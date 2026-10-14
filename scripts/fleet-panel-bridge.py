import gzip
def emit(value):
    packed=gzip.compress(json.dumps(value,ensure_ascii=False).encode())
    # Windows OpenSSH can stall on one large stdout write. Stream bounded ASCII
    # chunks; preserve the full payload and the existing compressed protocol.
    import time
    payload=json.dumps({"encoding":"gzip-base64","data":base64.b64encode(packed).decode()})+'\n'
    for start in range(0,len(payload),2048):
        sys.stdout.write(payload[start:start+2048]);sys.stdout.flush()
        if start+2048<len(payload):time.sleep(0.02)
"""Fixed SSH bridge to the local panel; no shell commands or credentials accepted."""
import json, sys, urllib.request, urllib.error, pathlib, subprocess, shlex, http.cookiejar, base64
payload = base64.b64decode(sys.argv[1], validate=True) if len(sys.argv) == 2 else sys.stdin.readline(10000).encode()
if len(payload) > 10000:
    raise ValueError('Request too large')
request = json.loads(payload)
route = request.get('route', '')
allowed = {'status', 'char', 'plan', 'reports', 'progress', 'map', 'team-brain', 'advice', 'start', 'stop', 'activity-control'}
if route not in allowed:
    raise ValueError('Unknown route')
def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k.lower() not in {'password', 'token', 'username', 'account', 'credentials', 'logfile'}}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value
if route == 'activity-control':
    root = pathlib.Path(__file__).resolve().parent.parent
    program = "const fs=require('fs'),c=require('./src/planning/activity-control');const input=JSON.parse(fs.readFileSync(0,'utf8'));try{const policy=JSON.parse(fs.readFileSync('machines/daily-team-activities.json'));console.log(JSON.stringify(input?c.command(process.cwd(),input):{ok:true,control:c.state(process.cwd(),policy),daily:JSON.parse(fs.readFileSync('logs/fleet/daily-activities.json')).view}));}catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}"
    result = subprocess.run(['node', '-e', program], input=json.dumps(request.get('control')), cwd=root, text=True, capture_output=True, timeout=5)
    if result.returncode != 0:
        raise ValueError('Activity controller unavailable')
    emit(clean(json.loads(result.stdout)))
    sys.exit(0)
