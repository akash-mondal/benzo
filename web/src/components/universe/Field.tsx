// The doodle field, after svgdoodles.com: an endless, draggable night of chrome doodles. Every doodle is a plane with the
// chrome band shader; the layout tiles and wraps as you pan, dust twinkles in depth, a streak crosses now and then.
// Hovering shows a white pill with the name; a click (not a drag) selects the doodle; the floating words are links.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { chromeMaterial, doodleTexture, dustFragment, dustVertex, hash01, planeVertex, streakFragment, WORD_FONT, wordTexture, wrap } from "./shaders";
import type { FieldDoodle, FieldWord } from "../../lib/types";

type Entry = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  doodle: FieldDoodle | null;
  word: FieldWord | null;
  baseX: number; baseY: number; phase: number; bobSpeed: number; spinSpeed: number; targetScale: number; baseScale: number;
};

// Where the words sit, as fractions of the tile (the reference's four anchor points).
// Where the words float, as fractions of the tile.
const WORD_ANCHORS: [number, number][] = [[0.02, 0.14], [0.17, -0.02], [-0.15, -0.06], [-0.06, -0.21], [0.13, -0.19]];

export default function Field({ doodles, words = [], onSelect, onWord = () => {}, ground = "#141a10", hint = "" }: {
  doodles: FieldDoodle[];
  words?: FieldWord[];
  onSelect: (d: FieldDoodle) => void;
  onWord?: (w: FieldWord) => void;
  ground?: string;
  hint?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const entries = useRef<Entry[]>([]);
  const group = useRef<THREE.Group | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const word = useRef(onWord); word.current = onWord;
  const hovered = useRef<Entry | null>(null);
  const pan = useRef({ x: 0, y: 0 });
  const tile = useRef({ w: 0, h: 0 });
  const [label, setLabel] = useState<{ name: string; tag: string | null } | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  // Scene, camera, dust, streaks and the input loop: built once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ground);
    scene.fog = new THREE.Fog(ground, 10, 26);
    const camera = new THREE.PerspectiveCamera(58, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.z = 12;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);
    const g = new THREE.Group();
    scene.add(g);
    group.current = g;

    const dustTile = () => {
      const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      const h = Math.tan(THREE.MathUtils.degToRad(29)) * 28 * 2 * 1.35;
      return { w: h * aspect, h };
    };
    const dustGeo = new THREE.BufferGeometry();
    {
      const t = dustTile(), n = 380, pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (hash01(i * 1.7 + 0.3) - 0.5) * t.w;
        pos[i * 3 + 1] = (hash01(i * 2.9 + 0.7) - 0.5) * t.h;
        pos[i * 3 + 2] = -5 - hash01(i * 4.3 + 0.1) * 11;
        size[i] = 1 + hash01(i * 5.9 + 0.5) * 2.4;
        seed[i] = hash01(i * 7.1 + 0.9);
      }
      dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      dustGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    }
    const dustMat = new THREE.ShaderMaterial({
      uniforms: { uPan: { value: new THREE.Vector2() }, uTile: { value: new THREE.Vector2(dustTile().w, dustTile().h) }, uTime: { value: 0 } },
      vertexShader: dustVertex, fragmentShader: dustFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(dustGeo, dustMat));

    const streaks = Array.from({ length: 3 }, () => {
      const material = new THREE.ShaderMaterial({ uniforms: { uLife: { value: 0 } }, vertexShader: planeVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.05), material);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, material, velocity: new THREE.Vector2(), startedAt: 0, duration: 1, active: false };
    });
    let nextStreak = 2.5;
    const launch = (now: number) => {
      const s = streaks.find((x) => !x.active);
      if (!s) return;
      const z = -8 - Math.random() * 6, h = Math.tan(THREE.MathUtils.degToRad(29)) * (12 - z) * 2, w = h * (el.clientWidth / Math.max(el.clientHeight, 1));
      const angle = (-Math.PI / 6) * (0.7 + Math.random() * 0.9), dir = Math.random() < 0.5 ? 1 : -1, speed = 10 + Math.random() * 8;
      s.velocity.set(Math.cos(angle) * speed * dir, Math.sin(angle) * speed);
      s.mesh.position.set((Math.random() - 0.5) * w * 0.8 - s.velocity.x * 0.6, (Math.random() * 0.5 + 0.1) * h * 0.5, z);
      s.mesh.rotation.z = Math.atan2(s.velocity.y, s.velocity.x);
      s.duration = 1.1 + Math.random() * 0.8; s.startedAt = now; s.active = true; s.mesh.visible = true;
    };

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(2, 2), drift = { x: 0, y: 0 };
    let dragging = false, lastX = 0, lastY = 0, travel = 0;
    const unit = () => (2 * Math.tan(THREE.MathUtils.degToRad(29)) * 12) / Math.max(el.clientHeight, 1);
    const down = (e: PointerEvent) => { dragging = true; travel = 0; lastX = e.clientX; lastY = e.clientY; drift.x = 0; drift.y = 0; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      setPointer({ x: e.clientX - r.left, y: e.clientY - r.top });
      if (dragging) {
        const k = unit(), dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY; travel += Math.abs(dx) + Math.abs(dy);
        pan.current.x += dx * k; pan.current.y -= dy * k; drift.x = dx * k; drift.y = -dy * k;
      }
    };
    const up = () => { dragging = false; };
    const leave = () => { mouse.set(2, 2); dragging = false; };
    const click = (e: MouseEvent) => {
      if (travel >= 6) return;
      const r = el.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(g.children)[0]?.object;
      const entry = entries.current.find((x) => x.mesh === hit);
      if (entry?.word) word.current(entry.word);
      else if (entry?.doodle) select.current(entry.doodle);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const k = unit(); pan.current.x -= e.deltaX * k; pan.current.y += e.deltaY * k; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("click", click);
    el.addEventListener("wheel", wheel, { passive: false });
    el.style.touchAction = "none";

    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      const t = dustTile();
      dustMat.uniforms.uTile.value.set(t.w, t.h);
    });
    resize.observe(el);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let frame = 0, last = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = clock.getElapsedTime(), dt = Math.min(now - last, 0.1);
      last = now;
      const t = still ? 0 : now, list = entries.current;
      ray.setFromCamera(mouse, camera);
      const hitObj = ray.intersectObjects(g.children)[0]?.object ?? null;
      const hit = list.find((x) => x.mesh === hitObj) ?? null;
      if (hit !== hovered.current) {
        hovered.current = hit;
        setLabel(hit ? { name: hit.word?.label ?? hit.doodle?.name ?? "", tag: hit.word ? hit.word.tag : hit.doodle?.tag ?? null } : null);
      }
      el.style.cursor = hit ? "pointer" : dragging ? "grabbing" : "grab";
      if (!dragging) { pan.current.x += drift.x; pan.current.y += drift.y; drift.x *= 0.94; drift.y *= 0.94; }
      const T = tile.current;
      for (const x of list) {
        const y = x.baseY + Math.sin(t * x.bobSpeed + x.phase) * 0.25;
        if (T.w > 0) { x.mesh.position.x = wrap(x.baseX + pan.current.x, T.w); x.mesh.position.y = wrap(y + pan.current.y, T.h); }
        else x.mesh.position.y = y;
        if (!still) x.mesh.rotation.z += x.spinSpeed * 0.004;
        const grow = x.word ? 1.12 : 1.5;
        x.targetScale = x === hit ? x.baseScale * grow : x.baseScale;
        x.mesh.scale.setScalar(x.mesh.scale.x + (x.targetScale - x.mesh.scale.x) * 0.15);
        const u = x.mesh.material.uniforms;
        u.uTime.value = t;
        u.uHover.value += (Number(x === hit) - u.uHover.value) * 0.12;
      }
      dustMat.uniforms.uPan.value.set(pan.current.x, pan.current.y);
      dustMat.uniforms.uTime.value = t;
      if (!still) {
        if (now >= nextStreak) { launch(now); nextStreak = now + 4 + Math.random() * 9; }
        for (const s of streaks) {
          if (!s.active) continue;
          const life = (now - s.startedAt) / s.duration;
          if (life >= 1) { s.active = false; s.mesh.visible = false; continue; }
          s.mesh.position.x += s.velocity.x * dt; s.mesh.position.y += s.velocity.y * dt;
          s.material.uniforms.uLife.value = life;
        }
      }
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave); el.removeEventListener("click", click); el.removeEventListener("wheel", wheel);
      g.children.forEach((m) => { const mesh = m as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
      dustGeo.dispose(); dustMat.dispose(); streaks.forEach((s) => { s.mesh.geometry.dispose(); s.material.dispose(); });
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  // Lay the doodles out on a jittered grid one tile wide, then the words at their anchors.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    let stale = false;
    (async () => {
      const textures = await Promise.all(doodles.map((d) => doodleTexture(d.src)));
      await document.fonts.load(WORD_FONT).catch(() => undefined);
      if (stale) return;
      g.children.forEach((m) => { const mesh = m as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
      g.clear();
      const el = host.current, aspect = el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1.6, n = doodles.length;
      const tan = Math.tan(THREE.MathUtils.degToRad(29)), H = tan * 16 * 2 * 1.3, W = tan * 16 * aspect * 2 * 1.3;
      tile.current = { w: W, h: H };
      const cols = Math.max(1, Math.round(Math.sqrt((W / H) * n))), rows = Math.max(1, Math.ceil(n / cols));
      const order = doodles.map((d, i) => ({ d, tex: textures[i], key: hash01(i * 9.17 + 1) })).sort((a, b) => a.key - b.key);
      const list: Entry[] = [];
      order.forEach(({ d, tex }, i) => {
        if (!tex) return;
        const k = i + 1, mat = chromeMaterial(tex, hash01(k * 8.9) * 10), size = (0.55 + hash01(k * 3.7) * 0.7) * (d.scale ?? 1);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        const c = i % cols, r = Math.floor(i / cols);
        const x = ((c + 0.5) / cols - 0.5) * W + (hash01(k) - 0.5) * 0.8 * (W / cols);
        const y = ((r + 0.5) / rows - 0.5) * H + (hash01(k * 1.3) - 0.5) * 0.8 * (H / rows);
        mesh.position.set(x, y, (hash01(k * 2.1) - 0.5) * 7 - 0.5);
        mesh.rotation.z = (hash01(k * 4.2) - 0.5) * 0.7;
        mesh.name = d.key;
        g.add(mesh);
        list.push({ mesh, doodle: d, word: null, baseX: x, baseY: y, phase: hash01(k * 5.5) * Math.PI * 2, bobSpeed: 0.25 + hash01(k * 6.1) * 0.5, spinSpeed: (hash01(k * 7.3) - 0.5) * 0.3, targetScale: 1, baseScale: 1 });
      });
      words.forEach((w, i) => {
        const tex = wordTexture(w.label);
        if (!tex) return;
        const k = (i + 1) * 41.7, mat = chromeMaterial(tex.texture, hash01(k) * 10);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.scale, w.scale * tex.aspect), mat);
        const [fx, fy] = WORD_ANCHORS[i % WORD_ANCHORS.length], x = fx * W, y = fy * H;
        mesh.position.set(x, y, 1.2);
        mesh.name = `word:${w.label}`;
        g.add(mesh);
        list.push({ mesh, doodle: null, word: w, baseX: x, baseY: y, phase: hash01(k * 3.1) * Math.PI * 2, bobSpeed: 0.2 + hash01(k * 4.3) * 0.3, spinSpeed: 0, targetScale: 1, baseScale: 1 });
      });
      entries.current = list;
      host.current?.setAttribute("data-ready", String(list.length));
    })();
    return () => { stale = true; };
  }, [doodles, words]);

  return (
    <div ref={host} className="absolute inset-0" data-testid="field">
      {hint && <span className="pointer-events-none absolute bottom-5 right-6 z-10 font-sans text-[13px] text-sand/70">{hint}</span>}
      {label && (
        <span className="pointer-events-none absolute z-10 flex -translate-x-1/2 items-baseline gap-2 bg-sand px-2.5 py-1 font-sans text-[13px] font-medium whitespace-nowrap text-ink" style={{ left: pointer.x, top: pointer.y + 24 }} data-testid="hover-pill">
          {label.name}
          {label.tag && <span className="text-muted">{label.tag}</span>}
        </span>
      )}
    </div>
  );
}
