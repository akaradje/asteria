"""One-shot read-only acceptance recorder for the separate VPS squad."""
import datetime,json,pathlib,time
ROOT=pathlib.Path(__file__).resolve().parent.parent
def fresh(at,now,limit):
    return isinstance(at,(float,int)) and 0<=now-at<limit
def project(snapshot,names,revision,now,build=None):
    try: at=datetime.datetime.fromisoformat(snapshot['at'].replace('Z','+00:00')).timestamp()*1000
    except (KeyError,ValueError,TypeError): at=0
    rows=[]
    for name in names:
        raw=next((r for r in snapshot.get('instances',[]) if r.get('char')==name),{})
        online=fresh(at,now,45000) and raw.get('status')=='playing' and not raw.get('recycling') and fresh(raw.get('lastSaveAt'),now,30000)
        fps=raw.get('fps') if online and fresh(raw.get('fpsAt'),now,15000) else None
        rows.append({'name':name,'online':online,'lv':raw.get('lv'),'job':raw.get('job'),'fps':fps,'partyId':raw.get('teamPartyId'),'recycles':raw.get('recycles',0),'phase':raw.get('runtimeV2',{}).get('phase')})
    party=snapshot.get('party') or {};guild=snapshot.get('guild') or {};version=snapshot.get('gameKnowledge',{}).get('systemVersion') or {}
    complete=all(r['online'] for r in rows) and fresh(party.get('checkedAt'),now,60000) and set(party.get('members',[]))==set(names) and len(party.get('members',[]))==len(names) and party.get('id') is not None and all(r['partyId']==party['id'] for r in rows)
    guild_ready=guild.get('name')=='ExampleGuild' and fresh(guild.get('checkedAt'),now,90000) and set(names).issubset(guild.get('members',[]))
    aligned=version.get('loadedSystemRevision')==revision and version.get('sourceRevision')==revision and version.get('aligned') is True and (build is None or version.get('build')==build)
    return {'at':now,'build':version.get('build'),'complete':bool(complete),'guildReady':bool(guild_ready),'aligned':aligned,'members':rows}
def save(path,data):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(data,indent=2),encoding='utf8');temporary.replace(path)
def main():
    registry=json.loads((ROOT/'machines/expansion.json').read_text());names=[m['charName'] for m in registry['members']]
    manifest=json.loads((ROOT/'logs/system-audit/architecture-release.json').read_text())
    revision=manifest['sourceRevision'];now=time.time()*1000;run=str(int(now));directory=ROOT/'logs/system-audit';directory.mkdir(parents=True,exist_ok=True)
    report={'runId':run,'createdAt':now,'status':'waiting_for_team','durationMs':10800000,'build':manifest['build'],'sourceRevision':revision,'observedMs':0,'completeMs':0,'samples':0,'measuredFpsSamples':0,'expectedFpsSamples':0,'lowFpsSamples':0,'failures':0,'longTermVerified':False,'minAvailableMb':None,'perCharacter':{}}
    file=directory/'vps-soak.json';samples=directory/'vps-soak-samples.jsonl';streak=0;previous=None
    while True:
        now=time.time()*1000
        try: s=project(json.loads((ROOT/'logs/status.json').read_text()),names,revision,now,manifest['build'])
        except (OSError,ValueError): s={'at':now,'complete':False,'guildReady':False,'aligned':False,'members':[]};report['failures']+=1
        mem={l.split(':')[0]:int(l.split()[1]) for l in pathlib.Path('/proc/meminfo').read_text().splitlines()};s['availableMb']=round(mem['MemAvailable']/1024)
        if report['status']=='waiting_for_team':
            streak=streak+1 if s['complete'] and s['guildReady'] and s['aligned'] else 0
            if streak>=3: report.update(status='running',startedAt=now,targetEndAt=now+10800000)
            elif now-report['createdAt']>=1800000: report.update(status='warmup_failed',finishedAt=now)
        if report['status']=='running':
            dt=min(30000,now-previous['at']) if previous else 0;report['observedMs']+=dt
            if previous and previous['complete'] and s['complete'] and previous['aligned'] and s['aligned']:report['completeMs']+=dt
            report['samples']+=1;report['minAvailableMb']=min(report['minAvailableMb'] or s['availableMb'],s['availableMb'])
            for row in s['members']:
                p=report['perCharacter'].setdefault(row['name'],{'firstLv':row['lv'],'lastLv':row['lv'],'minFps':None,'onlineSamples':0,'recycles':0});p['lastLv']=row['lv'];p['recycles']=max(p['recycles'],row['recycles'] or 0)
                if row['online']:p['onlineSamples']+=1;report['expectedFpsSamples']+=1
                if isinstance(row['fps'],(int,float)) and row['fps']>=0:
                    report['measuredFpsSamples']+=1;p['minFps']=min(p['minFps'] if p['minFps'] is not None else row['fps'],row['fps'])
                    if row['fps']<15:report['lowFpsSamples']+=1
            report['completePct']=100*report['completeMs']/report['observedMs'] if report['observedMs'] else 0
            report['fpsCoveragePct']=100*report['measuredFpsSamples']/report['expectedFpsSamples'] if report['expectedFpsSamples'] else 0
            report['lowFpsPct']=100*report['lowFpsSamples']/report['measuredFpsSamples'] if report['measuredFpsSamples'] else None
            if now>=report['targetEndAt']:
                report.update(status='completed',finishedAt=now)
                report['longTermVerified']=report['observedMs']>=10800000*.95 and report['completePct']>=99.5 and report['failures']==0 and report['fpsCoveragePct']>=90 and report['lowFpsPct'] is not None and report['lowFpsPct']<=2 and report['minAvailableMb']>=2048 and s['guildReady'] and s['aligned']
            previous=s
        report['lastSample']=s
        with samples.open('a',encoding='utf8') as stream:stream.write(json.dumps({'runId':run,**s})+'\n')
        save(file,report)
        if report['status'] in ('completed','warmup_failed'):return
        time.sleep(15)
if __name__=='__main__':main()
