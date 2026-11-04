"""Read current data for references that would break after account retirement."""
import concurrent.futures
import json
import sys
from collections import Counter
from pathlib import Path
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.data.tables import TableServiceClient

environment = sys.argv[1]
test = environment == "test"
account = "probonolawdatatestsuffix" if test else "probonolawdataprodsuffix"
old = ["integritycachetestsuffix", "probonolawportal7n5eya35", "dataautomationlasnn5vo5p", "aimieconfigtestsuffix001", "aimieserviceclxo2mycjfpl", "00000000-0000-4000-8000-00000000000c"] if test else ["integritycacheprodsuffix", "probonolawportalkc7ebqpb", "dataautomationlavdqzxqu4", "aimieconfigprodsuffix001", "aimieserviceobgbxpas4ai6", "dataingestionsvctq4ih3ga", "dataintegrityextractorrf", "portalstartertpusarwi", "resourcemanagerl7f5tq5g", "00000000-0000-4000-8000-00000000000d"]
credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
blobs = BlobServiceClient(f"https://{account}.blob.core.windows.net", credential=credential)
findings = []
errors = []


def scan_blob(item):
    container, blob = item
    try:
        data = blobs.get_blob_client(container, blob.name).download_blob().readall()
        matches = [name for name in old if name.encode() in data]
        if matches:
            return {"container": container, "blob": blob.name, "matches": matches, "bytes": len(data)}
    except Exception as error:
        return {"container": container, "blob": blob.name, "error": type(error).__name__}


for container in blobs.list_containers():
    name = container["name"]
    if name.endswith("-checkpoints") or "-encoded-" in name or "-input-" in name or name.startswith("video-indexer-") or name in ("input", "retired-service-history", "storage-retirement-audit"):
        continue
    candidates = [b for b in blobs.get_container_client(name).list_blobs() if b.size < 32*1024*1024 and ("." not in b.name.rsplit("/", 1)[-1] or b.name.lower().endswith((".md", ".json", ".txt", ".html", ".xml")))]
    matches = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for result in pool.map(scan_blob, ((name, b) for b in candidates)):
            if result:
                (errors if "error" in result else matches).append(result)
    findings.extend(matches)
    print(json.dumps({"container": name, "scanned": len(candidates), "matches": len(matches)}), flush=True)
tables = TableServiceClient(f"https://{account}.table.core.windows.net", credential=credential)
for table in tables.list_tables():
    count, matches = 0, []
    for entity in tables.get_table_client(table.name).list_entities():
        count += 1
        fields = {key: [name for name in old if name in value] for key, value in entity.items() if isinstance(value, str) and any(name in value for name in old)}
        if fields:
            matches.append({"table": table.name, "partitionKey": entity["PartitionKey"], "rowKey": entity["RowKey"], "fields": fields})
    findings.extend(matches)
    print(json.dumps({"table": table.name, "scanned": count, "matches": len(matches), "fields": sorted({field for x in matches for field in x["fields"]})}), flush=True)
Path("/work/storage-reference-findings.json").write_text(json.dumps({"environment": environment, "account": account, "findings": findings, "errors": errors}, indent=2))
print(json.dumps({"environment": environment, "references": len(findings), "errors": len(errors)}), flush=True)
sys.exit(1 if errors else 0)
