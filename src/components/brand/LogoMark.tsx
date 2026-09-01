"use client";

import { useEffect, useRef } from "react";

/**
 * The HomeFAX mark, from the brand kit (500x500 videos, black lines on white).
 *
 * variant "logo" is the boxed AR monogram draw-in (homefax-logo.mp4);
 * "house" is the 3D house draw-in (homefax-house.mp4) used by the splash.
 *
 * mode "loop" replays the draw-in, cut just before the tail hold so it never
 * sits still; "once" plays the draw-in through and holds the finished mark;
 * "still" seeks straight to the finished mark and holds it.
 *
 * surface "dark" is the kit's cream-on-onyx technique: the whole element
 * screen-blends onto the dark panel behind it, the video is inverted, and a
 * cream multiply overlay tints the lines. surface "light" simply multiplies
 * the black lines onto whatever light background is underneath.
 */
const LOOP_CAP_S = 3.4;

const SOURCES = {
  logo: { src: "/brand/homefax-logo.mp4", poster: "/brand/homefax-logo-still.png" },
  house: { src: "/brand/homefax-house.mp4", poster: "/brand/homefax-house.png" },
};

export default function LogoMark({
  variant = "house",
  mode = "still",
  surface = "dark",
  size = 96,
  className = "",
}: {
  variant?: "logo" | "house";
  mode?: "loop" | "once" | "still";
  surface?: "dark" | "light";
  size?: number | string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;

    const still = () => {
      const seek = () => {
        try {
          v.currentTime = Math.max(0, (v.duration || 5) - 0.05);
        } catch {
          /* not seekable yet — the poster frame is close enough */
        }
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    };

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (mode === "loop" && !reduced) {
      const onTime = () => {
        if (v.currentTime > LOOP_CAP_S) v.currentTime = 0.01;
      };
      v.addEventListener("timeupdate", onTime);
      v.loop = true;
      v.play().catch(still);
      return () => v.removeEventListener("timeupdate", onTime);
    }

    if (mode === "once" && !reduced) {
      v.loop = false;
      v.play().catch(still);
      return;
    }

    still();
  }, [mode]);

  const video = (
    <video
      ref={ref}
      src={SOURCES[variant].src}
      poster={SOURCES[variant].poster}
      muted
      playsInline
      preload="auto"
      aria-hidden
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...(surface === "dark"
          ? { filter: "invert(1)" }
          : { mixBlendMode: "multiply" as const }),
      }}
    />
  );

  if (surface === "light") {
    return (
      <div className={className} style={{ width: size, height: size }}>
        {video}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ position: "relative", width: size, height: size, mixBlendMode: "screen" }}
    >
      {video}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--cream, #f4eddf)",
          mixBlendMode: "multiply",
        }}
      />
    </div>
  );
}
