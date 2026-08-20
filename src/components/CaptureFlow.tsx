"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

  return (
    <div className="space-y-4">
      {phase.kind === "error" && (
        <div className="card border-[var(--grade-f)] p-4">
          <p className="text-sm font-semibold text-[var(--grade-f)]">That did not go through</p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {phase.message}
          </p>
        </div>
      )}

      {(phase.kind === "extracting" || phase.kind === "uploading") && (
        <div className="card p-5">
          <p className="text-sm font-semibold">
            {phase.kind === "extracting" ? "Reading the walk" : "Sending frames"}
          </p>
          <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
            {phase.kind === "extracting"
              ? "Scoring frames for sharpness and keeping the best of each pass."
              : "Only the selected frames upload — the video stays on your phone."}
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${Math.round((phase.done / Math.max(1, phase.total)) * 100)}%` }}
            />
          </div>
          <p className="tnum mt-1.5 text-xs text-[var(--ink-3)]">
            {phase.done} / {phase.total}
          </p>
        </div>
      )}

      {phase.kind === "idle" && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold">How to film this stage</h2>
          <ul className="mt-2.5 space-y-2">
            {captureGuide.map((g) => (
              <li key={g} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {g}
              </li>
            ))}
          </ul>
        </div>
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
        disabled={phase.kind === "extracting" || phase.kind === "uploading"}
        onClick={() => fileRef.current?.click()}
      >
        {phase.kind === "error" ? "Try again" : "Film this stage"}
      </button>

      {!reconEnabled && (
        <p className="text-center text-xs leading-relaxed text-[var(--ink-3)]">
          No reconstruction endpoint is configured, so this run will be simulated and clearly
          labelled as such.
        </p>
      )}
    </div>
  );
}

function Working({ steps, simulated }: { steps: JobStep[]; simulated: boolean }) {
  const shown = steps.length > 0 ? steps : PLACEHOLDER;
  return (
    <div className="card overflow-hidden">
      <div className="relative h-1 overflow-hidden bg-[var(--surface-2)]">
        <div className="sweeping absolute inset-0" />
      </div>
      <div className="p-5">
        <h2 className="text-sm font-semibold">Reconstructing</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          {simulated
            ? "Simulated run — no GPU endpoint is configured."
            : "Running on a GPU worker. You can leave this page; the record keeps the result."}
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
              {s.state === "running" && (
                <span className="label pulsing ml-auto">working</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: JobStep["state"] }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]">
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
    return <span className="h-5 w-5 shrink-0 rounded-full bg-[var(--grade-f)]" />;
  }
  return (
    <span
      className={`h-5 w-5 shrink-0 rounded-full border-2 ${state === "running" ? "pulsing border-[var(--accent)]" : "border-[var(--line)]"}`}
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
