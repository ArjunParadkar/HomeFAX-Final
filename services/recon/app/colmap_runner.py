"""Thin wrapper around the COLMAP CLI.

Every stage is a separate process so a failure is attributable, and stdout is
kept for the job log — when a solve goes wrong on a real site, the mapper's
output is the only thing that explains why.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class ColmapError(RuntimeError):
    pass


@dataclass
class SolveStats:
    images_registered: int
    images_submitted: int
    mean_reprojection_error: float
    sparse_points: int


def _run(args: list[str], log: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    # COLMAP logs through glog, which writes to stderr — stdout is usually empty.
    combined = (proc.stdout or "") + (proc.stderr or "")
    log.append(f"$ {' '.join(args[:3])} …\n{combined[-4000:]}")
    if proc.returncode != 0:
        raise ColmapError(
            f"{args[1] if len(args) > 1 else args[0]} failed: {combined[-1500:]}"
        )
    return combined


def feature_extraction(workdir: Path, log: list[str]) -> None:
    _run(
        [
            "colmap", "feature_extractor",
            "--database_path", str(workdir / "database.db"),
            "--image_path", str(workdir / "images"),
            # PINHOLE keeps the downstream undistort trivial; phone frames from a
            # single device share intrinsics, so one camera is the right model.
            "--ImageReader.camera_model", "PINHOLE",
            "--ImageReader.single_camera", "1",
            "--FeatureExtraction.use_gpu", "1",
            "--FeatureExtraction.max_image_size", "1600",
            # Interiors are feature-poor; more features per image is the cheapest
            # way to keep a blank-drywall pass from dropping out entirely.
            "--SiftExtraction.max_num_features", "16384",
            "--SiftExtraction.estimate_affine_shape", "1",
            "--SiftExtraction.domain_size_pooling", "1",
        ],
        log,
    )


def matching(workdir: Path, num_images: int, log: list[str]) -> None:
    db = str(workdir / "database.db")
    if num_images <= 80:
        # Every pair. At 60 frames that is 1,770 pairs — seconds on a GPU, and it
        # closes loops that sequential matching alone would miss.
        _run(
            ["colmap", "exhaustive_matcher",
             "--database_path", db,
             "--FeatureMatching.use_gpu", "1",
             "--FeatureMatching.guided_matching", "1"],
            log,
        )
    else:
        _run(
            ["colmap", "sequential_matcher",
             "--database_path", db,
             "--FeatureMatching.use_gpu", "1",
             "--FeatureMatching.guided_matching", "1",
             "--SequentialMatching.overlap", "15",
             "--SequentialMatching.quadratic_overlap", "1"],
            log,
        )


def mapper(workdir: Path, log: list[str]) -> Path:
    sparse = workdir / "sparse"
    sparse.mkdir(exist_ok=True)
    _run(
        ["colmap", "mapper",
         "--database_path", str(workdir / "database.db"),
         "--image_path", str(workdir / "images"),
         "--output_path", str(sparse),
         "--Mapper.ba_global_function_tolerance", "1e-6",
         "--Mapper.init_min_tri_angle", "4",
         "--Mapper.multiple_models", "0"],
        log,
    )
    models = sorted(p for p in sparse.iterdir() if p.is_dir())
    if not models:
        raise ColmapError(
            "No camera poses could be solved. The walk was probably too fast, or "
            "the surfaces too blank for the tracker to hold on to."
        )
    return models[0]


def solve_stats(model_dir: Path, submitted: int, log: list[str]) -> SolveStats:
    """Read the solve's own output files rather than scraping logs.

    The first version parsed model_analyzer's text and broke the moment the
    output stream and format shifted between COLMAP versions. The TXT model is
    a documented format: images.txt has two lines per registered image, and
    points3D.txt carries each point's reprojection error in column 8.
    """
    txt_dir = model_dir / "txt"
    txt_dir.mkdir(exist_ok=True)
    _run(
        ["colmap", "model_converter",
         "--input_path", str(model_dir),
         "--output_path", str(txt_dir),
         "--output_type", "TXT"],
        log,
    )

    registered = 0
    images_txt = txt_dir / "images.txt"
    if images_txt.exists():
        data_lines = [
            l for l in images_txt.read_text().splitlines()
            if l.strip() and not l.startswith("#")
        ]
        registered = len(data_lines) // 2

    points = 0
    err_sum = 0.0
    points_txt = txt_dir / "points3D.txt"
    if points_txt.exists():
        with points_txt.open() as fh:
            for line in fh:
                if not line.strip() or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) >= 8:
                    points += 1
                    try:
                        err_sum += float(parts[7])
                    except ValueError:
                        pass
    error = err_sum / points if points else 0.0
    return SolveStats(registered, submitted, error, points)


def dense(workdir: Path, log: list[str], max_image_size: int = 1400) -> Path:
    """Undistort, PatchMatch stereo, fuse. This is where the GPU time goes."""
    dense_dir = workdir / "dense"
    _run(
        ["colmap", "image_undistorter",
         "--image_path", str(workdir / "images"),
         "--input_path", str(workdir / "sparse" / "0"),
         "--output_path", str(dense_dir),
         "--output_type", "COLMAP",
         "--max_image_size", str(max_image_size)],
        log,
    )
    _run(
        ["colmap", "patch_match_stereo",
         "--workspace_path", str(dense_dir),
         "--workspace_format", "COLMAP",
         "--PatchMatchStereo.geom_consistency", "true",
         # Window and iteration counts trade VRAM for detail. These settle a
         # room in a couple of minutes on a 24 GB card without spilling.
         "--PatchMatchStereo.window_radius", "5",
         "--PatchMatchStereo.num_samples", "15",
         "--PatchMatchStereo.num_iterations", "5",
         "--PatchMatchStereo.cache_size", "24"],
        log,
    )
    fused = dense_dir / "fused.ply"
    _run(
        ["colmap", "stereo_fusion",
         "--workspace_path", str(dense_dir),
         "--workspace_format", "COLMAP",
         "--input_type", "geometric",
         "--output_path", str(fused),
         "--StereoFusion.min_num_pixels", "3",
         "--StereoFusion.max_reproj_error", "2"],
        log,
    )
    if not fused.exists():
        raise ColmapError("Dense fusion produced no point cloud.")
    return fused


def poisson_mesh(fused: Path, log: list[str]) -> Path:
    out = fused.parent / "meshed-poisson.ply"
    _run(
        ["colmap", "poisson_mesher",
         "--input_path", str(fused),
         "--output_path", str(out),
         "--PoissonMeshing.depth", "11",
         "--PoissonMeshing.trim", "8"],
        log,
    )
    if not out.exists():
        raise ColmapError("Poisson meshing produced no surface.")
    return out


def have_colmap() -> bool:
    return shutil.which("colmap") is not None
