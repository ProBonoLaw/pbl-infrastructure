"""Exercise the deployed Data Integrity service, including its own workload identity."""
import hashlib
import importlib.util
import json
import sys
import uuid
import struct
from pathlib import Path
import requests
from azure.storage.blob import BlobServiceClient, ContentSettings

spec=importlib.util.spec_from_file_location('vi',Path(__file__).with_name('video-indexer-retirement.py'))
vi=importlib.util.module_from_spec(spec)
spec.loader.exec_module(vi)


def run(environment):
    config=vi.CONFIG[environment]
    target=json.loads(Path('/work/video-indexer-target.json').read_text(encoding='utf-8-sig'))
    account=vi.VideoIndexer(config['subscription'],target['name'],target['accountId'],'Contributor')
    service=BlobServiceClient(f"https://{config['storage']}.blob.core.windows.net",credential=vi.credential)
    marker='storage-retirement-runtime-'+uuid.uuid4().hex
    # The deployed ExtractionPolicy routes AIFF to VI even when CU handles WAV.
    # 5 seconds, mono 16-bit PCM at 16 kHz; AIFF stores its rate as 80-bit float.
    source=service.get_blob_client('video-indexer-migration-input',marker+'.aiff')
    comm=struct.pack('>hIh',1,80000,16)+bytes.fromhex('400cfa00000000000000')
    sound=struct.pack('>II',0,0)+bytes(160000)
    chunks=b'COMM'+struct.pack('>I',len(comm))+comm+b'SSND'+struct.pack('>I',len(sound))+sound
    data=b'FORM'+struct.pack('>I',len(chunks)+4)+b'AIFF'+chunks
    source.upload_blob(data,overwrite=False,content_settings=ContentSettings(content_type='audio/aiff'))
    request={'filename':marker+'.aiff','filePath':marker+'.aiff','sourceId':str(uuid.uuid4()),'accountId':str(uuid.uuid4()),
             'containerName':'video-indexer-migration-input','containerPath':marker+'.aiff','force':False,'highRes':False}
    Path('/work/video-indexer-runtime-request.json').write_text(json.dumps(request))
    response=requests.post('http://data-integrity-api.file-operations.svc.cluster.local/internal/data-integrity/transform',json=request,timeout=900)
    if response.status_code != 200:
        raise RuntimeError(f'Runtime transform HTTP {response.status_code}; owned input retained for diagnosis')
    output=response.json()
    if not {'containerName','containerPath'}.issubset(output) or output['containerName'] != 'results':
        raise RuntimeError('Unexpected runtime output shape')
    markdown=service.get_blob_client(output['containerName'],output['containerPath'])
    contents=markdown.download_blob().readall()
    if not contents or config['oldId'].encode() in contents or b'integritycache' in contents:
        raise RuntimeError('Runtime output invalid')
    matches=[v for v in account.videos() if v['name']==marker+'.aiff']
    if len(matches)!=1 or matches[0]['state']!='Processed':
        raise RuntimeError('Runtime did not process canary in the replacement account')
    result={'environment':environment,'accountId':target['accountId'],'videoId':matches[0]['id'],'processed':True,
            'markdownBytes':len(contents),'markdownSha256':hashlib.sha256(contents).hexdigest(),'applicationIdentityVerified':True}
    account.request('DELETE',f"/Videos/{matches[0]['id']}")
    markdown.delete_blob(delete_snapshots='include');source.delete_blob(delete_snapshots='include')
    result['ownedArtifactsRemoved']=True
    audit=service.get_container_client('video-indexer-retirement-archive')
    audit.upload_blob(config['oldId']+'/runtime-verification.json',json.dumps(result,indent=2),overwrite=True,content_settings=ContentSettings(content_type='application/json'))
    Path('/work/video-indexer-runtime-verification.json').write_text(json.dumps(result))
    print(json.dumps(result),flush=True)


if __name__=='__main__':
    try:
        run(sys.argv[1])
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'status':getattr(error,'status_code',None),
                          'detail':str(error) if isinstance(error,RuntimeError) else None}),flush=True)
        sys.exit(1)
