"""Safety gates for an irreversible account conversion and regional retirement."""
import contextlib
import copy
import importlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

migration = importlib.import_module("migrate-cosmos-region")


class MigrationGuards(unittest.TestCase):
    def run_phase(self, phase, baseline, mode="Serverless", locations=None):
        calls = []
        account = {"name": "db-law-sls-testsuffix001", "properties": {
            "capacityMode": mode, "provisioningState": "Succeeded",
            "locations": locations or [{"locationName": "Central US", "failoverPriority": 0}],
        }}

        class FakeArm:
            def __init__(self, subscription):
                self.subscription = subscription

            def request(self, method, path, body=None):
                calls.append((method, path, body))
                if "/locations/northcentralus" in path:
                    return {"properties": {"isSubscriptionRegionAccessAllowedForAz": True}}
                if method == "PATCH":
                    account["properties"]["capacityMode"] = "Provisioned"
                return copy.deepcopy(account)

        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            report = directory / "baseline.json"
            report.write_text(json.dumps(baseline))
            argv = ["migration", "test", phase, "--journal", str(directory / "journal.json"), "--baseline", str(report)]
            with patch.object(migration, "Arm", FakeArm), patch("sys.argv", argv), contextlib.redirect_stdout(io.StringIO()):
                try:
                    migration.main()
                    failure = None
                except AssertionError as error:
                    failure = error
        return calls, failure

    def baseline(self):
        return {"environment": "test", "accountName": "db-law-sls-testsuffix001", "complete": True,
                "containers": [{}] * 9, "region": "northcentralus", "differences": []}

    def test_cross_environment_baseline_cannot_authorize_conversion(self):
        baseline = self.baseline()
        baseline["environment"] = "prod"
        calls, failure = self.run_phase("convert", baseline)
        self.assertIsNotNone(failure)
        self.assertTrue(all(method == "GET" for method, _, _ in calls))

    def test_conversion_only_changes_capacity_mode(self):
        calls, failure = self.run_phase("convert", self.baseline())
        self.assertIsNone(failure)
        writes = [(method, body) for method, _, body in calls if method != "GET"]
        self.assertEqual(writes, [("PATCH", {"properties": {"capacityMode": "Provisioned"}})])

    def test_data_difference_blocks_removal_of_source_region(self):
        baseline = self.baseline()
        baseline["differences"] = [{"container": "accounts", "beforeCount": 10, "afterCount": 9}]
        calls, failure = self.run_phase("retire-central", baseline, "Provisioned", [
            {"locationName": "North Central US", "failoverPriority": 0},
            {"locationName": "Central US", "failoverPriority": 1},
        ])
        self.assertIsNotNone(failure)
        self.assertTrue(all(method == "GET" for method, _, _ in calls))

    def test_latency_only_or_empty_report_cannot_authorize_regional_changes(self):
        for phase in ("promote", "retire-central"):
            locations = [
                {"locationName": "Central US", "failoverPriority": 0 if phase == "promote" else 1, "provisioningState": "Succeeded"},
                {"locationName": "North Central US", "failoverPriority": 1 if phase == "promote" else 0, "provisioningState": "Succeeded"},
            ]
            for complete in (False, True):
                baseline = self.baseline()
                baseline.update({"containers": [], "complete": complete})
                with self.subTest(phase=phase, complete=complete):
                    calls, failure = self.run_phase(phase, baseline, "Provisioned", locations)
                    self.assertIsNotNone(failure)
                    self.assertTrue(all(method == "GET" for method, _, _ in calls))

    def test_incomplete_full_report_cannot_authorize_regional_changes(self):
        for phase in ("promote", "retire-central"):
            locations = [
                {"locationName": "Central US", "failoverPriority": 0 if phase == "promote" else 1, "provisioningState": "Succeeded"},
                {"locationName": "North Central US", "failoverPriority": 1 if phase == "promote" else 0, "provisioningState": "Succeeded"},
            ]
            baseline = self.baseline()
            baseline["complete"] = False
            with self.subTest(phase=phase):
                calls, failure = self.run_phase(phase, baseline, "Provisioned", locations)
                self.assertIsNotNone(failure)
                self.assertTrue(all(method == "GET" for method, _, _ in calls))


if __name__ == "__main__":
    unittest.main()
