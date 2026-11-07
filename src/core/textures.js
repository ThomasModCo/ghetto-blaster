// Procedural canvas textures so the game ships with zero image assets.
import * as THREE from 'three';
import { RNG } from './rng.js';
import { paintFacade, paintBrick, paintConcrete, paintPlaster, paintCorrugated, paintMetal, paintTile, normalFromHeight } from './minipaint.js';

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
function grime(ctx, w, h, rng, n = 12) {
  for (let i = 0; i < n; i++) {
    const g = ctx.createRadialGradient(rng.float(0, w), rng.float(0, h), 0, rng.float(0, w), rng.float(0, h), rng.float(w * 0.1, w * 0.4));
    g.addColorStop(0, `rgba(0,0,0,${rng.float(0.05, 0.25)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
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
const MINI = { facade: [paintFacade, 512, 2.5], brick: [paintBrick, 256, 2.5], concrete: [paintConcrete, 256, 2], plaster: [paintPlaster, 256, 2], corrugated: [paintCorrugated, 256, 3], metal: [paintMetal, 128, 2], tile: [paintTile, 256, 2] };
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
  asphalt({ seed = 4, color = '#3c3c42' } = {}) {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, rng, 0.14, 9000);
    for (let i = 0; i < 4; i++) { ctx.strokeStyle = `rgba(0,0,0,${rng.float(0.2, 0.4)})`; ctx.lineWidth = rng.float(1, 2); ctx.beginPath(); let x = rng.float(0, w), y = rng.float(0, h); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rng.float(-30, 30); y += rng.float(-30, 30); ctx.lineTo(x, y); } ctx.stroke(); }
    grime(ctx, w, h, rng, 8);
    return finish(c, [8, 8]);
  },
  sidewalk({ seed = 5, color = '#9a9890' } = {}) {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, rng, 0.1, 5000);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    grime(ctx, w, h, rng, 6);
    return finish(c, [4, 4]);
  },
  dirt({ seed = 6, color = '#6b5a3e' } = {}) {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, rng, 0.15, 9000); grime(ctx, w, h, rng, 10);
    for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(80,110,40,${rng.float(0.1, 0.4)})`; ctx.fillRect(rng.float(0, w), rng.float(0, h), rng.float(2, 6), rng.float(2, 6)); }
    return finish(c, [6, 6]);
  },
  grass({ seed = 7, color = '#4f6b2e' } = {}) {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(${rng.int(40, 120)},${rng.int(90, 150)},${rng.int(20, 60)},0.6)`; ctx.fillRect(rng.float(0, w), rng.float(0, h), 2, rng.float(2, 6)); }
    grime(ctx, w, h, rng, 6);
    return finish(c, [6, 6]);
  },
  cobble({ seed = 8, color = '#6f6a63' } = {}) {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.fillStyle = '#3b3833'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      const col = new THREE.Color(color); col.offsetHSL(0, 0, rng.float(-0.08, 0.08));
      ctx.fillStyle = col.getStyle(); ctx.beginPath(); ctx.roundRect(x + 1 + ((y / 16) % 2) * 8, y + 1, 14, 14, 4); ctx.fill();
    }
    noise(ctx, w, h, rng, 0.1, 4000); grime(ctx, w, h, rng, 8);
    return finish(c, [6, 6]);
  },
  graffiti({ seed = 13, base = '#777', text = 'GB' } = {}) {
    const w = 256, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(seed);
    ctx.clearRect(0, 0, w, h);
    const colors = ['#ff2d95', '#00e5ff', '#ffe600', '#7cff00', '#ff6a00', '#b36bff', '#ffffff'];
    for (let i = 0; i < 3; i++) { ctx.fillStyle = rng.pick(colors); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(rng.float(40, w - 40), rng.float(20, h - 20), rng.float(30, 80), rng.float(14, 40), rng.float(-0.4, 0.4), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.font = `bold ${rng.int(60, 90)}px Impact, Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = rng.pick(colors); ctx.fillText(text, w / 2, h / 2);
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.strokeText(text, w / 2, h / 2);
    const t = finish(c, [1, 1]); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  sign({ seed = 14, text = 'LIQUOR', bg = '#b3121b', fg = '#fff', w = 256, h = 64 } = {}) {
    const c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, h - 8, w, 8);
    ctx.font = `bold ${Math.floor(h * 0.62)}px Impact, Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg; ctx.fillText(text, w / 2, h / 2 - 2);
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
  flashCore() {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(31);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,200,90,0.85)'); g.addColorStop(0.55, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // irregular hot spots
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) { const a = rng.float(0, 6.28), r = rng.float(20, 70); const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; const gg = ctx.createRadialGradient(x, y, 0, x, y, rng.float(14, 40)); gg.addColorStop(0, 'rgba(255,230,160,0.55)'); gg.addColorStop(1, 'rgba(255,150,40,0)'); ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  flashTongue() {
    // vertical flame tongue: bright at the base (bottom), tapering to the tip (top), jagged soft edges
    const w = 128, h = 256, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(37);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const len = h * rng.float(0.55, 1.0), wid = w * rng.float(0.18, 0.5), off = rng.float(-12, 12);
      const g = ctx.createLinearGradient(0, h, 0, h - len);
      g.addColorStop(0, `rgba(255,255,235,${rng.float(0.35, 0.6)})`); g.addColorStop(0.25, `rgba(255,210,110,${rng.float(0.3, 0.5)})`); g.addColorStop(0.6, `rgba(255,130,40,${rng.float(0.15, 0.3)})`); g.addColorStop(1, 'rgba(255,70,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(w / 2 + off - wid / 2, h); ctx.quadraticCurveTo(w / 2 + off - wid * 0.2, h - len * 0.6, w / 2 + off + rng.float(-10, 10), h - len); ctx.quadraticCurveTo(w / 2 + off + wid * 0.2, h - len * 0.6, w / 2 + off + wid / 2, h); ctx.closePath(); ctx.fill();
    }
    // bright base
    const g2 = ctx.createRadialGradient(w / 2, h - 10, 0, w / 2, h - 10, 60); g2.addColorStop(0, 'rgba(255,255,255,0.9)'); g2.addColorStop(1, 'rgba(255,200,100,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  },
  flashRing() {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(128, 128, 70, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(0.45, 'rgba(255,220,160,0.7)'); g.addColorStop(0.6, 'rgba(255,170,80,0.45)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
  smokePuff() {
    const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d'), rng = new RNG(41);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { const x = 64 + rng.float(-22, 22), y = 64 + rng.float(-22, 22), r = rng.float(18, 40); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(200,200,210,${rng.float(0.08, 0.16)})`); g.addColorStop(1, 'rgba(200,200,210,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
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
