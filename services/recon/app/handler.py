"""HomeFAX reconstruction worker.

One RunPod job = one stage capture. Input is the set of keyframes the phone
already selected and uploaded; output is a compressed GLB plus the measurements
the grader and the takeoff run on.

The pipeline is classical photogrammetry — COLMAP SfM, PatchMatch dense stereo,
Poisson meshing — rather than a generative image-to-3D model. That choice is
deliberate: generative models produce a plausible object, and a building record
needs a measured one. Every number this returns traces back to pixels the
contractor actually filmed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

try:
    import runpod
except ImportError:  # running as a plain HTTP worker on a pod
    runpod = None

import blob
import colmap_runner as colmap
import genrecon_runner
import geometry
import mesh as meshlib

MAX_FRAMES = 120
DOWNLOAD_TIMEOUT = 120


ProgressFn = Callable[[str, str], None]


def _noop_progress(step: str, detail: str = "") -> None:
    return None


def _download(url: str, dest: Path) -> Path | None:
    try:
        res = requests.get(url, timeout=DOWNLOAD_TIMEOUT, stream=True)
        res.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in res.iter_content(1 << 16):
                fh.write(chunk)
        return dest if dest.stat().st_size > 0 else None
    except Exception:
        return None


def _fetch_images(urls: list[str], images_dir: Path) -> list[str]:
    images_dir.mkdir(parents=True, exist_ok=True)
    ordered = urls[:MAX_FRAMES]

    def one(pair):
        i, url = pair
        return url, _download(url, images_dir / f"frame_{i:04d}.jpg")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, enumerate(ordered)))

    return [url for url, path in results if path is not None]


def _frames_from_video(video_url: str, images_dir: Path, max_frames: int) -> list[str]:
    """Fallback path for callers that hand us a video instead of frames."""
    images_dir.mkdir(parents=True, exist_ok=True)
    tmp = images_dir.parent / "source.mp4"
    if _download(video_url, tmp) is None:
        raise ValueError("The video could not be downloaded.")

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(tmp)],
        capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        duration = 0.0
    fps = max(0.5, min(4.0, max_frames / duration)) if duration > 0 else 2.0

    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", str(tmp),
         "-vf", f"fps={fps:.3f},scale='min(1600,iw)':-2",
         "-q:v", "3", str(images_dir / "frame_%04d.jpg")],
        capture_output=True, text=True, check=True,
    )
    tmp.unlink(missing_ok=True)

    # The visual grader needs frames it can point at, so put the ones we cut
    # back into storage and hand their URLs on.
    stamp = int(time.time())
    urls: list[str] = []
    if blob.configured():
        for i, path in enumerate(sorted(images_dir.glob("*.jpg"))[:max_frames]):
            try:
                urls.append(
                    blob.upload(
                        f"captures/video/{stamp}/{i:04d}.jpg",
                        path.read_bytes(),
                        "image/jpeg",
                    )
                )
            except blob.BlobError:
                break
    return urls


def run_pipeline(job_input: dict, on_progress: ProgressFn = _noop_progress) -> dict:
    """The whole reconstruction. Transport-agnostic on purpose.

    RunPod serverless calls this through `handler`; the standalone HTTP server
    in server.py calls it directly. Same code path either way, so a pod and a
    serverless endpoint cannot drift apart.
    """
    image_urls: list[str] = job_input.get("image_urls") or []
    video_url: str | None = job_input.get("video_url")
    stage: str = job_input.get("stage") or "unknown"
    max_frames: int = int(job_input.get("max_frames") or 90)

    started = time.time()
    log: list[str] = []
    workdir = Path(tempfile.mkdtemp(prefix="homefax-"))

    try:
        images_dir = workdir / "images"

        on_progress("extract", "fetching frames")
        if image_urls:
            kept = _fetch_images(image_urls, images_dir)
        elif video_url:
            kept = _frames_from_video(video_url, images_dir, max_frames)
        else:
            return {"ok": False, "error": "No frames or video were supplied."}

        submitted = len(list(images_dir.glob("*.jpg")))
        if submitted < 8:
            return {
                "ok": False,
                "error": f"Only {submitted} frames arrived; a reconstruction needs at least 8.",
            }

        on_progress("features", f"{submitted} frames")
        colmap.feature_extraction(workdir, log)

        on_progress("sfm", "matching and solving")
        colmap.matching(workdir, submitted, log)
        model_dir = colmap.mapper(workdir, log)
        stats = colmap.solve_stats(model_dir, submitted, log)

        if stats.images_registered < 8:
            return {
                "ok": False,
                "error": (
                    f"Only {stats.images_registered} of {submitted} frames could be placed. "
                    "Film a slower pass and keep textured surfaces in view."
                ),
            }

        used_genrecon = False
        if genrecon_runner.available():
            # GenRecon is the main HomeFAX model: generative reconstruction
            # conditioned on the COLMAP poses we just solved. The classical
            # dense pipeline below stays as the automatic fallback.
            try:
                on_progress("dense", "GenRecon generative reconstruction")
                gen_glb = genrecon_runner.reconstruct(workdir, log)
                on_progress("measure", "measuring generated mesh")
                measurements, completeness, gen_tris = meshlib.measure_generated_glb(gen_glb)
                used_genrecon = True
            except genrecon_runner.GenReconError as gerr:
                log.append(f"GenRecon failed, falling back to dense stereo: {gerr}")

        if not used_genrecon:
            on_progress("dense", f"{stats.images_registered} views registered")
            fused = colmap.dense(workdir, log)

            on_progress("mesh", "poisson surface")
            poisson = colmap.poisson_mesh(fused, log)

            on_progress("measure", "planes and spacing")
            measurements, rotation, translation = geometry.measure(str(fused))
            prepared, completeness = meshlib.prepare(
                poisson, rotation, translation, measurements.metres_per_unit
            )

        on_progress("pack", "compressing model")
        if used_genrecon:
            # Ships byte-for-byte: the baked UV textures do not survive a
            # re-export, and Draco would strip them too.
            glb_bytes = gen_glb.read_bytes()
            triangle_count = gen_tris
        else:
            glb_path = meshlib.export_glb(prepared, workdir / "scene.glb")
            glb_path = meshlib.compress(glb_path)
            glb_bytes = glb_path.read_bytes()
            triangle_count = int(len(prepared.triangles))

        stamp = int(time.time())
        glb_url = blob.upload(
            f"models/{stage}/{stamp}-scene.glb", glb_bytes, "model/gltf-binary"
        )

        sharpness = _median_sharpness(images_dir)

        return {
            "ok": True,
            "result": {
                "glbUrl": glb_url,
                "keyframeUrls": kept or image_urls,
                "metrics": {
                    "framesRegistered": stats.images_registered,
                    "framesSubmitted": submitted,
                    "reprojectionErrorPx": round(stats.mean_reprojection_error, 3),
                    "pointCount": measurements.point_count,
                    "triangleCount": triangle_count,
                    "meshCompleteness": completeness,
                    "sharpness": sharpness,
                    "metresPerUnit": round(measurements.metres_per_unit, 6),
                    "scaleSource": measurements.scale_source,
                    "glbBytes": len(glb_bytes),
                },
                "geometry": {
                    "boundingBoxM": list(measurements.bounding_box_m),
                    "floorAreaM2": measurements.floor_area_m2,
                    "wallAreaM2": measurements.wall_area_m2,
                    "ceilingHeightM": measurements.ceiling_height_m,
                    "planes": [
                        {
                            "kind": p.kind,
                            "areaM2": p.area_m2,
                            "deviationDeg": p.deviation_deg,
                            "flatnessMm": p.flatness_mm,
                        }
                        for p in measurements.planes
                        if p.kind != "other"
                    ],
                    "studSpacingIn": measurements.stud_spacing_in,
                    "studSpacingCv": measurements.stud_spacing_cv,
                },
                "elapsedSeconds": round(time.time() - started, 1),
            },
        }

    except colmap.ColmapError as err:
        return {"ok": False, "error": str(err), "log": log[-3:]}
    except Exception as err:  # noqa: BLE001 — the job must always answer
        return {
            "ok": False,
            "error": f"{type(err).__name__}: {err}",
            "trace": traceback.format_exc()[-1500:],
            "log": log[-3:],
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _median_sharpness(images_dir: Path) -> float:
    """Same focus measure the phone used, recomputed on what actually arrived."""
    from PIL import Image

    values: list[float] = []
    for path in sorted(images_dir.glob("*.jpg"))[:24]:
        try:
            img = Image.open(path).convert("L").resize((160, 120))
        except Exception:
            continue
        a = np.asarray(img, dtype=np.float32)
        lap = (
            4 * a[1:-1, 1:-1]
            - a[:-2, 1:-1]
            - a[2:, 1:-1]
            - a[1:-1, :-2]
            - a[1:-1, 2:]
        )
        values.append(float(lap.var()))
    return round(float(np.median(values)), 2) if values else 0.0


def handler(job):
    """RunPod serverless adapter."""

    def progress(step: str, detail: str = "") -> None:
        try:
            runpod.serverless.progress_update(job, {"step": step, "detail": detail})
        except Exception:  # progress is best-effort; never fail a job over it
            pass

    return run_pipeline(job.get("input") or {}, progress)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