if route == 'status':
    # Fleet status must not wait for the game website's optional health request.
    import os, time
    root = pathlib.Path(__file__).resolve().parent.parent
    def read_json(name):
        try:
            return json.loads((root / name).read_text())
        except (OSError, ValueError):
            return {}
    snapshot = read_json('logs/status.json')
    # Overview packets stay below the Windows OpenSSH large-write boundary.
    # Full per-character learning and investment details remain in /api/char.
    member_fields={'capabilityCoverage','nativeBotConsole','stageProfile','legacyMonetaryQuarantine','identity','astral','astralObjective','observations','runtimeV3','characterJourney','runtimeHealth','runtimeCost','runtimeCostStatus','actualProgress','bagTier','bagCapacity','bagDevelopment','slot','char','status','job','jobLv','lv','coins','lastSaveAt','positionAt','fps','fpsAt','memory','freshness','continuity','recovery','goal','dailyActivities','teamCooperation','guildDevelopment','activePetPlan','petActive','mainQuest','endgameCampaign','teamTradeStatus','serverRankings','runtimeV2','errors','recycles','noProgressFor','developmentProgress','levelProgress','levelTrainingStatus'}
    runtime_fields={'purchases','sourceCoherence','phase','lastScreenAt','lastActionAt','farmWatchdog','activityEvidence','stateFreshness','sessionStatus','sessionHealth','mastery','encyclopedia','learningRevision','observation','release','techniques','trial','reservations','loadouts'}
    compact=[]
    for member in snapshot.get('instances') or []:
        row={k:v for k,v in member.items() if k in member_fields}
        runtime=row.get('runtimeV2')
        if isinstance(runtime,dict):
            row['runtimeV2']={k:v for k,v in runtime.items() if k in runtime_fields}
            row['runtimeV2']['techniques']=[{k:v for k,v in t.items() if k in {'id','name','status','metric','cost','budget','evidence'}} for t in runtime.get('techniques') or []]
            activity=row['runtimeV2'].get('activityEvidence')
            if isinstance(activity,dict):
                activity['rows']=[{k:v for k,v in r.items() if k in {'id','activity','at','build','completed','reward','evidence'}} for r in (activity.get('rows') or [])[-8:]]
                activity['historyDisplayLimit']=8
        campaign=row.get('endgameCampaign')
        if isinstance(campaign,dict):
            def requirements(rows):return [{k:v for k,v in r.items() if k in {'name','have','want','short','kind','reserved','usable'}} for r in rows or []]
            campaign['requirements']=requirements(campaign.get('requirements'))
            campaign['missing']=requirements(campaign.get('missing'))
            wing=campaign.get('wing')
            if isinstance(wing,dict):campaign['wing']={k:v for k,v in wing.items() if k in {'target','name','finalTarget','finalName','tier','recipeVerified','completed','craftable','blockedReason'}}
            hunt=campaign.get('hunt')
            if isinstance(hunt,dict):hunt.pop('sources',None)
        compact.append(row)
    snapshot['instances']=compact
    telemetry = read_json('logs/fleet/local.json')
    bind = os.environ.get('SSH_CONNECTION', '').split()[2] if len(os.environ.get('SSH_CONNECTION', '').split()) == 4 else subprocess.check_output(['tailscale', 'ip', '-4'], text=True, timeout=5).strip().splitlines()[0]
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://' + bind + ':4711/api/panel-health', timeout=5) as response:
        health = json.load(response)
    if health.get('service') != 'asteria-panel':
        raise ValueError('Unexpected panel service')
    started_at = None
    try:
        panel_pid = subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', 'asteria-panel.service'], text=True, timeout=5).strip()
        for pid in pathlib.Path('/proc/' + panel_pid + '/task/' + panel_pid + '/children').read_text().split():
            proc = pathlib.Path('/proc/' + pid)
            if b'scripts/run.js' in (proc / 'cmdline').read_bytes() and (proc / 'cwd').resolve() == root:
                ticks = int((proc / 'stat').read_text().rsplit(')', 1)[1].split()[19])
                uptime = float(pathlib.Path('/proc/uptime').read_text().split()[0])
                started_at = int((time.time() - uptime + ticks / os.sysconf('SC_CLK_TCK')) * 1000)
                break
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    memory = {}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        parts = line.split()
        if parts[0] in {'MemTotal:', 'MemAvailable:'}:
            memory[parts[0]] = int(parts[1]) // 1024
    value = {k: snapshot.get(k) for k in ('instances', 'party', 'guild', 'tower', 'runtimeV2', 'gameKnowledge', 'governor')}
    value.update({'controllerProof':health,'running': bool(health.get('running')), 'error': None if health.get('running') else 'Remote farm is not running', 'snapshotAt': snapshot.get('at'), 'game': {'build': telemetry.get('build')}, 'host': {'freeMb': memory.get('MemAvailable:'), 'totalMb': memory.get('MemTotal:'), 'cpus': os.cpu_count()}})
    value.update({'startedAt': started_at, 'snapshotRunVerified': started_at is not None, **{k:health.get(k) for k in ['operatorStopped','intentAuthority','intentAt','intentRevision','intentRequestedAt']}})
    if len(gzip.compress(json.dumps(clean(value),ensure_ascii=False).encode())) > 20000:
        for member in value.get('instances') or []:
            for category in (member.get('serverRankings') or {}).get('categories',{}).values():
                if isinstance(category,dict):
                    category['history']=(category.get('history') or [])[-12:]
                    category['historyDisplayLimit']=12
    emit(clean(value))
    sys.exit(0)
