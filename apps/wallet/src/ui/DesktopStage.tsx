import { useEffect, useRef } from "react";

/**
 * The desktop "stage" behind the phone frame. On wide screens the wallet sits in
 * a centered device; this fills the space around it with a living, on-brand
 * environment: a warm perspective grid whose vanishing point leans toward the
 * cursor, soft coin motes that drift + parallax + repel, and an accent glow that
 * trails the pointer. Cursor-interactive everywhere OUTSIDE the device.
 *
 * Desktop-only (the loop never starts under the `sm` breakpoint), DPR-aware,
 * capped, paused when hidden, and fully static under prefers-reduced-motion.
 */
type Mote = { x: number; y: number; vx: number; vy: number; r: number; hue: number; depth: number };

const PALETTE = ["#7342e2", "#9b7bea", "#2fa873", "#e0a23b"];
const INK = "25, 40, 55";
const ACCENT = "115, 66, 226";

export function DesktopStage() {
  const ref = useRef<HTMLCanvasElement>(null);
  // pointer + a lerped "eye" that smoothly chases it (for buttery parallax)
  const pointer = useRef({ x: -9999, y: -9999, active: false });
  const eye = useRef({ x: 0, y: 0, gx: -9999, gy: -9999, ga: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const desktop = window.matchMedia("(min-width: 640px)");

    let motes: Mote[] = [];
    let raf = 0;
    let running = false;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(54, Math.max(18, Math.floor((w * h) / 36000)));
      motes = Array.from({ length: count }, () => {
        const depth = 0.4 + Math.random() * 0.9;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.1,
          vy: -0.05 - Math.random() * 0.12, // gentle upward drift
          r: (1.4 + Math.random() * 3) * depth,
          hue: Math.floor(Math.random() * PALETTE.length),
          depth,
        };
      });
      eye.current.x = w / 2;
      eye.current.y = h * 0.46;
    };

    const drawGrid = (vx: number, vy: number) => {
      const horizon = h * 0.46;
      // floor: horizontal lines with perspective compression toward the horizon
      ctx.lineWidth = 1;
      const ROWS = 22;
      for (let i = 1; i <= ROWS; i++) {
        const t = i / ROWS;
        const y = horizon + (h - horizon) * (t * t); // ease: denser near horizon
        const a = (1 - t) * 0.1;
        ctx.strokeStyle = `rgba(${INK}, ${a})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // converging radial lines from the (cursor-shifted) vanishing point
      const COLS = 26;
      for (let i = 0; i <= COLS; i++) {
        const fx = (i / COLS) * (w * 2.2) - w * 0.6; // fan wide past the edges
        ctx.strokeStyle = `rgba(${INK}, 0.075)`;
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(fx, h);
        ctx.stroke();
      }
      // a faint mirrored ceiling for depth (sparser)
      for (let i = 1; i <= 7; i++) {
        const t = i / 7;
        const y = horizon - horizon * (t * t);
        ctx.strokeStyle = `rgba(${INK}, ${(1 - t) * 0.05})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    };

    const drawGlow = (x: number, y: number, alpha: number) => {
      const R = 300;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, `rgba(${ACCENT}, ${0.12 * alpha})`);
      g.addColorStop(1, `rgba(${ACCENT}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - R, y - R, R * 2, R * 2);
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      const p = pointer.current;
      const e = eye.current;
      // smooth the pointer + activeness so motion is calm, not jittery
      const tx = p.active ? p.x : w / 2;
      const ty = p.active ? p.y : h * 0.46;
      e.gx += (tx - e.gx) * 0.08;
      e.gy += (ty - e.gy) * 0.08;
      e.ga += ((p.active ? 1 : 0) - e.ga) * 0.05;

      // vanishing point leans toward the cursor
      const vx = w / 2 + (e.gx - w / 2) * 0.06;
      const vy = h * 0.46 + (e.gy - h * 0.46) * 0.04;

      drawGlow(e.gx, e.gy, e.ga);
      drawGrid(vx, vy);

      // coin motes
      for (const d of motes) {
        if (p.active) {
          const dx = e.gx - d.x;
          const dy = e.gy - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 170) {
            const force = ((170 - dist) / 170) * 0.5 * d.depth;
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
        d.vy = d.vy * 0.95 - 0.012 * d.depth; // keep a soft upward bias
        if (d.y < -12) d.y = h + 12;
        if (d.y > h + 12) d.y = -12;
        if (d.x < -12) d.x = w + 12;
        if (d.x > w + 12) d.x = -12;

        ctx.globalAlpha = 0.14 + d.depth * 0.2;
        ctx.fillStyle = PALETTE[d.hue];
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      resize();
      if (reduce) {
        frame(); // single static paint
        cancelAnimationFrame(raf);
        return;
      }
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };

    const onMove = (ev: PointerEvent) => {
      pointer.current = { x: ev.clientX, y: ev.clientY, active: true };
    };
    const onLeave = () => (pointer.current.active = false);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (running && !reduce) raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      if (desktop.matches) resize();
    };
    const onBreakpoint = () => (desktop.matches ? start() : stop());

    if (desktop.matches) start();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    desktop.addEventListener("change", onBreakpoint);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      desktop.removeEventListener("change", onBreakpoint);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 hidden sm:block"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
