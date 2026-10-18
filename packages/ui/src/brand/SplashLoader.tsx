"use client";

import LogoMark from "./LogoMark";
import Wordmark from "./Wordmark";

/**
 * Frame 2a of the brand kit: the splash loader. The house draws itself in
 * cream on onyx, the wordmark sits below, a claude-colored fill slides along
 * the track, and the caption pulses. Used full-screen for route loads and
 * inline (as a panel) while a reconstruction is running.
 */
export default function SplashLoader({
  caption = "BUILDING PROPERTY HISTORY",
  fullScreen = false,
  markSize = 240,
  className = "",
}: {
  caption?: string;
  fullScreen?: boolean;
  markSize?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={caption}
      className={`${
        fullScreen ? "fixed inset-0 z-50" : "rounded-[14px] py-14"
      } flex flex-col items-center justify-center overflow-hidden ${className}`}
      style={{ background: "var(--onyx, #16130f)" }}
    >
      <LogoMark variant="house" mode="loop" surface="dark" size={markSize} />
      <div className="mt-2" style={{ color: "var(--cream, #f4eddf)" }}>
        <Wordmark size={26} tracking={0.34} accent="var(--claude, #d97757)" />
      </div>
      <div
        className="relative mt-6 h-[2px] w-[220px] overflow-hidden rounded-[1px]"
        style={{ background: "#3a322a" }}
      >
        <div
          className="hf-slide absolute left-0 top-0 h-full w-[34%]"
          style={{ background: "var(--claude, #d97757)" }}
        />
      </div>
      <div
        className="hf-pulse tnum mt-3.5 text-[10px] font-medium uppercase"
        style={{ letterSpacing: "0.22em", color: "#8a7c68" }}
      >
        {caption}
      </div>
    </div>
  );
}
