import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from azure.core.exceptions import ResourceExistsError
from azure.data.tables import EdmType, EntityProperty, TableEntity
from azure.storage.blob import BlobType, ContentSettings

spec = importlib.util.spec_from_file_location(
    "storage_copy", Path(__file__).with_name("copy-storage-data.py")
)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class Blob:
    def __init__(self, data=None):
        self.data = data
        self.tags = {"category": "staff"}
        self.properties = SimpleNamespace(
            blob_type=BlobType.BLOCKBLOB, etag="original",
            metadata={"purpose": "profile"},
            content_settings=ContentSettings(content_type="image/png"),
        )

    def get_blob_properties(self):
        return self.properties

    def get_blob_tags(self):
        return self.tags

    def download_blob(self, **kwargs):
        if kwargs:
            assert kwargs["etag"] == self.properties.etag
        return SimpleNamespace(
            readinto=lambda stream: stream.write(self.data),
            chunks=lambda: iter([self.data]),
        )

    def upload_blob(self, stream, *, overwrite, metadata, content_settings, tags):
        assert overwrite is False
        if self.data is not None:
            raise ResourceExistsError("Already exists")
        self.data = stream.read()
        self.properties.metadata = copy.deepcopy(metadata)
        self.properties.content_settings = copy.deepcopy(content_settings)
        self.tags = copy.deepcopy(tags)


def entity(**values):
    result = TableEntity(PartitionKey="p", RowKey="r", **values)
    result._metadata = {"etag": "version1"}
    return result


class Table:
    def __init__(self, record=None):
        self.record = record

    def create_entity(self, record):
        if self.record is not None:
            raise ResourceExistsError("Already exists")
        self.record = copy.deepcopy(record)

    def get_entity(self, partition, row):
        assert (partition, row) == ("p", "r")
        return self.record


