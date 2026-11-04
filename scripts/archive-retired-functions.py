"""Archive retired Production services; Data Automation is explicitly excluded."""
import base64
import datetime
import gzip
import hashlib
import json
import sys
import uuid
from pathlib import Path

from azure.core.exceptions import ResourceExistsError
from azure.core import MatchConditions
from azure.data.tables import TableServiceClient
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

SOURCES = ("dataingestionsvctq4ih3ga", "dataintegrityextractorrf", "portalstartertpusarwi", "resourcemanagerl7f5tq5g")
DESTINATION = "probonolawdataprodsuffix"


def encode(value):
    if isinstance(value, bytes):
        return {"type": "binary", "value": base64.b64encode(value).decode()}
    if isinstance(value, datetime.datetime):
        return {"type": "datetime", "value": value.isoformat()}
    if isinstance(value, uuid.UUID):
        return {"type": "uuid", "value": str(value)}
    raise TypeError(type(value).__name__)


def run():
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    destination = BlobServiceClient(f"https://{DESTINATION}.blob.core.windows.net", credential)
    archive = destination.get_container_client("retired-service-history")
    try:
        archive.create_container()
    except ResourceExistsError:
        pass
    ledger = []

    def upload(name, data, content_type):
        digest = hashlib.sha256(data).hexdigest()
        blob = archive.get_blob_client(name)
        blob.upload_blob(data, overwrite=True, metadata={"sha256": digest},
                         content_settings=ContentSettings(content_type=content_type))
        if hashlib.sha256(blob.download_blob().readall()).hexdigest() != digest:
            raise RuntimeError("Archive verification failed")
        return {"name": name, "bytes": len(data), "sha256": digest}

    for account in SOURCES:
        source = BlobServiceClient(f"https://{account}.blob.core.windows.net", credential)
        result = {"account": account, "blobs": [], "tables": []}
        for container in source.list_containers():
            name = container["name"]
            if not (name.endswith("-largemessages") or name == "images"):
                continue
            for blob in source.get_container_client(name).list_blobs():
                data = source.get_blob_client(name, blob.name).download_blob(etag=blob.etag, match_condition=MatchConditions.IfNotModified).readall()
                result["blobs"].append(upload(f"{account}/blobs/{name}/{blob.name}", data, "application/octet-stream"))
        tables = TableServiceClient(f"https://{account}.table.core.windows.net", credential=credential)
        for table in tables.list_tables():
            if not table.name.lower().endswith(("history", "instances")):
                continue
            path = Path(f"/work/{account}-{table.name}.jsonl.gz")
            count = 0
            with gzip.open(path, "wt", encoding="utf-8") as output:
                for entity in tables.get_table_client(table.name).list_entities():
                    output.write(json.dumps({"properties": dict(entity), "metadata": entity.metadata}, default=encode) + "\n")
                    count += 1
            entry = upload(f"{account}/tables/{table.name}.jsonl.gz", path.read_bytes(), "application/gzip")
            entry["entities"] = count
            result["tables"].append(entry)
            path.unlink()
        upload(f"{account}/manifest.json", json.dumps(result, indent=2).encode(), "application/json")
        ledger.append(result)
        print(json.dumps({"account": account, "blobsArchived": len(result["blobs"]), "tablesArchived": len(result["tables"]),
                          "entitiesArchived": sum(t["entities"] for t in result["tables"])}), flush=True)
    upload("verified-manifest.json", json.dumps(ledger, indent=2).encode(), "application/json")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(json.dumps({"errorType": type(error).__name__, "status": getattr(error, "status_code", None)}), flush=True)
        sys.exit(1)
