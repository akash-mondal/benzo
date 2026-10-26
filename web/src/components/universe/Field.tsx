// The doodle field, after svgdoodles.com: one fixed screen of chrome doodles. Every doodle is a plane with the
// chrome band shader; the layout tiles and wraps as you pan, dust twinkles in depth, a streak crosses now and then.
// Hovering shows a sand pill with the name. A click (not a drag) on a door dives the camera into it and goes to its page;
// a click on a round selects it. Ornaments are background texture: deep in the fog, never hovered.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { chromeMaterial, doodleTexture, dustFragment, dustVertex, hash01, planeVertex, SAND_HIGH, SAND_LOW, streakFragment, WORD_FONT, wordTexture } from "./shaders";

// Ornaments are drawn in a dull sand, so the doodles that do something are the bright ones.
const DIM_LOW = SAND_LOW.clone().multiplyScalar(0.3), DIM_HIGH = SAND_HIGH.clone().multiplyScalar(0.42);
import type { FieldDoodle } from "../../lib/types";

type Entry = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  doodle: FieldDoodle; size: number;
  baseX: number; baseY: number; phase: number; bobSpeed: number; spinSpeed: number; targetScale: number; baseScale: number;
};

const go = (href: string) => { location.href = href; };

export default function Field({ doodles, center, onSelect, onNavigate = go, arrive = false, ground = "#141a10" }: {
  doodles: FieldDoodle[];
  center?: string; // a word pinned to the middle of the screen: the sky moves under it
  onSelect: (d: FieldDoodle) => void;
  onNavigate?: (href: string) => void;
  arrive?: boolean; // came through a door: the camera eases back out of it
  ground?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const entries = useRef<Entry[]>([]);
  const group = useRef<THREE.Group | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const navigate = useRef(onNavigate); navigate.current = onNavigate;
  const targets = useRef<THREE.Object3D[]>([]);
  const hovered = useRef<Entry | null>(null);
  const pan = useRef({ x: 0, y: 0 });
  const tile = useRef({ w: 0, h: 0 });
  const [label, setLabel] = useState<{ name: string; tag: string | null } | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const names = useRef(new Map<string, HTMLSpanElement>());
  const centerMesh = useRef<THREE.Mesh | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const scene = sceneRef;

  // Scene, camera, dust, streaks and the input loop: built once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ground);
    scene.fog = new THREE.Fog(ground, 10, 26);
    const camera = new THREE.PerspectiveCamera(58, el.clientWidth / el.clientHeight, 0.1, 100);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const HOME_Z = 12;
    camera.position.z = arrive && !still ? 5 : HOME_Z;
    // A dive: the camera flies into a door, then the page changes.
    let dive: { x: number; y: number; z: number; at: number; href: string } | null = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);
    const g = new THREE.Group();
    scene.add(g);
    sceneRef.current = scene;
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

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(2, 2);
    let dragging = false, lastX = 0, lastY = 0, travel = 0;
    // One fixed screen: no panning. The pointer only hovers and clicks.
    const down = (e: PointerEvent) => { dragging = true; travel = 0; lastX = e.clientX; lastY = e.clientY; };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      setPointer({ x: e.clientX - r.left, y: e.clientY - r.top });
      if (dragging) { travel += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
    };
    const up = () => { dragging = false; };
    const leave = () => { mouse.set(2, 2); dragging = false; };
    const click = (e: MouseEvent) => {
      if (travel >= 6) return;
      const r = el.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(targets.current)[0]?.object;
      const entry = entries.current.find((x) => x.mesh === hit);
      if (!entry || dive) return;
      const href = entry.doodle.href;
      if (!href) return select.current(entry.doodle);
      if (still) return navigate.current(href);
      dive = { x: entry.mesh.position.x, y: entry.mesh.position.y, z: entry.mesh.position.z, at: clock.getElapsedTime(), href };
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("click", click);
    el.style.touchAction = "none";

    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      const t = dustTile();
      dustMat.uniforms.uTile.value.set(t.w, t.h);
    });
    resize.observe(el);

    const clock = new THREE.Clock();
    let frame = 0, last = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = clock.getElapsedTime(), dt = Math.min(now - last, 0.1);
      last = now;
      const t = still ? 0 : now, list = entries.current;
      ray.setFromCamera(mouse, camera);
      const hitObj = dive ? null : ray.intersectObjects(targets.current)[0]?.object ?? null;
      const hit = list.find((x) => x.mesh === hitObj) ?? null;
      if (hit !== hovered.current) {
        hovered.current = hit;
        // A named doodle already shows its name under it: its pill carries only the detail (count, state), if any.
        const named = hit && hit.doodle.place && (hit.doodle.href || hit.doodle.auction);
        setLabel(hit && (!named || hit.doodle.tag) ? { name: named ? "" : hit.doodle.name, tag: hit.doodle.tag } : null);
      }
      if (dive) {
        const k = Math.min((now - dive.at) / 0.55, 1), e = k * k * (3 - 2 * k);
        camera.position.x += (dive.x - camera.position.x) * e * 0.35;
        camera.position.y += (dive.y - camera.position.y) * e * 0.35;
        camera.position.z += (dive.z + 1.2 - camera.position.z) * e * 0.3;
        if (k >= 1) { const href = dive.href; dive = null; navigate.current(href); }
      } else if (camera.position.z !== HOME_Z) {
        camera.position.z += (HOME_Z - camera.position.z) * Math.min(dt * 4, 1);
        if (Math.abs(HOME_Z - camera.position.z) < 0.01) camera.position.z = HOME_Z;
      }
      el.style.cursor = hit ? "pointer" : "default";
      for (const x of list) {
        // Nothing drifts: every doodle stays where it was laid out (only the dust and the odd streak move).
        const y = x.baseY;
        x.mesh.position.x = x.baseX;
        x.mesh.position.y = y;
        x.targetScale = x === hit ? x.baseScale * 1.5 : x.baseScale;
        x.mesh.scale.setScalar(x.mesh.scale.x + (x.targetScale - x.mesh.scale.x) * 0.15);
        const u = x.mesh.material.uniforms;
        u.uTime.value = t;
        u.uHover.value += (Number(x === hit) - u.uHover.value) * 0.12;
      }
      // The names under the placed doodles follow their doodle on screen.
      const W2 = el.clientWidth / 2, H2 = el.clientHeight / 2, v = new THREE.Vector3();
      for (const x of list) {
        const span = names.current.get(x.doodle.key);
        if (!span) continue;
        if (!x.mesh.visible) { span.style.opacity = "0"; continue; }
        v.set(x.mesh.position.x, x.mesh.position.y - (x.size * x.mesh.scale.x) / 2 - 0.08, x.mesh.position.z).project(camera);
        const sx = v.x * W2 + W2, sy = -v.y * H2 + H2, out = v.z > 1 || sx < -80 || sx > el.clientWidth + 80 || sy < -40 || sy > el.clientHeight + 40;
        span.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translateX(-50%)`;
        span.style.opacity = out ? "0" : "1";
      }
      // The centre word: one, at the canvas origin; it moves with the canvas, never repeats.
      if (centerMesh.current) (centerMesh.current.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
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
      el.removeEventListener("pointerleave", leave); el.removeEventListener("click", click);
      g.children.forEach((m) => { const mesh = m as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
      dustGeo.dispose(); dustMat.dispose(); streaks.forEach((s) => { s.mesh.geometry.dispose(); s.material.dispose(); });
      renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  // Lay the doodles out on a jittered grid one tile wide; the ambient ornaments get a grid of their own, deep in the fog.
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    let stale = false;
    (async () => {
      const textures = await Promise.all(doodles.map((d) => doodleTexture(d.src)));
      if (stale) return;
      g.children.forEach((m) => { const mesh = m as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
      g.clear();
      const el = host.current, aspect = el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1.6;
      const tan = Math.tan(THREE.MathUtils.degToRad(29)), H = tan * 19.5 * 2, W = H * aspect; // the screen at the ornaments' depth
      tile.current = { w: W, h: H };
      const list: Entry[] = [];
      const lay = (items: { d: FieldDoodle; tex: THREE.Texture | null }[], ambient: boolean, salt: number) => {
        const n = items.length, cols = Math.max(1, Math.round(Math.sqrt((W / H) * n))), rows = Math.max(1, Math.ceil(n / cols));
        items.map((it, i) => ({ ...it, key: hash01(i * 9.17 + salt) })).sort((a, b) => a.key - b.key).forEach(({ d, tex }, i) => {
          if (!tex) return;
          const k = i + 1 + salt, mat = ambient ? chromeMaterial(tex, hash01(k * 8.9) * 10, DIM_LOW, DIM_HIGH) : chromeMaterial(tex, hash01(k * 8.9) * 10);
          const size = (ambient ? 0.45 + hash01(k * 3.7) * 0.45 : 0.55 + hash01(k * 3.7) * 0.7) * (d.scale ?? 1);
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
          const c = i % cols, r = Math.floor(i / cols);
          const x = ((c + 0.5) / cols - 0.5) * W + (hash01(k) - 0.5) * 0.8 * (W / cols);
          const y = ((r + 0.5) / rows - 0.5) * H + (hash01(k * 1.3) - 0.5) * 0.8 * (H / rows);
          // Doors and rounds float near; the bigger the door, the nearer. Ornaments sit far back, where the fog dims them.
          const z = ambient ? -6 - hash01(k * 2.1) * 3 : (hash01(k * 2.1) - 0.5) * 5 - 0.5 + ((d.scale ?? 1) - 1) * 1.5;
          mesh.position.set(x, y, z);
          mesh.rotation.z = (hash01(k * 4.2) - 0.5) * 0.7;
          mesh.name = d.key;
          g.add(mesh);
          list.push({ mesh, doodle: d, size, baseX: x, baseY: y, phase: hash01(k * 5.5) * Math.PI * 2, bobSpeed: 0.25 + hash01(k * 6.1) * 0.5, spinSpeed: (hash01(k * 7.3) - 0.5) * 0.3, targetScale: 1, baseScale: 1 });
        });
      };
      const all = doodles.map((d, i) => ({ d, tex: textures[i] }));
      // The first screen at z 0 (the camera's home distance is 12): placed doodles sit inside it, named below.
      const vh = 2 * tan * 12, vw = vh * aspect;
      all.filter((x) => x.d.place && x.tex).forEach(({ d, tex }, i) => {
        const size = 1.05 * (d.scale ?? 1), mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), chromeMaterial(tex!, hash01(i * 3.3 + 7) * 10));
        const x = d.place![0] * vw, y = d.place![1] * vh;
        mesh.position.set(x, y, 0); mesh.rotation.z = (hash01(i * 5.1 + 2) - 0.5) * 0.35; mesh.name = d.key; g.add(mesh);
        list.push({ mesh, doodle: d, size, baseX: x, baseY: y, phase: hash01(i * 2.7) * Math.PI * 2, bobSpeed: 0.3 + hash01(i * 4.9) * 0.3, spinSpeed: 0, targetScale: 1, baseScale: 1 });
      });
      // Everything else that can be clicked (a market's rounds): into free cells of the one screen, clear of the
      // centre word and of the placed doodles.
      const cw = Math.min(vw * 0.42, 5.2), ch = cw * 0.3, placedXY = list.map((e) => [e.baseX, e.baseY]);
      const free: [number, number][] = [];
      for (let y = -0.39 * vh; y <= 0.44 * vh; y += 1.25) for (let x = -0.46 * vw; x <= 0.46 * vw; x += 1.25) {
        const k = x * 3.1 + y * 7.3, jx = x + (hash01(k) - 0.5) * 0.5, jy = y + (hash01(k + 1) - 0.5) * 0.5;
        if (Math.abs(jx) < cw / 2 + 0.5 && Math.abs(jy) < ch / 2 + 0.5) continue;
        if (placedXY.some(([px, py]) => Math.hypot(px - jx, py - jy) < 1.55)) continue;
        free.push([jx, jy]);
      }
      free.sort((a, b) => hash01(a[0] * 13.1 + a[1] * 7.7) - hash01(b[0] * 13.1 + b[1] * 7.7));
      all.filter((x) => !x.d.ambient && !x.d.place && x.tex).forEach(({ d, tex }, i) => {
        if (i >= free.length) return;
        const [x, y] = free[i], k = i + 41, size = (0.6 + hash01(k * 3.7) * 0.35) * (d.scale ?? 1);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), chromeMaterial(tex!, hash01(k * 8.9) * 10));
        mesh.position.set(x, y, (hash01(k * 2.1) - 0.5) * 1.2); mesh.rotation.z = (hash01(k * 4.2) - 0.5) * 0.6; mesh.name = d.key; g.add(mesh);
        list.push({ mesh, doodle: d, size, baseX: x, baseY: y, phase: hash01(k * 5.5) * Math.PI * 2, bobSpeed: 0.25 + hash01(k * 6.1) * 0.4, spinSpeed: (hash01(k * 7.3) - 0.5) * 0.3, targetScale: 1, baseScale: 1 });
      });
      lay(all.filter((x) => x.d.ambient), true, 517);
      if (centerMesh.current) { scene.current?.remove(centerMesh.current); centerMesh.current.geometry.dispose(); (centerMesh.current.material as THREE.Material).dispose(); centerMesh.current = null; }
      if (center) {
        await document.fonts.load(WORD_FONT).catch(() => undefined);
        const w = wordTexture(center);
        if (w && !stale) {
          const width = Math.min(vw * 0.42, 5.2), mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * w.aspect), chromeMaterial(w.texture, 3.1));
          mesh.position.set(0, 0, 2.5); mesh.name = "center"; scene.current?.add(mesh); centerMesh.current = mesh;
        }
      }
      entries.current = list;
      targets.current = list.filter((x) => !x.doodle.ambient).map((x) => x.mesh);
      host.current?.setAttribute("data-ready", String(list.length));
    })();
    return () => { stale = true; };
  }, [doodles, center]);

  return (
    <div ref={host} className="absolute inset-0" data-testid="field">
      {doodles.filter((d) => d.place && (d.href || d.auction)).map((d) => (
        <span key={d.key} ref={(el) => { if (el) names.current.set(d.key, el); else names.current.delete(d.key); }} data-door-label={d.name}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap font-sans text-[13px] text-sand/80" style={{ opacity: 0 }}>{d.name}</span>
      ))}
      {label && (
        <span className="pointer-events-none absolute z-10 flex -translate-x-1/2 items-baseline gap-2 bg-sand px-2.5 py-1 font-sans text-[13px] font-medium whitespace-nowrap text-ink" style={{ left: pointer.x, top: pointer.y + 24 }} data-testid="hover-pill">
          {label.name}
          {label.tag && <span className={label.name ? "text-muted" : ""}>{label.tag}</span>}
        </span>
      )}
    </div>
  );
}
