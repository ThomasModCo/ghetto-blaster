// Procedural canvas textures so the game ships with zero image assets.
import * as THREE from 'three';
import { RNG } from './rng.js';
import { paintFacade, paintBrick, paintConcrete, paintPlaster, paintCorrugated, paintMetal, paintTile, paintAsphalt, paintSidewalk, paintDirt, paintGrass, paintCobble, normalFromHeight } from './minipaint.js';

const cache = new Map();

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function finish(c, repeat = [1, 1], opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso || 4;
  t.needsUpdate = true;
  return t;
}
function noise(ctx, w, h, rng, amount = 0.08, count = 4000) {
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, amount);
    ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(rng.float(0, w), rng.float(0, h), rng.float(1, 4), rng.float(1, 4));
  }
}

// Random seeds are quantised to a few variants per texture type so that props share materials and batch into few draw calls.
const SEED_VARIANTS = { brick: 4, concrete: 4, plaster: 4, asphalt: 2, sidewalk: 2, dirt: 2, grass: 2, cobble: 2, tile: 3, metal: 3, corrugated: 4, facade: 4, graffiti: 3, cloth: 3, water: 1 };
// Texture detail follows the quality setting: low halves the miniature wall textures (memory on phones).
let DETAIL = 'high';
export function setTextureDetail(q) { DETAIL = q; }
const normalCache = new Map(), normalOfMap = new WeakMap();
/** The shared normal map that goes with a miniature colour texture (kept off userData: three.js JSON-copies userData on clone). */
export function normalFor(map) { return normalOfMap.get(map) || null; }
// colour-only params: they never change a texture's relief, so buildings that differ only in paint share a normal map
const PAINT_KEYS = new Set(['color', 'wall', 'winColor', 'trim', 'lit', 'mortar', 'line', 'rust', 'frame']);
const MINI = { facade: [paintFacade, 512, 2.5], brick: [paintBrick, 256, 2.5], concrete: [paintConcrete, 256, 2], plaster: [paintPlaster, 256, 2], corrugated: [paintCorrugated, 256, 3], metal: [paintMetal, 128, 2], tile: [paintTile, 256, 2],
  asphalt: [paintAsphalt, 256, 1.6], sidewalk: [paintSidewalk, 256, 2], dirt: [paintDirt, 256, 1.6], grass: [paintGrass, 256, 1.2], cobble: [paintCobble, 256, 2.5] };
export function tex(name, params = {}) {
  if (params.seed !== undefined && SEED_VARIANTS[name]) params = { ...params, seed: ((Math.abs(Math.floor(params.seed)) - 1) % SEED_VARIANTS[name]) + 1 };
  const key = name + JSON.stringify(params) + (MINI[name] ? DETAIL : '');
  if (cache.has(key)) return cache.get(key);
  let t;
  if (MINI[name]) {
    const [paint, size, strength] = MINI[name], S = DETAIL === 'low' ? size / 2 : size;
    const r = paint(params, S); t = finish(r.c, r.repeat);
    const lk = name + JSON.stringify(Object.fromEntries(Object.entries(params).filter(([k]) => !PAINT_KEYS.has(k)))) + DETAIL;
    let n = normalCache.get(lk);
    if (!n) { n = finish(normalFromHeight(r.hc, strength), r.repeat); n.colorSpace = THREE.NoColorSpace; n.name = name + ':normal'; normalCache.set(lk, n); }
    normalOfMap.set(t, n);
  } else t = GEN[name](params);
  t.name = name;
  cache.set(key, t);
  return t;
}

