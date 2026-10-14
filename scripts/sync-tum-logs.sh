#!/usr/bin/env bash
# Pull tum's farm logs into logs/tum-remote/ on this machine, so logs of both
# machines (tum 2-slot farm + this 6-slot farm) can be read from one place.
# Runs every 10 min via Task Scheduler task "Asteria tum log sync"
# (wscript -> sync-tum-logs-hidden.vbs -> sync-tum-logs.cmd -> this script).
set -u
TUM=deploy@192.0.2.11
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/logs/tum-remote"
LOG="$DEST/_sync.log"

mkdir -p "$DEST"

# tum's clock is UTC and its log files rotate on UTC dates, so compute the
# filenames in UTC to match what exists on tum.
today=$(date -u +%F)
yday=$(date -u -d yesterday +%F)

# Today's files are always compared; yesterday's stop growing at rotation, so a
# local copy means they are done.
list="farm-$today.log console-$today.log status.json team-room.json fleet-performance.json reports.json patch-notes.log"
ylist="farm-$yday.log console-$yday.log"

trim() { # keep _sync.log bounded
  [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 400 ] && tail -n 150 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"
  return 0
}

note() { echo "$(date '+%F %T') $*" >> "$LOG"; trim; }

# One round-trip for remote sizes, then scp only files whose size differs from
# the local copy (into .tmp + mv so a reader never sees a half-written file).
sizes=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$TUM" "cd ~/asteria/logs && wc -c $list $ylist" 2>/dev/null)
if [ -z "$sizes" ]; then
  note "tum unreachable (no size listing)"
  exit 0
fi

while read -r size path; do
  case "$path" in total | '') continue ;; esac
  [ -n "$size" ] || continue
  if [ -f "$DEST/$path" ] && [ "$(wc -c < "$DEST/$path")" = "$size" ]; then
    continue
  fi
  if scp -o BatchMode=yes -o ConnectTimeout=10 -q "$TUM:~/asteria/logs/$path" "$DEST/.tmp-$path" 2>/dev/null; then
    mv -f "$DEST/.tmp-$path" "$DEST/$path"
    note "fetched $path ($size bytes)"
  else
    note "fetch failed: $path"
  fi
done <<EOF
$sizes
EOF

date '+%F %T' > "$DEST/_last-sync.txt"
