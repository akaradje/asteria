"""Pinned SSH to the private coordinator; no shell or credential argument."""
import base64,gzip,io,json,sys,urllib.request,urllib.error
if len(sys.argv)!=2 or len(sys.argv[1])>24000:raise ValueError('Invalid bounded authority request')
body=base64.b64decode(sys.argv[1],validate=True)
value=json.loads(body)
if value.get('encoding')=='gzip-base64':
    with gzip.GzipFile(fileobj=io.BytesIO(base64.b64decode(value['data'],validate=True))) as stream:body=stream.read(131073)
if len(body)>131072:raise ValueError('Authority request too large')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
request=urllib.request.Request('http://127.0.0.1:4873/rpc',data=body,headers={'Content-Type':'application/json'})
try:
    with opener.open(request,timeout=10) as response:
        reply=response.read(1000001)
        if len(reply)>1000000:raise ValueError('Authority response too large')
        print(json.dumps({'encoding':'gzip-base64','data':base64.b64encode(gzip.compress(reply)).decode()}) if len(reply)>16000 else reply.decode())
except urllib.error.HTTPError as error:
    try: value=json.loads(error.read(4096))
    except Exception: value={}
    stage=value.get('stage')
    if stage not in ['parse','feed_validation','feed_persistence','feed_projection','cooperation_projection']:stage=None
    print(json.dumps({'ok':False,'error':'private_authority_rejected','code':error.code,'stage':stage}));sys.exit(1)
except Exception:print(json.dumps({'ok':False,'error':'private_authority_unavailable'}));sys.exit(1)
