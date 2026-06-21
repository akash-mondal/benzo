/**
 * VideoBackground — ambient looping video behind the console (replaces the canvas
 * grid). Fills its positioned parent, sits behind content, carries a soft scrim
 * for legibility, autoplays muted+looped, and falls back to a still frame under
 * prefers-reduced-motion. Drop-in for the old <Canvas tint=… />.
 */
import { useEffect, useRef } from "react";

export function VideoBackground({ tint = "#fbfbf9", src = "/bg.mp4" }: { tint?: string; src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) { v.pause(); return; }
    v.play().catch(() => {});
    const onVis = () => { if (document.hidden) v.pause(); else v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <video ref={ref} className="absolute inset-0 h-full w-full object-cover" src={src} autoPlay loop muted playsInline preload="auto" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${tint}73 0%, ${tint}33 35%, ${tint}55 100%)` }} />
    </div>
  );
}
