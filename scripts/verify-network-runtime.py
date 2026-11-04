"""Read-only DI, CU and Cosmos calls from AKS using active application settings.

Credentials remain in process memory and kubectl stdin; only HTTP results print.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("environment", choices=["test", "prod"])
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
context = "probono-law-aks-test-nc" if args.environment == "test" else "probono-law-aks-prod"
os.environ["PATH"] = str(Path.home() / ".azure-kubelogin") + os.pathsep + os.environ["PATH"]

def kubectl(namespace, arguments, stdin=None):
    result = subprocess.run(["kubectl", "--context", context, "-n", namespace] + arguments, input=stdin, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("kubectl verification failed: " + result.stderr)
    return result.stdout


def pod(namespace, label):
    return next(p["metadata"]["name"] for p in json.loads(kubectl(namespace, ["get", "pods", "-l", label, "-o", "json"]))["items"] if all(c["ready"] for c in p["status"]["containerStatuses"]))


settings = json.loads(kubectl("file-operations", ["exec", pod("file-operations", "app=data-integrity-api"), "--", "cat", "/mnt/keyvault/appsettings.json"]))
keys = ["DI_ENDPOINT", "DI_KEY", "CONTENT_UNDERSTANDING_ENDPOINT", "CONTENT_UNDERSTANDING_API_KEY", "COSMOS_ENDPOINT", "COSMOS_KEY"]
settings = {k: settings[k] for k in keys}
code = "settings = " + repr(settings) + '''
import base64, datetime, hashlib, hmac, json, urllib.request, urllib.parse, urllib.error
results = []
def get(component, url, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as response:
            status = response.status
            response.read()
    except urllib.error.HTTPError as error:
        status = error.code
    assert status == 200, component + " HTTP " + str(status)
    results.append({"component": component, "http": status})
get("Document Intelligence", settings["DI_ENDPOINT"].rstrip("/") + "/documentintelligence/documentModels/prebuilt-layout?api-version=2024-11-30", {"Ocp-Apim-Subscription-Key": settings["DI_KEY"]})
for analyzer in ("prebuilt-documentSearch", "prebuilt-audioSearch", "prebuilt-videoSearch"):
    get("Content Understanding " + analyzer, settings["CONTENT_UNDERSTANDING_ENDPOINT"].rstrip("/") + "/contentunderstanding/analyzers/" + analyzer + "?api-version=2025-11-01", {"Ocp-Apim-Subscription-Key": settings["CONTENT_UNDERSTANDING_API_KEY"]})
date = datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
payload = "get\\ndbs\\n\\n" + date.lower() + "\\n\\n"
signature = base64.b64encode(hmac.new(base64.b64decode(settings["COSMOS_KEY"]), payload.encode(), hashlib.sha256).digest()).decode()
get("Cosmos DB database metadata", settings["COSMOS_ENDPOINT"].rstrip("/") + "/dbs", {"x-ms-date": date, "x-ms-version": "2018-12-31", "authorization": urllib.parse.quote("type=master&ver=1.0&sig=" + signature)})
print(json.dumps(results))
'''
results = json.loads(kubectl("aimie-operations", ["exec", "-i", pod("aimie-operations", "app=aimie-service"), "-c", "functions", "--", "python", "-"], code))
report = {"environment": args.environment, "results": results}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
