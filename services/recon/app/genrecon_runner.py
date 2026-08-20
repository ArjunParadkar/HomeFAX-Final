"""GenRecon (TRELLIS.2-based) reconstruction — the main HomeFAX model.

GenRecon casts scene reconstruction as conditional 3D generation over
overlapping chunks, conditioned on posed multi-view images. It needs COLMAP
camera poses as input, which the classical half of this worker already
produces — so this module replaces only the dense-stereo + meshing stages.

It runs in its own conda environment (python 3.10, torch 2.6, compiled CUDA
extensions), separate from the worker's system python. Three env vars wire it:

    GENRECON_PYTHON  the conda env's python binary
    GENRECON_DIR     the GenRecon checkout
    GENRECON_CKPT    directory holding sparse_structure/shape_slat/texture_slat.pt

If any are missing the worker silently keeps its classical pipeline, so the
same code runs on both the GenRecon pod and the plain COLMAP one.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


class GenReconError(RuntimeError):
    pass


def available() -> bool:
    py = os.environ.get("GENRECON_PYTHON")
    repo = os.environ.get("GENRECON_DIR")
    ckpt = os.environ.get("GENRECON_CKPT")
    if not (py and repo and ckpt):
        return False
    return (
        Path(py).exists()
        and (Path(repo) / "reconstruct_scene.py").exists()
        and (Path(ckpt) / "shape_slat.pt").exists()
    )


def _sh(cmd: list[str], cwd: Path, log: list[str], label: str) -> None:
    proc = subprocess.run(
        [str(c) for c in cmd], cwd=str(cwd), capture_output=True, text=True
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    log.append(f"$ {label}\n{combined[-4000:]}")
    if proc.returncode != 0:
        raise GenReconError(f"{label} failed (exit {proc.returncode}): {combined[-1200:]}")


def reconstruct(workdir: Path, log: list[str]) -> Path:
    """Run GenRecon on a workspace that already holds images/ and sparse/0.

    Returns the path to the produced GLB. Layout follows GenRecon's Iphone
    mode (inference/get_images.py IphoneMixin): <scene>/rgb/ plus a COLMAP
    text model in <scene>/colmap/.
    """
    py = os.environ["GENRECON_PYTHON"]
    repo = Path(os.environ["GENRECON_DIR"])
    ckpt = Path(os.environ["GENRECON_CKPT"])

    rgb = workdir / "rgb"
    if not rgb.exists():
        # The worker downloads frames into images/; GenRecon wants rgb/.
        rgb.symlink_to(workdir / "images")

    colmap_dir = workdir / "colmap"
    colmap_dir.mkdir(exist_ok=True)
    _sh(
        ["colmap", "model_converter",
         "--input_path", workdir / "sparse" / "0",
         "--output_path", colmap_dir,
         "--output_type", "TXT"],
        workdir, log, "model_converter TXT",
    )

    out = workdir / "out"
    out.mkdir(exist_ok=True)

    # Arguments proven working in the HomeFAX V3 wrapper; chunk factor and
    # stat ratio were the values that behaved on real interiors.
    _sh(
        [py, repo / "reconstruct_scene.py",
         "--mode", "Iphone",
         "--path", workdir,
         "--output_path", out,
         "--ss_ckpt", ckpt / "sparse_structure.pt",
         "--shape_ckpt", ckpt / "shape_slat.pt",
         "--tex_ckpt", ckpt / "texture_slat.pt",
         "--colmap_subdir", "colmap",
         "--num_imgs_per_scene", "999",
         "--chunk_size_factor", "1.08",
         "--stat_std_ratio", "3.0"],
        repo, log, "reconstruct_scene",
    )

    _sh(
        [py, repo / "chunked_to_glb.py",
         "--inputs", out / "to_glb_inputs.pt",
         "--chunk_inputs", out / "chunk_inputs.pt",
         "--output_dir", out],
        repo, log, "chunked_to_glb",
    )

    glbs = sorted(out.glob("*.glb"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not glbs:
        raise GenReconError("GenRecon finished but produced no GLB in the output directory.")
    return glbs[0]
