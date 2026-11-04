"""Scan Cosmos DB storage references; optionally update feedback screenshot URLs."""
import argparse
import hashlib
import json
import sys
from urllib.parse import unquote, urlsplit
from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings


def run(environment, apply):
    test = environment == 'test'
    old_portal = 'probonolawportal7n5eya35' if test else 'probonolawportalkc7ebqpb'
    old_cache = 'integritycachetestsuffix' if test else 'integritycacheprodsuffix'
    old_vi = '00000000-0000-4000-8000-00000000000c' if test else '00000000-0000-4000-8000-00000000000d'
    target = 'probonolawdatatestsuffix' if test else 'probonolawdataprodsuffix'
    suffix = 'testsuffix001' if test else 'prodsuffix001'
    credential = DefaultAzureCredential()
    db = CosmosClient(f'https://db-law-sls-{suffix}.documents.azure.com:443/', credential).get_database_client('db_conversation_history')
    blobs = BlobServiceClient(f'https://{target}.blob.core.windows.net', credential=credential)
    audit = blobs.get_container_client('storage-retirement-audit')
    if apply:
        try:
            audit.create_container()
        except ResourceExistsError:
            pass
    totals, ledger = [], []
    for info in db.list_containers():
        if apply and info['id'] != 'feedback':
            continue
        container = db.get_container_client(info['id'])
        rows = list(container.query_items(query='SELECT * FROM c WHERE CONTAINS(TOSTRING(c), @portal) OR CONTAINS(TOSTRING(c), @cache) OR CONTAINS(TOSTRING(c), @vi)',
            parameters=[{'name':'@portal','value':old_portal},{'name':'@cache','value':old_cache},{'name':'@vi','value':old_vi}], enable_cross_partition_query=True))
        fields, changed = set(), 0
        for row in rows:
            def visit(value, path=''):
                if isinstance(value, list):
                    return [visit(x, path+'[]') for x in value]
                if isinstance(value, dict):
                    return {k:visit(v,path+'.'+k) for k,v in value.items()}
                if isinstance(value, str) and any(x in value for x in (old_portal,old_cache,old_vi)):
                    fields.add(path)
                    if apply:
                        if info['id'] != 'feedback' or old_cache in value or old_vi in value:
                            raise RuntimeError('Reference outside approved feedback migration needs review')
                        uri = urlsplit(value)
                        if uri.hostname != old_portal+'.blob.core.windows.net' or uri.query:
                            raise RuntimeError('Unexpected screenshot URL format')
                        name, blob = unquote(uri.path).lstrip('/').split('/',1)
                        if name != 'feedback-images':
                            raise RuntimeError('Unexpected screenshot container')
                        blobs.get_blob_client(name,blob).get_blob_properties()
                        return value.replace(old_portal+'.blob.core.windows.net',target+'.blob.core.windows.net')
                return value
            updated = visit(row)
            if apply and updated != row:
                serialized = json.dumps(row,sort_keys=True).encode()
                digest = hashlib.sha256(serialized).hexdigest()
                original = audit.get_blob_client('cosmos-feedback-originals/'+digest+'.json')
                try:
                    original.upload_blob(serialized,overwrite=False,content_settings=ContentSettings(content_type='application/json'))
                except ResourceExistsError:
                    pass
                if original.download_blob().readall() != serialized:
                    raise RuntimeError('Original Cosmos record archive mismatch')
                result = container.replace_item(row['id'],updated,etag=row['_etag'],match_condition=MatchConditions.IfNotModified)
                if old_portal in json.dumps(result):
                    raise RuntimeError('Feedback reference remains after write')
                ledger.append({'id':row['id'],'previousEtag':row['_etag'],'newEtag':result['_etag'],'archiveSha256':digest})
                changed += 1
        totals.append({'container':info['id'],'matches':len(rows),'fields':sorted(fields),'updated':changed})
        print(json.dumps({'environment':environment,**totals[-1]}),flush=True)
    if apply:
        audit.upload_blob('cosmos-feedback-url-rewrite-manifest.json',json.dumps(ledger,indent=2),overwrite=True,content_settings=ContentSettings(content_type='application/json'))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('environment',choices=('test','prod'))
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:
        run(args.environment,args.apply)
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__,'httpStatus':getattr(error,'status_code',None),
                          'detail':str(error) if isinstance(error,RuntimeError) else None}),flush=True)
        sys.exit(1)
