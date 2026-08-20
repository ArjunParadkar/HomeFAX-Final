# HomeFAX-GenRecon: the custom model plan

GenRecon (MIT, TRELLIS.2-based, also MIT) is the main HomeFAX reconstruction
model. This is the plan for turning the stock checkpoint into a HomeFAX-tuned
fork — **quick, accurate, and biased toward construction-stage interiors** —
staged so each tier pays for itself before the next one starts.

## Why tuning is worth it

The TRELLIS.2 prior was trained on finished scenes: furniture, decorated rooms,
objects. HomeFAX's money shots are the stages *before* finish — exposed stud
lattices, rough plumbing runs through joist bays, open ceilings. Those are
out-of-distribution for the stock prior, which means the generative fill-in is
weakest exactly where HomeFAX needs it strongest. That gap is the whole case
for a custom version.

## Tier 1 — inference tuning (days, no training, current 4090)

Speed and reliability work on the stock checkpoints:

- **Frame cap at 24–32.** GenRecon needs 8–32 views; COLMAP matching is O(n²)
  in frames. Biggest single latency win.
- **Warm-weights service.** 13.7 GB of checkpoints reload per job today. A
  persistent inference process keeps them in VRAM: minutes → seconds per job.
- **Sampler/step budget sweep.** Fewer diffusion steps per chunk; measure the
  quality knee on real stage captures, then sit just above it.
- **Chunk-size tuning for 24 GB.** Headroom discipline so full-room scans never
  OOM; revisit when the bigger GPU lands.
- **Bake budget.** 4096px texture bake → 2048 where the phone viewer can't tell.

Target: **~5–8 min per room**, stock quality.

## Tier 2 — HomeFAX finetune (weeks, needs data + bigger GPU)

LoRA/finetune the shape and texture SLAT models on construction-stage scenes:

- **The app is the data flywheel.** Every real capture stores its frames and
  COLMAP poses — exactly the supervision GenRecon's data toolkit
  (`data_toolkit_scenes/`) wants. Contractors generate training data by using
  the product.
- **Synthetic framing pretext.** Procedural stud walls / joist bays / rough-in
  runs rendered to posed views are cheap infinite data for the geometry the
  stock prior has never seen. (The viewer's procedural framing generator is a
  seed for this.)
- **Eval that matches the product**: held-out real stages, scored on the
  measured-geometry checks (plumb/spacing recovered from the *generated* mesh
  vs. the classical pipeline's measurement of the same capture). Accuracy for
  HomeFAX means "the generated mesh measures true", not FID.
- Training realistically wants >24 GB VRAM — this tier waits for the RTX 6000.

## Tier 3 — architecture (months, only if Tier 2 proves out)

Step-distilled student model for near-interactive reconstruction; prune the
object-centric capacity a scene model doesn't use. Decide after Tier 2 data
exists; do not start here.

## Ground rules

- The classical COLMAP path stays as the permanent fallback and as the
  *measurement referee* for evaluating generated meshes.
- Fork lives as `homefax-genrecon` with upstream attribution (MIT obligations).
- Nothing in Tier 2/3 begins until Tier 1 is measured on real captures.
