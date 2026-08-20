# COLMAP ships a CUDA-enabled image; building it from source takes ~40 minutes,
# so we start from theirs and add the Python side on top.
FROM colmap/colmap:latest

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ca-certificates curl xvfb ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Draco compression for the delivered model — a phone should not have to pull
# 40 MB of mesh over LTE.
RUN npm install -g @gltf-transform/cli@4

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --break-system-packages -r /tmp/requirements.txt

COPY app /app
WORKDIR /app

CMD ["python3", "-u", "handler.py"]
