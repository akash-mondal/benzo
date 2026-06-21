/**
 * VideoBackground — the ambient looping video behind every screen (replaces the
 * canvas dots/grid). Fills its positioned parent, sits BEHIND all cards, and
 * carries a soft scrim so dark-on-light text stays legible over the footage.
 * Autoplays muted + looped (the only way mobile browsers allow autoplay), and
 * falls back to a still first frame under prefers-reduced-motion.
 *
 * Drop-in: same `tint` prop shape as the old CanvasBackground.
 */
import { useEffect, useRef } from "react";

export function VideoBackground({ tint = "#f2f2ee", src = "/bg.mp4" }: { tint?: string; src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      v.pause();
      return;
    }
    // Some browsers need an explicit play() after mount; ignore the autoplay-block rejection.
    v.play().catch(() => {});
    const onVis = () => { if (document.hidden) v.pause(); else v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
      {/* Legibility scrim — keeps the brand tint + lets dark text read over the video. */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${tint}66 0%, ${tint}26 30%, ${tint}40 100%)` }} />
    </div>
  );
}
