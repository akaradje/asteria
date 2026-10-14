import gzip
def emit(value):
    packed=gzip.compress(json.dumps(value,ensure_ascii=False).encode())
    import time
    payload=json.dumps({"encoding":"gzip-base64","data":base64.b64encode(packed).decode()})+'\n'
    for start in range(0,len(payload),2048):
        sys.stdout.write(payload[start:start+2048]);sys.stdout.flush()
        if start+2048<len(payload):time.sleep(0.02)
"""SSH-only exchange of public telemetry. Never reads credentials or accepts commands."""
import json, pathlib, sys, time, base64
root=pathlib.Path(__file__).resolve().parent.parent
payload=base64.b64decode(sys.argv[1],validate=True) if len(sys.argv)==2 else sys.stdin.readline(200000).encode()
if len(payload)>16000:raise ValueError('Telemetry too large')
incoming=json.loads(payload)
if incoming.get('encoding')=='gzip-base64':
    import zlib
    raw=zlib.decompressobj(16+zlib.MAX_WBITS).decompress(base64.b64decode(incoming['data'],validate=True),48001)
    if len(raw)>48000:raise ValueError('Cooperation too large')
    incoming=json.loads(raw)
if incoming.get('machine')!='windows' or abs(time.time()*1000-incoming.get('at',0))>15000:
    raise ValueError('Stale or unexpected machine')
allowed_top={'machine','at','build','party','members','workflow','tradeWorkflow','workboard','dailyActivities','guild','expansion'}
allowed_member={'identity','runtimeGeneration','classSupport','slot','charName','status','job','lv','lastSaveAt','teamPartyId','livePos','vitals','recycling','goal','readiness','recovery','memory','performance','activityState','workflowAck','activityResult','teamInventory','teamTradeStatus','tradeAvailability','teamWork','actionOwner'}
if incoming.get('guild') is not None:
    raise ValueError('Windows cannot publish leader guild intent')
if incoming.get('workflow') is not None:
    raise ValueError('Windows cannot publish leader activity intent')
if incoming.get('dailyActivities') is not None:
    raise ValueError('Windows cannot publish coordinator daily plan')
if incoming.get('workboard') is not None:
    raise ValueError('Windows cannot publish coordinator workboard')
if incoming.get('tradeWorkflow') is not None:
    raise ValueError('Windows cannot publish leader trade intent')
if set(incoming)-allowed_top or len(incoming.get('members',[]))>6:
    raise ValueError('Unexpected telemetry')
config=json.loads((root/'machines/fleet.json').read_text())
names={m['charName'] for m in config['members'] if m['machine']=='windows'}
expansion=incoming.get('expansion')
extra_members=[]
if expansion is not None:
    extra=json.loads((root/'machines/expansion.json').read_text())
    if not extra.get('enabled') or not isinstance(expansion,dict) or set(expansion)-{'machine','at','build','members'} or expansion.get('machine')!='vps' or expansion.get('build')!=incoming.get('build') or abs(time.time()*1000-expansion.get('at',0))>=15000 or len(expansion.get('members',[]))>len(extra['members']):
        raise ValueError('Invalid expansion telemetry')
    extra_members=expansion['members']
    if any(not any(e['slot']==m.get('slot') and e['charName']==m.get('charName') for e in extra['members']) for m in extra_members):raise ValueError('Unknown expansion member')
if any(m.get('charName') not in names for m in incoming['members']):raise ValueError('Foreign primary member')
names.update(m['charName'] for m in extra_members)
def reject_private(value):
    if isinstance(value,dict):
        if any(k.lower() in {'password','token','username','account','credentials','cookie','authorization'} for k in value):
            raise ValueError('Private fields are not telemetry')
        for child in value.values():reject_private(child)
    elif isinstance(value,list):
        for child in value:reject_private(child)
reject_private(incoming)

