// The sealed ticket: what a doodle opens. Sand stock with an envelope-flap cut, a leaf-green screen where the doodle
// turns in sand chrome under its status light, a perforated stub, the name, and its controls: copy in a chosen format,
// and for an auction, open it. An interface fragment (data-ui): its own controls, radii and the shadow of its menu.
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { chromeMaterial, doodleTexture } from "./shaders";
import { AUCTION_FORMATS, DOODLE_FORMATS, auctionAs, doodleAs } from "./formats";
import { MODE_NAME, STATE_LIGHT } from "../../lib/api";
import type { FieldDoodle } from "../../lib/types";

export function Spinner({ src, className = "h-28 w-full", size = 1.35, still = false }: { src: string; className?: string; size?: number; still?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 10);
    camera.position.z = 2.4;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);
    let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null, gone = false;
    doodleTexture(src).then((t) => { if (!t || gone) return; mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), chromeMaterial(t, 3.7)); scene.add(mesh); });
    const reduce = still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let over = false;
    const enter = () => (over = true), leave = () => (over = false);
    el.addEventListener("pointerenter", enter); el.addEventListener("pointerleave", leave);
    const clock = new THREE.Clock();
    let frame = 0, speed = 0.4;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const dt = clock.getDelta(), t = clock.elapsedTime;
      if (mesh && !reduce) { mesh.material.uniforms.uTime.value = t; speed += ((over ? 0 : 0.6) - speed) * 0.06; mesh.rotation.y -= speed * dt; }
      renderer.render(scene, camera);
    };
    loop();
    const resize = new ResizeObserver(() => { camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1); camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); });
    resize.observe(el);
    return () => {
      gone = true; cancelAnimationFrame(frame); resize.disconnect();
      el.removeEventListener("pointerenter", enter); el.removeEventListener("pointerleave", leave);
      if (mesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, [src, size, still]);
  return <div ref={box} className={className} />;
}

const CONTROL = "flex h-10 w-full items-center justify-center gap-1.5 font-sans text-[13px] font-medium text-ink/70 transition-colors hover:text-ink focus-visible:text-ink";
// The flap: a 28px diagonal cut on the ticket's top-left corner (the stage's cut, at ticket size).
const FLAP = "polygon(28px 0, 100% 0, 100% 100%, 0 100%, 0 28px)";

const MENU = "absolute bottom-[calc(100%+6px)] left-2 z-50 max-h-72 w-48 overflow-auto bg-sand p-1 shadow-[0_14px_30px_rgba(42,42,38,0.28)]"; // taste-skill-ignore: an open menu is a real overlay and casts its shadow

function Picker({ items, value, onChange }: { items: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  const label = items.find((i) => i.value === value)?.label ?? value;
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-label="Copy format" aria-haspopup="listbox" aria-expanded={open} className={CONTROL} onClick={() => setOpen((o) => !o)}>
        <span className="max-w-[5.5rem] truncate">{label}</span>
        <svg className="size-3.5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul role="listbox" className={MENU}>
          {items.map((i) => (
            <li key={i.value} role="option" aria-selected={i.value === value}>
              <button type="button" className={`w-full px-3 py-2 text-left font-sans text-[13px] hover:bg-surface ${i.value === value ? "font-medium text-ink" : "text-ink/70"}`} onClick={() => { onChange(i.value); setOpen(false); }}>
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Card({ doodle, onClose, signer }: { doodle: FieldDoodle; onClose: () => void; signer?: string }) {
  const a = doodle.auction;
  const items = a ? AUCTION_FORMATS : DOODLE_FORMATS;
  const [format, setFormat] = useState(items[0].value);
  const [copied, setCopied] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => { setFormat(items[0].value); setCopied(false); }, [doodle.key]);
  useEffect(() => {
    if (a) return;
    let gone = false;
    fetch(doodle.src).then((r) => r.text()).then((t) => { if (!gone) setSvg(t); }).catch(() => setSvg(null));
    return () => { gone = true; };
  }, [doodle.src, a]);
  const copy = useCallback(async () => {
    const text = a ? auctionAs(format, a, signer) : svg ? doodleAs(format, doodle.name, svg) : "";
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard refused */ }
  }, [a, format, signer, svg, doodle.name]);

  const light = a ? STATE_LIGHT[a.state] ?? STATE_LIGHT.SETTLED : { word: doodle.group === "ornament" ? "Free to use" : "How it works", color: "bg-sand", glow: "" };
  const title = a ? (a.live ? "Live round" : MODE_NAME[a.mode]) : doodle.category;
  const name = a ? (a.lot ?? `${MODE_NAME[a.mode]} ${a.id.slice(0, 6)}`) : doodle.name;

  return (
    <div className="card-in w-60" data-ui data-testid="card" role="dialog" aria-label={`${title}: ${name}`}>
      <div className="relative px-3.5 pb-0 pt-3">
        {/* The stock is a layer of its own, so the flap cut never clips the format menu. */}
        <div aria-hidden className="absolute inset-0 bg-surface" style={{ clipPath: FLAP }} />
        <div className="relative flex items-center justify-between pl-5">
          <span className="font-sans text-[13px] font-bold uppercase tracking-wide text-ink">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center text-ink/60 transition-colors hover:text-ink">
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="relative mt-2 bg-leaf-deep px-2 pb-2 pt-2.5">
          <span className="absolute right-2.5 top-2 z-10 flex items-center gap-1.5 font-sans text-[13px] text-sand/80" data-testid="card-light">
            {light.word}<span className={`size-1.5 rounded-full ${light.color} ${light.glow}`} />
          </span>
          <Spinner src={doodle.src} />
          {a && <p className="truncate text-center font-sans text-[12px] text-sand/60">{a.leaf_count ?? 0} sealed bids</p>}
        </div>
        <div className="relative -mx-3.5 mt-3">
          <div className="border-t-2 border-dotted border-ink/25" />
          <span aria-hidden className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-ground" />
          <span aria-hidden className="absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-ground" />
        </div>
        {a
          ? <a href={`/auction/?id=${a.id}`} className="relative block truncate pt-2.5 text-center font-sans text-base font-bold tracking-tight text-ink underline-offset-4 hover:underline" data-testid="card-open"><span data-testid="card-name">{name}</span> <span aria-hidden className="text-moss">→</span></a>
          : <p className="relative truncate pt-2.5 text-center font-sans text-base font-bold tracking-tight text-ink" data-testid="card-name">{name}</p>}
        <div className="relative -mx-3.5 grid grid-cols-2">
          <Picker items={items} value={format} onChange={setFormat} />
          <button type="button" onClick={copy} aria-label="Copy" className={`${CONTROL} ${copied ? "text-moss hover:text-moss" : ""}`}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
