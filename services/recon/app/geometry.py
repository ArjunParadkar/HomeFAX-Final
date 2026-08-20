"""Measuring the reconstruction.

Everything the grader and the takeoff rely on is computed here, off the dense
point cloud and the meshed surface. Two things are worth stating plainly:

* COLMAP solves geometry up to an unknown scale. We recover metric scale from
  the floor-to-ceiling distance, assuming a standard 2.44 m (8 ft) ceiling. That
  assumption is reported back as `scale_source`, and every derived quantity
  inherits its uncertainty. A tape measure or a 4 ft level in frame would let us
  do better; until the app asks for one, this is the honest best estimate.

* Stud spacing is measured against that scale, so the absolute number moves with
  it — but the coefficient of variation does not. Irregular spacing is detected
  correctly even when the absolute scale is off.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import open3d as o3d

INCH = 0.0254
ASSUMED_CEILING_M = 2.44
# RANSAC inlier band, as a fraction of the cloud's diagonal.
PLANE_TOL_FRAC = 0.0025
MIN_PLANE_POINTS = 400
MAX_PLANES = 10


@dataclass
class Plane:
    kind: str
    area_m2: float
    deviation_deg: float
    flatness_mm: float
    normal: np.ndarray = field(repr=False, default_factory=lambda: np.zeros(3))
    offset: float = 0.0


@dataclass
class Measurements:
    planes: list[Plane]
    floor_area_m2: float
    wall_area_m2: float
    ceiling_height_m: float | None
    bounding_box_m: tuple[float, float, float]
    stud_spacing_in: float | None
    stud_spacing_cv: float | None
    metres_per_unit: float
    scale_source: str
    point_count: int


def _segment_planes(pcd: o3d.geometry.PointCloud, tol: float) -> list[tuple[np.ndarray, float, np.ndarray]]:
    """Iterative RANSAC. Returns (normal, offset, inlier_points) per plane."""
    remaining = pcd
    found: list[tuple[np.ndarray, float, np.ndarray]] = []

    for _ in range(MAX_PLANES):
        if len(remaining.points) < MIN_PLANE_POINTS:
            break
        try:
            model, idx = remaining.segment_plane(
                distance_threshold=tol, ransac_n=3, num_iterations=600
            )
        except RuntimeError:
            break
        if len(idx) < MIN_PLANE_POINTS:
            break

        a, b, c, d = model
        n = np.array([a, b, c], dtype=float)
        norm = np.linalg.norm(n)
        if norm == 0:
            break
        pts = np.asarray(remaining.points)[idx]
        found.append((n / norm, d / norm, pts))
        remaining = remaining.select_by_index(idx, invert=True)

    return found


def _find_up(planes, all_points: np.ndarray) -> np.ndarray:
    """The floor is the widest plane with essentially the whole cloud above it."""
    best = None
    best_area = -1.0

    for n, d, pts in planes:
        for sign in (1.0, -1.0):
            nn = n * sign
            dd = d * sign
            signed = all_points @ nn + dd
            above = float(np.mean(signed > -0.05 * np.std(signed + 1e-9)))
            if above < 0.93:
                continue
            span = pts.max(axis=0) - pts.min(axis=0)
            area = float(np.sort(span)[-1] * np.sort(span)[-2])
            if area > best_area:
                best_area = area
                best = nn

    if best is not None:
        return best

    # Nothing looked like a floor — fall back to the direction of least spread,
    # which for a room-shaped cloud is the vertical.
    centred = all_points - all_points.mean(axis=0)
    _, _, vh = np.linalg.svd(centred, full_matrices=False)
    return vh[-1]


def _rotation_to_y(up: np.ndarray) -> np.ndarray:
    """Rotation matrix taking `up` to +Y."""
    up = up / np.linalg.norm(up)
    target = np.array([0.0, 1.0, 0.0])
    v = np.cross(up, target)
    c = float(np.dot(up, target))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (np.linalg.norm(v) ** 2))


def _occupancy_area(points_2d: np.ndarray, cell: float) -> float:
    """Area of an arbitrary footprint, by counting occupied cells.

    A convex hull would badly overstate an L-shaped room or a wall with a
    doorway in it, so this counts what was actually seen.
    """
    if len(points_2d) == 0 or cell <= 0:
        return 0.0
    keys = np.floor(points_2d / cell).astype(np.int64)
    unique = np.unique(keys, axis=0)
    return float(len(unique) * cell * cell)


def _stud_spacing(wall_pts: np.ndarray, normal: np.ndarray, scale: float):
    """Autocorrelation of the wall's depth profile finds repeating members.

    Exposed framing makes a wall periodic: stud faces sit proud of the cavity
    behind them. Binning distance-to-plane along the wall's horizontal axis
    gives a signal whose period is the spacing.
    """
    if len(wall_pts) < 600:
        return None, None

    # Horizontal axis in the wall plane.
    u = np.cross(normal, np.array([0.0, 1.0, 0.0]))
    if np.linalg.norm(u) < 1e-6:
        return None, None
    u /= np.linalg.norm(u)

    along = wall_pts @ u
    depth = wall_pts @ normal
    depth = depth - np.median(depth)

    span = float(along.max() - along.min())
    if span * scale < 1.2:  # shorter than 1.2 m of wall — not enough cycles
        return None, None

    bin_m = 0.02
    nbins = max(32, int((span * scale) / bin_m))
    idx = np.clip(((along - along.min()) / span * (nbins - 1)).astype(int), 0, nbins - 1)

    profile = np.zeros(nbins)
    counts = np.zeros(nbins)
    np.add.at(profile, idx, depth)
    np.add.at(counts, idx, 1.0)
    occupied = counts > 0
    if occupied.sum() < nbins * 0.6:
        return None, None
    profile[occupied] /= counts[occupied]
    profile[~occupied] = 0.0
    profile -= profile.mean()
    if np.allclose(profile, 0):
        return None, None

    ac = np.correlate(profile, profile, mode="full")[nbins - 1:]
    if ac[0] <= 0:
        return None, None
    ac = ac / ac[0]

    # Residential spacing lives between 10 and 26 inches.
    lo = max(2, int((10 * INCH) / (bin_m)))
    hi = min(len(ac) - 1, int((26 * INCH) / (bin_m)))
    if hi <= lo + 1:
        return None, None

    window = ac[lo:hi]
    peak = int(np.argmax(window)) + lo
    if ac[peak] < 0.18:  # too weak to call periodic
        return None, None

    period_m = peak * bin_m
    spacing_in = period_m / INCH

    # Consistency: how steady the peaks are across the wall, from the spacing
    # between successive local maxima of the profile.
    sig = profile.copy()
    thresh = sig.std() * 0.4
    peaks = [
        i
        for i in range(1, len(sig) - 1)
        if sig[i] > sig[i - 1] and sig[i] >= sig[i + 1] and sig[i] > thresh
    ]
    if len(peaks) >= 4:
        gaps = np.diff(peaks) * bin_m
        gaps = gaps[(gaps > 0.5 * period_m) & (gaps < 1.8 * period_m)]
        cv = float(np.std(gaps) / np.mean(gaps)) if len(gaps) >= 3 and np.mean(gaps) > 0 else None
    else:
        cv = None

    return float(spacing_in), cv


def measure(
    cloud_path: str,
    voxel: float = 0.01,
) -> tuple[Measurements, np.ndarray, np.ndarray]:
    """Measure the fused cloud. Returns measurements plus the alignment applied."""
    pcd = o3d.io.read_point_cloud(cloud_path)
    if len(pcd.points) == 0:
        raise ValueError("The fused point cloud is empty.")

    raw_count = len(pcd.points)
    work = pcd.voxel_down_sample(voxel) if raw_count > 400_000 else pcd
    work, _ = work.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)

    pts = np.asarray(work.points)
    diag = float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))
    tol = max(diag * PLANE_TOL_FRAC, 1e-4)

    segments = _segment_planes(work, tol)
    if not segments:
        raise ValueError("No planar structure could be found in the reconstruction.")

    up = _find_up(segments, pts)
    R = _rotation_to_y(up)

    pts_a = pts @ R.T
    floor_y = float(np.percentile(pts_a[:, 1], 1))
    ceil_y = float(np.percentile(pts_a[:, 1], 99))
    height_units = ceil_y - floor_y

    # Scale. See the module docstring for why this is an assumption, not a fact.
    if height_units > 1e-6:
        scale = ASSUMED_CEILING_M / height_units
        scale_source = "assumed"
    else:
        scale = 1.0
        scale_source = "assumed"

    planes: list[Plane] = []
    floor_area = 0.0
    wall_area = 0.0
    spacings: list[float] = []
    cvs: list[float] = []

    for n, d, seg_pts in segments:
        n_a = R @ n
        seg_a = seg_pts @ R.T
        vertical_component = abs(float(n_a[1]))
        angle_to_up = math.degrees(math.acos(min(1.0, vertical_component)))

        # Distance of inliers to their own plane, in mm, at metric scale.
        resid = np.abs(seg_pts @ n + d)
        flatness_mm = float(np.sqrt(np.mean(resid**2)) * scale * 1000.0)

        if vertical_component > 0.85:
            mean_y = float(seg_a[:, 1].mean())
            kind = "floor" if mean_y < (floor_y + ceil_y) / 2 else "ceiling"
            deviation = angle_to_up
            area = _occupancy_area(seg_a[:, [0, 2]] * scale, 0.05)
            if kind == "floor":
                floor_area = max(floor_area, area)
        elif vertical_component < 0.3:
            kind = "wall"
            deviation = abs(90.0 - angle_to_up)
            u = np.cross(n_a, np.array([0.0, 1.0, 0.0]))
            if np.linalg.norm(u) > 1e-6:
                u /= np.linalg.norm(u)
                local = np.stack([seg_a @ u, seg_a[:, 1]], axis=1) * scale
                area = _occupancy_area(local, 0.05)
            else:
                area = 0.0
            wall_area += area

            s, cv = _stud_spacing(seg_a, n_a, scale)
            if s is not None:
                spacings.append(s)
                if cv is not None:
                    cvs.append(cv)
        else:
            kind = "other"
            deviation = abs(90.0 - angle_to_up)
            area = 0.0

        planes.append(
            Plane(
                kind=kind,
                area_m2=round(area, 3),
                deviation_deg=round(deviation, 3),
                flatness_mm=round(flatness_mm, 2),
                normal=n_a,
                offset=float(d),
            )
        )

    extent = (pts_a.max(axis=0) - pts_a.min(axis=0)) * scale

    spacing_in = float(np.median(spacings)) if spacings else None
    # Across-wall disagreement counts too: if two walls disagree, the framing is
    # not consistent even when each wall is internally regular.
    if spacings:
        across = float(np.std(spacings) / np.mean(spacings)) if len(spacings) > 1 else 0.0
        within = float(np.mean(cvs)) if cvs else 0.0
        spacing_cv = round(max(across, within), 4)
    else:
        spacing_cv = None

    return (
        Measurements(
            planes=planes,
            floor_area_m2=round(floor_area, 2),
            wall_area_m2=round(wall_area, 2),
            ceiling_height_m=round(height_units * scale, 3) if height_units > 0 else None,
            bounding_box_m=(round(float(extent[0]), 2), round(float(extent[1]), 2), round(float(extent[2]), 2)),
            stud_spacing_in=round(spacing_in, 2) if spacing_in else None,
            stud_spacing_cv=spacing_cv,
            metres_per_unit=scale,
            scale_source=scale_source,
            point_count=raw_count,
        ),
        R,
        np.array([0.0, -floor_y, 0.0]),
    )
