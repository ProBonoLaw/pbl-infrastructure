"""Merge immutable source Table entities without overwriting destination records.

Use after source writers stop. Optional AIMIE URL remapping keeps historical
large-message references on the new account after their blobs are verified.
Server-maintained timestamps and ETags are regenerated; user EDM types remain.
"""
import argparse
import collections
import importlib.util
import json
from pathlib import Path
from azure.data.tables import TableServiceClient
from azure.identity import DefaultAzureCredential

spec = importlib.util.spec_from_file_location("copy_storage", Path(__file__).with_name("copy-storage-data.py"))
copy_storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copy_storage)


def remap_entity(entity, source, target, remap):
    result = copy_storage.entity_data(entity)
    if remap:
        old, new = f"https://{source}.blob.core.windows.net/", f"https://{target}.blob.core.windows.net/"
        result = {key: value.replace(old, new) if isinstance(value, str) else value
                  for key, value in result.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--copy", action="store_true")
    parser.add_argument("--remap-aimie-blob-urls", action="store_true")
    args = parser.parse_args()
    source, target, _, tables = copy_storage.load_profile(args.plan, args.source)
    if args.remap_aimie_blob_urls and not (source.startswith("aimieservice") and target.startswith("aimiedata")):
        raise ValueError("URL remapping is limited to the AIMIE history migration")
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    sources = TableServiceClient(f"https://{source}.table.core.windows.net", credential=credential)
    targets = TableServiceClient(f"https://{target}.table.core.windows.net", credential=credential)
    present = {item.name for item in targets.list_tables()}
    for name in tables:
        source_table = sources.get_table_client(name)
        rows = list(source_table.list_entities())
        if args.remap_aimie_blob_urls and name.endswith("Instances"):
            if any(row.get("RuntimeStatus") not in {"Completed", "Failed", "Terminated", "Canceled"} for row in rows):
                raise RuntimeError("Source still contains active Durable instances")
        versions = {(row["PartitionKey"], row["RowKey"]): row.metadata['etag'] for row in rows}
        expected = {(row["PartitionKey"], row["RowKey"]): remap_entity(row, source, target, args.remap_aimie_blob_urls) for row in rows}
        target_table = targets.get_table_client(name)
        existing = {(row["PartitionKey"], row["RowKey"]): copy_storage.entity_data(row)
                    for row in target_table.list_entities()} if name in present else {}
        if any(existing[key] != value for key, value in expected.items() if key in existing):
            raise RuntimeError("Destination has conflicting entities; no records were overwritten")
        grouped = collections.defaultdict(list)
        for key, value in expected.items():
            if key not in existing:
                grouped[key[0]].append(value)
        copied = 0
        if args.copy:
            targets.create_table_if_not_exists(name)
            for partition in grouped.values():
                for offset in range(0, len(partition), 100):
                    batch = partition[offset:offset+100]
                    target_table.submit_transaction([("create", row) for row in batch])
                    copied += len(batch)
            verified = {(row["PartitionKey"], row["RowKey"]): copy_storage.entity_data(row) for row in target_table.list_entities()}
            if any(verified.get(key) != value for key, value in expected.items()):
                raise RuntimeError("Target entity verification failed")
            if copy_storage.entity_versions(source_table) != versions:
                raise RuntimeError("Source entities changed; keep writers paused")
        print(json.dumps({"table": name, "sourceEntities": len(expected),
                          "existingDestinationEntities": len(existing),
                          "copied": copied, "mode": "copy" if args.copy else "inventory"}), flush=True)


if __name__ == "__main__":
    main()
