"""Staged ARM migration of existing PEs; keep old routes until AKS verification.

Inventory/state files contain resource metadata, never account keys or tokens.
Run inventory, stage, probe from AKS, cutover, verify from AKS, then retire.
Each mutation is journaled. Pulumi adoption follows before VNet retirement.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error

SUBSCRIPTIONS = {"test": "00000000-0000-4000-8000-000000000003", "prod": "00000000-0000-4000-8000-000000000002"}
NETWORK_API = "2024-05-01"
SERVICES = {
    "primary-foundry": ("foundry", "aimie3-logic-pe"),
    "shared-dbs/Sql": ("cosmos", "cosmos-serverless-pilot-logic-pe"),
    "shared-dbs/searchService": ("search", "search-northcentral-pe"),
    "probono-law-data-ingestion-event-hubs-service": ("eventhubs", "consolidated-logic-eventhub-pe"),
    "aimie-notification": ("webpubsub", "aimie-notification-webpubsub-pe"),
    "data-integrity-extractor": ("document-ingress", "document-integrity-cognitive-services-pe"),
    "customer-account-kv": ("customer-vault", "customer-vault-logic-pe"),
    "onboarding-dpl": ("onboarding-vault", "onboarding-vault-logic-pe"),
}


class Arm:
    def __init__(self, subscription):
        self.subscription = subscription
        self.token = None
        self.expiry = 0

    def request(self, method, path, body=None, missing_ok=False):
        if time.time() > self.expiry:
            result = subprocess.run(["az.cmd" if os.name == "nt" else "az", "account", "get-access-token", "--subscription", self.subscription, "-o", "json"], capture_output=True, check=True, text=True)
            self.token = json.loads(result.stdout)["accessToken"]
            self.expiry = time.time() + 1800
        url = path if path.startswith("https://") else "https://management.azure.com" + path
        if "api-version=" not in url:
            url += "?api-version=" + NETWORK_API
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read()
                data = json.loads(raw) if raw else {}
                if response.status == 202 and not data:
                    data = {"status": "InProgress"}
                poll = response.headers.get("Azure-AsyncOperation") or response.headers.get("Location")
        except urllib.error.HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            detail = json.loads(error.read() or b"{}")
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {detail}") from None
        if method != "GET" and poll:
            for _ in range(600):
                status = self.request("GET", poll)
                state = status.get("status", status.get("properties", {}).get("provisioningState", "Succeeded"))
                if state == "Succeeded":
                    break
                if state in ("Failed", "Canceled"):
                    raise RuntimeError(f"ARM operation failed: {status}")
                time.sleep(3)
            else:
                raise TimeoutError(path)
        if method == "DELETE":
            for _ in range(600):
                if self.request("GET", path, missing_ok=True) is None:
                    break
                time.sleep(3)
            else:
                raise TimeoutError("Deletion did not finish: " + path)
        return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=SUBSCRIPTIONS)
    parser.add_argument("phase", choices=["inventory", "stage", "cutover", "retire"])
    parser.add_argument("--journal", type=Path, required=True)
    args = parser.parse_args()
    arm = Arm(SUBSCRIPTIONS[args.environment])
    root = "/subscriptions/" + arm.subscription
    subnet = root + "/resourceGroups/shared-vnet-aks-northcentral/providers/Microsoft.Network/virtualNetworks/aks-northcentral/subnets/private-endpoints"

    def save():
        temporary = args.journal.with_suffix(".tmp")
        temporary.write_text(json.dumps(journal, indent=2), encoding="utf-8")
        temporary.replace(args.journal)

    if args.phase == "inventory":
        if args.journal.exists():
            raise RuntimeError("Journal already exists; preserve original inventory")
        journal = {"environment": args.environment, "subscription": arm.subscription, "subnet": subnet, "endpoints": []}
        endpoints = arm.request("GET", root + "/providers/Microsoft.Network/privateEndpoints")["value"]
        for old in endpoints:
            if "/vnet-logic-apps-operations/" not in old["properties"]["subnet"]["id"]:
                continue
            group = old["id"].split("/")[4]
            connection = old["properties"]["privateLinkServiceConnections"][0]["properties"]
            group_ids = connection["groupIds"]
            key = group + "/" + group_ids[0] if group == "shared-dbs" else group
            if group == "data-loader-foundry":
                service, logical = ("document-intelligence", "cognitive-logic-pe") if "/cog-svc-" in connection["privateLinkServiceId"] else ("data-loader", "data-loader-logic-pe")
            else:
                service, logical = SERVICES[key]
            name = "aks-nc-" + service + "-pe"
            new_id = root + "/resourceGroups/" + group + "/providers/Microsoft.Network/privateEndpoints/" + name
            zones = arm.request("GET", old["id"] + "/privateDnsZoneGroups")["value"]
            assert len(zones) == 1, (service, zones)
            journal["endpoints"].append({"service": service, "logical": logical, "old": old, "oldZoneGroup": zones[0], "newId": new_id, "newName": name, "group": group})
        assert len(journal["endpoints"]) == 10
        save()
    else:
        journal = json.loads(args.journal.read_text(encoding="utf-8-sig"))
        assert journal["subscription"] == arm.subscription and journal["subnet"] == subnet
    for entry in journal["endpoints"]:
        service = entry["service"]
        if args.phase == "stage":
            existing = arm.request("GET", entry["newId"], missing_ok=True)
            connection = entry["old"]["properties"]["privateLinkServiceConnections"][0]["properties"]
            if not existing:
                arm.request("PUT", entry["newId"], {"location": "northcentralus", "properties": {"subnet": {"id": subnet}, "privateLinkServiceConnections": [{"name": entry["newName"], "properties": {"privateLinkServiceId": connection["privateLinkServiceId"], "groupIds": connection["groupIds"]}}]}})
            new = arm.request("GET", entry["newId"])
            assert new["properties"]["provisioningState"] == "Succeeded", "Wait for provisioning before verification"
            assert new["properties"]["subnet"]["id"].lower() == subnet.lower()
            new_connection = new["properties"]["privateLinkServiceConnections"][0]["properties"]
            assert new_connection["privateLinkServiceId"].lower() == connection["privateLinkServiceId"].lower()
            assert new_connection["privateLinkServiceConnectionState"]["status"] == "Approved"
            entry["new"] = new
            entry["nics"] = [arm.request("GET", nic["id"]) for nic in new["properties"]["networkInterfaces"]]
            if service == "webpubsub":
                target = connection["privateLinkServiceId"] + "?api-version=2025-01-01-preview"
                resource = arm.request("GET", target)
                private_connection = next(c for c in resource["properties"]["privateEndpointConnections"] if c["properties"]["privateEndpoint"]["id"].lower() == entry["newId"].lower())
                acls = resource["properties"]["networkACLs"]
                entry.setdefault("oldWebPubSubAcl", acls)
                allowed = ["ServerConnection", "ClientConnection", "RESTAPI", "Trace"]
                if not any(a["name"] == private_connection["name"] for a in acls.get("privateEndpoints", [])):
                    acls.setdefault("privateEndpoints", []).append({"name": private_connection["name"], "allow": allowed})
                    arm.request("PATCH", target, {"properties": {"networkACLs": acls}})
            entry["staged"] = True
            save()
        elif args.phase == "cutover" and not entry.get("cutover"):
            assert entry.get("staged") and journal.get("stagedProbePassed"), "Record successful direct-IP AKS probes first"
            old_zone = entry["oldZoneGroup"]
            configs = [{"name": z["name"], "properties": {"privateDnsZoneId": z["properties"]["privateDnsZoneId"]}} for z in old_zone["properties"]["privateDnsZoneConfigs"]]
            old_configs = list(configs)
            if service == "data-loader":
                prefix = configs[0]["properties"]["privateDnsZoneId"].rsplit("/", 1)[0]
                for zone in ("privatelink.openai.azure.com", "privatelink.services.ai.azure.com"):
                    if not any(c["properties"]["privateDnsZoneId"].endswith("/" + zone) for c in configs):
                        configs.append({"name": zone, "properties": {"privateDnsZoneId": prefix + "/" + zone}})
            # All old IPs stay reachable through the peerings during DNS cache expiry.
            arm.request("DELETE", old_zone["id"], missing_ok=True)
            try:
                arm.request("PUT", entry["newId"] + "/privateDnsZoneGroups/default", {"properties": {"privateDnsZoneConfigs": configs}})
            except Exception:
                arm.request("PUT", old_zone["id"], {"properties": {"privateDnsZoneConfigs": old_configs}})
                raise
            entry["newZoneGroup"] = arm.request("GET", entry["newId"] + "/privateDnsZoneGroups/default")
            entry["cutover"] = True
            save()
        elif args.phase == "retire" and not entry.get("retired"):
            assert all(e.get("cutover") for e in journal["endpoints"]) and journal.get("dnsProbePassed"), "Record successful DNS/API checks from AKS first"
            arm.request("DELETE", entry["old"]["id"], missing_ok=True)
            assert arm.request("GET", entry["old"]["id"], missing_ok=True) is None
            entry["retired"] = True
            save()
        print(f"{args.environment} {args.phase}: {service}", flush=True)


if __name__ == "__main__":
    main()
