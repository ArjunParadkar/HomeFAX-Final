"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SplashLoader from "@/components/brand/SplashLoader";
import { extractFrames } from "@/lib/frames";
import type { JobStep, StageId } from "@/lib/types";

/**
 * Everything between "I am standing in the room" and "the model is on screen".
 *
 * Deliberately one component: the phases share too much state to split, and on
 * a phone the whole thing is a single scroll of one screen.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "extracting"; done: number; total: number }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "working"; steps: JobStep[] }
  | { kind: "error"; message: string };

const POLL_MS = 2500;

export default function CaptureFlow({
  slug,
  stage,
  captureGuide,
  blobEnabled,
  reconEnabled,
  activeCaptureId,
  initialSteps,
}: {
  slug: string;
  stage: StageId;
  captureGuide: string[];
  blobEnabled: boolean;
  reconEnabled: boolean;
  activeCaptureId: string | null;
  initialSteps: JobStep[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    activeCaptureId ? { kind: "working", steps: initialSteps } : { kind: "idle" },
  );
  const [captureId, setCaptureId] = useState<string | null>(activeCaptureId);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ---------------------------- polling loop ---------------------------- */

  useEffect(() => {
    if (!captureId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/captures/${captureId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Status check failed (${res.status})`);
        const body = (await res.json()) as {
          state: string;
          job?: { steps?: JobStep[]; error?: string };
        };
        if (cancelled) return;

        if (body.state === "done") {
          router.refresh();
          return;
        }
        if (body.state === "failed") {
          setPhase({
            kind: "error",
            message: body.job?.error ?? "The reconstruction failed.",
          });
          setCaptureId(null);
          return;
        }
        setPhase({ kind: "working", steps: body.job?.steps ?? [] });
        timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        // Transient network blips are common on site — keep polling.
        void err;
        timer = setTimeout(tick, POLL_MS * 2);
      }
    }

    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [captureId, router]);

  /* ------------------------------ submission ----------------------------- */

  const onFile = useCallback(
    async (file: File) => {
      try {
        setPhase({ kind: "extracting", done: 0, total: 1 });

        const { frames } = await extractFrames(file, {
          maxFrames: 60,
          onProgress: (done, total) => setPhase({ kind: "extracting", done, total }),
        });

        let imageUrls: string[] = [];
        if (blobEnabled) {
          setPhase({ kind: "uploading", done: 0, total: frames.length });
          const stamp = Date.now();
          for (let i = 0; i < frames.length; i++) {
            const result = await upload(
              `captures/${slug}/${stage}/${stamp}-${String(i).padStart(3, "0")}.jpg`,
              frames[i].blob,
              { access: "public", handleUploadUrl: "/api/blob/upload" },
            );
            imageUrls.push(result.url);
            setPhase({ kind: "uploading", done: i + 1, total: frames.length });
          }
        } else {
          // No storage configured: the frames stay on the device and the run is
          // simulated. The page says so plainly rather than pretending.
          imageUrls = [];
        }

        const res = await fetch("/api/captures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, stage, imageUrls }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "The server would not accept the capture.");
        }
        const body = (await res.json()) as { id: string };
        setCaptureId(body.id);
        setPhase({ kind: "working", steps: [] });
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [blobEnabled, slug, stage],
  );

  /* -------------------------------- views -------------------------------- */

  if (phase.kind === "working") {
    return <Working steps={phase.steps} simulated={!reconEnabled} />;
  }

  if (phase.kind === "extracting" || phase.kind === "uploading") {
    const reading = phase.kind === "extracting";
    const pct = Math.round((phase.done / Math.max(1, phase.total)) * 100);
    return (
      <section className="plate overflow-hidden" aria-busy>
        <SplashLoader
          caption={reading ? "READING THE WALK" : "SENDING FRAMES"}
          markSize={116}
          className="py-7!"
        />
        <div className="border-t border-[var(--line)] px-5 py-4">
          <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {reading
              ? "Scoring every frame for sharpness and keeping the best of each pass."
              : "Only the selected frames upload. The video stays on your phone."}
          </p>
          <div
            className="mt-3 h-[3px] overflow-hidden rounded-[1px] bg-[var(--surface-2)]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={reading ? "Reading the walk" : "Sending frames"}
          >
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="tnum mt-2 text-[0.625rem] uppercase tracking-[0.14em] text-[var(--ink-3)]">
            {phase.done} / {phase.total} frames
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {phase.kind === "error" && (
        <div className="card p-4" style={{ borderColor: "var(--grade-f)" }}>
          <p className="eyebrow" style={{ color: "var(--grade-f)" }}>
            That did not go through
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {phase.message}
          </p>
        </div>
      )}

      {phase.kind === "idle" && (
        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">How to film this stage</h2>
          </div>
          <ul className="px-4 py-3">
            {captureGuide.map((g) => (
              <li
                key={g}
                className="flex gap-2.5 py-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]"
              >
                <span
                  className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]"
                  aria-hidden
                />
                {g}
              </li>
            ))}
          </ul>
        </section>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <button
        type="button"
        className="btn btn-primary w-full"
        onClick={() => fileRef.current?.click()}
      >
        {phase.kind === "error" ? "Film it again" : "Film this stage"}
      </button>

      {!reconEnabled && (
        <p className="text-center text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
          No reconstruction endpoint is configured. This run will be simulated, and every screen it
          touches says so.
        </p>
      )}
    </div>
  );
}

function Working({ steps, simulated }: { steps: JobStep[]; simulated: boolean }) {
  const shown = steps.length > 0 ? steps : PLACEHOLDER;
  return (
    <section className="plate overflow-hidden" aria-busy>
      <SplashLoader
        caption={simulated ? "SIMULATING RECONSTRUCTION" : "RECONSTRUCTING 3D MODEL"}
        markSize={116}
        className="py-7!"
      />
      <div className="border-t border-[var(--line)] px-5 py-4">
        <p className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          {simulated
            ? "Simulated run — no GPU endpoint is configured, and the result will be labelled as stand-in geometry."
            : "Running on a GPU worker. You can leave this page and put the phone away; the record keeps the result."}
        </p>
        <ol className="mt-4 space-y-2.5">
          {shown.map((s) => (
            <li key={s.key} className="flex items-center gap-3">
              <StepDot state={s.state} />
              <span
                className={`text-[0.8125rem] ${
                  s.state === "pending" ? "text-[var(--ink-3)]" : "text-[var(--ink)]"
                }`}
              >
                {s.label}
              </span>
              {s.state === "running" && <span className="label pulsing ml-auto">working</span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepDot({ state }: { state: JobStep["state"] }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--accent)]">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            stroke="var(--accent-ink)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return <span className="h-5 w-5 shrink-0 rounded-[5px] bg-[var(--grade-f)]" />;
  }
  return (
    <span
      className={`h-5 w-5 shrink-0 rounded-[5px] border-2 ${state === "running" ? "pulsing border-[var(--accent)]" : "border-[var(--line)]"}`}
    />
  );
}

const PLACEHOLDER: JobStep[] = [
  { key: "extract", label: "Selecting keyframes", state: "running" },
  { key: "features", label: "Matching features", state: "pending" },
  { key: "sfm", label: "Solving camera poses", state: "pending" },
  { key: "dense", label: "Dense stereo", state: "pending" },
  { key: "mesh", label: "Meshing and texturing", state: "pending" },
  { key: "measure", label: "Measuring geometry", state: "pending" },
  { key: "pack", label: "Compressing model", state: "pending" },
];
