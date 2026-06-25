/**
 * StageVideo - the ambient looping video that fills the viewport BEHIND the
 * console card (the area where the grid used to sit). It lives at z-0 so the
 * opaque workspace card floats *over* it; the video is the backdrop, never inside
 * the app content. Autoplays muted + looped, pauses when the tab is hidden, and
 * freezes on a still frame under prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";

export function StageVideo({ src = "/stage.mp4" }: { src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      v.pause();
      return;
    }
    v.play().catch(() => {});
    const onVis = () => { if (document.hidden) v.pause(); else v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <video ref={ref} className="absolute inset-0 h-full w-full object-cover" src={src} autoPlay loop muted playsInline preload="auto" />
      {/* whisper-soft scrim so the backdrop stays calm behind the floating card */}
      <div className="absolute inset-0 bg-black/[0.06]" />
    </div>
  );
}