def class_support(value, generation, build):
    """Bounded native observations only; this bridge grants no game commands."""
    if value is None:return
    def shape(row, keys):
        if not isinstance(row,dict) or set(row)-set(keys):raise ValueError('Unexpected class support fields')
    def numeric(row, keys):
        for key in keys:
            x=row.get(key)
            if x is not None and (type(x) not in (int,float) or not __import__('math').isfinite(x) or x<0):raise ValueError('Invalid class support number')
    def strings(row, keys):
        for key in keys:
            x=row.get(key)
            if x is not None and (not isinstance(x,str) or len(x)>240):raise ValueError('Invalid class support text')
    shape(value, {'build','session','sourceCurrent','save','vitals','party','phase','ready','missing','protected','developmentBlocked','journalBlocked','deaths','probes','storageBlocked','goal','managedTarget','pendingTravel','reservation'})
    if value.get('session')!=generation or value.get('build')!=build:raise ValueError('Class support generation/build mismatch')
    strings(value, {'build','session','phase','managedTarget'})
    for key in ['sourceCurrent','ready','protected','developmentBlocked','journalBlocked','storageBlocked','pendingTravel']:
        if key in value and type(value[key]) is not bool:raise ValueError('Invalid class support flag')
    saved=value.get('save');shape(saved, {'job','jobLv','lv','coins','equip','bagTier','bagUsed','potions','materials'})
    strings(saved, {'job'});numeric(saved, {'jobLv','lv','coins','bagTier','bagUsed','potions'})
    if type(saved.get('bagUsed')) is not int or not 0<=saved['bagUsed']<=2000:raise ValueError('Invalid class support bag count')
    gear=saved.get('equip',{});shape(gear, {'weapon','head','armor','boots','accessory','accessory2','acc1','acc2','ring','ring2','amulet','necklace','offhand','shield','wing','wings'})
    strings(gear, gear.keys())
    cores={'Ancient Bark','Pharaoh Gold','Wyrm Scale','Tyrant Ember','Abyss Crystal'}
    materials=saved.get('materials',{});shape(materials, cores);numeric(materials, materials.keys())
    for key,keys in [('vitals',{'at','hp','maxHp','currentHp'}),('party',{'id','_sessionBound','_receivedAt','_streamAt'}),('reservation',{'key','expiresAt'})]:
        row=value.get(key)
        if row is None:continue
        shape(row,keys);numeric(row,keys-{'key','_sessionBound'})
        if key=='vitals' and (row.get('hp',0)>1):raise ValueError('Invalid class support HP ratio')
        if key=='party' and type(row.get('_sessionBound')) is not bool:raise ValueError('Invalid class support party proof')
        if key=='reservation':strings(row,{'key'})
    goal=value.get('goal')
    if goal is not None:shape(goal,{'kind','recipient','monsterId','mapId'});strings(goal,goal.keys())
    for key,keys in [('missing',{'name','want','have'}),('deaths',{'map','at'}),('probes',{'monsterId','build','status','deadline','cooldownUntil'})]:
        rows=value.get(key,[])
        if not isinstance(rows,list) or len(rows)>(5 if key=='missing' else 64):raise ValueError('Too many class support observations')
        for row in rows:
            shape(row,keys);strings(row,keys&{'name','map','monsterId','build','status'});numeric(row,keys&{'want','have','at','deadline','cooldownUntil'})
            if key=='missing' and row.get('name') not in cores:raise ValueError('Unexpected class support material')

