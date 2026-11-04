"""Private-network Video Indexer inventory and migration preflight. Never log tokens."""
import argparse
import io
import json
import time
import uuid
import wave
from pathlib import Path

import requests
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings
from azure.core.exceptions import ResourceExistsError

CONFIG = {
    "test": {"subscription": "00000000-0000-4000-8000-000000000003", "oldName": "video-indexer-testsuffix001", "oldId": "00000000-0000-4000-8000-00000000000c", "storage": "probonolawdatatestsuffix"},
    "prod": {"subscription": "00000000-0000-4000-8000-000000000002", "oldName": "video-indexer-prodsuffix001", "oldId": "00000000-0000-4000-8000-00000000000d", "storage": "probonolawdataprodsuffix"},
}
credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)

class VideoIndexer:
    def __init__(self, subscription, name, account_id, permission="Reader"):
        self.resource = f"/subscriptions/{subscription}/resourceGroups/video-indexer/providers/Microsoft.VideoIndexer/accounts/{name}"
        self.base = f"https://{name}.api.videoindexer.ai/eastus/Accounts/{account_id}"
        self.permission = permission
        self.access_token = None
        self.token_time = 0

    def headers(self):
        if self.access_token is None or time.monotonic() - self.token_time > 1800:
            arm = credential.get_token("https://management.azure.com/.default").token
            response = requests.post(f"https://management.azure.com{self.resource}/generateAccessToken?api-version=2025-04-01",
                                     headers={"Authorization": f"Bearer {arm}"}, json={"permissionType": self.permission, "scope": "Account"}, timeout=60)
            if not response.ok:
                raise RuntimeError(f"VI token generation HTTP {response.status_code}")
            self.access_token = response.json()["accessToken"]
            self.token_time = time.monotonic()
        return {"Authorization": f"Bearer {self.access_token}"}

    def request(self, method, path, *, optional=False, raw=False, **kwargs):
        # A server error can follow an accepted POST. Never repeat creation.
        attempts = 7 if method.upper() in ("GET", "HEAD", "OPTIONS", "PUT", "DELETE") else 1
        for attempt in range(attempts):
            response = requests.request(method, self.base + path, headers=self.headers(), timeout=90, **kwargs)
            if response.status_code == 401:
                self.access_token = None
            elif response.status_code not in (429, 500, 502, 503, 504):
                break
            if attempt == attempts - 1:
                break
            time.sleep(min(30, 2 ** attempt))
        if optional and response.status_code in (400, 404):
            return {"unsupportedEndpoint": path, "http": response.status_code}
        if not response.ok:
            try:
                error_type = response.json().get("ErrorType")
            except ValueError:
                error_type = None
            raise RuntimeError(f"VI {method} {path}: HTTP {response.status_code}, type={error_type}")
        return response.content if raw else (response.json() if response.content else None)

    def videos(self):
        values, ids, skip = [], set(), 0
        for _ in range(1000):
            page = self.request("GET", "/Videos", params={"pageSize": 100, "skip": skip})
            rows = page["results"]
            for video in rows:
                if video["id"] in ids:
                    raise RuntimeError("VI inventory changed while paginating")
                ids.add(video["id"])
                values.append(video)
            skip += len(rows)
            if not rows or page.get("nextPage", {}).get("done") is True:
                return values
        raise RuntimeError("VI pagination did not complete")

def inventory(environment):
    config = CONFIG[environment]
    source = VideoIndexer(config["subscription"], config["oldName"], config["oldId"])
    videos = source.videos()
    models = {}
    for path in ("/Customization/PersonModels", "/Customization/Language", "/Customization/Brands"):
        models[path] = source.request("GET", path, optional=True)
    data = {"config": config, "videos": videos, "models": models}
    Path(f"/work/video-indexer-source-{environment}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    summary = {"environment": environment, "videos": len(videos), "states": sorted({v.get("state", "Unknown") for v in videos}),
               "personModelIds": sorted({v.get("personModelId") for v in videos if v.get("personModelId")}),
               "modelResponseTypes": {path: type(value).__name__ for path, value in models.items()}}
    for path, value in models.items():
        if isinstance(value, list):
            summary.setdefault("modelCounts", {})[path] = len(value)
        elif isinstance(value, dict):
            summary.setdefault("modelFields", {})[path] = list(value)
    if videos:
        download = source.request("GET", f"/Videos/{videos[0]['id']}/SourceFile/DownloadUrl")
        summary["sourceDownloadResponseType"] = type(download).__name__
        if isinstance(download, str):
            response = requests.head(download, timeout=60)
            summary["sourceMediaHeadStatus"] = response.status_code
            summary["sourceMediaLength"] = response.headers.get("Content-Length")
    print(json.dumps(summary), flush=True)

def canary(environment, target_path):
    config = CONFIG[environment]
    target = json.loads(Path(target_path).read_text(encoding="utf-8-sig"))
    if target["environment"] != environment or target["storage"] != config["storage"] or not target["ready"]:
        raise RuntimeError("Replacement record mismatch")
    vi = VideoIndexer(config["subscription"], target["name"], target["accountId"], "Contributor")
    blobs = BlobServiceClient(f"https://{config['storage']}.blob.core.windows.net", credential=credential)
    container = blobs.get_container_client("video-indexer-migration-input")
    try:
        container.create_container()
    except ResourceExistsError:
        pass
    name = "canary-" + uuid.uuid4().hex
    blob = container.get_blob_client(name + ".wav")
    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(bytes(16000 * 2 * 5))
    blob.upload_blob(audio.getvalue(), overwrite=False, content_settings=ContentSettings(content_type="audio/wav"))
    video_id = None
    try:
        submitted = vi.request("POST", "/Videos", params={"name": name, "privacy": "Private", "videoUrl": blob.url,
            "externalId": name, "useManagedIdentityToDownloadVideo": "true", "indexingPreset": "Default", "streamingPreset": "Default", "language": "en-US"})
        video_id = submitted["id"]
        previous = None
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            index = vi.request("GET", f"/Videos/{video_id}/Index")
            state = index.get("state")
            if state != previous:
                print(json.dumps({"environment": environment, "canary": video_id, "state": state}), flush=True)
                previous = state
            if state == "Processed":
                result = {"environment": environment, "accountId": target["accountId"], "state": state, "storage": config["storage"]}
                Path(f"/work/video-indexer-canary-{environment}.json").write_text(json.dumps(result), encoding="utf-8")
                break
            if state == "Failed":
                raise RuntimeError("Replacement indexing canary failed")
            time.sleep(5)
        else:
            raise RuntimeError("Replacement indexing canary timed out")
    finally:
        if video_id:
            vi.request("DELETE", f"/Videos/{video_id}")
        blob.delete_blob()
        print(json.dumps({"environment": environment, "ownedCanaryRemoved": True}), flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=CONFIG)
    parser.add_argument("operation", choices=("inventory", "canary"))
    parser.add_argument("--target-record")
    args = parser.parse_args()
    if args.operation == "inventory":
        inventory(args.environment)
    else:
        canary(args.environment, args.target_record)
