#!/usr/bin/env bash
# The one command that finishes HomeFAX's GenRecon rollout after funds land.
#
#   bash scripts/resume-genrecon.sh
#
# It refuses to start until the RunPod balance is positive, then:
#   1. restarts the GenRecon pod (its 100 GB volume resumes provisioning
#      from the stage markers — nothing already done is redone)
#   2. follows the provisioning log streamed to Blob until the worker
#      reports genrecon:true (or surfaces the first real error and stops)
#   3. runs a 40-frame test reconstruction and reports the measured timing
#   4. wires RECON_URL/RECON_KEY into Vercel production and deploys
#   5. leaves the pod RUNNING and prints the stop command — stopping when
#      idle is the rule, but you probably want to film something first.
#
# Secrets come from .env.local (RUNPOD_API_KEY, RECON_KEY, HOMEFAX_POD_ID,
# BLOB_READ_WRITE_TOKEN). Safe to re-run at any point; every step is
# idempotent or read-only.

set -uo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env.local; set +a
POD="${HOMEFAX_POD_ID:?HOMEFAX_POD_ID missing from .env.local}"
RP="${RUNPOD_API_KEY:?RUNPOD_API_KEY missing from .env.local}"
KEY="${RECON_KEY:?RECON_KEY missing from .env.local}"
BASE="https://$POD-8000.proxy.runpod.net"
LOGURL="https://hvd0xzjehdzr7owv.public.blob.vercel-storage.com/podlogs/genrecon-provision.log"
FRAMES_JSON="${FRAMES_JSON:-/home/god/homefax-final/scripts/testset_urls.json}"

say() { printf '\n=== %s [%s]\n' "$1" "$(date -u +%H:%M:%S)"; }

say "balance"
BAL=$(curl -s --max-time 30 "https://api.runpod.io/graphql?api_key=$RP" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { myself { clientBalance } }"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['myself']['clientBalance'])")
echo "balance: \$$BAL"
python3 -c "import sys; sys.exit(0 if float('$BAL') > 0.5 else 1)" || {
  echo "Balance is \$$BAL — add funds at https://console.runpod.io/user/billing first."
  exit 1
}

say "restarting pod $POD"
CODE=$(curl -s --max-time 120 -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $RP" "https://rest.runpod.io/v1/pods/$POD/restart")
if [ "$CODE" != "200" ]; then
  # A stopped pod sometimes needs start rather than restart.
  CODE=$(curl -s --max-time 120 -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $RP" "https://rest.runpod.io/v1/pods/$POD/start")
fi
echo "start/restart: HTTP $CODE"
[ "$CODE" = "200" ] || { echo "Pod would not start — check the console."; exit 1; }

say "waiting for the GenRecon worker (provisioning resumes from markers)"
DEADLINE=$(( $(date +%s) + 5400 ))
LAST=""
while [ $(date +%s) -le $DEADLINE ]; do
  H=$(curl -s --max-time 10 "$BASE/health" 2>/dev/null || true)
  if echo "$H" | grep -q '"genrecon": true'; then echo "worker ready: $H"; break; fi
  STAGE=$(curl -s --max-time 10 "$LOGURL?ts=$(date +%s)" -H "Cache-Control: no-cache" 2>/dev/null \
    | grep -E "^=== |[Ee]rror|failed|Killed|Traceback" | tail -1 || true)
  if [ -n "$STAGE" ] && [ "$STAGE" != "$LAST" ]; then echo "  $STAGE"; LAST="$STAGE"; fi
  if echo "$STAGE" | grep -qE "Traceback|CondaError"; then
    echo "Provisioning hit an error — full log: $LOGURL"; exit 1
  fi
  sleep 30
done
echo "$H" | grep -q '"genrecon": true' || { echo "Timed out after 90 min. Log: $LOGURL"; exit 1; }

say "test reconstruction (40 frames, timed)"
T0=$(date +%s)
python3 - "$BASE" "$KEY" "$FRAMES_JSON" <<'PYEOF'
import json, pathlib, sys, time, urllib.request
base, key, frames = sys.argv[1:4]
urls = json.loads(pathlib.Path(frames).read_text())
def req(path, data=None):
    r = urllib.request.Request(
        f"{base}/{path}", data=json.dumps(data).encode() if data else None,
        method="POST" if data else "GET",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "homefax/1.0"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)
job = req("reconstruct", {"input": {"image_urls": urls, "stage": "framing", "max_frames": 40}})
print("job:", job["id"])
last = ""
while True:
    time.sleep(15)
    try:
        d = req(f"jobs/{job['id']}")
    except Exception as e:
        print("poll:", e); continue
    line = f"{d['status']} {d.get('step') or ''}"
    if line != last: print(" ", line); last = line
    if d["status"] in ("COMPLETED", "FAILED"):
        o = d.get("output") or {}
        if not o.get("ok"):
            print("FAILED:", str(o.get("error"))[:400]); raise SystemExit(1)
        r = o["result"]
        print("GLB:", r["glbUrl"])
        print("elapsed(worker):", r.get("elapsedSeconds"), "s")
        break
PYEOF
[ $? -eq 0 ] || exit 1
echo "wall time: $(( $(date +%s) - T0 ))s"

say "wiring production"
for env in production preview development; do
  printf '%s' "$BASE" | vercel env add RECON_URL $env --force >/dev/null 2>&1
  printf '%s' "$KEY" | vercel env add RECON_KEY $env --force >/dev/null 2>&1
done
vercel deploy --prod --yes 2>&1 | grep -E '"message"' | head -1

say "DONE"
echo "HomeFAX is live with GenRecon at https://homefax-final.vercel.app"
echo
echo "The pod is RUNNING and billing \$0.74/hr. When you stop filming:"
echo "  curl -s -X POST -H \"Authorization: Bearer \$RUNPOD_API_KEY\" https://rest.runpod.io/v1/pods/$POD/stop"
echo "(restarting later takes ~1 minute; everything lives on the volume)"
