#!/usr/bin/env bash
# Provision a RunPod Pod as the GenRecon reconstruction worker.
#
# Everything expensive — the conda env, the compiled CUDA extensions, the
# 13.7 GB of checkpoints, the GenRecon checkout — lives on the persistent
# volume at /workspace, so a pod restart re-enters in seconds. Only the
# worker code itself is refreshed from GitHub on every boot.
#
# Designed to run as the container start command on the colmap/colmap:latest
# image (COLMAP solves the poses GenRecon conditions on):
#
#   HOMEFAX_FOREGROUND=1 bash provision-genrecon.sh
#
# Stage markers under /workspace/.stages/ make every stage idempotent.

set -uo pipefail

WS=/workspace
MF=$WS/miniforge
ENVN=genrecon
GR=$WS/genrecon
CK=$WS/checkpoints
APP=${APP_DIR:-/opt/homefax}
PORT="${PORT:-8000}"
STAGES=$WS/.stages
mkdir -p "$STAGES"

say() { printf '\n=== %s [%s]\n' "$1" "$(date -u +%H:%M:%S)"; }
done_marker() { [ -f "$STAGES/$1" ]; }
mark() { touch "$STAGES/$1"; }

if [ -z "${RECON_KEY:-}" ]; then
  echo "RECON_KEY is not set — refusing an unauthenticated worker." >&2
  exit 1
fi

say "ssh access"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || true
apt-get install -y -qq --no-install-recommends \
  curl ca-certificates git python3 python3-pip ffmpeg openssh-server bzip2 || true
if [ -n "${PUBLIC_KEY:-}" ]; then
  mkdir -p /root/.ssh /run/sshd
  grep -qxF "$PUBLIC_KEY" /root/.ssh/authorized_keys 2>/dev/null \
    || echo "$PUBLIC_KEY" >> /root/.ssh/authorized_keys
  chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
  pkill sshd 2>/dev/null || true
  [ -x /usr/sbin/sshd ] && /usr/sbin/sshd && echo "sshd up"
fi

say "hardware"
command -v colmap >/dev/null || { echo "no colmap — wrong image" >&2; exit 1; }
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

say "worker deps (system python)"
done_marker sysdeps || {
  python3 -m pip install --break-system-packages -q --no-cache-dir \
    numpy 'open3d==0.19.0' trimesh pillow requests scipy && mark sysdeps
}

say "checkpoints (13.7 GB, parallel, resumable)"
mkdir -p "$CK"
for f in sparse_structure.pt shape_slat.pt texture_slat.pt; do
  [ -f "$STAGES/ckpt_$f" ] || (
    curl -fL --retry 5 -C - -o "$CK/$f" "https://kaldir.vc.cit.tum.de/genrecon/$f" \
      && touch "$STAGES/ckpt_$f" && echo "checkpoint $f done"
  ) &
done

say "miniforge"
if [ ! -x "$MF/bin/conda" ]; then
  curl -fsSL https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh -o /tmp/mf.sh
  bash /tmp/mf.sh -b -p "$MF"
fi
# shellcheck disable=SC1091
source "$MF/etc/profile.d/conda.sh"

say "conda env (python 3.10 + cuda-toolkit 12.6)"
done_marker condaenv || {
  conda create -y -n $ENVN python=3.10 nvidia::cuda-toolkit=12.6 ninja \
    && conda install -y -n $ENVN -c conda-forge libjpeg-turbo xorg-libx11 \
    && mark condaenv
}
conda activate $ENVN
export CUDA_HOME=$CONDA_PREFIX
# RTX 4090 is Ada (sm_89). The README's 9.0 example targets Hopper — kernels
# built for it will not run here.
export TORCH_CUDA_ARCH_LIST="8.9"

say "torch 2.6 cu126"
done_marker torch || {
  pip install -q torch==2.6.0 torchvision==0.21.0 \
    --index-url https://download.pytorch.org/whl/cu126 && mark torch
}

say "genrecon checkout"
[ -d "$GR/.git" ] || git clone -q -b main --recursive https://github.com/kasothaphie/GenRecon.git "$GR"

say "CUDA extensions (the long compile)"
done_marker extensions || {
  ( cd "$GR" && . ./setup.sh --basic --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm ) \
    && mark extensions
}

say "flash-attention (prebuilt wheel)"
done_marker flashattn || {
  pip install -q "https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.3/flash_attn-2.7.3+cu12torch2.6cxx11abiTRUE-cp310-cp310-linux_x86_64.whl" \
    && mark flashattn
}

say "waiting for checkpoint downloads"
wait
for f in sparse_structure.pt shape_slat.pt texture_slat.pt; do
  [ -f "$STAGES/ckpt_$f" ] || { echo "checkpoint $f missing" >&2; exit 1; }
done
du -sh "$CK"

say "import smoke test"
"$MF/envs/$ENVN/bin/python" - <<'PYEOF'
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(),
      torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
import flash_attn  # noqa: F401
print("flash_attn ok")
PYEOF

say "homefax worker code"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin main && git -C "$APP" reset -q --hard origin/main
else
  rm -rf "$APP"
  git clone -q --depth 1 -b main https://github.com/ArjunParadkar/HomeFAX-Final.git "$APP"
fi
echo "worker at $(git -C "$APP" rev-parse --short HEAD)"

say "starting worker"
pkill -f "python3 -u server.py" 2>/dev/null || true
sleep 1
cd "$APP/services/recon/app"
export RECON_KEY
export BLOB_READ_WRITE_TOKEN="${BLOB_READ_WRITE_TOKEN:-}"
export PORT
export GENRECON_PYTHON="$MF/envs/$ENVN/bin/python"
export GENRECON_DIR="$GR"
export GENRECON_CKPT="$CK"

if [ "${HOMEFAX_FOREGROUND:-0}" = "1" ]; then
  echo "GenRecon worker holding the foreground on :$PORT"
  exec python3 -u server.py
fi
nohup python3 -u server.py >/var/log/homefax-recon.log 2>&1 &
sleep 3
curl -fsS "http://127.0.0.1:$PORT/health" && echo && echo "worker up"