if route == 'progress':
    root = pathlib.Path(__file__).resolve().parent.parent
    try:
        value = json.loads((root / 'logs/reports.json').read_text())
    except (OSError, ValueError):
        value = {'slots': {}, 'events': []}
    emit({k: value.get(k) for k in ('version', 'at', 'build', 'slots', 'events')})
    sys.exit(0)
method = 'POST' if route in {'start', 'stop'} else 'GET'
bind = subprocess.check_output(['tailscale', 'ip', '-4'], text=True, timeout=5).strip().splitlines()[0]
base = 'http://' + bind + ':4711'
url = base + '/api/' + route
if route == 'char':
    slot = request.get('slot')
    if not isinstance(slot, int) or not 0 <= slot < 6:
        raise ValueError('Invalid slot')
    url += '?slot=' + str(slot)
body = json.dumps({'n': 3, 'god': True, 'nodraw': True}).encode() if method == 'POST' else None
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
# The password stays on tum: recover the existing service's configuration,
# authenticate locally, and never include it in the SSH response.
service = subprocess.check_output(['sudo', '-n', 'cat', '/etc/systemd/system/asteria-panel.service'], text=True, timeout=5)
args = shlex.split(next(line[10:] for line in service.splitlines() if line.startswith('ExecStart=')))
password = next((arg.split('=', 1)[1] for arg in args if arg.startswith('--password=')), '')
if password:
    opener.open(urllib.request.Request(base + '/api/auth', data=json.dumps({'password': password}).encode(), headers={'Content-Type': 'application/json'}), timeout=5).close()
headers={'Content-Type':'application/json'}
if method=='POST':
    health=json.load(opener.open(base+'/api/panel-health',timeout=5))
    if health.get('service')!='asteria-panel' or health.get('machine')!='tum':raise ValueError('Controller identity mismatch')
    if int(health.get('version','0'))>=15:
        token=json.load(opener.open(base+'/api/control-token',timeout=5)).get('token')
        if not isinstance(token,str) or len(token)!=64:raise ValueError('Control token unavailable')
        headers['X-Asteria-Control']=token
    elif health.get('loadedControllerRevision')!='6764094f9dce7fe4156c110d77674c0b1e83f7cbf494f789ccfd723fb4127d35':raise ValueError('Unknown legacy controller; no mutation')
try:
    with opener.open(urllib.request.Request(url, data=body, method=method, headers=headers), timeout=70 if route in {'start','stop'} else 12) as response:
        value = json.load(response)
    import time
    root = pathlib.Path(__file__).resolve().parent.parent
    try:
        snapshot = json.loads((root / 'logs/status.json').read_text())
    except (OSError, ValueError):
        snapshot = {}
    member = next((m for m in snapshot.get('instances', []) if m.get('slot') == request.get('slot')), {})
    value['meta'] = {'machine': 'tum', 'fetchedAt': int(time.time()*1000), 'snapshotAt': snapshot.get('at'), 'lastSaveAt': member.get('lastSaveAt')}
    if route == 'char':
        for field in ['capabilityCoverage','nativeBotConsole','stageProfile','legacyMonetaryQuarantine','identity','astral','astralObjective','observations','runtimeV3', 'characterJourney', 'runtimeHealth', 'runtimeCost','runtimeCostStatus', 'actualProgress', 'dailyActivities', 'teamCooperation', 'guildDevelopment', 'activePetPlan', 'petActive', 'mainQuest', 'endgameCampaign', 'teamTradeStatus', 'memory', 'recovery', 'freshness', 'investmentPlan', 'equipmentCeiling', 'developmentProgress', 'gearImpact', 'runtimeV2', 'development', 'questOutcomes', 'personalBrain', 'levelProgress', 'levelTrainingStatus']:
            value[field] = member.get(field)
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k.lower() not in {'password', 'token', 'username', 'account', 'credentials', 'logfile'}}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value
    emit(clean(value))
except urllib.error.HTTPError as error:
    emit({'ok': False, 'error': 'Panel authentication required' if error.code == 401 else 'Panel request failed'})
