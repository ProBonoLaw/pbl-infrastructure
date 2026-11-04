"""Resumable migration; private source archives and per-video manifests stay in Azure.

Run within the dedicated workload-identity pod. Logs contain IDs and counts only.
An uncertain submission is reconciled by external ID and is never blindly retried.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import requests
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContentSettings

spec = importlib.util.spec_from_file_location("vi", Path(__file__).with_name("video-indexer-retirement.py"))
vi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vi)


class MigrationLease:
    """Renew a finite lock; stop work on renewal failure or local expiry."""
    duration = 60
    renewal_interval = 15

    def __init__(self, blob):
        self.blob = blob
        self.stopped = threading.Event()
        self.lost = threading.Event()

    def __enter__(self):
        self.renewed_at = time.monotonic()
        self.lease = self.blob.acquire_lease(lease_duration=self.duration)
        self.worker = threading.Thread(target=self._renew, daemon=True)
        self.worker.start()
        return self

    def _renew(self):
        while not self.stopped.wait(self.renewal_interval):
            try:
                renewed_at = time.monotonic()
                self.lease.renew(timeout=10, connection_timeout=10, read_timeout=10, retry_total=0)
                self.renewed_at = renewed_at
            except Exception:
                self.lost.set()
                return

    def check(self):
        if self.lost.is_set() or time.monotonic() - self.renewed_at >= self.duration - 5:
            self.lost.set()
            raise RuntimeError("Migration lease lost; stop and resume from private manifests after lock expiry")

    def call(self, operation, *args, **kwargs):
        self.check()
        result = operation(*args, **kwargs)
        self.check()
        return result

    def __exit__(self, exc_type, exc_value, traceback):
        self.stopped.set()
        self.worker.join(timeout=25)
        if exc_type is None:
            self.check()
            if self.worker.is_alive():
                raise RuntimeError("Migration lease renewal did not stop; wait for lock expiry before resuming")
        if not self.worker.is_alive() and not self.lost.is_set():
            try:
                self.lease.release(timeout=10, connection_timeout=10, read_timeout=10, retry_total=0)
            except Exception:
                # Expiry releases the lock even when Azure cannot be reached.
                if exc_type is None:
                    raise RuntimeError("Migration lease release failed; wait for lock expiry before resuming") from None


def run(environment, target_path, concurrency):
    config = vi.CONFIG[environment]
    target = json.loads(Path(target_path).read_text(encoding="utf-8-sig"))
    if target["environment"] != environment or target["storage"] != config["storage"] or not target["ready"]:
        raise RuntimeError("Target mismatch")
    source = vi.VideoIndexer(config["subscription"], config["oldName"], config["oldId"])
    destination = vi.VideoIndexer(config["subscription"], target["name"], target["accountId"], "Contributor")
    blobs = BlobServiceClient(f"https://{config['storage']}.blob.core.windows.net", credential=vi.credential)
    archive = blobs.get_container_client("video-indexer-retirement-archive")
    inputs = blobs.get_container_client("video-indexer-migration-input")
    for container in (archive, inputs):
        try:
            container.create_container()
        except ResourceExistsError:
            pass
    prefix = config["oldId"]
    lock = archive.get_blob_client(f"{prefix}/migration.lock")
    try:
        lock.upload_blob(b"", overwrite=False)
    except ResourceExistsError:
        pass
    with MigrationLease(lock) as lease:
        def save(name, value):
            data = json.dumps(value, sort_keys=True, indent=2).encode()
            lease.call(archive.upload_blob, f"{prefix}/{name}", data, overwrite=True,
                                content_settings=ContentSettings(content_type="application/json"))

        inventory = json.loads(Path(f"/work/video-indexer-source-{environment}.json").read_text())
        models = inventory["models"]
        persons = models["/Customization/PersonModels"]
        if not isinstance(persons, list) or any(not p.get("isDefault") or p.get("personsCount", 0) for p in persons):
            raise RuntimeError("Custom person models require explicit migration")
        if models["/Customization/Language"] or models["/Customization/Brands"]:
            raise RuntimeError("Custom language or brand models require explicit migration")
        current = source.videos()
        if {v["id"] for v in current} != {v["id"] for v in inventory["videos"]}:
            raise RuntimeError("Source inventory changed; reconcile before starting")
        if any(v["state"] != "Processed" or not v["hasSourceVideoFile"] for v in current):
            raise RuntimeError("Source videos are not ready")
        save("source-inventory.json", inventory)
        records = []
        external_ids = set()
        # Freeze the canonical external-ID owner to the archived inventory order.
        # Historical duplicate entries get distinct IDs while the newest keeps
        # the existing application lookup key. Preserve all source video records.
        for video in inventory["videos"]:
            lease.check()
            old_id = video["id"]
            external_id = video.get("externalId")
            identity_kind = "existing-external-id"
            if not external_id or external_id in external_ids:
                identity_kind = "duplicate-external-id" if external_id else "legacy-archival-id"
                external_id = f"legacy:{config['oldId']}:{old_id}"
            external_ids.add(external_id)
            manifest_name = f"{old_id}/manifest.json"
            try:
                record = json.loads(archive.download_blob(f"{prefix}/{manifest_name}").readall())
                if record["newAccountId"] != target["accountId"]:
                    raise RuntimeError("Manifest target mismatch")
                if record["externalId"] != external_id:
                    raise RuntimeError("Manifest external ID needs explicit reconciliation")
            except ResourceNotFoundError:
                record = {"oldAccountId": config["oldId"], "oldVideoId": old_id,
                          "newAccountId": target["accountId"], "source": video,
                          "externalId": external_id,
                          "identityKind": identity_kind,
                          "state": "Pending"}
                save(manifest_name, record)
            records.append(record)

        def checkpoint(record):
            save(f"{record['oldVideoId']}/manifest.json", record)
            print(json.dumps({"environment": environment, "oldVideoId": record["oldVideoId"],
                              "newVideoId": record.get("newVideoId"), "state": record["state"]}), flush=True)

        def prepare(record):
            lease.check()
            old_id = record["oldVideoId"]
            index = source.request("GET", f"/Videos/{old_id}/Index", params={"includeStreamingUrls": "false"})
            save(f"{old_id}/original-index.json", index)
            captions = source.request("GET", f"/Videos/{old_id}/Captions", raw=True,
                                      params={"format": "Vtt", "language": record["source"]["sourceLanguage"]})
            lease.call(archive.upload_blob, f"{prefix}/{old_id}/original-captions.vtt", captions, overwrite=True,
                                content_settings=ContentSettings(content_type="text/vtt"))
            download = source.request("GET", f"/Videos/{old_id}/SourceFile/DownloadUrl")
            local = Path(f"/work/{old_id}.media")
            digest, length = hashlib.sha256(), 0
            with requests.get(download, stream=True, timeout=(30, 180)) as response:
                if response.status_code != 200:
                    raise RuntimeError("Original media download failed")
                with local.open("wb") as stream:
                    for chunk in response.iter_content(4 * 1024 * 1024):
                        lease.check()
                        stream.write(chunk)
                        digest.update(chunk)
                        length += len(chunk)
                if response.headers.get("Content-Length") and length != int(response.headers["Content-Length"]):
                    raise RuntimeError("Original media download incomplete")
                record["sourceEtag"] = response.headers.get("ETag")
                content_type = response.headers.get("Content-Type", "application/octet-stream")
            media = inputs.get_blob_client(f"{prefix}/{old_id}/original.mp4")
            lease.call(media.upload_blob, local.open("rb"), overwrite=True, length=length,
                              metadata={"sha256": digest.hexdigest(), "oldvideoid": old_id},
                              content_settings=ContentSettings(content_type=content_type))
            verified = hashlib.sha256()
            for chunk in media.download_blob().chunks():
                lease.check()
                verified.update(chunk)
            if verified.digest() != digest.digest():
                raise RuntimeError("Uploaded original media hash mismatch")
            local.unlink()
            record.update({"sha256": digest.hexdigest(), "bytes": length, "inputBlob": media.blob_name,
                           "sourceArchived": True, "state": "Prepared"})
            checkpoint(record)

        def submit(record):
            lease.check()
            existing = [v for v in destination.videos() if v.get("externalId") == record["externalId"]]
            if len(existing) > 1:
                raise RuntimeError("Ambiguous external ID in replacement")
            if existing:
                result = existing[0]
            elif record["state"] == "Submitting":
                raise RuntimeError("Uncertain earlier submission has no visible match; manual reconciliation required")
            else:
                record["state"] = "Submitting"
                checkpoint(record)
                original = record["source"]
                params = {"name": original["name"], "privacy": original["privacyMode"],
                          "videoUrl": inputs.get_blob_client(record["inputBlob"]).url,
                          "externalId": record["externalId"], "useManagedIdentityToDownloadVideo": "true",
                          "indexingPreset": original["indexingPreset"], "streamingPreset": original["streamingPreset"],
                          "language": original["sourceLanguage"]}
                for key in ("description", "metadata"):
                    if original.get(key):
                        params[key] = original[key]
                # A single POST; a transport error leaves the durable Submitting state for reconciliation.
                response = lease.call(requests.post, destination.base + "/Videos", headers=destination.headers(), params=params, timeout=30)
                if not response.ok:
                    raise RuntimeError(f"Submission HTTP {response.status_code}; reconcile external ID before retry")
                result = response.json()
            if result.get("indexingPreset") and result["indexingPreset"] != record["source"]["indexingPreset"]:
                raise RuntimeError("Existing replacement preset mismatch")
            record.update({"newVideoId": result["id"], "state": "Processing", "submittedAt": time.time()})
            checkpoint(record)

        deadline = time.monotonic() + 5 * 3600
        while any(r["state"] != "Verified" for r in records):
            lease.check()
            if time.monotonic() > deadline:
                raise RuntimeError("Migration deadline reached; safe to resume")
            for record in records:
                lease.check()
                if record["state"] == "Processing":
                    result = destination.request("GET", f"/Videos/{record['newVideoId']}/Index", params={"includeStreamingUrls": "false"})
                    if result.get("state") == "Failed":
                        record["state"] = "Failed"
                        checkpoint(record)
                        raise RuntimeError("Replacement video indexing failed")
                    if result.get("state") == "Processed":
                        actual = next(v for v in destination.videos() if v["id"] == record["newVideoId"])
                        for key in ("indexingPreset", "streamingPreset", "privacyMode", "sourceLanguage"):
                            if actual[key] != record["source"][key]:
                                raise RuntimeError(f"Replacement {key} mismatch")
                        if abs(actual["durationInSeconds"] - record["source"]["durationInSeconds"]) > 1:
                            raise RuntimeError("Replacement duration mismatch")
                        save(f"{record['oldVideoId']}/replacement-index.json", result)
                        captions = destination.request("GET", f"/Videos/{record['newVideoId']}/Captions", raw=True,
                                                       params={"format": "Vtt", "language": actual["sourceLanguage"]})
                        lease.call(archive.upload_blob, f"{prefix}/{record['oldVideoId']}/replacement-captions.vtt", captions, overwrite=True,
                                            content_settings=ContentSettings(content_type="text/vtt"))
                        record.update({"state": "Verified", "verifiedAt": time.time(), "durationInSeconds": actual["durationInSeconds"]})
                        checkpoint(record)
            active = sum(r["state"] == "Processing" for r in records)
            for record in records:
                lease.check()
                if active >= concurrency:
                    break
                if record["state"] == "Pending":
                    prepare(record)
                if record["state"] in ("Prepared", "Submitting"):
                    submit(record)
                    active += 1
                elif record["state"] == "Failed":
                    raise RuntimeError("Failed manifest requires investigation")
            if any(r["state"] != "Verified" for r in records):
                time.sleep(15)
        mapping = {"environment": environment, "oldAccountId": config["oldId"], "newAccountId": target["accountId"],
                   "videos": [{k: r[k] for k in ("oldVideoId", "newVideoId", "externalId", "identityKind", "sha256", "bytes", "durationInSeconds", "state")} for r in records]}
        save("verified-mapping.json", mapping)
        print(json.dumps({"environment": environment, "verified": len(records), "archiveContainer": archive.container_name}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=("test", "prod"))
    parser.add_argument("--target-record", required=True)
    parser.add_argument("--concurrency", type=int, choices=(1, 2), default=1)
    args = parser.parse_args()
    try:
        run(args.environment, args.target_record, args.concurrency)
    except Exception as error:
        # SDK/HTTP exception strings may contain signed download URLs.
        print(json.dumps({"environment": args.environment, "errorType": type(error).__name__,
                          "detail": str(error) if isinstance(error, RuntimeError) else "Operation failed; inspect private migration manifest",
                          "httpStatus": getattr(error, "status_code", None)}), flush=True)
        sys.exit(1)