class StorageCopyTests(unittest.TestCase):
    def test_blob_content_headers_metadata_and_tags_are_preserved(self):
        source, target = Blob(b"image content"), Blob()
        self.assertTrue(migration.copy_blob(source, target))
        self.assertEqual(target.data, source.data)
        self.assertEqual(target.properties.content_settings.content_type, "image/png")
        self.assertEqual(target.tags, source.tags)
        self.assertEqual(target.properties.metadata, source.properties.metadata)
        self.assertFalse(migration.copy_blob(source, target), "Identical copy is resumable")

    def test_existing_blob_with_different_data_is_never_overwritten(self):
        target = Blob(b"destination content")
        with self.assertRaises(migration.MigrationConflict):
            migration.copy_blob(Blob(b"source content"), target)
        self.assertEqual(target.data, b"destination content")

    def test_table_types_and_keys_are_preserved(self):
        record = entity(Enabled=True, Value=EntityProperty(2**40, EdmType.INT64),
                        Binary=b"bytes", Timestamp="server timestamp")
        source, target = Table(record), Table()
        self.assertTrue(migration.copy_entity(source, target, record))
        self.assertEqual(target.record["Value"], record["Value"])
        self.assertEqual(target.record["Binary"], b"bytes")
        self.assertTrue(target.record["Enabled"])
        self.assertNotIn("Timestamp", target.record)
        self.assertFalse(migration.copy_entity(source, target, record))

    def test_conflicting_table_entity_is_never_overwritten(self):
        source, target = Table(entity(Name="source")), Table(entity(Name="target"))
        with self.assertRaises(migration.MigrationConflict):
            migration.copy_entity(source, target, source.record)
        self.assertEqual(target.record["Name"], "target")

    def test_source_table_change_fails_verification(self):
        record = entity(Name="old")
        current = entity(Name="new")
        current._metadata["etag"] = "version2"
        with self.assertRaises(migration.MigrationConflict):
            migration.copy_entity(Table(current), Table(), record)

    def test_inventory_never_contacts_destination(self):
        source_blobs, source_tables = Mock(), Mock()
        source_blobs.list_containers.return_value = [SimpleNamespace(name="staffphotos")]
        source_blobs.get_container_client.return_value.list_blobs.return_value = [Mock(), Mock()]
        source_tables.list_tables.return_value = [SimpleNamespace(name="staff")]
        source_tables.get_table_client.return_value.list_entities.return_value = [entity(Name="user")]
        target_blobs, target_tables = Mock(), Mock()
        summary = migration.transfer(source_blobs, target_blobs, source_tables, target_tables)
        self.assertEqual(summary["blobs"], 2)
        self.assertEqual(summary["entities"], 1)
        self.assertEqual(summary["copied_blobs"], 0)
        self.assertEqual(target_blobs.mock_calls, [])
        self.assertEqual(target_tables.mock_calls, [])

    def test_allowlist_excludes_legacy_data(self):
        items = [SimpleNamespace(name=name) for name in (
            "azure-webjobs-hosts", "flow-history", "file-operations-checkpoints"
        )]
        self.assertEqual(
            [item.name for item in migration.select_named(items, ["file-operations-checkpoints"])],
            ["file-operations-checkpoints"],
        )
        self.assertEqual(migration.select_named(items, []), [])
        with self.assertRaises(migration.MigrationConflict):
            migration.select_named(items, ["missing-data"])

    def test_data_automation_profile_keeps_current_ingestion_state(self):
        plan = Path(__file__).resolve().parents[1] / "deploy/storage-migration/test.json"
        source, target, containers, tables = migration.load_profile(plan, "dataAutomation")
        self.assertNotEqual(source, target)
        self.assertEqual(tables, ["IngestionProgress"])
        self.assertEqual(len(containers), 12)
        self.assertNotIn("azure-webjobs-hosts", containers)

    def test_data_automation_profile_rejects_legacy_runtime_names(self):
        original = Path(__file__).resolve().parents[1] / "deploy/storage-migration/test.json"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            for field, name in (
                ("containers", "azure-webjobs-hosts"),
                ("containers", "flow-history"),
                ("tables", "AzureFunctionsDiagnosticEvents202610"),
            ):
                with self.subTest(name=name):
                    plan = json.loads(original.read_text(encoding="utf-8"))
                    plan["sources"]["dataAutomation"][field].append(name)
                    path.write_text(json.dumps(plan), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "Legacy Data Automation"):
                        migration.load_profile(path, "dataAutomation")

    def test_aimie_config_copy_does_not_contact_table_service(self):
        plan = Path(__file__).resolve().parents[1] / "deploy/storage-migration/test-aimie.json"
        source, target, containers, tables = migration.load_profile(plan, "aimieConfig")
        self.assertEqual(source, "aimieconfigtestsuffix001")
        self.assertEqual(target, "aimiedatatestsuffix")
        self.assertEqual(containers, ["agents"])
        self.assertEqual(tables, [])
        source_blobs, target_blobs, source_tables, target_tables = Mock(), Mock(), Mock(), Mock()
        source_blobs.list_containers.return_value = [SimpleNamespace(name="agents", metadata={})]
        source_blobs.get_container_client.return_value.list_blobs.return_value = [
            SimpleNamespace(name="agent.json", etag="original")
        ]
        source_blobs.get_container_client.return_value.get_blob_client.return_value = Blob(b"{}")
        # Azure quotes Get Properties ETags but omits quotes in List Blobs.
        source_blobs.get_container_client.return_value.get_blob_client.return_value.properties.etag = '"original"'
        target_blobs.get_container_client.return_value.get_blob_client.return_value = Blob()
        summary = migration.transfer(source_blobs, target_blobs, source_tables, target_tables,
                                     True, containers, tables)
        self.assertEqual(summary["copied_blobs"], 1)
        self.assertEqual(summary["tables"], 0)
        self.assertEqual(source_tables.mock_calls, [])
        self.assertEqual(target_tables.mock_calls, [])


if __name__ == "__main__":
    unittest.main()
