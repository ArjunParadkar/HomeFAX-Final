#!/usr/bin/env bash
# Provision a RunPod Pod to serve the HomeFAX reconstruction worker.
#
# Run this ON the pod (SSH in, paste it, or curl it from the repo):
#
#   export RECON_KEY=...            # the shared secret the web app will send
#   export BLOB_READ_WRITE_TOKEN=...# where the finished GLB goes
#   bash provision.sh
#
# It is also the pod's container start command. In that role the worker must
# hold the foreground — a backgrounded server would let the container exit and
# RunPod would stop the pod:
#
#   HOMEFAX_FOREGROUND=1 bash provision.sh
#
# Set HOMEFAX_MODE=serverless to run the RunPod serverless handler instead of
# the HTTP server. That lets one image serve both shapes: a serverless endpoint
# provisions itself on cold start, so nothing has to be published to a registry.
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

if [ "${HOMEFAX_MODE:-server}" != "serverless" ] && [ -z "${RECON_KEY:-}" ]; then
  echo "RECON_KEY is not set. Refusing to start an unauthenticated worker on a public port." >&2
  exit 1
fi
RECON_KEY="${RECON_KEY:-}"

say "ssh access"
# The COLMAP image is not a RunPod-managed one, so nothing sets up sshd or
# injects keys. Without this there is no way into the box when a solve misbehaves.
if [ -n "${PUBLIC_KEY:-}" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || true
  apt-get install -y -qq --no-install-recommends openssh-server >/dev/null || true
  mkdir -p /root/.ssh /run/sshd
  grep -qxF "$PUBLIC_KEY" /root/.ssh/authorized_keys 2>/dev/null \
    || echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys
  chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  pkill sshd 2>/dev/null || true
  if [ -x /usr/sbin/sshd ]; then
    /usr/sbin/sshd && echo "sshd listening on 22" || echo "sshd failed to start" >&2
  else
    echo "sshd not available on this image" >&2
  fi
else
  echo "no PUBLIC_KEY set — skipping ssh"
fi

say "checking the box"
fatal=0
if command -v colmap >/dev/null 2>&1; then
  echo "colmap: $(command -v colmap)"
else
  echo "colmap is NOT installed on this image. Use colmap/colmap:latest." >&2
  fatal=1
fi
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
else
  echo "nvidia-smi not found — cannot confirm a GPU is attached." >&2
fi
[ "$fatal" = "0" ] || exit 1

say "system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  python3 python3-pip git ca-certificates curl ffmpeg >/dev/null

say "python dependencies"
# --break-system-packages is correct here: the container IS the environment,
# and a venv only adds a path to get wrong after a restart.
PIP_PKGS="numpy open3d==0.19.0 trimesh pillow requests scipy"
if [ "${HOMEFAX_MODE:-server}" = "serverless" ]; then
  PIP_PKGS="$PIP_PKGS runpod"
fi
# shellcheck disable=SC2086
python3 -m pip install --quiet --break-system-packages --no-cache-dir $PIP_PKGS

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

export RECON_KEY
export BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-}"
export PORT

if [ "${HOMEFAX_MODE:-server}" = "serverless" ]; then
  # The worker becomes a RunPod serverless consumer: it polls for jobs rather
  # than listening on a port, and must hold the foreground.
  echo "starting the RunPod serverless handler"
  exec python3 -u handler.py
fi

if [ "${HOMEFAX_FOREGROUND:-0}" = "1" ]; then
  # Become the container's main process, writing to stdout so the output shows
  # up as RunPod container logs rather than hiding in a file.
  echo "running in the foreground as the container's main process"
  exec python3 -u server.py
fi

nohup python3 -u server.py >"$LOG" 2>&1 &

sleep 3
if curl -fsS "http://127.0.0.1:$PORT/health"; then
  printf '\n\nWorker is up on port %s. Logs: %s\n' "$PORT" "$LOG"
else
  echo "Worker did not come up. Last lines of $LOG:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
