// The field's shaders, after svgdoodles.com: a chrome band shader for every doodle (it reads only the texture's alpha),
// twinkling dust that wraps with the pan, and the shooting-star streak.
import * as THREE from "three";

export const planeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const chromeFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uSeed;
  uniform float uHover;
  uniform float uFade;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  varying vec2 vUv;

  float bands(vec2 p, float t, float seed, float shift) {
    float axis = p.x * 0.8 + p.y * 0.6;
    float r = length(p);
    float wobble =
      sin(p.y * 9.0 + t * 1.1 + seed) * 0.09 +
      sin(p.x * 7.0 - t * 0.8 + seed * 2.0) * 0.09;
    float coord = axis + r * 0.55 + wobble + shift;
    float wave = sin(coord * 22.0 - t * 1.4 + seed * 6.2831);
    return pow(wave * 0.5 + 0.5, 1.4);
  }

  void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.01) discard;
    vec2 p = vUv - 0.5;
    float g = bands(p, uTime, uSeed, 0.0);
    float rC = bands(p, uTime, uSeed, 0.012);
    float bC = bands(p, uTime, uSeed, -0.012);
    // Sand chrome: bands run from a dark sand to paper white, each channel offset a little (the sheen).
    vec3 chrome = mix(uLow, uHigh, vec3(rC, g, bC));
    chrome += uHover * 0.12;
    gl_FragColor = vec4(chrome, a * 0.96 * uFade);
  }
`;

// The two ends of the chrome bands: a dark sand and paper white (the page's own sand, lit).
export const SAND_LOW = new THREE.Vector3(0.62, 0.58, 0.47), SAND_HIGH = new THREE.Vector3(0.99, 0.97, 0.91);
export const chromeMaterial = (map: THREE.Texture, seed: number, low = SAND_LOW, high = SAND_HIGH) =>
  new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uTime: { value: 0 }, uSeed: { value: seed }, uHover: { value: 0 }, uFade: { value: 1 }, uLow: { value: low }, uHigh: { value: high } },
    vertexShader: planeVertex,
    fragmentShader: chromeFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

export const dustVertex = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform vec2 uPan;
  uniform vec2 uTile;
  uniform float uTime;
  varying float vAlpha;

  vec2 wrap2(vec2 v, vec2 size) {
    return mod(v + size * 0.5, size) - size * 0.5;
  }

  void main() {
    vec3 pos = position;
    pos.xy = wrap2(pos.xy + uPan, uTile);
    pos.y += sin(uTime * 0.25 + aSeed * 6.2831) * 0.5;
    pos.x += cos(uTime * 0.18 + aSeed * 12.566) * 0.35;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (190.0 / -mv.z);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed) + aSeed * 40.0);
    float depthFade = clamp((34.0 + pos.z) / 34.0, 0.2, 1.0);
    vAlpha = twinkle * depthFade;
    gl_Position = projectionMatrix * mv;
  }
`;

export const dustFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vec3(0.93, 0.89, 0.78), a * vAlpha * 0.3);
  }
`;

export const streakFragment = /* glsl */ `
  uniform float uLife;
  varying vec2 vUv;
  void main() {
    float tail = pow(vUv.x, 2.5);
    float core = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    float flight = sin(3.14159 * uLife);
    gl_FragColor = vec4(vec3(0.98, 0.95, 0.86), tail * core * flight * 0.8);
  }
`;

// Deterministic hash in [0, 1), the same one the reference uses for its layout.
export const hash01 = (x: number) => {
  const t = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return t - Math.floor(t);
};

// Wrap a coordinate into a tile of the given size, centred on 0.
export const wrap = (v: number, size: number) => (((v + size / 2) % size) + size) % size - size / 2;

// An SVG drawn into a 256² canvas and flattened to white, so the shader reads only its alpha.
const textureCache = new Map<string, Promise<THREE.Texture | null>>();
// soft: the background sea is drawn small and scaled up, which blurs it the same way in every browser (canvas
// filters are not everywhere), so the doodles you can click stay the sharp ones.
export function doodleTexture(url: string, size = 256, soft = false): Promise<THREE.Texture | null> {
  const key = `${url}@${size}${soft ? "~" : ""}`;
  if (!textureCache.has(key))
    textureCache.set(key, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        const w = img.width || 64, h = img.height || 64, k = Math.min(size / w, size / h);
        if (soft) {
          const t = 22, small = document.createElement("canvas"); small.width = t; small.height = t;
          const sx = small.getContext("2d")!, q = Math.min(t / w, t / h) * 0.86;
          sx.drawImage(img, (t - w * q) / 2, (t - h * q) / 2, w * q, h * q);
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.drawImage(small, 0, 0, size, size);
        } else ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
        const t = new THREE.CanvasTexture(c);
        t.anisotropy = 8;
        resolve(t);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  return textureCache.get(key)!;
}

// A word set in Georgia and turned into a texture, for the chrome words that float in the field.
// Set in Source Serif 4 italic (loaded before drawing: see Field), so the words read as Benzo's, not a stock Georgia.
export const WORD_FONT = "italic 500 160px 'Source Serif 4 Variable', Georgia, serif";
export function wordTexture(text: string): { texture: THREE.Texture; aspect: number } | null {
  const font = WORD_FONT;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const c = document.createElement("canvas");
  c.width = Math.ceil(probe.measureText(text).width) + 48;
  c.height = 224;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 24, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return { texture: t, aspect: c.height / c.width };
}
