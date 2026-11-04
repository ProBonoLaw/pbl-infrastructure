"""Verify final region, autoscale, schema, native RBAC, private DNS and AKS health."""
import argparse
import importlib
import json
import os
from pathlib import Path
import subprocess

m = importlib.import_module("migrate-cosmos-region")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("environment", choices=m.ENVIRONMENTS)
parser.add_argument("--before", type=Path, required=True)
parser.add_argument("--data-report", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
subscription, suffix = m.ENVIRONMENTS[args.environment]
arm = m.Arm(subscription)
before = json.loads(args.before.read_text())
data = json.loads(args.data_report.read_text())
assert before["environment"] == data["environment"] == args.environment
root = before["account"]["id"]
assert root == f"/subscriptions/{subscription}/resourceGroups/shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/db-law-sls-{suffix}"
account = arm.request("GET", root + m.API)
props = account["properties"]
assert props["provisioningState"] == "Succeeded"
assert props["capacityMode"] == "Provisioned"
assert not any(x["name"] == "EnableServerless" for x in props.get("capabilities", []))
assert len(props["locations"]) == 1
assert props["locations"][0]["locationName"] == "North Central US"
assert props["locations"][0]["isZoneRedundant"] is True
assert props["locations"][0]["failoverPriority"] == 0
assert props["writeLocations"][0]["locationName"] == "North Central US"
assert props["documentEndpoint"] == before["account"]["properties"]["documentEndpoint"]
assert account["location"] == before["account"]["location"]
for field in ("publicNetworkAccess", "isVirtualNetworkFilterEnabled", "disableLocalAuth", "ipRules",
              "virtualNetworkRules", "networkAclBypass", "networkAclBypassResourceIds", "consistencyPolicy", "backupPolicy"):
    assert props.get(field) == before["account"]["properties"].get(field), field + " changed"

for field, path in (("roles", "sqlRoleDefinitions"), ("assignments", "sqlRoleAssignments")):
    current = arm.request("GET", root + "/" + path + m.API)["value"]
    assert {x["id"]: x["properties"] for x in current} == {x["id"]: x["properties"] for x in before[field]}, field + " changed"

schema_fields = ("id", "_rid", "partitionKey", "indexingPolicy", "uniqueKeyPolicy", "conflictResolutionPolicy",
                 "defaultTtl", "analyticalStorageTtl", "fullTextPolicy", "vectorEmbeddingPolicy")
throughput = {}
for database in before["databases"]:
    current = arm.request("GET", database["database"]["id"] + "/containers" + m.API)["value"]
    old = {c["name"]: c for c in database["containers"]}
    assert set(old) == {c["name"] for c in current}
    for container in current:
        original = old[container["name"]]["properties"]["resource"]
        resource = container["properties"]["resource"]
        assert {k:resource.get(k) for k in schema_fields} == {k:original.get(k) for k in schema_fields}, container["name"] + " schema changed"
        settings = arm.request("GET", container["id"] + "/throughputSettings/default" + m.API)["properties"]["resource"]
        assert settings["autoscaleSettings"]["maxThroughput"] == m.AUTOSCALE[container["name"]]
        assert str(settings.get("offerReplacePending", False)).lower() in ("false", "none"), "Throughput update remains pending"
        throughput[container["name"]] = settings["autoscaleSettings"]["maxThroughput"]

dns = arm.request("GET", f"/subscriptions/{subscription}/resourceGroups/shared-dbs/providers/Microsoft.Network/privateEndpoints/aks-nc-cosmos-pe/privateDnsZoneGroups/default")
records = [record for zone in dns["properties"]["privateDnsZoneConfigs"] for record in zone["properties"]["recordSets"]]
assert {r["recordSetName"] for r in records} == {account["name"], account["name"] + "-northcentralus"}
assert all(ip.startswith("172.28.243.") for r in records for ip in r["ipAddresses"])
assert data["accountName"] == account["name"] and data["complete"] and data["differences"] == []
assert len(data["containers"]) == 9
assert data["region"] == "northcentralus"

os.environ["PATH"] = str(Path.home() / ".azure-kubelogin") + os.pathsep + os.environ["PATH"]
context = "probono-law-aks-test-nc" if args.environment == "test" else "probono-law-aks-prod"
result = subprocess.run(["kubectl", "--context", context, "get", "deployments", "--all-namespaces", "-o", "json"], capture_output=True, text=True, check=True)
deployments = json.loads(result.stdout)["items"]
not_ready = [d["metadata"]["namespace"] + "/" + d["metadata"]["name"] for d in deployments if d["spec"].get("replicas",1) != d["status"].get("readyReplicas",0)]
assert not not_ready, "Deployments not ready: " + str(not_ready)
report = {"environment":args.environment,"accountName":account["name"],"dataRegion":"North Central US",
          "zoneRedundant":True,"mode":"Provisioned autoscale","unchangedSchemaAndPermissions":True,
          "nativeRoleAssignments":len(before["assignments"]),"autoscaleMaxThroughput":throughput,
          "verifiedDocuments":sum(c["count"] for c in data["containers"]),"dataHashesMatch":True,
          "privateDnsRecords":[{k:r[k] for k in ("recordSetName","ipAddresses")} for r in records],
          "readyDeployments":len(deployments),"complete":True}
args.output.write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report))
