#!/usr/bin/env bash
# Provision a RunPod Pod to serve the HomeFAX reconstruction worker.
#
# Run this ON the pod (SSH in, paste it, or curl it from the repo):
#
#   export RECON_KEY=...            # the shared secret the web app will send
#   export BLOB_READ_WRITE_TOKEN=...# where the finished GLB goes
#   bash provision.sh
#
# It is idempotent — re-running after a pod restart just brings the worker back.
#
# The pod should be started from the `colmap/colmap:latest` image. COLMAP's
# dense stereo needs a CUDA-enabled build, and the Ubuntu package is not one;
# building from source on the pod costs ~40 minutes of GPU rental to produce
# something that image already has.

set -euo pipefail

REPO="${REPO:-https://github.com/ArjunParadkar/HomeFAX-Final.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/homefax}"
PORT="${PORT:-8000}"
LOG="${LOG:-/var/log/homefax-recon.log}"

say() { printf '\n=== %s\n' "$1"; }

if [ -z "${RECON_KEY:-}" ]; then
  echo "RECON_KEY is not set. Refusing to start an unauthenticated worker on a public port." >&2
  exit 1
fi

say "checking the box"
command -v colmap >/dev/null 2>&1 && echo "colmap: $(command -v colmap)" || {
  echo "colmap is NOT installed on this image." >&2
  echo "Redeploy the pod from the colmap/colmap:latest image — a source build costs" >&2
  echo "about 40 minutes of rental to reproduce what that image already ships." >&2
  exit 1
}
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || {
  echo "No GPU visible. Dense stereo will not run." >&2
  exit 1
}

say "system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  python3 python3-pip git ca-certificates curl ffmpeg >/dev/null

say "python dependencies"
# --break-system-packages is correct here: the container IS the environment,
# and a venv only adds a path to get wrong after a restart.
python3 -m pip install --quiet --break-system-packages --no-cache-dir \
  numpy 'open3d==0.19.0' trimesh pillow requests scipy

say "gltf-transform (Draco compression)"
if ! command -v gltf-transform >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 || true
  apt-get install -y -qq --no-install-recommends nodejs >/dev/null 2>&1 || true
  npm install -g --silent @gltf-transform/cli@4 >/dev/null 2>&1 || true
fi
command -v gltf-transform >/dev/null 2>&1 \
  && echo "draco compression available" \
  || echo "gltf-transform missing — models ship uncompressed (larger, still correct)"

say "worker source"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
echo "at $(git -C "$APP_DIR" rev-parse --short HEAD)"

say "starting the worker"
pkill -f "python3 server.py" 2>/dev/null || true
sleep 1
cd "$APP_DIR/services/recon/app"
RECON_KEY="$RECON_KEY" \
BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-}" \
PORT="$PORT" \
  nohup python3 server.py >"$LOG" 2>&1 &

sleep 3
if curl -fsS "http://127.0.0.1:$PORT/health"; then
  printf '\n\nWorker is up on port %s. Logs: %s\n' "$PORT" "$LOG"
else
  echo "Worker did not come up. Last lines of $LOG:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
