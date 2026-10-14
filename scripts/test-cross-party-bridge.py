"""Offline bridge integration; no live HTTP, SSH, payments or game actions."""
import base64, gzip, importlib.util, json, pathlib, subprocess, sys, tempfile, time

source=pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='asteria-cross-bridge-') as directory:
    root=pathlib.Path(directory)
    (root/'scripts').mkdir(); (root/'machines').mkdir(); (root/'logs/fleet').mkdir(parents=True)
    for name in ['fleet-exchange.py','vps-panel-bridge.py']:
        (root/'scripts'/name).write_bytes((source/name).read_bytes())
    primary={'members':[{'charName':'Primary','machine':'windows','slot':0}]}
    extra={'enabled':True,'members':[{'charName':'Extra','machine':'vps','slot':0}],'guild':{'name':'Guild','leader':'Primary'}}
    (root/'machines/fleet.json').write_text(json.dumps(primary));(root/'machines/expansion.json').write_text(json.dumps(extra))
    (root/'logs/fleet/local.json').write_text(json.dumps({'machine':'tum','members':[]}))
    now=int(time.time()*1000)
    payload={'machine':'windows','at':now,'build':'b1','members':[{'slot':0,'charName':'Primary'}],'expansion':{'machine':'vps','at':now,'build':'b1','members':[{'slot':0,'charName':'Extra'}]}}
    def exchange(value):
        wire={'encoding':'gzip-base64','data':base64.b64encode(gzip.compress(json.dumps(value).encode())).decode()}
        # This is an offline protocol fixture. Freeze only the child test clock
        # so subprocess startup costs cannot age otherwise valid telemetry.
        # The unmodified production handler still enforces its 15s boundary.
        runner="import runpy,sys,time;stamp=float(sys.argv[1]);time.time=lambda:stamp;sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')"
        return subprocess.run([sys.executable,'-c',runner,str(now/1000),str(root/'scripts/fleet-exchange.py'),base64.b64encode(json.dumps(wire).encode()).decode()],capture_output=True)
    assert exchange(payload).returncode==0
    stale=json.loads(json.dumps(payload));stale['at']=now-15001
    assert exchange(stale).returncode!=0,'unchanged production freshness rejects data beyond fifteen seconds'
    assert json.loads((root/'logs/fleet/vps.json').read_text())['members'][0]['charName']=='Extra'
    assert 'expansion' not in json.loads((root/'logs/fleet/windows.json').read_text())
    cash=json.loads(json.dumps(payload));cash['expansion']['members'][0]['teamInventory']={'at':now,'offers':[],'copper':{'coins':15000,'reserve':12000,'target':62000,'spare':0,'need':47000}}
    assert exchange(cash).returncode==0
    for change in [{'spare':1},{'target':62001},{'need':47001},{'coins':True},{'password':'fixture'},{'need':-1}]:
        bad=json.loads(json.dumps(cash));bad['expansion']['members'][0]['teamInventory']['copper'].update(change)
        assert exchange(bad).returncode!=0,change
    funded=json.loads(json.dumps(cash));fund=funded['expansion']['members'][0]['teamInventory'];fund['job']='nightfang';fund['copper']={'coins':1300000,'reserve':112000,'target':3162000,'spare':0,'need':1862000,'classFunding':{'build':'b1','job':'nightfang','item':'Abyss Crystal','quantity':1,'price':3000000,'quoteAt':now-1000,'validUntil':now+599000}}
    assert exchange(funded).returncode==0
    accepted=(root/'logs/fleet/vps.json').read_bytes()
    for change in [{'price':3000001},{'price':True},{'item':'Copper'},{'job':'inquisitor'},{'build':'old'},{'quantity':0},{'validUntil':now},{'validUntil':now+600000},{'password':'fixture'}]:
        bad=json.loads(json.dumps(funded));bad['expansion']['members'][0]['teamInventory']['copper']['classFunding'].update(change)
        assert exchange(bad).returncode!=0,change
        assert (root/'logs/fleet/vps.json').read_bytes()==accepted,'invalid quote cannot replace accepted telemetry'
    for flag in [True,False,'true',1,None]:
        proof=json.loads(json.dumps(payload));proof['expansion']['members'][0]['teamTradeStatus']={'noDispatch':flag}
        assert (exchange(proof).returncode==0)==(type(flag) is bool)
    for change in [{'charName':'Foreign'}, {'credentials':{'password':'fixture'}}]:
        bad=json.loads(json.dumps(payload));bad['expansion']['members'][0].update(change)
        assert exchange(bad).returncode!=0
    native={'build':'b1','session':'session-primary','sourceCurrent':True,
            'save':{'job':'nightfang','jobLv':50,'lv':117,'coins':300000,'equip':{'weapon':'gear','offhand':None,'acc1':None},'bagTier':0,'bagUsed':20,'potions':80,'materials':{'Abyss Crystal':0}},
            'vitals':{'at':now,'hp':1,'maxHp':8214,'currentHp':8214},
            'party':{'id':1,'_sessionBound':True,'_receivedAt':now-100000,'_streamAt':now},
            'phase':'class','ready':False,'protected':False,'developmentBlocked':False,'journalBlocked':False,'storageBlocked':False,'pendingTravel':False,
            'missing':[{'name':'Abyss Crystal','want':1,'have':0}],'deaths':[{'map':'d4','at':now-1000}],'probes':[],
            'goal':{'kind':'milestone-assist','recipient':'Primary','monsterId':'nyxara_queen_of_the_abyss','mapId':'d4'},
            'managedTarget':'b1:d4:nyxara_queen_of_the_abyss','reservation':{'key':'b1:1:nyxara:d4:Primary:live','expiresAt':now+60000}}
    supported=json.loads(json.dumps(payload));supported['members'][0].update({'runtimeGeneration':'session-primary','classSupport':native})
    result=exchange(supported);assert result.returncode==0,result.stderr.decode()
    target=root/'logs/fleet/windows.json';accepted=target.read_bytes()
    assert json.loads(accepted)['members'][0]['classSupport']==native
    for change in [{'commands':['travel']},{'build':'old'},{'session':'other-session'},{'protected':'false'},
                   {'vitals':{'at':now,'hp':2}},{'save':{**native['save'],'bagUsed':2001}},
                   {'save':{**native['save'],'jobLv':True}}, {'save':{**native['save'],'jobLv':-1}}, {'save':{**native['save'],'jobLv':'50'}},
                   {'save':{**native['save'],'equip':{'weapon':'gear','unknown':'gear'}}},
                   {'missing':[{'name':'Invented Core','have':0,'want':1}]},
                   {'deaths':[{'map':'d4','at':now}]*65},{'goal':{'kind':'assist','token':'fixture'}}]:
        bad=json.loads(json.dumps(supported));bad['members'][0]['classSupport'].update(change)
        assert exchange(bad).returncode!=0,change
        assert target.read_bytes()==accepted,'rejected evidence must not replace native telemetry'
    spec=importlib.util.spec_from_file_location('test_bridge',root/'scripts/vps-panel-bridge.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
    memory=root/'meminfo';memory.write_text('MemTotal: 12000000 kB\nMemAvailable: 6000000 kB\n')
    bridge.Path=lambda value:memory if value=='/proc/meminfo' else pathlib.Path(value)
    activity={'gd':{'build':'b1','at':now,'left':1,'guildId':'guild-one'}}
    ack={'id':'run-one','phase':'GATHERING','ok':True,'at':now}
    snapshot={'at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'gameKnowledge':{'systemVersion':{'build':'b1'}},'instances':[{'slot':0,'char':'Extra','activityState':activity,'workflowAck':ack,'dailyWorkStatus':None,'characterJourney':{'state':'gather','credentials':'fixture'},'account':'fixture'}]}
    (root/'logs/status.json').write_text(json.dumps(snapshot))
    class Response:
        def __init__(self,value): self.value=value
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self):return json.dumps(self.value).encode()
    class Opener:
        def open(self,request,**kwargs):
            url=request if isinstance(request,str) else request.full_url
            return Response({'service':'asteria-panel','machine':'vps','running':True} if url.endswith('panel-health') else {'account':'fixture'})
    bridge.urllib.request.build_opener=lambda *args:Opener()
    status=bridge.handle({'route':'status'})
    assert status['cooperation']['members'][0]['actionOwner'] is None
    assert status['cooperation']['build']=='b1'
    assert status['cooperation']['members'][0]['activityState']==activity
    assert status['cooperation']['members'][0]['workflowAck']==ack
    assert status['instances'][0]['characterJourney']=={'state':'gather'}
    assert bridge.handle({'route':'char','slot':0})['characterJourney']=={'state':'gather'}
    encoded=json.loads(bridge.encode_response({'rows':['measured field data '*1000]*6}))
    assert encoded['encoding']=='gzip-base64'
    assert len(json.dumps(encoded))<16000
    assert len(json.loads(gzip.decompress(base64.b64decode(encoded['data'])))['rows'])==6
    try: bridge.handle({'route':'status','cooperation':{'at':now-30000,'build':'b1'}})
    except ValueError:pass
    else:raise AssertionError('stale intent accepted')
print('PASS compressed cross-party exchange, registered roster/private rejection, null owner, journey detail projection and stale intent rejection')
