"""Read source inventory for the authorized storage retirement; never print contents."""
import concurrent.futures
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueServiceClient
from azure.data.tables import TableServiceClient

environment = sys.argv[1]
if environment not in ("test", "prod"):
    raise SystemExit("Unexpected environment")
accounts = ({
    "aimieConfig": "aimieconfigtestsuffix001",
    "aimie": "aimieserviceclxo2mycjfpl",
    "portal": "probonolawportal7n5eya35",
    "dataAutomation": "dataautomationlasnn5vo5p",
    "integrityCache": "integritycachetestsuffix",
} if environment == "test" else {
    "aimieConfig": "aimieconfigprodsuffix001",
    "aimie": "aimieserviceobgbxpas4ai6",
    "portal": "probonolawportalkc7ebqpb",
    "dataAutomation": "dataautomationlavdqzxqu4",
    "integrityCache": "integritycacheprodsuffix",
    "dataIngestion": "dataingestionsvctq4ih3ga",
    "dataIntegrity": "dataintegrityextractorrf",
    "portalStarter": "portalstartertpusarwi",
    "resourceManager": "resourcemanagerl7f5tq5g",
})
credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
cutover = datetime(2026, 10, 26, 19, 30, tzinfo=timezone.utc)

def inspect(pair):
    key, account = pair
    result = {"key": key, "account": account, "containers": [], "tables": [], "queues": [], "errors": []}
    try:
        blob = BlobServiceClient(f"https://{account}.blob.core.windows.net", credential=credential)
        for container in blob.list_containers():
            row = {"name": container.name, "blobs": 0, "bytes": 0, "latestModified": None, "modifiedAfterCutover": 0}
            for item in blob.get_container_client(container.name).list_blobs():
                row["blobs"] += 1
                row["bytes"] += item.size or 0
                if item.last_modified:
                    timestamp = item.last_modified.isoformat()
                    if row["latestModified"] is None or timestamp > row["latestModified"]:
                        row["latestModified"] = timestamp
                    row["modifiedAfterCutover"] += int(item.last_modified > cutover)
            result["containers"].append(row)
    except Exception as error:
        result["errors"].append({"service": "blob", "type": type(error).__name__, "status": getattr(error, "status_code", None)})
    try:
        tables = TableServiceClient(f"https://{account}.table.core.windows.net", credential=credential)
        for table in tables.list_tables():
            # Data Automation's legacy Functions tables are explicitly excluded.
            excluded = key == "dataAutomation" and table.name != "IngestionProgress"
            count = None if excluded else sum(1 for _ in tables.get_table_client(table.name).list_entities(select=["PartitionKey", "RowKey"]))
            result["tables"].append({"name": table.name, "entities": count, "excludedDataAutomationLegacy": excluded})
    except Exception as error:
        result["errors"].append({"service": "table", "type": type(error).__name__, "status": getattr(error, "status_code", None)})
    try:
        queues = QueueServiceClient(f"https://{account}.queue.core.windows.net", credential=credential)
        for queue in queues.list_queues():
            result["queues"].append({"name": queue.name, "messages": queues.get_queue_client(queue.name).get_queue_properties().approximate_message_count})
    except Exception as error:
        result["errors"].append({"service": "queue", "type": type(error).__name__, "status": getattr(error, "status_code", None)})
    Path(f"/work/retirement-inventory-{key}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result), flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    results = list(executor.map(inspect, accounts.items()))
Path("/work/retirement-inventory.json").write_text(json.dumps({"environment": environment, "observedAt": datetime.now(timezone.utc).isoformat(), "accounts": results}, indent=2), encoding="utf-8")
if any(result["errors"] for result in results):
    raise SystemExit(1)
