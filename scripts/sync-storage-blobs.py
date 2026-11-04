"""Copy allowlisted blobs with a local ledger and conditional destination writes.

Run a baseline while sources are active, then rerun after pausing writers. The
ledger permits updates only to blobs this migration previously copied. Existing
untracked blobs must match exactly. Source deletions are reported, never applied.
Blob versions and snapshots must be assessed separately before retiring sources.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path

from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, BlobType

spec = importlib.util.spec_from_file_location("copy_storage", Path(__file__).with_name("copy-storage-data.py"))
copy_storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copy_storage)


def blob_metadata(properties):
    # List Blobs deserializes empty XML metadata values as None. The upload SDK
    # drops None values, so translate them back to their original empty strings.
    return {key: "" if value is None else value for key, value in (properties.metadata or {}).items()}


def fingerprint(properties, tags):
    headers = properties.content_settings
    return json.dumps({"metadata": blob_metadata(properties), "tags": tags or {},
                       "headers": {key: getattr(headers, key) for key in (
                           "content_type", "content_encoding", "content_language",
                           "content_disposition", "cache_control")}}, sort_keys=True)


def transfer(source_account, target_account, names, ledger_path, workers, frozen, allow_existing_extra=False):
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    source = BlobServiceClient(f"https://{source_account}.blob.core.windows.net", credential=credential)
    target = BlobServiceClient(f"https://{target_account}.blob.core.windows.net", credential=credential)
    database = sqlite3.connect(ledger_path, check_same_thread=False)
    database.execute("create table if not exists settings (name text primary key, value text)")
    database.execute("create table if not exists blobs (container text, name text, source_etag text, target_etag text, properties text, md5 text, primary key(container,name))")
    for key, value in {"source": source_account, "target": target_account, "containers": json.dumps(names)}.items():
        previous = database.execute("select value from settings where name=?", (key,)).fetchone()
        if previous and previous[0] != value:
            raise RuntimeError("Ledger belongs to a different migration selection")
        database.execute("insert or ignore into settings values (?,?)", (key, value))
    database.commit()
    mutex = threading.Lock()
    available = {container.name: container for container in source.list_containers(include_metadata=True)}
    if set(names) - available.keys():
        raise RuntimeError("An allowlisted source container is missing")

    for container_name in names:
        source_container = source.get_container_client(container_name)
        target_container = target.get_container_client(container_name)
        metadata = available[container_name].metadata or {}
        try:
            target_container.create_container(metadata=metadata)
        except ResourceExistsError:
            if target_container.get_container_properties().metadata != metadata:
                raise RuntimeError("Destination container metadata differs")
        counts = {"copied": 0, "updated": 0, "unchanged": 0, "adopted": 0, "sourceChanged": 0}

        def copy_one(item):
            if item.blob_type != BlobType.BLOCKBLOB:
                raise RuntimeError("Only block blobs are supported")
            name, etag = item.name, item.etag.strip('"')
            with mutex:
                previous = database.execute("select source_etag,target_etag,properties,md5 from blobs where container=? and name=?", (container_name, name)).fetchone()
            properties = fingerprint(item, item.tags)
            if previous and previous[0] == etag and previous[2] == properties:
                return "unchanged"
            source_blob = source_container.get_blob_client(name)
            destination_blob = target_container.get_blob_client(name)
            payload = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
            try:
                source_blob.download_blob(etag=item.etag, match_condition=MatchConditions.IfNotModified).readinto(payload)
            except Exception as error:
                payload.close()
                if getattr(error, "status_code", None) in (404, 412) and not frozen:
                    return "sourceChanged"
                raise
            payload.seek(0)
            digest = hashlib.file_digest(payload, "md5").digest()
            payload.seek(0)
            source_digest = hashlib.file_digest(payload, "sha256").digest()
            payload.seek(0)
            if previous:
                result = destination_blob.upload_blob(payload, overwrite=True,
                    etag=f'"{previous[1]}"', match_condition=MatchConditions.IfNotModified,
                    metadata=blob_metadata(item), tags=item.tags or {},
                    content_settings=item.content_settings, validate_content=True)
                action = "updated"
            else:
                try:
                    result = destination_blob.upload_blob(payload, overwrite=False,
                        metadata=blob_metadata(item), tags=item.tags or {},
                        content_settings=item.content_settings, validate_content=True)
                    action = "copied"
                except ResourceExistsError:
                    actual = destination_blob.get_blob_properties()
                    actual_tags = destination_blob.get_blob_tags()
                    if (fingerprint(actual, actual_tags) != properties or
                            copy_storage.blob_digest(destination_blob) != source_digest):
                        payload.close()
                        raise RuntimeError("Untracked destination blob differs; nothing was overwritten") from None
                    result = {"etag": actual.etag}
                    action = "adopted"
            # Validate the destination bytes. This also catches transport/content-encoding errors.
            target_digest = hashlib.sha256()
            for chunk in destination_blob.download_blob(etag=result['etag'], match_condition=MatchConditions.IfNotModified).chunks():
                target_digest.update(chunk)
            payload.close()
            if target_digest.digest() != source_digest:
                raise RuntimeError("Destination content verification failed")
            with mutex:
                database.execute("insert or replace into blobs values (?,?,?,?,?,?)",
                    (container_name, name, etag, result['etag'].strip('"'), properties, base64.b64encode(digest).decode()))
                database.commit()
            return action

        processed = 0
        # Input media can be large; bound temporary disk use while keeping
        # concurrency for the many small checkpoint and evidence-state blobs.
        container_workers = min(workers, 4) if container_name == "input" else workers
        with ThreadPoolExecutor(max_workers=container_workers) as pool:
            pending = set()
            for item in source_container.list_blobs(include=["metadata", "tags"]):
                pending.add(pool.submit(copy_one, item))
                if len(pending) >= container_workers * 2:
                    completed, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in completed:
                        counts[future.result()] += 1
                        processed += 1
                    if processed // 1000 != (processed - len(completed)) // 1000:
                        print(json.dumps({"container": container_name, "processed": processed, **counts}), flush=True)
            for future in pending:
                counts[future.result()] += 1
                processed += 1

        recorded = dict((row[0], row[1:]) for row in database.execute(
            "select name,source_etag,target_etag,properties,md5 from blobs where container=?", (container_name,)))
        verified = 0
        for item in target_container.list_blobs(include=["metadata", "tags"]):
            if item.name not in recorded:
                if allow_existing_extra:
                    continue
                raise RuntimeError("Unexpected untracked destination blob; review before cutover")
            previous = recorded[item.name]
            if item.etag.strip('"') != previous[1] or fingerprint(item, item.tags) != previous[2]:
                raise RuntimeError("Destination was changed outside this migration")
            verified += 1
        if verified != len(recorded):
            raise RuntimeError("A copied destination blob is missing")
        current_names = set()
        changed = 0
        for item in source_container.list_blobs(include=["metadata", "tags"]):
            current_names.add(item.name)
            previous = recorded.get(item.name)
            if not previous or previous[0] != item.etag.strip('"') or previous[2] != fingerprint(item, item.tags):
                changed += 1
        removed = len(recorded.keys() - current_names)
        print(json.dumps({"container": container_name, "processed": processed,
                          "verified": verified, "changedSinceCopy": changed,
                          "removedAtSource": removed, **counts}), flush=True)
        if frozen and (changed or removed or counts["sourceChanged"]):
            raise RuntimeError("Source and destination differ; do not cut over")
    database.close()
    credential.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=16, choices=range(1,33))
    parser.add_argument("--writers-frozen", action="store_true")
    parser.add_argument("--allow-existing-aimie-blobs", action="store_true",
                        help="Preserve new runtime blobs while merging historical AIMIE blobs")
    args = parser.parse_args()
    source, target, containers, _ = copy_storage.load_profile(args.plan, args.source)
    if args.allow_existing_aimie_blobs and not (source.startswith("aimieservice") and target.startswith("aimiedata")):
        raise ValueError("Existing extra blobs are allowed only for AIMIE history merges")
    transfer(source, target, containers, args.ledger, args.workers, args.writers_frozen, args.allow_existing_aimie_blobs)
