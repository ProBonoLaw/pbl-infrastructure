"""Offline regression checks for video retirement and audit failure cases."""
import ast
import contextlib
import importlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

vi = importlib.import_module("video-indexer-retirement")
reindex = importlib.import_module("reindex-video-library")


class VideoRequestSafety(unittest.TestCase):
    def client(self):
        client = vi.VideoIndexer("subscription", "account", "id", "Contributor")
        client.headers = Mock(return_value={})
        return client

    def test_creation_is_never_retried_after_an_uncertain_response(self):
        for status in (401, 429, 500, 502, 503, 504):
            response = SimpleNamespace(status_code=status, ok=False, json=lambda: {})
            with self.subTest(status=status), patch.object(vi.requests, "request", return_value=response) as request, patch.object(vi.time, "sleep"):
                with self.assertRaises(RuntimeError):
                    self.client().request("POST", "/Videos")
                self.assertEqual(request.call_count, 1)

    def test_reads_retry_transient_failures(self):
        responses = [SimpleNamespace(status_code=503),
                     SimpleNamespace(status_code=200, ok=True, content=b"{}", json=lambda: {"results": []})]
        with patch.object(vi.requests, "request", side_effect=responses) as request, patch.object(vi.time, "sleep"):
            self.assertEqual(self.client().request("GET", "/Videos"), {"results": []})
            self.assertEqual(request.call_count, 2)


class LeaseSafety(unittest.TestCase):
    def setUp(self):
        self.blob = Mock()
        self.thread = Mock()
        self.thread.is_alive.return_value = False
        self.thread_patch = patch.object(reindex.threading, "Thread", return_value=self.thread)
        self.thread_patch.start()
        self.addCleanup(self.thread_patch.stop)

    def test_finite_lease_is_released_on_success_and_operation_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.blob.reset_mock()
                try:
                    with reindex.MigrationLease(self.blob):
                        if fail:
                            raise ValueError("Interrupted migration")
                except ValueError:
                    pass
                self.blob.acquire_lease.assert_called_once_with(lease_duration=60)
                self.blob.acquire_lease.return_value.release.assert_called_once()

    def test_renewal_failure_blocks_mutation_and_success_report(self):
        guard = reindex.MigrationLease(self.blob).__enter__()
        guard.stopped.wait = Mock(return_value=False)
        guard.lease.renew.side_effect = OSError("Transport failure with private details")
        guard._renew()
        operation = Mock()
        with self.assertRaisesRegex(RuntimeError, "Migration lease lost"):
            guard.call(operation)
        operation.assert_not_called()
        with self.assertRaisesRegex(RuntimeError, "Migration lease lost"):
            guard.__exit__(None, None, None)
        guard.lease.release.assert_not_called()

    def test_renewal_keeps_long_running_migrations_active(self):
        with reindex.MigrationLease(self.blob) as guard:
            guard.stopped.wait = Mock(side_effect=[False, True])
            with patch.object(reindex.time, "monotonic", return_value=guard.renewed_at + 15):
                guard._renew()
                self.assertEqual(guard.call(lambda: "checkpoint"), "checkpoint")
            guard.lease.renew.assert_called_once()

    def test_expiry_blocks_work_even_if_renewal_thread_is_stalled(self):
        guard = reindex.MigrationLease(self.blob).__enter__()
        with patch.object(reindex.time, "monotonic", return_value=guard.renewed_at + 60):
            with self.assertRaises(RuntimeError):
                guard.call(Mock())
        guard.__exit__(ValueError, ValueError(), None)

    def test_lease_loss_during_operation_blocks_later_checkpoints(self):
        guard = reindex.MigrationLease(self.blob).__enter__()
        def operation():
            guard.lost.set()
        with self.assertRaises(RuntimeError):
            guard.call(operation)
        guard.__exit__(ValueError, ValueError(), None)


class AuditSafety(unittest.TestCase):
    def test_zero_or_partially_ready_replicas_cannot_pass_network_audit(self):
        tree = ast.parse(Path(__file__).with_name("audit-consolidated-network.py").read_text())
        assertion = next(n for n in tree.body if isinstance(n, ast.Assert) and n.msg is not None)
        check = compile(ast.Module(body=[assertion], type_ignores=[]), "network-readiness", "exec")
        for replicas, ready, updated, passes in [(0, 0, 0, False), (2, 1, 2, False), (2, 2, 1, False), (2, 2, 2, True)]:
            deployment = {"spec": {"replicas": replicas}, "status": {"readyReplicas": ready, "updatedReplicas": updated}}
            with self.subTest(replicas=replicas, ready=ready, updated=updated):
                if passes:
                    exec(check, {"deployments": [deployment] * 12})
                else:
                    with self.assertRaises(AssertionError):
                        exec(check, {"deployments": [deployment] * 12})
        with self.assertRaises(AssertionError):
            exec(check, {"deployments": [{"spec": {"replicas": 0}}] * 12})

    def test_latency_only_metadata_cannot_claim_a_complete_data_scan(self):
        # Execute the report producer from the Python sent to the AKS pod.
        tree = ast.parse(Path(__file__).with_name("verify-cosmos-data.py").read_text())
        remote = next(n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.startswith("\nimport base64"))
        producer = ast.parse(remote).body[-1]
        code = compile(ast.Module(body=[producer], type_ignores=[]), "cosmos-report", "exec")
        for latency_only in (False, True):
            output = io.StringIO()
            with self.subTest(latency_only=latency_only), contextlib.redirect_stdout(output):
                exec(code, {"json": json, "time": SimpleNamespace(monotonic=lambda: 1), "name": "account", "region": "northcentralus", "ips": [], "containers": [], "latency": None, "started": 0, "latency_only": latency_only})
            self.assertEqual(json.loads(output.getvalue())["complete"], not latency_only)


if __name__ == "__main__":
    unittest.main()
