"""Update verified result-asset URLs using conditional writes and private originals."""
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings


def run():
    findings = json.loads(Path('/work/storage-reference-findings.json').read_text())
    if findings['environment'] != 'test' or findings['account'] != 'probonolawdatatestsuffix' or findings['errors']:
        raise RuntimeError('Unexpected reference scan')
    old = 'integritycachetestsuffix.blob.core.windows.net'
    new = 'probonolawdatatestsuffix.blob.core.windows.net'
    service = BlobServiceClient('https://' + new, credential=DefaultAzureCredential())
    audit = service.get_container_client('storage-retirement-audit')
    try:
        audit.create_container()
    except ResourceExistsError:
        pass
    plans, verified_targets = [], set()
    for item in findings['findings']:
        if item.get('container') != 'results' or item['matches'] != ['integritycachetestsuffix']:
            raise RuntimeError('Reference needs separate review')
        blob = service.get_blob_client(item['container'], item['blob'])
        props = blob.get_blob_properties()
        original = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        text = original.decode('utf-8-sig')
        urls = re.findall(r'https?://[^\s<>"\)]+', text)
        for value in urls:
            if old not in value:
                continue
            parsed = urlsplit(value)
            if parsed.hostname != old:
                continue
            if parsed.query:
                raise RuntimeError('Signed URLs require regeneration')
            container, name = unquote(parsed.path).lstrip('/').split('/', 1)
            if (container, name) not in verified_targets:
                service.get_blob_client(container, name).get_blob_properties()
                verified_targets.add((container, name))
        updated = original.replace(old.encode(), new.encode())
        if b'integritycachetestsuffix' in updated:
            raise RuntimeError('Unrecognized remaining source reference')
        plans.append((item, blob, props, original, updated))
    ledger = []
    for item, blob, props, original, updated in plans:
        if original == updated:
            continue
        original_name = 'original-result-urls/' + item['blob']
        saved = audit.get_blob_client(original_name)
        try:
            saved.upload_blob(original, overwrite=False, content_settings=props.content_settings)
        except ResourceExistsError:
            if saved.download_blob().readall() != original:
                raise RuntimeError('Conflicting audit original')
        if saved.download_blob().readall() != original:
            raise RuntimeError('Audit verification failed')
        props.content_settings.content_md5 = hashlib.md5(updated).digest()
        blob.upload_blob(updated, overwrite=True, etag=props.etag, match_condition=MatchConditions.IfNotModified,
                         content_settings=props.content_settings, metadata=props.metadata, tags=blob.get_blob_tags())
        if blob.download_blob().readall() != updated:
            raise RuntimeError('Updated reference verification failed')
        ledger.append({'container': item['container'], 'blob': item['blob'], 'priorEtag': props.etag,
                       'originalSha256': hashlib.sha256(original).hexdigest(), 'updatedSha256': hashlib.sha256(updated).hexdigest()})
    audit.upload_blob('result-url-rewrite-manifest.json', json.dumps(ledger, indent=2), overwrite=True,
                      content_settings=ContentSettings(content_type='application/json'))
    print(json.dumps({'updatedBlobs': len(ledger), 'verifiedTargetBlobs': len(verified_targets)}), flush=True)


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps({'errorType': type(error).__name__, 'httpStatus': getattr(error, 'status_code', None),
                          'detail': str(error) if isinstance(error, RuntimeError) else None}), flush=True)
        sys.exit(1)
