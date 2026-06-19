/**
 * Cursor-interactive canvas for the console — the same field as the wallet but a
 * cooler, sparser temperature (it lives behind the workspace, under the cards).
 * Capped, DPR-aware, paused when hidden, static under reduced-motion.
 */
import { useEffect, useRef } from "react";

type Dot = { x: number; y: number; vx: number; vy: number; r: number; hue: number; depth: number };
const PALETTE = ["#7342e2", "#9b7bea", "#2fa873", "#cdd2d8"];

export function Canvas({ density = 0.00006, tint = "#fbfbf9" }: { density?: number; tint?: string }) {
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
      const count = Math.min(80, Math.max(20, Math.floor(w * h * density)));
      dots = Array.from({ length: count }, () => {
        const depth = 0.4 + Math.random() * 0.9;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
          r: (1.2 + Math.random() * 2.2) * depth,
          hue: Math.floor(Math.random() * PALETTE.length),
          depth,
        };
      });
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      const p = pointer.current;
      for (const d of dots) {
        if (p.active) {
          const dx = p.x - d.x;
          const dy = p.y - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 130) {
            const force = ((130 - dist) / 130) * 0.5 * d.depth;
            d.vx -= (dx / dist) * force;
            d.vy -= (dy / dist) * force;
          } else {
            d.vx += (dx / dist) * 0.003 * d.depth;
            d.vy += (dy / dist) * 0.003 * d.depth;
          }
        }
        d.x += d.vx;
        d.y += d.vy;
        d.vx *= 0.95;
        d.vy *= 0.95;
        if (d.x < -10) d.x = w + 10;
        if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10;
        if (d.y > h + 10) d.y = -10;
        ctx.globalAlpha = 0.1 + d.depth * 0.16;
        ctx.fillStyle = PALETTE[d.hue];
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.active) {
        ctx.lineWidth = 0.6;
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          if (Math.hypot(p.x - d.x, p.y - d.y) > 150) continue;
          for (let j = i + 1; j < dots.length; j++) {
            const e = dots[j];
            const dd = Math.hypot(d.x - e.x, d.y - e.y);
            if (dd < 70) {
              ctx.globalAlpha = (1 - dd / 70) * 0.12;
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
      frame();
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerout", onLeave);
      document.addEventListener("visibilitychange", onVis);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, [density]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: tint, pointerEvents: "none" }} />;
}
