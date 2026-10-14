"""Read-only dashboard EXP projection; never accesses accounts or game pages."""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[2]
machine = sys.argv[1] if len(sys.argv) == 2 else None
if machine not in {'tum', 'vps'}:
    raise ValueError('Unknown EXP host')
roster = json.loads((root / 'machines' / ('expansion.json' if machine == 'vps' else 'fleet.json')).read_text())
snapshot = json.loads((root / 'logs/status.json').read_text())
assigned = {(m['slot'], m['charName']) for m in roster['members'] if m['machine'] == machine}
version = (snapshot.get('gameKnowledge') or {}).get('systemVersion') or {}
rows = [{k: r.get(k) for k in ('slot', 'char', 'lv', 'exp', 'lastSaveAt')}
        for r in snapshot.get('instances') or [] if (r.get('slot'), r.get('char')) in assigned]
for row in rows:
    source = next(r for r in snapshot['instances'] if r.get('slot') == row['slot'] and r.get('char') == row['char'])
    row['levelProgress'] = {k: v for k, v in (source.get('levelProgress') or {}).items()
                            if k in {'build', 'lv', 'saveAt', 'at', 'status', 'expPerHour', 'measuredMs', 'samples'}}
print(json.dumps({'build': version.get('build'), 'snapshotAt': snapshot.get('at'), 'rows': rows}))