const GEN = {
  graffiti({ seed = 13, base = '#777', text = 'GB' } = {}) {
    // toy reskin: a die-cut vinyl sticker of a tag: crisp colour bursts, chunky letters, thick white cut line
    const w = 256, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.clearRect(0, 0, w, h);
    const colors = ['#ff2d95', '#00c8e0', '#ffd60a', '#7cd320', '#ff6a00', '#a066ff'];
    const fs = rng.int(56, 78); ctx.font = `bold ${fs}px Impact, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const burst = (col, cx, cy, rx, ry) => { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, k = i % 2 ? 0.78 : 1; ctx.lineTo(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k); } ctx.closePath(); ctx.fill(); };
    // white die-cut backing first (covers everything that follows, plus a margin)
    ctx.save(); ctx.fillStyle = '#fbf8f0'; ctx.strokeStyle = '#fbf8f0'; ctx.lineJoin = 'round'; ctx.lineWidth = 22;
    burst('#fbf8f0', w / 2 - 20, h / 2, 70, 40); ctx.strokeText(text, w / 2, h / 2); ctx.restore();
    burst(colors[rng.int(0, colors.length - 1)], w / 2 - 20, h / 2, 60, 32);
    ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = '#141414'; ctx.strokeText(text, w / 2, h / 2);
    // two-tone letter fill (hard split across the middle) with a glossy top edge
    const top = colors[rng.int(0, colors.length - 1)], bot = colors[rng.int(0, colors.length - 1)], lg = ctx.createLinearGradient(0, h / 2 - fs / 2, 0, h / 2 + fs / 2);
    lg.addColorStop(0, top); lg.addColorStop(0.52, top); lg.addColorStop(0.52, bot); lg.addColorStop(1, bot);
    ctx.fillStyle = lg; ctx.fillText(text, w / 2, h / 2);
    const t = finish(c, [1, 1]); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  sign({ seed = 14, text = 'LIQUOR', bg = '#b3121b', fg = '#fff', w = 256, h = 64 } = {}) {
    // toy reskin: a printed sticker on the model, white die-cut border, faint gloss, one corner peeling back
    const c = canvas(w, h), ctx = c.getContext('2d'), b = Math.max(3, Math.round(h * 0.07)), r = Math.round(h * 0.16);
    ctx.fillStyle = '#2e2d2b'; ctx.fillRect(0, 0, w, h); // the wall behind, seen under the peel
    ctx.fillStyle = '#f6f3ea'; ctx.beginPath(); ctx.roundRect(1, 1, w - 2, h - 2, r); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(1 + b, 1 + b, w - 2 - b * 2, h - 2 - b * 2, Math.max(2, r - b)); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(1 + b, h - b - Math.round(h * 0.14), w - 2 - b * 2, Math.round(h * 0.14) - 1);
    ctx.font = `bold ${Math.floor(h * 0.56)}px Impact, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(text, w / 2 + 2, h / 2 + 1); ctx.fillStyle = fg; ctx.fillText(text, w / 2, h / 2 - 1);
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(1, 1, w - 2, h - 2, r); ctx.fill();
    // peeled top-right corner: wall shows through, the curled flap shows the sticker's pale back with a soft shadow
    const p = Math.round(h * 0.42);
    ctx.fillStyle = '#2e2d2b'; ctx.beginPath(); ctx.moveTo(w - p, 0); ctx.lineTo(w, 0); ctx.lineTo(w, p); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(w - p, 0); ctx.lineTo(w, p); ctx.lineTo(w - p * 0.7, p * 0.9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e4dfd2'; ctx.beginPath(); ctx.moveTo(w - p, 0); ctx.lineTo(w, p); ctx.lineTo(w - p * 0.82, p * 0.72); ctx.closePath(); ctx.fill();
    const t = finish(c, [1, 1]); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  neon({ seed = 15, text = 'OPEN', color = '#ff2d95', w = 256, h = 96 } = {}) {
    const c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.font = `bold ${Math.floor(h * 0.6)}px Impact, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.fillText(text, w / 2, h / 2);
    const t = finish(c, [1, 1]); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  roadMarks({ dashed = true } = {}) {
    const w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(240,220,120,0.85)';
    if (dashed) { for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 3, y, 6, 32); } else ctx.fillRect(w / 2 - 3, 0, 6, h);
    return finish(c, [1, 1]);
  },
  water({ seed = 16 } = {}) {
    const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = '#2f4f5a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(255,255,255,${rng.float(0.03, 0.12)})`; ctx.fillRect(rng.float(0, w), rng.float(0, h), rng.float(4, 20), 1); }
    return finish(c, [4, 4]);
  },
  cloth({ seed = 17, color = '#c0392b', stripe = '#f5f5f5' } = {}) {
    const w = 64, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe; for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 8, h);
    return finish(c, [2, 1]);
  },
  skin({ color = '#8d5a3b' } = {}) {
    const w = 16, h = 16, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    return finish(c, [1, 1]);
  },
  particle() {
    const w = 64, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  // ---- muzzle flash layers (256px, soft gradients + noise) ----
  flashCore() { // toy reskin: a cap-gun "pop" burst, a crisp spiky star instead of a realistic fireball
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(31);
    const star = (R, r, n, jitter) => { ctx.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rad = (i % 2 ? r : R) * (1 + rng.float(-jitter, jitter)); ctx.lineTo(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad); } ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = 'rgba(255,120,30,0.85)'; star(124, 64, 11, 0.12);
    ctx.fillStyle = 'rgba(255,196,70,1)'; star(98, 52, 11, 0.1);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 70); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,248,210,1)'); g.addColorStop(1, 'rgba(255,230,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 70, 0, 7); ctx.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  flashTongue() { // crisp flame petals (bright base at the bottom, pointed tips at the top)
    const w = 128, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(37);
    ctx.clearRect(0, 0, w, h);
    const petal = (cx, len, wid, cols) => { const g = ctx.createLinearGradient(0, h, 0, h - len); cols.forEach(([o, col]) => g.addColorStop(o, col)); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - wid / 2, h); ctx.bezierCurveTo(cx - wid / 2, h - len * 0.45, cx - wid * 0.12, h - len * 0.75, cx, h - len); ctx.bezierCurveTo(cx + wid * 0.12, h - len * 0.75, cx + wid / 2, h - len * 0.45, cx + wid / 2, h); ctx.fill(); };
    petal(64 + rng.float(-6, 6), h * 0.98, w * 0.7, [[0, 'rgba(255,140,40,0.9)'], [1, 'rgba(255,90,20,0.6)']]);
    petal(64 + rng.float(-4, 4), h * 0.78, w * 0.45, [[0, 'rgba(255,215,90,1)'], [1, 'rgba(255,170,60,0.8)']]);
    petal(64, h * 0.5, w * 0.24, [[0, 'rgba(255,255,240,1)'], [1, 'rgba(255,240,180,0.9)']]);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  flashRing() { // comic pop ring: a crisp thin ring with short motion dashes
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,225,150,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(128, 128, 100, 0, 7); ctx.stroke();
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124); ctx.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  smokePuff() { // paper-cap smoke: a small white cartoon cloud with a crisp rim and a soft shaded underside
    const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(41);
    ctx.clearRect(0, 0, w, h);
    const blobs = []; for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + rng.float(-0.3, 0.3), d = rng.float(14, 24); blobs.push([64 + Math.cos(a) * d, 66 + Math.sin(a) * d * 0.8, rng.float(16, 24)]); } blobs.push([64, 64, 28]);
    ctx.fillStyle = 'rgba(150,146,140,0.9)'; for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y + 2, r + 2, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(244,242,236,0.95)'; for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    const g = ctx.createLinearGradient(0, 30, 0, 100); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(120,116,110,0.35)'); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  muzzle() {
    const w = 64, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.translate(32, 32);
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillStyle = 'rgba(255,200,80,0.9)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(28, -4); ctx.lineTo(28, 4); ctx.fill(); }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20); g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = g; ctx.fillRect(-32, -32, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  // ---- toy reskin: diorama table ----
  wood({ color = '#7a4f2e', seed = 1 } = {}) {
    const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    const plank = 128;
    for (let x = 0; x < w; x += plank) {
      const col = new THREE.Color(color); col.offsetHSL(rng.float(-0.01, 0.01), rng.float(-0.04, 0.04), rng.float(-0.05, 0.05));
      ctx.fillStyle = col.getStyle(); ctx.fillRect(x, 0, plank, h);
      for (let i = 0; i < 46; i++) { // grain lines
        const gx = x + rng.float(2, plank - 2); ctx.strokeStyle = `rgba(40,20,8,${rng.float(0.05, 0.22)})`; ctx.lineWidth = rng.float(0.5, 2);
        ctx.beginPath(); ctx.moveTo(gx, 0); for (let y = 0; y <= h; y += 32) ctx.lineTo(gx + Math.sin(y * 0.02 + i) * rng.float(1, 4), y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,10,4,0.55)'; ctx.fillRect(x, 0, 2, h); // plank seam
    }
    noise(ctx, w, h, rng, 0.05, 2500);
    const t = finish(c, [1, 1]); t.anisotropy = 8; return t;
  },
  foam({ top = '#5d5a50', seed = 1 } = {}) { // cut edge of a diorama board: scenic top, plaster, layered pink foam
    const w = 256, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = top; ctx.fillRect(0, 0, w, 10);
    ctx.fillStyle = '#e9e3d6'; ctx.fillRect(0, 10, w, 16);
    const layers = ['#e8a8b4', '#e3a0ad', '#eab0bb', '#dc98a6'];
    for (let i = 0; i < 4; i++) { ctx.fillStyle = layers[i]; ctx.fillRect(0, 26 + i * 25, w, 25); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 26 + i * 25, w, 1); }
    noise(ctx, w, h, rng, 0.06, 1800);
    return finish(c, [1, 1]);
  },
};

