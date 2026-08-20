"""Turning the Poisson surface into something a phone will happily load."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh

# A phone can orbit this comfortably; beyond it, mid-range Androids stutter.
TARGET_TRIANGLES = 180_000


def prepare(
    mesh_path: Path,
    rotation: np.ndarray,
    translation: np.ndarray,
    scale: float,
) -> tuple[o3d.geometry.TriangleMesh, float]:
    """Clean, orient, and scale the mesh. Returns it plus a completeness ratio."""
    mesh = o3d.io.read_triangle_mesh(str(mesh_path))
    if len(mesh.triangles) == 0:
        raise ValueError("The meshed surface is empty.")

    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()

    # Poisson closes the surface far beyond the observed region; the offcuts show
    # up as separate blobs. Keep the components that carry the actual room.
    labels, counts, _ = mesh.cluster_connected_triangles()
    labels = np.asarray(labels)
    counts = np.asarray(counts)
    if len(counts) > 1:
        keep_order = np.argsort(counts)[::-1]
        cumulative = np.cumsum(counts[keep_order]) / counts.sum()
        keep_n = int(np.searchsorted(cumulative, 0.97) + 1)
        keep = set(keep_order[:keep_n].tolist())
        mesh.remove_triangles_by_mask(np.array([l not in keep for l in labels]))
        mesh.remove_unreferenced_vertices()

    # Completeness: how much of the surface still has an open edge. A cave you
    # only saw from one side leaves a boundary; a fully observed room does not.
    completeness = _closed_fraction(mesh)

    if len(mesh.triangles) > TARGET_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(TARGET_TRIANGLES)
        mesh.remove_unreferenced_vertices()

    mesh.rotate(rotation, center=(0, 0, 0))
    mesh.translate(translation)
    mesh.scale(scale, center=(0, 0, 0))
    mesh.compute_vertex_normals()

    return mesh, completeness


def _closed_fraction(mesh: o3d.geometry.TriangleMesh) -> float:
    tri = np.asarray(mesh.triangles)
    if len(tri) == 0:
        return 0.0
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    edges = np.sort(edges, axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    if len(counts) == 0:
        return 0.0
    boundary = float(np.count_nonzero(counts == 1))
    return round(max(0.0, 1.0 - boundary / len(counts)), 4)


def export_glb(mesh: o3d.geometry.TriangleMesh, out_path: Path) -> Path:
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    colors = np.asarray(mesh.vertex_colors)

    kwargs = {}
    if len(colors) == len(vertices) and len(colors) > 0:
        rgba = np.concatenate(
            [(colors * 255).astype(np.uint8), np.full((len(colors), 1), 255, np.uint8)],
            axis=1,
        )
        kwargs["vertex_colors"] = rgba

    tm = trimesh.Trimesh(vertices=vertices, faces=faces, process=False, **kwargs)
    scene = trimesh.Scene(tm)
    out_path.write_bytes(scene.export(file_type="glb"))
    return out_path


def compress(glb: Path) -> Path:
    """Draco pass. If the CLI is missing or fails, the uncompressed file stands."""
    if shutil.which("gltf-transform") is None:
        return glb
    compressed = glb.with_name(f"{glb.stem}-draco.glb")
    try:
        subprocess.run(
            ["gltf-transform", "draco", str(glb), str(compressed)],
            capture_output=True,
            text=True,
            timeout=180,
            check=True,
        )
    except (subprocess.SubprocessError, OSError):
        return glb
    if compressed.exists() and compressed.stat().st_size > 0:
        return compressed
    return glb
