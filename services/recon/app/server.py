"""Standalone HTTP front end for the reconstruction pipeline.

This is what runs when the worker lives on a rented **Pod** rather than a
serverless endpoint. Same `run_pipeline` either way — the only difference is
who drives it and how progress gets out.

    RECON_KEY=… BLOB_READ_WRITE_TOKEN=… python3 server.py

Routes:
    GET  /health           liveness plus what the box can actually do
    POST /reconstruct      {image_urls, stage, max_frames} -> {id}
    GET  /jobs/{id}        state, current step, and the result when it lands

Jobs run one at a time. The GPU is the scarce resource and PatchMatch stereo
will happily consume all of it, so overlapping two reconstructions makes both
slower and risks an out-of-memory abort halfway through a contractor's upload.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from handler import run_pipeline

# Enough history for a contractor to walk a house without losing an early stage,
# and small enough that memory never becomes a question.
MAX_TRACKED_JOBS = 64

_jobs: dict[str, dict[str, Any]] = {}
_order: list[str] = []
_lock = threading.Lock()
_queue: "queue.Queue[str]" = queue.Queue()


def _now() -> float:
    return time.time()


def _set(job_id: str, **fields: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.update(fields)
        job["updatedAt"] = _now()


def _create(job_input: dict) -> str:
    job_id = uuid.uuid4().hex[:16]
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "state": "IN_QUEUE",
            "step": None,
            "detail": None,
            "input": job_input,
            "output": None,
            "createdAt": _now(),
            "updatedAt": _now(),
        }
        _order.append(job_id)
        # Evict oldest finished jobs; never evict something still running.
        while len(_order) > MAX_TRACKED_JOBS:
            for i, old in enumerate(_order):
                if _jobs.get(old, {}).get("state") in ("COMPLETED", "FAILED"):
                    _order.pop(i)
                    _jobs.pop(old, None)
                    break
            else:
                break
    _queue.put(job_id)
    return job_id


def _worker_loop() -> None:
    while True:
        job_id = _queue.get()
        with _lock:
            job = _jobs.get(job_id)
        if job is None:
            continue

        _set(job_id, state="IN_PROGRESS", step="extract")

        def progress(step: str, detail: str = "", _id: str = job_id) -> None:
            _set(_id, step=step, detail=detail)

        try:
            output = run_pipeline(job["input"], progress)
            _set(
                job_id,
                state="COMPLETED" if output.get("ok") else "FAILED",
                output=output,
                step=None,
            )
        except Exception as err:  # noqa: BLE001 — a crashed job must still answer
            _set(
                job_id,
                state="FAILED",
                output={
                    "ok": False,
                    "error": f"{type(err).__name__}: {err}",
                    "trace": traceback.format_exc()[-1500:],
                },
                step=None,
            )
        finally:
            _queue.task_done()


class Handler(BaseHTTPRequestHandler):
    server_version = "homefax-recon/1.0"

    # The default logger writes a line per request to stderr; keep the pod log
    # about reconstructions, not about polling.
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.end_headers()
        self.wfile.write(body)

    def _authorised(self) -> bool:
        expected = os.environ.get("RECON_KEY", "")
        got = self.headers.get("Authorization", "")
        if got.lower().startswith("bearer "):
            got = got[7:]
        if len(got) != len(expected):
            return False
        diff = 0
        for a, b in zip(got, expected):
            diff |= ord(a) ^ ord(b)
        return diff == 0

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0].rstrip("/")

        if path == "/health":
            self._send(200, _health())
            return

        if not self._authorised():
            self._send(401, {"error": "Unauthorized"})
            return

        if path.startswith("/jobs/"):
            job_id = path[len("/jobs/"):]
            with _lock:
                job = _jobs.get(job_id)
            if job is None:
                self._send(404, {"error": "No such job."})
                return
            self._send(
                200,
                {
                    "id": job["id"],
                    "status": job["state"],
                    "step": job["step"],
                    "detail": job["detail"],
                    "output": job["output"],
                },
            )
            return

        self._send(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0].rstrip("/")
        if not self._authorised():
            self._send(401, {"error": "Unauthorized"})
            return
        if path not in ("/reconstruct", "/run"):
            self._send(404, {"error": "Not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": "Body was not valid JSON."})
            return

        # Accept the serverless envelope too, so the same client code works
        # against a pod without special-casing the request shape.
        job_input = body.get("input") if isinstance(body.get("input"), dict) else body
        if not job_input.get("image_urls") and not job_input.get("video_url"):
            self._send(400, {"error": "Supply image_urls or video_url."})
            return

        job_id = _create(job_input)
        self._send(202, {"id": job_id, "status": "IN_QUEUE"})


def _health() -> dict:
    gpu = None
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10,
            )
            gpu = out.stdout.strip().splitlines()[0] if out.stdout.strip() else None
        except (subprocess.SubprocessError, OSError, IndexError):
            gpu = None

    with _lock:
        queued = sum(1 for j in _jobs.values() if j["state"] == "IN_QUEUE")
        running = sum(1 for j in _jobs.values() if j["state"] == "IN_PROGRESS")

    return {
        "ok": True,
        "colmap": shutil.which("colmap") is not None,
        "gltfTransform": shutil.which("gltf-transform") is not None,
        "gpu": gpu,
        "blobConfigured": bool(os.environ.get("BLOB_READ_WRITE_TOKEN")),
        "queued": queued,
        "running": running,
    }


def main() -> int:
    if not os.environ.get("RECON_KEY"):
        # A pod's ports are open to the internet. An unauthenticated endpoint
        # here is a stranger's free GPU, billed to us.
        print("RECON_KEY is not set — refusing to start an unauthenticated worker.")
        return 1

    port = int(os.environ.get("PORT", "8000"))
    threading.Thread(target=_worker_loop, daemon=True).start()

    health = _health()
    print(f"homefax recon worker on :{port}")
    print(f"  colmap={health['colmap']} gpu={health['gpu']} blob={health['blobConfigured']}")
    if not health["colmap"]:
        print("  WARNING: colmap is not on PATH; reconstructions will fail.")

    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
