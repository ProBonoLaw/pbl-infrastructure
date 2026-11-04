"""Convert existing Cosmos accounts and replicate to North Central US in stages.

Uses the documented capacityMode property in API 2026-04-01-preview. No account,
database, container, item, identity or permission is created or deleted here.
Each phase validates its prerequisites and records ARM metadata in a journal.
Run verify-cosmos-data.py before conversion and before/after regional failover.
"""
import argparse
import datetime
import importlib
import json
from pathlib import Path
import time

Arm = importlib.import_module("consolidate-private-endpoints").Arm
ENVIRONMENTS = {
    "test": ("00000000-0000-4000-8000-000000000003", "testsuffix001"),
    "prod": ("00000000-0000-4000-8000-000000000002", "prodsuffix001"),
}
API = "?api-version=2026-04-01-preview"
# Keep room for expensive conversation queries; other low-volume containers
# use the smallest autoscale ceiling. Zone redundancy has no autoscale premium.
AUTOSCALE = {name: (5000 if name == "messages2" else 2000 if name == "notices" else 1000)
             for name in ("accounts", "accountUsage", "aimieStats", "messages2", "notices",
                          "requests", "clientFeedbackRequests", "feedback", "billingRuns")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=ENVIRONMENTS)
    parser.add_argument("phase", choices=["convert", "autoscale", "replicate", "promote", "retire-central", "inspect", "resume"])
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    subscription, suffix = ENVIRONMENTS[args.environment]
    arm = Arm(subscription)
    root = f"/subscriptions/{subscription}/resourceGroups/shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/db-law-sls-{suffix}"
    journal = json.loads(args.journal.read_text()) if args.journal.exists() else {
        "environment": args.environment, "accountId": root, "operations": []}
    assert journal["accountId"] == root

    def save():
        temporary = args.journal.with_suffix(".tmp")
        temporary.write_text(json.dumps(journal, indent=2), encoding="utf-8")
        temporary.replace(args.journal)

    def account():
        return arm.request("GET", root + API)

    def wait_ready():
        for _ in range(720):
            current = account()
            props = current["properties"]
            transition = props.get("capacityModeChangeTransitionState") or {}
            if props["provisioningState"] == "Succeeded" and transition.get("capacityModeTransitionStatus") not in ("Initialized", "InProgress"):
                return current
            if props["provisioningState"] in ("Failed", "Canceled") or transition.get("capacityModeTransitionStatus") == "Failed":
                raise RuntimeError("Account operation failed; inspect journal and Azure operation status")
            time.sleep(5)
        raise TimeoutError("Operation still running; inspect before retrying")

    current = account()
    props = current["properties"]
    locations = {x["locationName"]: x for x in props["locations"]}
    if args.phase == "inspect":
        print(json.dumps({"environment": args.environment, "name": current["name"],
                          "mode": props.get("capacityMode"), "state": props["provisioningState"],
                          "transition": props.get("capacityModeChangeTransitionState"),
                          "locations": [{k: x.get(k) for k in ("locationName", "failoverPriority", "isZoneRedundant", "provisioningState")} for x in props["locations"]]}))
        return
    if args.phase == "resume":
        # A local polling timeout does not cancel the Azure operation. Resume
        # observation of the recorded request; never submit the mutation again.
        pending = journal["operations"][-1]
        assert not pending["complete"] and pending.get("request")
        assert pending["phase"] in ("convert", "replicate", "promote", "retire-central")
        current = wait_ready()
        final = current["properties"]
        assert final["capacityMode"] == "Provisioned"
        final_locations = {x["locationName"]: x for x in final["locations"]}
        if pending["phase"] == "convert":
            assert set(final_locations) == {"Central US"}
        elif pending["phase"] == "replicate":
            assert set(final_locations) == {"Central US", "North Central US"}
            assert final_locations["North Central US"]["failoverPriority"] == 1
        elif pending["phase"] == "promote":
            assert final["writeLocations"][0]["locationName"] == "North Central US"
        else:
            assert set(final_locations) == {"North Central US"}
        pending["complete"] = True
        pending["finished"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        pending["resumedObservation"] = True
        journal["current"] = current
        save()
        print(json.dumps({"environment": args.environment, "phase": pending["phase"], "complete": True, "resumedObservation": True}))
        return
    assert props["provisioningState"] == "Succeeded", "Wait for existing operation"
    journal.setdefault("before", current)
    operation = {"phase": args.phase, "started": datetime.datetime.now(datetime.timezone.utc).isoformat(), "complete": False}
    journal["operations"].append(operation)
    save()

    if args.phase == "convert":
        assert args.baseline, "A verified data baseline is required"
        baseline = json.loads(args.baseline.read_text())
        assert baseline["environment"] == args.environment and baseline["accountName"] == current["name"]
        assert baseline["complete"] and len(baseline["containers"]) == 9
        assert set(locations) == {"Central US"}
        assert props.get("capacityMode") == "Serverless"
        regional = arm.request("GET", f"/subscriptions/{subscription}/providers/Microsoft.DocumentDB/locations/northcentralus" + API)
        assert regional["properties"]["isSubscriptionRegionAccessAllowedForAz"]
        operation["request"] = {"properties": {"capacityMode": "Provisioned"}}
        save()
        arm.request("PATCH", root + API, operation["request"])
        current = wait_ready()
        assert current["properties"].get("capacityMode") == "Provisioned"
    else:
        assert props.get("capacityMode") == "Provisioned", "Convert first"
        if args.phase == "autoscale":
            containers = arm.request("GET", root + "/sqlDatabases/db_conversation_history/containers" + API)["value"]
            assert {c["name"] for c in containers} == set(AUTOSCALE)
            operation["containers"] = {}
            for container in containers:
                path = container["id"] + "/throughputSettings/default"
                throughput = arm.request("GET", path + API)["properties"]["resource"]
                if not throughput.get("autoscaleSettings"):
                    arm.request("POST", path + "/migrateToAutoscale" + API, {})
                body = {"properties": {"resource": {"autoscaleSettings": {"maxThroughput": AUTOSCALE[container["name"]]}}}}
                arm.request("PUT", path + API, body)
                result = arm.request("GET", path + API)["properties"]["resource"]
                assert result["autoscaleSettings"]["maxThroughput"] == AUTOSCALE[container["name"]]
                operation["containers"][container["name"]] = result
                save()
                print(json.dumps({"container": container["name"], "maxThroughput": AUTOSCALE[container["name"]]}), flush=True)
        elif args.phase == "replicate":
            assert set(locations) == {"Central US"}
            operation["request"] = {"properties": {"locations": [
                {"locationName": "Central US", "failoverPriority": 0, "isZoneRedundant": False},
                {"locationName": "North Central US", "failoverPriority": 1, "isZoneRedundant": True}]}}
            save()
            arm.request("PATCH", root + API, operation["request"])
            current = wait_ready()
            assert len(current["properties"]["readLocations"]) == 2
        elif args.phase == "promote":
            assert set(locations) == {"Central US", "North Central US"}
            assert all(x["provisioningState"] == "Succeeded" for x in locations.values())
            assert locations["Central US"]["failoverPriority"] == 0
            assert args.baseline, "Verified North Central US replica report is required"
            report = json.loads(args.baseline.read_text())
            assert report["environment"] == args.environment and report["accountName"] == current["name"]
            assert report["complete"] and len(report["containers"]) == 9 and report["region"] == "northcentralus" and report.get("differences") == []
            operation["request"] = {"failoverPolicies": [
                {"locationName": "North Central US", "failoverPriority": 0},
                {"locationName": "Central US", "failoverPriority": 1}]}
            save()
            arm.request("POST", root + "/failoverPriorityChange" + API, operation["request"])
            current = wait_ready()
            assert current["properties"]["writeLocations"][0]["locationName"] == "North Central US"
        elif args.phase == "retire-central":
            assert set(locations) == {"Central US", "North Central US"}
            assert locations["North Central US"]["failoverPriority"] == 0
            assert args.baseline, "Validated North Central US data report is required"
            report = json.loads(args.baseline.read_text())
            assert report["environment"] == args.environment and report["accountName"] == current["name"]
            assert report["complete"] and len(report["containers"]) == 9 and report["region"] == "northcentralus" and report.get("differences") == []
            operation["request"] = {"properties": {"locations": [
                {"locationName": "North Central US", "failoverPriority": 0, "isZoneRedundant": True}]}}
            save()
            arm.request("PATCH", root + API, operation["request"])
            current = wait_ready()
            assert len(current["properties"]["locations"]) == 1
    operation["complete"] = True
    operation["finished"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    journal["current"] = account()
    save()
    print(json.dumps({"environment": args.environment, "phase": args.phase, "complete": True}))


if __name__ == "__main__":
    main()
