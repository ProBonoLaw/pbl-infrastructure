"""Verify complete ID coverage, original downloads and private playback manifests."""
import importlib.util
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urljoin
import requests
from azure.storage.blob import BlobServiceClient, ContentSettings

spec=importlib.util.spec_from_file_location('vi',Path(__file__).with_name('video-indexer-retirement.py'))
vi=importlib.util.module_from_spec(spec);spec.loader.exec_module(vi)


def run(environment):
    config=vi.CONFIG[environment]
    target=json.loads(Path('/work/video-indexer-target.json').read_text(encoding='utf-8-sig'))
    blobs=BlobServiceClient(f"https://{config['storage']}.blob.core.windows.net",credential=vi.credential)
    archive=blobs.get_container_client('video-indexer-retirement-archive')
    prefix=config['oldId']
    mapping=json.loads(archive.download_blob(prefix+'/verified-mapping.json').readall())
    source=vi.VideoIndexer(config['subscription'],config['oldName'],config['oldId'])
    destination=vi.VideoIndexer(config['subscription'],target['name'],target['accountId'])
    old=source.videos();new=destination.videos()
    if len({x['newVideoId'] for x in mapping['videos']}) != len(mapping['videos']):
        raise RuntimeError('Historical entries must retain distinct replacement videos')
    if mapping['newAccountId']!=target['accountId'] or {x['id'] for x in old}!={x['oldVideoId'] for x in mapping['videos']}:
        raise RuntimeError('Final source inventory changed or target differs')
    if {x['id'] for x in new}!={x['newVideoId'] for x in mapping['videos']} or any(x['state']!='Processed' for x in old+new):
        raise RuntimeError('Replacement coverage or processing state incomplete')
    checks=[]
    for item in mapping['videos']:
        if item['state']!='Verified':
            raise RuntimeError('Incomplete video manifest')
        download=destination.request('GET',f"/Videos/{item['newVideoId']}/SourceFile/DownloadUrl")
        response=requests.head(download,timeout=60)
        if response.status_code!=200 or int(response.headers.get('Content-Length',-1))!=item['bytes']:
            raise RuntimeError('Replacement original media length differs')
        playback=destination.request('GET',f"/Videos/{item['newVideoId']}/streaming-url")
        headers={'Authorization':'Bearer '+playback['jwt']} if playback.get('jwt') else {}
        response=requests.get(playback['url'],headers=headers,timeout=90)
        if response.status_code!=200 or not response.content:
            raise RuntimeError('Private playback manifest unavailable')
        segment_verified=False
        if response.content.startswith(b'#EXTM3U'):
            format='HLS'
        else:
            root=ET.fromstring(response.content)
            format=root.tag.split('}')[-1]
            if format not in ('SmoothStreamingMedia','MPD'):
                raise RuntimeError('Unexpected playback manifest')
            if format=='SmoothStreamingMedia':
                streams=root.findall('StreamIndex')
                stream=next((x for x in streams if x.get('Type')=='video'),streams[0] if streams else None)
                if stream is None:
                    raise RuntimeError('Playback manifest has no streams')
                quality=stream.find('QualityLevel');chunk=stream.find('c')
                if quality is not None and chunk is not None:
                    path=stream.attrib['Url'].replace('{bitrate}',quality.attrib['Bitrate']).replace('{start time}',chunk.get('t','0'))
                    with requests.get(urljoin(playback['url'],path),headers={**headers,'Range':'bytes=0-31'},stream=True,timeout=90) as segment:
                        if segment.status_code not in (200,206) or not next(segment.iter_content(32),b''):
                            raise RuntimeError('Private playback segment unavailable')
                    segment_verified=True
        checks.append({'oldVideoId':item['oldVideoId'],'newVideoId':item['newVideoId'],'originalLengthVerified':True,
                       'playbackManifestVerified':True,'format':format,'playbackSegmentVerified':segment_verified})
        print(json.dumps({'environment':environment,'verifiedPlayback':len(checks),'total':len(mapping['videos'])}),flush=True)
    result={'environment':environment,'oldAccountId':config['oldId'],'newAccountId':target['accountId'],
            'videoLibraryVerified':True,'count':len(checks),'durationInSeconds':sum(v['durationInSeconds'] for v in mapping['videos']),'checks':checks}
    archive.upload_blob(prefix+'/library-verification.json',json.dumps(result,indent=2),overwrite=True,content_settings=ContentSettings(content_type='application/json'))
    Path('/work/video-library-verification.json').write_text(json.dumps(result))
    print(json.dumps({k:v for k,v in result.items() if k!='checks'}),flush=True)


if __name__=='__main__':
    try:
        run(sys.argv[1])
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'status':getattr(error,'status_code',None),
                          'detail':str(error) if isinstance(error,RuntimeError) else None}),flush=True)
        sys.exit(1)