export function skyGradient(top = '#2b3a5c', horizon = '#d99a62', bottom = '#1a1a1f') {
  const c = canvas(4, 256), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.55, horizon); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}

/**
 * Toy reskin: the "sky" is the real room the diorama table stands in, painted and heavily blurred into an
 * equirectangular panorama. Wall colour follows the map's fog colour so distant fog blends into the walls;
 * windows show the map's sky colour by day and city lights at night.
 */
const roomCache = new Map();
export function roomPanorama(env = {}) {
  const night = !!env.night, key = JSON.stringify([env.fogColor, env.skyHorizon, env.skyTop, night]);
  if (roomCache.has(key)) return roomCache.get(key);
  const W = 2048, H = 1024, c = canvas(W, H), ctx = c.getContext('2d'), rng = new RNG(4242);
  const fog = new THREE.Color(env.fogColor || '#b9bcc2');
  const wall = fog.clone().lerp(new THREE.Color(night ? '#2a2630' : '#d8c8b0'), 0.35);
  const ceil = wall.clone().multiplyScalar(night ? 0.55 : 0.85), floor = new THREE.Color(night ? '#1c1612' : '#4a3424');
  const horizonV = 0.5; // eye level ~ table top
  // ceiling -> wall -> floor
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ceil.getStyle()); g.addColorStop(0.2, ceil.clone().lerp(wall, 0.6).getStyle()); g.addColorStop(0.24, wall.getStyle());
  g.addColorStop(horizonV + 0.08, wall.clone().multiplyScalar(0.9).getStyle()); g.addColorStop(horizonV + 0.12, floor.getStyle()); g.addColorStop(1, floor.clone().multiplyScalar(0.6).getStyle());
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x * W, y * H, w * W, h * H); };
  const glow = (x, y, r, col, a) => { const gg = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W); gg.addColorStop(0, col.replace('A', a)); gg.addColorStop(1, col.replace('A', 0)); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); };
  // windows (two, on opposite walls) with curtains
  const sky = new THREE.Color(env.skyHorizon || '#cfd7de'), skyTop = new THREE.Color(env.skyTop || '#6c86a4');
  for (const wx of [0.12, 0.62]) {
    const wg = ctx.createLinearGradient(0, 0.26 * H, 0, 0.5 * H);
    if (night) { wg.addColorStop(0, '#0b1024'); wg.addColorStop(1, '#1d1838'); } else { wg.addColorStop(0, skyTop.getStyle()); wg.addColorStop(1, sky.clone().lerp(new THREE.Color('#ffffff'), 0.35).getStyle()); }
    ctx.fillStyle = wg; ctx.fillRect(wx * W, 0.26 * H, 0.13 * W, 0.24 * H);
    if (night) for (let i = 0; i < 70; i++) rect(wx + rng.float(0, 0.13), rng.float(0.38, 0.5), 0.0015, 0.004, `rgba(255,${rng.int(170, 230)},120,0.9)`);
    else glow(wx + 0.065, 0.38, 0.12, 'rgba(255,250,235,A)', 0.55);
    rect(wx + 0.063, 0.26, 0.004, 0.24, 'rgba(40,36,32,0.8)'); rect(wx, 0.375, 0.13, 0.005, 'rgba(40,36,32,0.8)');
    rect(wx - 0.025, 0.24, 0.028, 0.3, wall.clone().lerp(new THREE.Color('#7a3a2a'), 0.55).getStyle()); rect(wx + 0.127, 0.24, 0.028, 0.3, wall.clone().lerp(new THREE.Color('#7a3a2a'), 0.55).getStyle());
  }
  // bookshelf
  rect(0.33, 0.22, 0.09, 0.34, '#3a2a1e');
  for (let r = 0; r < 5; r++) for (let b = 0; b < 12; b++) rect(0.335 + b * 0.0068, 0.235 + r * 0.066, 0.006, rng.float(0.035, 0.055), ['#7a2a24', '#2a4a6a', '#c9b48a', '#2f5a3a', '#6a5a8a', '#b86a2a'][rng.int(0, 5)]);
  // door
  rect(0.86, 0.25, 0.06, 0.33, wall.clone().multiplyScalar(0.7).getStyle());
  // framed pictures
  rect(0.47, 0.3, 0.05, 0.07, '#2a2622'); rect(0.475, 0.307, 0.04, 0.056, sky.clone().lerp(new THREE.Color('#887766'), 0.5).getStyle());
  rect(0.79, 0.31, 0.04, 0.05, '#2a2622');
  // sofa / armchair silhouettes and a rug
  rect(0.44, 0.5, 0.16, 0.08, '#5a3a32'); rect(0.44, 0.47, 0.16, 0.04, '#6a463c');
  rect(0.02, 0.5, 0.07, 0.09, '#3e4a52');
  ctx.fillStyle = 'rgba(120,40,30,0.35)'; ctx.beginPath(); ctx.ellipse(0.55 * W, 0.8 * H, 0.25 * W, 0.08 * H, 0, 0, Math.PI * 2); ctx.fill();
  // floor lamp + ceiling light
  rect(0.3, 0.3, 0.003, 0.28, '#222'); glow(0.3015, 0.29, night ? 0.09 : 0.05, 'rgba(255,200,130,A)', night ? 0.9 : 0.45);
  if (night) glow(0.55, 0.05, 0.2, 'rgba(255,215,160,A)', 0.35);
  noise(ctx, W, H, rng, 0.03, 6000);
  // heavy blur: the room is far out of focus
  const out = canvas(W, H), o = out.getContext('2d'); o.filter = 'blur(22px)'; o.drawImage(c, 0, 0); o.filter = 'none';
  const t = new THREE.CanvasTexture(out); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
  t.userData.wall = wall.clone().multiplyScalar(0.95); // fog blends into this
  roomCache.set(key, t); return t;
}
