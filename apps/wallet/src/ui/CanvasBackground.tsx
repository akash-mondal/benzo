import { useEffect, useRef } from "react";

/**
 * Cursor-interactive canvas that lives BEHIND the cards. A field of soft drifting
 * "coins" gently parallax toward the pointer, repel within a radius, and draw
 * faint links to nearby neighbours near the cursor. Capped + DPR-aware + paused
 * when the tab is hidden; fully disabled under prefers-reduced-motion.
 */
type Dot = { x: number; y: number; vx: number; vy: number; r: number; hue: number; depth: number };

const PALETTE = ["#7342e2", "#9b7bea", "#2fa873", "#e0a23b", "#192837"];

export function CanvasBackground({ density = 0.00009, tint = "#f2f2ee" }: { density?: number; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let dots: Dot[] = [];
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.max(24, Math.floor(w * h * density)));
      dots = Array.from({ length: count }, () => {
        const depth = 0.4 + Math.random() * 0.9;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          r: (1.3 + Math.random() * 2.6) * depth,
          hue: Math.floor(Math.random() * PALETTE.length),
          depth,
        };
      });
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      const p = pointer.current;
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        // gentle drift + parallax pull toward the pointer scaled by depth
        if (p.active) {
          const dx = p.x - d.x;
          const dy = p.y - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 150) {
            // repel inside the close radius (cursor pushes coins away)
            const force = ((150 - dist) / 150) * 0.6 * d.depth;
            d.vx -= (dx / dist) * force;
            d.vy -= (dy / dist) * force;
          } else {
            // distant parallax: subtle attraction
            d.vx += (dx / dist) * 0.004 * d.depth;
            d.vy += (dy / dist) * 0.004 * d.depth;
          }
        }
        d.x += d.vx;
        d.y += d.vy;
        d.vx *= 0.94;
        d.vy *= 0.94;
        // wrap
        if (d.x < -10) d.x = w + 10;
        if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10;
        if (d.y > h + 10) d.y = -10;

        ctx.globalAlpha = 0.18 + d.depth * 0.22;
        ctx.fillStyle = PALETTE[d.hue];
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // proximity links near the cursor only (cheap)
      if (p.active) {
        ctx.lineWidth = 0.6;
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          if (Math.hypot(p.x - d.x, p.y - d.y) > 170) continue;
          for (let j = i + 1; j < dots.length; j++) {
            const e = dots[j];
            const dd = Math.hypot(d.x - e.x, d.y - e.y);
            if (dd < 64) {
              ctx.globalAlpha = (1 - dd / 64) * 0.16;
              ctx.strokeStyle = "#7342e2";
              ctx.beginPath();
              ctx.moveTo(d.x, d.y);
              ctx.lineTo(e.x, e.y);
              ctx.stroke();
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => (pointer.current.active = false);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    if (reduce) {
      // static single paint, no loop
      frame();
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onMove, { passive: true });
      window.addEventListener("pointerout", onLeave);
      document.addEventListener("visibilitychange", onVis);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerout", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: tint, pointerEvents: "none" }}
    />
  );
}
