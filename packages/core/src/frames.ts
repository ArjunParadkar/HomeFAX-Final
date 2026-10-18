"use client";

/**
 * Frame selection, on the phone.
 *
 * Uploading a two-minute 4K walkthrough over LTE is the slowest part of the
 * whole product, so the video never leaves the device. We decode it locally,
 * score every candidate frame for sharpness, and upload only the frames the
 * solver will actually use — roughly 4 MB instead of 300 MB, and the worker
 * gets a cleaner input set than naive fixed-interval sampling would give it.
 */

export type ExtractOptions = {
  maxFrames?: number;
  /** Longest edge of the uploaded frame. 1600 keeps feature detail without bloating. */
  maxEdge?: number;
  quality?: number;
  onProgress?: (done: number, total: number) => void;
};

export type ExtractedFrame = {
  blob: Blob;
  timeSec: number;
  sharpness: number;
};

export type ExtractResult = {
  frames: ExtractedFrame[];
  durationSec: number;
  /** Frames considered before sharpness rejection — shown in the capture summary. */
  candidates: number;
};

const DEFAULTS = { maxFrames: 60, maxEdge: 1600, quality: 0.82 };

export async function extractFrames(
  file: File,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const { maxFrames, maxEdge, quality } = { ...DEFAULTS, ...opts };

  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);

  try {
    await once(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) {
      throw new Error("That file has no readable video track.");
    }

    // Oversample by 2x, then keep the sharpest frame in each output window.
    const candidateCount = Math.min(maxFrames * 2, Math.max(maxFrames, Math.ceil(duration * 3)));
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser would not give us a 2D canvas.");

    // Sharpness is measured on a downscaled copy — cheap, and the ranking holds.
    const probe = document.createElement("canvas");
    const PROBE = 160;
    probe.width = PROBE;
    probe.height = Math.max(1, Math.round((PROBE * h) / w));
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (!pctx) throw new Error("This browser would not give us a 2D canvas.");

    type Candidate = { time: number; sharpness: number };
    const scored: Candidate[] = [];

    // Pass one: seek across the clip and score. Some phone encoders die partway
    // through a seek-heavy pass, so a failure here keeps whatever we already have.
    for (let i = 0; i < candidateCount; i++) {
      const t = (duration * (i + 0.5)) / candidateCount;
      try {
        await seek(video, t);
      } catch {
        break;
      }
      pctx.drawImage(video, 0, 0, probe.width, probe.height);
      scored.push({ time: t, sharpness: laplacianVariance(pctx, probe.width, probe.height) });
      opts.onProgress?.(i + 1, candidateCount + maxFrames);
    }

    if (scored.length === 0) {
      throw new Error("The video could not be decoded in this browser.");
    }

    // Pick the sharpest candidate in each of maxFrames evenly spaced windows, so
    // coverage stays uniform along the walk instead of clustering on sharp spots.
    const windows = Math.min(maxFrames, scored.length);
    const chosen: Candidate[] = [];
    for (let i = 0; i < windows; i++) {
      const lo = (i * scored.length) / windows;
      const hi = ((i + 1) * scored.length) / windows;
      const slice = scored.slice(Math.floor(lo), Math.max(Math.floor(lo) + 1, Math.floor(hi)));
      const best = slice.reduce((a, b) => (b.sharpness > a.sharpness ? b : a));
      chosen.push(best);
    }

    // Pass two: re-seek the winners at full resolution and encode.
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      try {
        await seek(video, c.time);
      } catch {
        break;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await toBlob(canvas, quality);
      if (blob) frames.push({ blob, timeSec: c.time, sharpness: c.sharpness });
      opts.onProgress?.(candidateCount + i + 1, candidateCount + maxFrames);
    }

    if (frames.length < 8) {
      throw new Error(
        `Only ${frames.length} usable frames came out of that clip — a reconstruction needs at least 8. Film a slower, longer pass.`,
      );
    }

    return { frames, durationSec: duration, candidates: scored.length };
  } finally {
    URL.revokeObjectURL(video.src);
    video.removeAttribute("src");
    video.load();
  }
}

/** Variance of the Laplacian on luminance — the standard cheap focus measure. */
function laplacianVariance(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function once(el: HTMLVideoElement, event: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("The browser could not read that video."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Seek stalled."));
    }, 8000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Decoder failed mid-seek."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = Math.max(0, time);
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
