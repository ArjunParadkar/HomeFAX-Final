# HomeFAX — contractor edition

A permanent record of how a house was actually built. The contractor films each
stage on a phone; the app returns a measured 3D model, a graded inspection, and
a parts list that shows its work.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

With nothing configured the app runs end to end against a local JSON store and a simulated
reconstruction (labelled as simulated wherever it shows): film or upload a stage, get the graded
inspection and the parts take-off. Live: https://homefax-final.vercel.app · product walkthrough video:
[`demo/homefax_demo.mp4` on the `platform` branch](https://github.com/ArjunParadkar/HomeFAX-Final/blob/platform/demo/homefax_demo.mp4).

## The pipeline

```
phone: film stage → score frames for sharpness → upload the best 60
  ↓
RunPod GPU: COLMAP SfM → dense stereo → Poisson mesh → measure → Draco GLB
  ↓
app: geometry-based grading  +  vision review (Claude)  →  stage grade
                                                        →  parts takeoff
  ↓
record: 11 stages, each graded, one cumulative parts list
```

The video never leaves the phone. Frame selection happens on-device, so a
two-minute 4K walk uploads as ~4 MB of chosen keyframes instead of 300 MB of
footage.

## Grading

Four dimensions, weighted per stage (`src/lib/stages.ts`):

| Dimension | Source | Reproducible? |
|---|---|---|
| Capture | registration rate, sharpness, mesh completeness | yes |
| Geometry | plumb, level, flatness, stud spacing, solve error | yes |
| Workmanship | vision review against the stage checklist | no |
| Compliance | vision review against the stage checklist | no |

When no Anthropic key is present, the two judged dimensions are dropped and the
remaining weights renormalised — the report says so rather than scoring an
un-assessed dimension as perfect.

## Parts

Every line carries its derivation and one of three bases:

- **measured** — computed from the model's own geometry
- **detected** — counted in the frames by the vision review
- **derived** — implied by a measured quantity under a stated rule

Across stages, a later measured count supersedes an earlier estimate rather than
double-ordering material that was simply visible twice.

## Running locally

```bash
npm install
npm run dev
```

With nothing configured, the app runs end to end against a local JSON store and
a simulated reconstruction — clearly labelled as simulated everywhere it shows.

## Environment

| Variable | Effect when absent |
|---|---|
| `AUTH_SECRET` | Sessions are signed with a dev fallback; production refuses to start without it |
| `ACCESS_KEYS` | Companies cannot claim records made under the old key gate. Format: `secret:Label,secret2:Label2` |
| `DATABASE_URL` | Falls back to a JSON file under `.data/` |
| `BLOB_READ_WRITE_TOKEN` | Frames stay on the device; runs are simulated |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` | Reconstruction is simulated |
| `ANTHROPIC_API_KEY` | Workmanship and compliance are not graded |

## Accounts and passwords

Sign-ins are real accounts (scrypt password, signed session cookie). There is no
mail provider, so password recovery is handed over rather than emailed:

- **Change password** — on `/profile`, with the current password.
- **Reset link** — a company owner or admin issues a one-time link for a member
  from `/team` (only the owner can issue one for an admin). The link opens
  `/reset`, sets the new password once, signs the person in, and dies. Links
  expire after an hour; issuing a new one retires the old one.
- **Owner recovery** — the UI never resets an owner. Run
  `DATABASE_URL=… npx tsx scripts/issue-reset-link.ts owner@example.com` and
  hand over the printed link.

## Layout

```
src/lib/stages.ts    the 11 stages, their checklists, capture guidance, weights
src/lib/quality.ts   the rubric — what each dimension measures and what it costs
src/lib/parts.ts     catalogue and quantity takeoff
src/lib/frames.ts    on-device frame selection
src/lib/recon.ts     RunPod client, plus the simulation fallback
src/lib/vision.ts    the vision review
services/recon/      the GPU worker
```

## Platform branch

The multi-app platform (contractor + homeowner + admin over a shared RLS database) lives on the [`platform`](https://github.com/ArjunParadkar/HomeFAX-Final/tree/platform) branch, with demo videos under `demo/`. This `main` branch is the contractor app that is live at https://homefax-final.vercel.app.
