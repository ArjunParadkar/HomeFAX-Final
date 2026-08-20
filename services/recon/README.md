# HomeFAX reconstruction worker

A RunPod serverless worker. One job = one stage capture.

## What it does

Classical photogrammetry, not generative 3D:

```
frames → COLMAP SfM → PatchMatch dense stereo → Poisson mesh
       → plane/scale/spacing measurement → decimate → Draco GLB
```

The choice matters. An image-to-3D generative model returns a *plausible*
object; a building record needs a *measured* one. Every number this worker
returns traces back to pixels the contractor filmed.

## Scale

COLMAP solves geometry up to an unknown scale. Metric scale is recovered from
the floor-to-ceiling distance, assuming a standard 2.44 m ceiling, and reported
as `scaleSource: "assumed"`. Absolute quantities inherit that assumption;
ratios (stud-spacing consistency, plumb, flatness) do not. Putting a tape or a
4 ft level in frame is the upgrade path to a measured scale.

## Contract

Input:

```json
{ "image_urls": ["https://…jpg"], "stage": "framing", "max_frames": 90 }
```

`video_url` works too — the worker cuts frames with ffmpeg and uploads them —
but the phone already picks better frames, so prefer `image_urls`.

Output on success: `{ "ok": true, "result": { glbUrl, keyframeUrls, metrics, geometry } }`,
matching `ReconResult` in `src/lib/types.ts`. On failure: `{ "ok": false, "error": "…" }`
with a message written for the contractor, not the developer.

Progress is published with `runpod.serverless.progress_update` as
`{"step": "...", "detail": "..."}`; the web app maps those step keys to its
timeline.

## Environment

| Variable | Why |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Where the finished GLB is uploaded |

## Tests

`tests/test_geometry.py` builds a room of known dimensions, hides it behind an
arbitrary rotation and an unknown scale, and checks that `measure()` recovers
it. Run it against any environment that has open3d:

```bash
python tests/test_geometry.py
```

It is the guard against the failure mode that matters most here — a scale or
axis bug that produces a confident, wrong parts list.
