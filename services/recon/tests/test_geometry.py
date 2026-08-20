"""Ground-truth test for the measurement stage.

Builds a room whose dimensions we know, hides it behind an arbitrary rotation
and an unknown scale (exactly what COLMAP hands us), then checks that measure()
recovers the room. Without this, a scale or axis bug would only ever surface as
a quietly wrong parts list.

    python tests/test_geometry.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import open3d as o3d

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

import geometry  # noqa: E402

RNG = np.random.default_rng(7)

ROOM_W = 5.0
ROOM_D = 4.0
ROOM_H = 2.44
STUD_SPACING_M = 16 * 0.0254
TILT_DEG = 2.5
# COLMAP returns geometry at an arbitrary scale; 0.37 stands in for it.
TRUE_UNITS_PER_M = 0.37


def _u(n: int, a: float, b: float) -> np.ndarray:
    return RNG.uniform(a, b, n)


def build_room() -> np.ndarray:
    pts = []

    n = 60_000
    pts.append(np.stack([_u(n, 0, ROOM_W), np.zeros(n), _u(n, 0, ROOM_D)], 1))

    n = 40_000
    pts.append(np.stack([_u(n, 0, ROOM_W), np.full(n, ROOM_H), _u(n, 0, ROOM_D)], 1))

    # Back wall: exposed framing. Studs sit 20 mm proud of the sheathing behind.
    n = 70_000
    x = _u(n, 0, ROOM_W)
    y = _u(n, 0, ROOM_H)
    on_stud = np.mod(x, STUD_SPACING_M) < 0.038
    z = np.where(on_stud, 0.02, 0.0)
    pts.append(np.stack([x, y, z], 1))

    # Opposite wall, plumb and plain.
    n = 40_000
    pts.append(np.stack([_u(n, 0, ROOM_W), _u(n, 0, ROOM_H), np.full(n, ROOM_D)], 1))

    # Left wall, tilted out of plumb by a known angle.
    n = 40_000
    ys = _u(n, 0, ROOM_H)
    pts.append(np.stack([np.tan(np.deg2rad(TILT_DEG)) * ys, ys, _u(n, 0, ROOM_D)], 1))

    # Right wall, plumb.
    pts.append(np.stack([np.full(n, ROOM_W), _u(n, 0, ROOM_H), _u(n, 0, ROOM_D)], 1))

    cloud = np.concatenate(pts, 0)
    cloud += RNG.normal(0, 0.002, cloud.shape)  # 2 mm reconstruction noise
    return cloud


def hide_the_answer(cloud: np.ndarray) -> np.ndarray:
    """Arbitrary rotation, translation, and unknown scale — the COLMAP frame."""
    axis = np.array([0.3, 0.5, -0.81])
    axis /= np.linalg.norm(axis)
    theta = 0.9
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    R = np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * K @ K
    return (cloud * TRUE_UNITS_PER_M) @ R.T + np.array([11.0, -4.0, 7.5])


def main() -> int:
    scrambled = hide_the_answer(build_room())
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(scrambled)
    out = Path("/tmp/homefax-test-room.ply")
    o3d.io.write_point_cloud(str(out), pcd)

    m, _, _ = geometry.measure(str(out))

    truth_scale = 1 / TRUE_UNITS_PER_M
    walls = [p for p in m.planes if p.kind == "wall"]
    tilted = max((p.deviation_deg for p in walls), default=0.0)
    others = sorted(p.deviation_deg for p in walls)[: max(1, len(walls) - 1)]

    checks = [
        (
            "scale recovered",
            abs(m.metres_per_unit - truth_scale) / truth_scale < 0.06,
            f"{m.metres_per_unit:.3f} m/unit vs {truth_scale:.3f}",
        ),
        (
            "floor area",
            abs(m.floor_area_m2 - ROOM_W * ROOM_D) / (ROOM_W * ROOM_D) < 0.12,
            f"{m.floor_area_m2:.1f} m2 vs {ROOM_W * ROOM_D:.1f}",
        ),
        (
            "ceiling height",
            abs((m.ceiling_height_m or 0) - ROOM_H) < 0.05,
            f"{m.ceiling_height_m} m",
        ),
        ("walls found", len(walls) >= 3, f"{len(walls)} wall planes"),
        (
            "tilt measured",
            abs(tilted - TILT_DEG) < 0.8,
            f"worst wall {tilted:.2f} deg vs {TILT_DEG}",
        ),
        (
            "plumb walls read as plumb",
            max(others) < 1.0,
            f"others at {[round(p, 2) for p in others]}",
        ),
        (
            "stud spacing",
            m.stud_spacing_in is not None and abs(m.stud_spacing_in - 16) < 1.5,
            f"{m.stud_spacing_in} in (cv {m.stud_spacing_cv})",
        ),
    ]

    width = max(len(name) for name, _, _ in checks)
    failures = 0
    for name, ok, detail in checks:
        if not ok:
            failures += 1
        print(f"[{'PASS' if ok else 'FAIL'}] {name.ljust(width)}  {detail}")

    print(f"\n{len(checks) - failures}/{len(checks)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
