"""Fixed private SSH bridge. Local HTTP panel never binds to a public address."""
import base64
import gzip
import json
import os
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SECRET_FIELDS = {'password','pass','token','username','account','credentials','logfile','api_key','secret'}

def encode_response(value):
    payload=json.dumps(value).encode()
    if len(payload)>2000000:raise ValueError('Response too large')
    return json.dumps({'encoding':'gzip-base64','data':base64.b64encode(gzip.compress(payload)).decode()}) if len(payload)>16000 else payload.decode()


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k,v in value.items() if k.lower() not in SECRET_FIELDS and not k.lower().endswith('_api_key')}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def handle(request):
    route = request.get('route')
    if route not in {'status','char','plan','progress','map','team-brain','start','stop'}:
        raise ValueError('Unknown third-host route')
    config = json.loads((ROOT/'machines/expansion.json').read_text())
    cooperation=request.get('cooperation')
    if cooperation is not None:
        now=time.time()*1000
        if not isinstance(cooperation,dict) or set(cooperation)-{'at','build','workboard','tradeWorkflow','workflow','dailyActivities'} or not isinstance(cooperation.get('at'),(int,float)) or not 0<=now-cooperation['at']<15000:
            raise ValueError('Stale cooperation intent')
        file=ROOT/'logs/fleet/primary.json';file.parent.mkdir(parents=True,exist_ok=True)
        temp=file.with_suffix('.tmp');temp.write_text(json.dumps(clean(cooperation)));temp.chmod(0o600);temp.replace(file)
    authority = request.get('guildAuthority')
    if authority is not None:
        now = time.time()*1000
        if (authority.get('name') != config['guild']['name'] or authority.get('leader') != config['guild']['leader']
                or not isinstance(authority.get('checkedAt'), (int,float))
                or not 0 <= now-authority['checkedAt'] < 90000
                or not authority.get('leaderFrom')):
            raise ValueError('Stale or unexpected shared guild authority')
        file = ROOT/'logs/shared-guild-authority.json'
        file.parent.mkdir(parents=True, exist_ok=True)
        temp = file.with_suffix('.tmp')
        temp.write_text(json.dumps(clean(authority)))
        temp.chmod(0o600)
        temp.replace(file)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = 'http://127.0.0.1:4711'
    with opener.open(base+'/api/panel-health',timeout=5) as response:
        health=json.load(response)
    if health.get('service')!='asteria-panel' or health.get('machine')!='vps':
        raise ValueError('Unexpected third-host controller')
    if route=='status':
        try: snapshot=json.loads((ROOT/'logs/status.json').read_text())
        except (FileNotFoundError,json.JSONDecodeError): snapshot={}
        fields={'capabilityCoverage','nativeBotConsole','stageProfile','legacyMonetaryQuarantine','identity','astral','astralObjective','observations','runtimeV2','runtimeV3','characterJourney','teamWork','teamInventory','tradeAvailability','livePos','vitals','teamTradeStatus','serverRankings','runtimeHealth','runtimeCost','runtimeCostStatus','actualProgress','slot','char','status','job','jobLv','lv','coins','lastSaveAt','positionAt','fps','fpsAt','goal','equip','gearPower','bagTier','bagCapacity','recycling','teamPartyId','levelProgress','levelTrainingStatus','developmentProgress','mainQuest','petActive','activePetPlan','equipmentCeiling','investmentPlan','wing','guildMembership'}
        rows=[{k:v for k,v in r.items() if k in fields} for r in snapshot.get('instances') or []]
        for row in rows:
            runtime=row.get('runtimeV2') or {}
            row['runtimeV2']={k:v for k,v in runtime.items() if k in {'purchases','sourceCoherence','learningRevision','scheduler'}}
        mem={}
        for line in Path('/proc/meminfo').read_text().splitlines():
            parts=line.split()
            if parts[0] in {'MemTotal:','MemAvailable:'}:mem[parts[0]]=int(parts[1])//1024
        member_fields={'identity','activityState','workflowAck','activityResult','readiness','performance','runtimeGeneration','slot','status','job','lv','lastSaveAt','teamPartyId','teamInventory','teamWork','livePos','vitals','recycling','teamTradeStatus','tradeAvailability'}
        cooperation_rows=[{**{k:v for k,v in r.items() if k in member_fields},'charName':r.get('char'),'runtimeGeneration':((r.get('runtimeV2') or {}).get('stateFreshness') or {}).get('sessionId'),'actionOwner':'activity' if (r.get('dailyWorkStatus') or {}).get('ownsNavigation') else None} for r in snapshot.get('instances') or []]
        coop={'machine':'vps','at':int(__import__('datetime').datetime.fromisoformat(snapshot['at'].replace('Z','+00:00')).timestamp()*1000) if snapshot.get('at') else 0,'build':(snapshot.get('gameKnowledge') or {}).get('systemVersion',{}).get('build'),'members':cooperation_rows}
        return clean({'cooperation':coop,'machine':'vps','controllerProof':health,'running':bool(health.get('running')),'snapshotAt':snapshot.get('at'),
            'instances':rows,'party':snapshot.get('party'),'guild':snapshot.get('guild'),
            'governor':snapshot.get('governor'),'host':{'cpus':os.cpu_count(),'freeMb':mem.get('MemAvailable:'),'totalMb':mem.get('MemTotal:')},
            'gameKnowledge':{'systemVersion':(snapshot.get('gameKnowledge') or {}).get('systemVersion')},
            'error':None if health.get('running') else 'VPS farm is not running'})
    if route=='progress':
        try:
            report=json.loads((ROOT/'logs/reports.json').read_text())
            return clean({k:report.get(k) for k in ['version','at','build','slots','events']})
        except FileNotFoundError:return {'slots':{},'events':[]}
    target='/api/'+route
    if route=='char':
        slot=request.get('slot')
        if isinstance(slot,bool) or not isinstance(slot,int) or not any(r['slot']==slot for r in config['members']):
            raise ValueError('Unknown new character slot')
        target+='?slot='+str(slot)
    body=None
    if route in {'start','stop'}:
        count=request.get('count',config.get('activeCount',len(config['members'])))
        if isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=len(config['members']):
            raise ValueError('Invalid staged concurrency')
        body=json.dumps({'n':count,'nodraw':True}).encode()
    headers={'Content-Type':'application/json'}
    if route in {'start','stop'}:
        if int(health.get('version','0'))>=15:
            token=json.load(opener.open(base+'/api/control-token',timeout=5)).get('token')
            if not isinstance(token,str) or len(token)!=64:raise ValueError('Control token unavailable')
            headers['X-Asteria-Control']=token
        elif health.get('loadedControllerRevision')!='6764094f9dce7fe4156c110d77674c0b1e83f7cbf494f789ccfd723fb4127d35':raise ValueError('Unknown legacy controller; no mutation')
    with opener.open(urllib.request.Request(base+target,data=body,headers=headers),timeout=30) as response:
        value=json.load(response)
        if route=='char':
            try: snapshot=json.loads((ROOT/'logs/status.json').read_text())
            except (FileNotFoundError,json.JSONDecodeError): snapshot={}
            member=next((r for r in snapshot.get('instances') or [] if r.get('slot')==request['slot']),{})
            value['characterJourney']=member.get('characterJourney')
        return clean(value)


if __name__=='__main__':
    try:
        if len(sys.argv)!=2 or len(sys.argv[1])>24000:raise ValueError('Invalid request size')
        value=json.loads(base64.b64decode(sys.argv[1],validate=True))
        if value.get('encoding')=='gzip-base64':
            import zlib
            raw=zlib.decompressobj(16+zlib.MAX_WBITS).decompress(base64.b64decode(value['data'],validate=True),48001)
            if len(raw)>48000:raise ValueError('Cooperation request too large')
            value=json.loads(raw)
        print(encode_response(handle(value)))
    except Exception as error:
        print(json.dumps({'ok':False,'error':'Third-host request failed: '+type(error).__name__}))
        sys.exit(1)
