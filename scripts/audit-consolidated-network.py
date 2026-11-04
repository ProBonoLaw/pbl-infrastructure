"""Assert the final live network shape and workload readiness in one environment."""
import argparse
import concurrent.futures
import importlib
import ipaddress
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("environment", choices=["test", "prod"])
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
migration = importlib.import_module("consolidate-private-endpoints")
arm = migration.Arm(migration.SUBSCRIPTIONS[args.environment])
root = "/subscriptions/" + arm.subscription
vnets = arm.request("GET", root + "/providers/Microsoft.Network/virtualNetworks")["value"]
assert len(vnets) == 1 and vnets[0]["name"] == "aks-northcentral"
vnet = vnets[0]
assert vnet["location"] == "northcentralus"
assert not vnet["properties"].get("virtualNetworkPeerings")
assert {s["name"] for s in vnet["properties"]["subnets"]} == {"aks", "private-endpoints"}
subnet = vnet["id"] + "/subnets/private-endpoints"
endpoints = arm.request("GET", root + "/providers/Microsoft.Network/privateEndpoints")["value"]
assert len(endpoints) == 17
for endpoint in endpoints:
    assert endpoint["location"] == "northcentralus"
    assert endpoint["properties"]["provisioningState"] == "Succeeded"
    assert endpoint["properties"]["subnet"]["id"].lower() == subnet.lower()
    assert all(c["properties"]["privateLinkServiceConnectionState"]["status"] == "Approved" for c in endpoint["properties"]["privateLinkServiceConnections"])
zones = arm.request("GET", root + "/providers/Microsoft.Network/privateDnsZones?api-version=2024-06-01")["value"]
assert len(zones) == 15
network = ipaddress.ip_network("172.28.243.0/24")

def audit_zone(zone):
    links = arm.request("GET", zone["id"] + "/virtualNetworkLinks?api-version=2024-06-01")["value"]
    assert len(links) == 1 and links[0]["properties"]["virtualNetwork"]["id"].lower() == vnet["id"].lower(), zone["name"]
    records = arm.request("GET", zone["id"] + "/A?api-version=2024-06-01")["value"]
    for record in records:
        assert all(ipaddress.ip_address(a["ipv4Address"]) in network for a in record["properties"].get("aRecords", [])), record["id"]
    return {"zone": zone["name"], "links": len(links), "aRecords": len(records)}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    dns = list(pool.map(audit_zone, zones))
os.environ["PATH"] = str(Path.home() / ".azure-kubelogin") + os.pathsep + os.environ["PATH"]
context = "probono-law-aks-test-nc" if args.environment == "test" else "probono-law-aks-prod"

def kubectl(arguments):
    return json.loads(subprocess.run(["kubectl", "--context", context] + arguments + ["-o", "json"], check=True, text=True, capture_output=True).stdout)

deployments = kubectl(["-n", "file-operations", "get", "deployments"])["items"]
assert len(deployments) == 12
assert all(d["spec"].get("replicas", 0) > 0 and
           d["spec"]["replicas"] == d.get("status", {}).get("readyReplicas", 0) == d.get("status", {}).get("updatedReplicas", 0)
           for d in deployments), "Every File Operations deployment must have positive, ready, updated replicas"
pods = kubectl(["-n", "aimie-operations", "get", "pods", "-l", "app=aimie-service"])["items"]
nodes = {n["metadata"]["name"]: n for n in kubectl(["get", "nodes"])["items"]}
assert pods
for pod in pods:
    assert all(c["ready"] for c in pod["status"]["containerStatuses"])
    assert nodes[pod["spec"]["nodeName"]]["metadata"]["labels"]["topology.kubernetes.io/region"] == "northcentralus"
report = {"environment": args.environment, "vnet": vnet["name"], "location": vnet["location"], "vnets": 1, "subnets": 2, "peerings": 0, "privateEndpoints": len(endpoints), "dnsZones": len(zones), "dnsLinks": sum(z["links"] for z in dns), "dnsAddressesWithinNorthVnet": True, "fileOperationsDeploymentsReady": len(deployments), "aimiePodsReadyInNorthCentralUS": len(pods), "dns": dns}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in report.items() if k != "dns"}))
