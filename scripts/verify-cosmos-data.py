"""Read Cosmos data from AKS; write only counts and cryptographic digests locally.

Uses the active File Operations endpoint/key in memory through kubectl stdin.
Never prints credentials or item contents. All data-plane calls are read-only.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("environment", choices=["test", "prod"])
parser.add_argument("--region", choices=["global", "centralus", "northcentralus"], default="global")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--compare", type=Path)
parser.add_argument("--latency-only", action="store_true")
args = parser.parse_args()
if args.latency_only and args.compare:
    parser.error("Latency-only reports cannot be used for data comparisons")
context = "probono-law-aks-test-nc" if args.environment == "test" else "probono-law-aks-prod"
os.environ["PATH"] = str(Path.home() / ".azure-kubelogin") + os.pathsep + os.environ["PATH"]


def kubectl(namespace, arguments, stdin=None):
    result = subprocess.run(["kubectl", "--context", context, "-n", namespace] + arguments,
                            input=stdin, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("kubectl verification failed: " + result.stderr)
    return result.stdout


def pod(namespace, label):
    return next(p["metadata"]["name"] for p in json.loads(kubectl(namespace, ["get", "pods", "-l", label, "-o", "json"]))["items"]
                if p["status"].get("containerStatuses") and all(c["ready"] for c in p["status"]["containerStatuses"]))


settings = json.loads(kubectl("file-operations", ["exec", pod("file-operations", "app=data-integrity-api"), "--", "cat", "/mnt/keyvault/appsettings.json"]))
settings = {k: settings[k] for k in ("COSMOS_ENDPOINT", "COSMOS_KEY")}
code = "settings = " + repr(settings) + "\nregion = " + repr(args.region) + "\nlatency_only = " + repr(args.latency_only) + r'''
import base64, datetime, hashlib, hmac, http.client, json, socket, statistics, time, urllib.request, urllib.parse, urllib.error
name = urllib.parse.urlparse(settings["COSMOS_ENDPOINT"]).hostname.split(".")[0]
host = name + ("-" + region if region != "global" else "") + ".documents.azure.com"
ips = sorted({x[4][0] for x in socket.getaddrinfo(host,443)})
assert all(x.startswith("172.28.243.") for x in ips), "Cosmos must resolve through the NCUS private endpoint"
feed_connection = http.client.HTTPSConnection(host,443,timeout=60)
def get(path, resource_type, resource_id, continuation=None):
    global feed_connection
    for attempt in range(8):
        date = datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        payload = "get\n" + resource_type + "\n" + resource_id + "\n" + date.lower() + "\n\n"
        signature = base64.b64encode(hmac.new(base64.b64decode(settings["COSMOS_KEY"]), payload.encode(), hashlib.sha256).digest()).decode()
        headers = {"x-ms-date": date, "x-ms-version": "2018-12-31", "authorization": urllib.parse.quote("type=master&ver=1.0&sig=" + signature), "x-ms-max-item-count": "100"}
        if continuation: headers["x-ms-continuation"] = continuation
        try:
            feed_connection.request("GET","/"+path,headers=headers)
            response=feed_connection.getresponse()
            body=response.read()
            if response.status == 429:
                time.sleep(max(0.1,float(response.headers.get("x-ms-retry-after-ms","1000"))/1000)); continue
            if response.status != 200:
                raise RuntimeError("Cosmos read returned HTTP " + str(response.status))
            return json.loads(body), response.headers.get("x-ms-continuation"), float(response.headers.get("x-ms-request-charge",0))
        except (http.client.HTTPException, OSError):
            feed_connection.close()
            feed_connection = http.client.HTTPSConnection(host,443,timeout=60)
            if attempt == 7: raise RuntimeError("Cosmos read connection failed after retries") from None
            time.sleep(0.25)
    raise RuntimeError("Cosmos read remained throttled")
def feed(path, kind, rid, key):
    continuation = None
    while True:
        result, continuation, charge = get(path, kind, rid, continuation)
        yield from result[key]
        if not continuation: break
started = time.monotonic()
containers=[]
for database in ([] if latency_only else feed("dbs", "dbs", "", "Databases")):
    database_id = "dbs/" + database["id"]
    for container in feed(database_id+"/colls", "colls", database_id, "DocumentCollections"):
        rid = database_id + "/colls/" + container["id"]
        digests=[]
        for item in feed(rid+"/docs", "docs", rid, "Documents"):
            digests.append(hashlib.sha256(json.dumps(item,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest())
        ranges=list(feed(rid+"/pkranges", "pkranges", rid, "PartitionKeyRanges"))
        containers.append({"database": database["id"], "name": container["id"], "count":len(digests),
                           "digest":hashlib.sha256("\n".join(sorted(digests)).encode()).hexdigest(),
                           "physicalPartitions":len(ranges),"partitionKey":container["partitionKey"]})
latency = None
if latency_only:
    parent = "dbs/db_conversation_history/colls/accounts"
    sample = next(feed(parent+"/docs", "docs", parent, "Documents"))
    rid = parent + "/docs/" + sample["id"]
    connection = http.client.HTTPSConnection(host,443,timeout=30)
    timings=[]
    for i in range(35):
        date = datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        payload = "get\ndocs\n" + rid + "\n" + date.lower() + "\n\n"
        sig = base64.b64encode(hmac.new(base64.b64decode(settings["COSMOS_KEY"]),payload.encode(),hashlib.sha256).digest()).decode()
        headers={"x-ms-date":date,"x-ms-version":"2018-12-31","authorization":urllib.parse.quote("type=master&ver=1.0&sig="+sig),
                 "x-ms-documentdb-partitionkey":json.dumps([sample["accountId"]])}
        before=time.perf_counter()
        connection.request("GET","/"+urllib.parse.quote(rid,safe="/"),headers=headers)
        response=connection.getresponse();response.read()
        assert response.status == 200, "Point read failed HTTP " + str(response.status)
        if i>=5:timings.append((time.perf_counter()-before)*1000)
    connection.close()
    latency={"samples":len(timings),"medianMs":round(statistics.median(timings),2),"p95Ms":round(sorted(timings)[28],2)}
feed_connection.close()
print(json.dumps({"accountName":name,"region":region,"privateIps":ips,"containers":containers,
                  "pointReadLatency":latency,"elapsedSeconds":round(time.monotonic()-started,3),"complete":not latency_only}))
'''
report = json.loads(kubectl("aimie-operations", ["exec", "-i", pod("aimie-operations", "app=aimie-service"), "-c", "functions", "--", "python", "-"], code))
report["environment"] = args.environment
report["capturedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
if args.compare:
    baseline = json.loads(args.compare.read_text())
    assert baseline["complete"] and report["complete"] and baseline["containers"] and report["containers"], "Full data scans are required for comparison"
    assert baseline["environment"] == args.environment and baseline["accountName"] == report["accountName"]
    before = {c["name"]: c for c in baseline["containers"]}
    assert set(before) == {c["name"] for c in report["containers"]}
    report["differences"] = [{"container":c["name"],"beforeCount":before[c["name"]]["count"],"afterCount":c["count"]}
                             for c in report["containers"] if c["digest"] != before[c["name"]]["digest"]]
args.output.write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report))
