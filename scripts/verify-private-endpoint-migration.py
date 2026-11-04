"""Probe every new PE IP with TLS/SNI from AKS, then validate DNS after cutover."""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("phase", choices=["stage", "dns"])
parser.add_argument("--journal", type=Path, required=True)
args = parser.parse_args()
journal = json.loads(args.journal.read_text(encoding="utf-8-sig"))
assert all(e.get("staged") for e in journal["endpoints"])
context = "probono-law-aks-test-nc" if journal["environment"] == "test" else "probono-law-aks-prod"
os.environ["PATH"] = str(Path.home() / ".azure-kubelogin") + os.pathsep + os.environ["PATH"]
prefix = ["kubectl", "--context", context, "-n", "aimie-operations"]
pods = json.loads(subprocess.run(prefix + ["get", "pods", "-l", "app=aimie-service", "-o", "json"], check=True, capture_output=True, text=True).stdout)
pod = next(p["metadata"]["name"] for p in pods["items"] if all(c["ready"] for c in p["status"]["containerStatuses"]))
checks = []
for entry in journal["endpoints"]:
    for dns in entry["new"]["properties"]["customDnsConfigs"]:
        for ip in dns["ipAddresses"]:
            checks.append({"service": entry["service"], "host": dns["fqdn"], "ip": ip})
assert len(checks) >= 10
code = "checks = " + repr(checks) + "\nuse_dns = " + repr(args.phase == "dns") + '''
import json, socket, ssl
results = []
for check in checks:
    host, expected = check["host"], check["ip"]
    ips = sorted(set(a[4][0] for a in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM))) if use_dns else [expected]
    if use_dns:
        assert expected in ips and all(ip.startswith("172.28.243.") for ip in ips), (host, ips, expected)
    with socket.create_connection((host if use_dns else expected, 443), timeout=20) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as connection:
            connection.sendall(("GET / HTTP/1.1\\r\\nHost: " + host + "\\r\\nConnection: close\\r\\n\\r\\n").encode())
            status = connection.recv(1024).split(b"\\r\\n", 1)[0].decode()
            assert status.startswith("HTTP/"), (host, status)
    if check["service"] == "eventhubs":
        with socket.create_connection((host if use_dns else expected, 5671), timeout=20) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host):
                pass
    results.append({**check, "resolved": ips, "status": status})
print(json.dumps(results))
'''
result = subprocess.run(prefix + ["exec", "-i", pod, "-c", "functions", "--", "python", "-"], input=code, text=True, capture_output=True)
if result.returncode:
    raise RuntimeError(result.stderr)
results = json.loads(result.stdout)
journal["stagedProbePassed" if args.phase == "stage" else "dnsProbePassed"] = True
journal[args.phase + "ProbeResults"] = results
args.journal.write_text(json.dumps(journal, indent=2), encoding="utf-8")
print(json.dumps({"environment": journal["environment"], "phase": args.phase, "passed": len(results), "services": sorted(set(c["service"] for c in results))}))
