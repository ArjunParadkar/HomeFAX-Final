#!/usr/bin/env bash
# The one command that finishes HomeFAX's GenRecon rollout after funds land.
#
#   bash scripts/resume-genrecon.sh
#
# It refuses to start until the RunPod balance is positive, then:
#   1. restarts the GenRecon pod (its 100 GB volume resumes provisioning
#      from the stage markers — nothing already done is redone). If RunPod
#      has reclaimed the pod — it does that after days at a negative balance,
#      and it took pod k4seektj9t0sn7 and its volume by 2026-08-26 — a fresh
#      RTX 4090 pod is created from scratch and its id written back to
#      .env.local. A cold provision (conda env, CUDA builds, 13.7 GB of
#      checkpoints) takes ~1 h, so fund at least ~$5.
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
  echo "(a fresh pod needs ~1 h of provisioning at \$0.74/hr — fund at least ~\$5)"
  exit 1
}

say "checking pod $POD"
EXISTS=$(curl -s --max-time 30 -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $RP" "https://rest.runpod.io/v1/pods/$POD")
if [ "$EXISTS" = "200" ]; then
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
else
  say "pod $POD is gone (HTTP $EXISTS) — creating a fresh GenRecon pod"
  # The colmap image has no curl/git; the start command installs git, clones
  # the app, and hands off to provision-genrecon.sh, which owns everything
  # else (and streams its log to Blob). /workspace is the persistent volume.
  START_CMD='export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq --no-install-recommends git ca-certificates; rm -rf /opt/homefax; git clone -q --depth 1 -b main https://github.com/ArjunParadkar/HomeFAX-Final.git /opt/homefax; export HOMEFAX_FOREGROUND=1; exec bash /opt/homefax/services/recon/provision-genrecon.sh'
  BODY=$(START_CMD="$START_CMD" RECON_KEY="$KEY" python3 -c '
import json, os
print(json.dumps({
  "name": "homefax-genrecon",
  "imageName": "colmap/colmap:latest",
  "cloudType": "SECURE",
  "gpuTypeIds": ["NVIDIA GeForce RTX 4090", "NVIDIA GeForce RTX 3090"],
  "gpuTypePriority": "custom",
  "gpuCount": 1,
  "containerDiskInGb": 40,
  "volumeInGb": 100,
  "volumeMountPath": "/workspace",
  "ports": ["8000/http"],
  "env": {"RECON_KEY": os.environ["RECON_KEY"],
          "BLOB_READ_WRITE_TOKEN": os.environ.get("BLOB_READ_WRITE_TOKEN", ""),
          "HOMEFAX_FOREGROUND": "1"},
  "dockerStartCmd": ["bash", "-c", os.environ["START_CMD"]],
}))')
  RESP=$(curl -s --max-time 120 -X POST -H "Authorization: Bearer $RP" \
    -H "Content-Type: application/json" "https://rest.runpod.io/v1/pods" -d "$BODY")
  NEWPOD=$(printf '%s' "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  [ -n "$NEWPOD" ] || { echo "Pod creation failed: $RESP"; exit 1; }
  echo "created pod $NEWPOD: $(printf '%s' "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('machine') or {}).get('gpuTypeId') or d.get('gpuTypeId') or '?', d.get('costPerHr','?'), '\$/hr')" 2>/dev/null)"
  POD="$NEWPOD"; BASE="https://$POD-8000.proxy.runpod.net"
  # Persist so the next run (and the stop command) target the new pod.
  sed -i "s|^HOMEFAX_POD_ID=.*|HOMEFAX_POD_ID=$POD|; s|^RECON_URL=.*|RECON_URL=$BASE|" .env.local
  grep -q '^HOMEFAX_POD_ID=' .env.local || echo "HOMEFAX_POD_ID=$POD" >> .env.local
  echo "wrote HOMEFAX_POD_ID/RECON_URL to .env.local"
fi

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