for m in incoming['members']+extra_members:
    generation=m.get('runtimeGeneration')
    if generation is not None and (not isinstance(generation,str) or not 1<=len(generation)<=80 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-' for c in generation)):
        raise ValueError('Invalid runtime generation')
    if set(m)-allowed_member or m.get('charName') not in names:
        raise ValueError('Unknown member or unexpected fields')
    class_support(m.get('classSupport'), generation, incoming.get('build'))
    identity=m.get('identity')
    if identity is not None:
        import re
        if not isinstance(identity,dict) or set(identity)-{'actorId','name','host','slot','realm','epoch','lifecycle','policyRevision','nativeClass','identityEvidence'} or not re.fullmatch(r'actor-[a-f0-9]{32}',str(identity.get('actorId',''))) or identity.get('name')!=m.get('charName') or identity.get('slot')!=m.get('slot') or identity.get('host') not in {'windows','vps'} or identity.get('identityEvidence')!='authenticated_native_character_list' or type(identity.get('policyRevision')) is not int:
            raise ValueError('Invalid authenticated actor projection')
    work=m.get('teamWork')
    if work is not None:
        if not isinstance(work,dict) or set(work)-{'milestones','equipment','at','phase','needs','reserved','helper','blocked','kills','monsterId','bossProof','bossBoard','helperWaitUntil'} or len(work.get('needs',[]))>24 or len(work.get('blocked',[]))>24:
            raise ValueError('Unexpected work projection')
        if work.get('helperWaitUntil') is not None and (type(work['helperWaitUntil']) not in (int,float) or not time.time()*1000<work['helperWaitUntil']<time.time()*1000+7200000):raise ValueError('Invalid personal return deadline')
        metrics=work.get('equipment')
        if metrics is not None and (not isinstance(metrics,dict) or set(metrics)!={'legendaryEquipped','refine10Equipped','complete'} or any(type(metrics[k]) is not int or not 0<=metrics[k]<=8 for k in ['legendaryEquipped','refine10Equipped']) or type(metrics['complete']) is not bool):raise ValueError('Invalid equipment milestone summary')
        milestone=work.get('milestones')
        if milestone is not None and (not isinstance(milestone,dict) or set(milestone)!={'stage','equipmentAllowed'} or milestone['stage'] not in {'pet','class','wing','equipment'} or type(milestone['equipmentAllowed']) is not bool):raise ValueError('Invalid progression milestone summary')
        proof=work.get('bossProof',{})
        if not isinstance(proof,dict) or set(proof)-{'ignar_the_flame_tyrant'} or any(type(v) is not int or v<0 for v in proof.values()):
            raise ValueError('Unexpected boss proof')
        board=work.get('bossBoard')
        if board is not None:
            if not isinstance(board,dict) or set(board)!={'_receivedAt','now','list'} or type(board['_receivedAt']) not in (int,float) or type(board['now']) not in (int,float) or not isinstance(board['list'],list) or len(board['list'])>1:
                raise ValueError('Unexpected boss board')
            for b in board['list']:
                if not isinstance(b,dict) or set(b)!={'id','map','up','next'} or b['id']!='ignar_the_flame_tyrant' or b['map']!='n3' or type(b['up']) is not bool or b['next'] is not None and type(b['next']) not in (int,float):
                    raise ValueError('Unexpected wing boss round')
        if any(not isinstance(r,dict) or set(r)-{'name','want','priority','kind'} or not isinstance(r.get('name'),str) or type(r.get('want')) not in (int,float) or r['want']<=0 for r in work.get('needs',[])):
            raise ValueError('Unexpected work requirement')
    if m.get('actionOwner') not in (None,'activity'):
        raise ValueError('Unexpected action owner')
    inventory=m.get('teamInventory')
    trade=m.get('teamTradeStatus')
    if isinstance(trade,dict) and 'noDispatch' in trade and type(trade['noDispatch']) is not bool:
        raise ValueError('Invalid durable trade dispatch proof')
    if isinstance(trade,dict) and 'navigationReleased' in trade and type(trade['navigationReleased']) is not bool:
        raise ValueError('Invalid trade navigation release proof')
    availability=m.get('tradeAvailability')
    if availability is not None:
        if not isinstance(availability,dict) or set(availability)!={'at','clear'} or type(availability.get('clear')) is not bool or type(availability.get('at')) not in (int,float):
            raise ValueError('Unexpected trade availability')
    if inventory is not None:
        if not isinstance(inventory,dict) or set(inventory)-{'at','copper','job','lv','jobLv','equip','wings','refine','weaponOpts','sockets','holes','locks','bagFree','offers','materials','storageMaterials','stage','needs','reserved'} or len(inventory.get('offers',[]))>24:
            raise ValueError('Unexpected inventory telemetry')
        copper=inventory.get('copper')
        if copper is not None:
            if not isinstance(copper,dict) or set(copper)-{'coins','reserve','target','spare','need','classFunding'} or not {'coins','reserve','target','spare','need'}<=set(copper) or any(type(copper[k]) is not int or not 0<=copper[k]<=9007199254740991 for k in ['coins','reserve','target','spare','need']):
                raise ValueError('Invalid Copper budget')
            funding=copper.get('classFunding')
            if funding is not None:
                if not isinstance(funding,dict) or set(funding)!={'build','job','item','quantity','price','quoteAt','validUntil'} or any(not isinstance(funding[k],str) or not 1<=len(funding[k])<=100 for k in ['build','job','item']) or any(type(funding[k]) is not int for k in ['quantity','price','quoteAt','validUntil']):
                    raise ValueError('Invalid class material funding quote')
                if funding['build']!=incoming.get('build') or funding['job']!=inventory.get('job') or funding['item']=='Copper' or not 1<=funding['quantity']<=100 or not 1<=funding['price']<=3000000 or not funding['quoteAt']<=incoming['at']<funding['validUntil']<=funding['quoteAt']+600000:
                    raise ValueError('Stale or inconsistent class material funding quote')
            if copper['target']!=copper['reserve']+50000+(funding['price'] if funding else 0) or copper['spare']!=max(0,copper['coins']-copper['target']) or copper['need']>max(0,copper['target']-copper['coins']):
                raise ValueError('Inconsistent Copper budget')
        stored=inventory.get('storageMaterials',{})
        if not isinstance(stored,dict) or len(stored)>24 or any(not isinstance(k,str) or len(k)>100 or type(v) is not int or v<0 for k,v in stored.items()):
            raise ValueError('Invalid personal storage material telemetry')
        if any(not isinstance(x,dict) or set(x)-{'id','index'} for x in inventory.get('offers',[])):
            raise ValueError('Unexpected gear offer')
    metric=m.get('performance')
    if metric is not None:
        if not isinstance(metric,dict) or set(metric)-{'fps','at'}:
            raise ValueError('Unexpected performance fields')
        for key in ('fps','at'):
            value=metric.get(key)
            if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or value<0):
                raise ValueError('Invalid performance metric')
folder=root/'logs/fleet';folder.mkdir(parents=True,exist_ok=True)
if expansion is not None:
    target=folder/'vps.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps(expansion));temp.replace(target)
incoming.pop('expansion',None)
target=folder/'windows.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps(incoming));temp.replace(target)
local=json.loads((folder/'local.json').read_text())
if local.get('machine')!='tum':raise ValueError('No tum telemetry')
emit(local)
