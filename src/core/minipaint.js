// Miniature-kit textures for the toy reskin: walls painted the way a model-railroad building or a tabletop terrain
// piece is painted. Crisp molded shapes, a dark wash pooled in recesses, light dry-brushed edge highlights, glossy
// clear-plastic glazing. No photographic noise, grime or drips (those read as "dirty real wall", not "small model").
// Each generator paints a colour canvas and a matching height canvas; textures.js turns the height into a normal map
// so the relief catches the light. Normal maps depend only on layout, never on colour, so buildings share them.
import * as THREE from 'three';
import { RNG } from './rng.js';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const C = (c) => new THREE.Color(c);
const shade = (c, dl, ds = 0) => C(c).offsetHSL(0, ds, dl).getStyle();
const grey = (v) => `rgb(${v},${v},${v})`;

/** Raised molded rectangle: base fill, light top/left edge, dark bottom/right edge; height canvas gets the plateau. */
function molded(ctx, hx, x, y, w, h, col, { hi = 0.09, lo = -0.12, edge = 1.5, height = 200, r = 0 } = {}) {
  ctx.fillStyle = col; rect(ctx, x, y, w, h, r);
  ctx.fillStyle = shade(col, hi); ctx.fillRect(x, y, w, edge); ctx.fillRect(x, y, edge, h);
  ctx.fillStyle = shade(col, lo); ctx.fillRect(x, y + h - edge, w, edge); ctx.fillRect(x + w - edge, y, edge, h);
  if (hx) { hx.fillStyle = grey(height); rect(hx, x, y, w, h, r); hx.fillStyle = grey(Math.min(255, height + 25)); rect(hx, x + edge, y + edge, w - edge * 2, h - edge * 2, r); }
}
function rect(ctx, x, y, w, h, r = 0) { if (r > 0) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h); }
/** Fine paint stipple: barely-there tonal variation so flat colour doesn't look like a computer fill. */
function stipple(ctx, w, h, rng, n, a) { for (let i = 0; i < n; i++) { ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${rng.float(0, a)})` : `rgba(255,255,255,${rng.float(0, a)})`; const s = rng.float(1, 2.5); ctx.fillRect(rng.float(0, w), rng.float(0, h), s, s); } }
/** Soft tonal blotches, like an uneven base coat; low contrast. */
function mottle(ctx, w, h, rng, n, a) {
  for (let i = 0; i < n; i++) {
    const x = rng.float(0, w), y = rng.float(0, h), r = rng.float(w * 0.08, w * 0.25), g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng.chance(0.5) ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
/** Wash streak under a ledge: the dark paint that settles below sills on a weathered miniature. */
function washBelow(ctx, x, y, w, len, a = 0.22) { const g = ctx.createLinearGradient(0, y, 0, y + len); g.addColorStop(0, `rgba(20,14,10,${a})`); g.addColorStop(1, 'rgba(20,14,10,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, len); }

/** Molded brick courses. Bricks sit proud of a recessed, washed mortar line. */
function bricks(ctx, hx, w, h, rng, color, { bw = 28, bh = 10, gap = 2, accent = 0.08 } = {}) {
  const mortar = shade(color, -0.2, -0.12);
  ctx.fillStyle = mortar; ctx.fillRect(0, 0, w, h); if (hx) { hx.fillStyle = grey(70); hx.fillRect(0, 0, w, h); }
  for (let y = 0, row = 0; y < h; y += bh, row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < w + bw; x += bw) {
      const c = C(color).offsetHSL(rng.float(-0.006, 0.006), rng.float(-0.04, 0.04), rng.chance(accent) ? rng.float(-0.08, 0.08) : rng.float(-0.025, 0.025)).getStyle();
      molded(ctx, hx, x + off + gap / 2, y + gap / 2, bw - gap, bh - gap, c, { hi: 0.07, lo: -0.08, edge: 1, height: 175 });
    }
  }
}

// ---------------- facade ----------------
/**
 * Building facade tile: 3 x 2 windows (layout identical to the original generator, so the 3D window surrounds in
 * maps/kit.js still sit on the painted openings). Painted like a model-kit building: trim-coloured frames and mullions,
 * a dark reveal inside each opening, glossy glazing with a clear-plastic glint, curtains and blinds for life.
 */
export function paintFacade({ seed = 12, wall = '#8a3b2a', style = 'brick', cols = 3, rows = 2, lit = 0.35, winColor = '#1a2230', trim = null, balcony = false, shutters = false, ac = true } = {}, S = 512) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed), deco = new RNG(seed * 7919 + 13);
  const k = S / 512; ctx.scale(k, k); hx.scale(k, k);
  const W = 512, H = 512, tc = trim || (style === 'brick' ? '#d6cbb4' : shade(wall, 0.12, -0.05));
  hx.fillStyle = grey(128); hx.fillRect(0, 0, W, H);
  if (style === 'brick') bricks(ctx, hx, W, H, rng, wall);
  else if (style === 'glass') { ctx.fillStyle = '#4a545c'; ctx.fillRect(0, 0, W, H); hx.fillStyle = grey(190); hx.fillRect(0, 0, W, H); }
  else {
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.05)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    mottle(ctx, W, H, rng, 6, 0.035); stipple(ctx, W, H, rng, 1800, 0.035);
    // cast panel seams at each floor line and the tile edges (recessed, washed dark with a lit lower lip)
    for (let r = 0; r <= rows; r++) { const y = (r * H) / rows; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, y - 1.5, W, 3); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, y + 1.5, W, 1); hx.fillStyle = grey(60); hx.fillRect(0, y - 1.5, W, 3); }
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0, 0, 2, H); hx.fillStyle = grey(70); hx.fillRect(0, 0, 2, H);
  }
  const cw = W / cols, ch = H / rows;
  const curtainCols = ['#e8dcc4', '#c9a48f', '#9fb7b0', '#d9c27a', '#b9aeb8', '#f0ece2'];
  for (let r = 0; r < rows; r++) for (let ci = 0; ci < cols; ci++) {
    const x = ci * cw + cw * 0.25, y = r * ch + ch * 0.2, ww = cw * 0.5, wh = ch * 0.55;
    if (style === 'glass') { // curtain wall: each cell is a 2 x 2 group of panes in slim mullions, spandrel band below
      const gx = ci * cw, gy = r * ch, sp = ch * 0.16, pw = cw / 2, ph = (ch - sp) / 2;
      molded(ctx, hx, gx, gy + ch - sp, cw, sp, '#3a434b', { edge: 1.5, height: 175 });
      for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
        const on = rng.chance(lit * 0.6), x0 = gx + px * pw + 2.5, y0 = gy + py * ph + 2.5, w0 = pw - 5, h0 = ph - 5;
        const g = ctx.createLinearGradient(x0, y0, x0 + w0 * 0.5, y0 + h0); g.addColorStop(0, on ? '#f6dca2' : '#7f9cb8'); g.addColorStop(0.55, on ? '#e2b26a' : '#3d5670'); g.addColorStop(1, on ? '#c98c46' : '#26384c');
        ctx.fillStyle = g; ctx.fillRect(x0, y0, w0, h0); hx.fillStyle = grey(105); hx.fillRect(x0, y0, w0, h0);
        if (!on && deco.chance(0.3)) { ctx.fillStyle = 'rgba(230,226,214,0.55)'; ctx.fillRect(x0, y0, w0, h0 * deco.float(0.2, 0.6)); }
      }
      glint(ctx, gx + 2, gy + 2, cw - 4, ch - sp - 4, 0.13);
      continue;
    }
    const on = rng.chance(lit);
    // frame (raised, trim colour) and the dark reveal inside it
    molded(ctx, hx, x - 7, y - 7, ww + 14, wh + 14, tc, { edge: 2, height: 215 });
    ctx.fillStyle = shade(wall, -0.32, -0.1); ctx.fillRect(x, y, ww, wh); hx.fillStyle = grey(25); hx.fillRect(x, y, ww, wh);
    // glazing set a little back from the reveal
    const gx = x + 4, gy = y + 4, gw = ww - 8, gh = wh - 8;
    const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
    if (on) { g.addColorStop(0, '#ffe7b0'); g.addColorStop(1, '#e3a04e'); } else { g.addColorStop(0, shade(winColor, 0.2, 0.05)); g.addColorStop(1, winColor); }
    ctx.fillStyle = g; ctx.fillRect(gx, gy, gw, gh); hx.fillStyle = grey(45); hx.fillRect(gx, gy, gw, gh);
    // life behind the glass: curtains, a half-drawn blind, or nothing
    const kind = deco.float(0, 1);
    if (kind < 0.38) { const cc = curtainCols[deco.int(0, curtainCols.length - 1)], cwid = gw * deco.float(0.18, 0.34); for (const sx of [gx, gx + gw - cwid]) { ctx.fillStyle = shade(cc, on ? 0 : -0.25); ctx.fillRect(sx, gy, cwid, gh); ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let f = 1; f < 4; f++) ctx.fillRect(sx + (cwid * f) / 4, gy, 1.5, gh); } }
    else if (kind < 0.6) { const bh = gh * deco.float(0.25, 0.7); ctx.fillStyle = shade('#e9e2d0', on ? 0 : -0.3); ctx.fillRect(gx, gy, gw, bh); ctx.fillStyle = 'rgba(0,0,0,0.13)'; for (let s = 6; s < bh; s += 6) ctx.fillRect(gx, gy + s, gw, 1); }
    glint(ctx, gx, gy, gw, gh, on ? 0.12 : 0.2);
    // mullions (trim colour, raised)
    molded(ctx, hx, x + ww / 2 - 2.5, y, 5, wh, tc, { edge: 1, height: 205 });
    molded(ctx, hx, x, y + wh * 0.42 - 2.5, ww, 5, tc, { edge: 1, height: 205 });
    // sill ledge with a wash streak under it
    molded(ctx, hx, x - 12, y + wh + 7, ww + 24, 7, shade(tc, 0.04), { edge: 1.5, height: 230 });
    washBelow(ctx, x - 10, y + wh + 14, ww + 20, 18);
    if (shutters && rng.chance(0.5)) for (const sx of [x - ww * 0.32 - 7, x + ww + 7 + ww * 0.04]) { molded(ctx, hx, sx, y - 4, ww * 0.28, wh + 8, '#3d5a3a', { edge: 1.5, height: 190 }); ctx.fillStyle = 'rgba(0,0,0,0.22)'; for (let s = y + 2; s < y + wh; s += 6) ctx.fillRect(sx + 3, s, ww * 0.28 - 6, 2); }
    if (balcony) { // railing in front of the lower half of the opening
      const by = y + wh - 2, bx = x - ww * 0.3; molded(ctx, hx, bx, by, ww * 1.6, 7, '#34373a', { edge: 1.5, height: 235 }); molded(ctx, hx, bx, by - 24, ww * 1.6, 4, '#34373a', { edge: 1, height: 235 });
      for (let b = 0; b <= 9; b++) molded(ctx, hx, bx + (b * ww * 1.6) / 9 - 1.5, by - 22, 3, 22, '#34373a', { edge: 0.8, height: 235 });
    }
    if (ac && rng.chance(0.22)) { const ax = x + ww * 0.08, ay = y + wh * 0.55, aw = ww * 0.42, ah = wh * 0.4; molded(ctx, hx, ax, ay, aw, ah, '#b9bdc0', { edge: 2, height: 240, r: 2 }); ctx.fillStyle = '#5d6266'; for (let s = ay + 5; s < ay + ah - 4; s += 4) ctx.fillRect(ax + 4, s, aw - 8, 2); }
  }
  return { c, hc, repeat: [1, 1] };
}
/** Clear-plastic glint: a soft diagonal band and a crisp thin line, the way a glazing insert catches light. */
function glint(ctx, x, y, w, h, a) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h); ctx.lineTo(x + w * 0.45, y + h); ctx.lineTo(x + w * 0.95, y); ctx.lineTo(x + w * 0.65, y); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${a * 1.6})`; ctx.beginPath(); ctx.moveTo(x + w * 0.55, y + h); ctx.lineTo(x + w * 0.6, y + h); ctx.lineTo(x + w * 1.1, y); ctx.lineTo(x + w * 1.05, y); ctx.fill();
  ctx.restore();
}

// ---------------- generic walls ----------------
export function paintBrick({ color = '#8a3b2a', seed = 1 } = {}, S = 256) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 256; ctx.scale(k, k); hx.scale(k, k); bricks(ctx, hx, 256, 256, rng, color, { bw: 32, bh: 12, gap: 2 });
  return { c, hc, repeat: [2, 2] };
}
/** Cast concrete: smooth paint, formwork panel seams and tie-hole dimples (very "model kit"). */
export function paintConcrete({ color = '#8d8d86', seed = 2, dirty = 0.5 } = {}, S = 256) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 256; ctx.scale(k, k); hx.scale(k, k);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256); hx.fillStyle = grey(128); hx.fillRect(0, 0, 256, 256);
  mottle(ctx, 256, 256, rng, 5, 0.04); stipple(ctx, 256, 256, rng, 1400, 0.04);
  for (const y of [0, 128]) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0, y, 256, 2.5); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(0, y + 2.5, 256, 1); hx.fillStyle = grey(70); hx.fillRect(0, y, 256, 2.5); }
  for (const x of [0, 128]) { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, 0, 2, 256); hx.fillStyle = grey(80); hx.fillRect(x, 0, 2, 256); }
  for (const y of [32, 96, 160, 224]) for (const x of [32, 96, 160, 224]) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(x + 0.8, y + 1, 1.6, 0, 3.3); ctx.fill(); hx.fillStyle = grey(50); hx.beginPath(); hx.arc(x, y, 2.6, 0, 7); hx.fill(); }
  for (let i = 0; i < 3 * dirty; i++) washBelow(ctx, rng.float(0, 220), rng.chance(0.5) ? 2 : 130, rng.float(20, 50), rng.float(20, 50), 0.12);
  return { c, hc, repeat: [2, 2] };
}
/** Painted render: an even, slightly mottled base coat, the way a model's render walls are painted. */
export function paintPlaster({ color = '#d9c9a3', seed = 3, dirty = 0.6 } = {}, S = 256) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 256; ctx.scale(k, k); hx.scale(k, k);
  hx.fillStyle = grey(140); hx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256); mottle(ctx, 256, 256, rng, 8, 0.045); stipple(ctx, 256, 256, rng, 1600, 0.035);
  // no chipped patches: small trim boxes squeeze the whole tile, which turned them into a repeating dot pattern
  return { c, hc, repeat: [2, 2] };
}
/** Corrugated sheet: shaded ribs (real relief in the normal map), rust weeping from the fixing line. */
export function paintCorrugated({ color = '#8a8f93', seed = 11, rust = 0.6 } = {}, S = 256) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 256; ctx.scale(k, k); hx.scale(k, k);
  const P = 8; // 32 ribs per tile: stays a fine corrugation however far the wall stretches the texture
  for (let x = 0; x < 256; x++) { const s = Math.sin((x / P) * Math.PI * 2); ctx.fillStyle = shade(color, s * 0.13); ctx.fillRect(x, 0, 1, 256); hx.fillStyle = grey(Math.round(128 + Math.cos((x / P) * Math.PI * 2) * 100)); hx.fillRect(x, 0, 1, 256); }
  stipple(ctx, 256, 256, rng, 600, 0.04);
  for (let i = 0; i < 14 * rust; i++) { const x = rng.float(0, 256), y = rng.float(0, 200), g = ctx.createLinearGradient(0, y, 0, y + rng.float(30, 90)); g.addColorStop(0, `rgba(150,70,30,${rng.float(0.3, 0.6)})`); g.addColorStop(1, 'rgba(150,70,30,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, rng.float(3, 9), 90); }
  return { c, hc, repeat: [2, 2] };
}
/** Riveted plate. */
export function paintMetal({ color = '#6e7278', seed = 10, rust = 0.3 } = {}, S = 128) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 128; ctx.scale(k, k); hx.scale(k, k);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128); hx.fillStyle = grey(128); hx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) { ctx.fillStyle = `rgba(255,255,255,${rng.float(0, 0.03)})`; ctx.fillRect(0, y, 128, 1); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 128, 2); ctx.fillRect(0, 0, 2, 128); hx.fillStyle = grey(70); hx.fillRect(0, 0, 128, 2); hx.fillRect(0, 0, 2, 128);
  for (const p of [8, 40, 72, 104]) for (const q of [8, 120]) for (const [x, y] of [[p + 4, q], [q, p + 4]]) { ctx.fillStyle = shade(color, 0.12); ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x + 0.6, y + 0.8, 2.2, 0.2, 2.6); ctx.fill(); hx.fillStyle = grey(220); hx.beginPath(); hx.arc(x, y, 2.2, 0, 7); hx.fill(); }
  for (let i = 0; i < 6 * rust; i++) { const x = rng.float(0, 120), y = rng.float(0, 100), g = ctx.createLinearGradient(0, y, 0, y + 30); g.addColorStop(0, `rgba(140,70,30,${rng.float(0.25, 0.5)})`); g.addColorStop(1, 'rgba(140,70,30,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, rng.float(3, 7), 30); }
  return { c, hc, repeat: [1, 1] };
}
/** Floor / wall tiles with a bevelled edge. */
export function paintTile({ seed = 9, color = '#b8b2a4', line = '#5a554c', size = 32 } = {}, S = 256) {
  const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'), rng = new RNG(seed);
  const k = S / 256; ctx.scale(k, k); hx.scale(k, k);
  ctx.fillStyle = line; ctx.fillRect(0, 0, 256, 256); hx.fillStyle = grey(70); hx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += size) for (let x = 0; x < 256; x += size) molded(ctx, hx, x + 1, y + 1, size - 2, size - 2, C(color).offsetHSL(0, 0, rng.float(-0.03, 0.03)).getStyle(), { edge: 1.5, height: 175 });
  return { c, hc, repeat: [4, 4] };
}

/** Normal map (tangent space, linear) from a grey height canvas; wraps at the edges so tiling stays seamless. */
export function normalFromHeight(hc, strength = 3) {
  const w = hc.width, h = hc.height, id = hc.getContext('2d').getImageData(0, 0, w, h);
  const out = canvas(w, h), octx = out.getContext('2d'), img = id && octx.createImageData(w, h);
  if (!img) return out; // headless sims stub the canvas: no pixels to read
  const src = id.data, d = img.data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // canvas rows run down, texture v runs up: flip the vertical gradient
    let nx = -(H(x + 1, y) - H(x - 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0); return out;
}

// ---------------- ground (model-railroad scenics) ----------------
// Ground textures repeat many times across the board, so anything larger than a speck is drawn with wrap-around
// (`wrap`) to keep the tiling seamless.
function wrap(W, H, x, y, r, draw) { for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) if (x + ox > -r && x + ox < W + r && y + oy > -r && y + oy < H + r) draw(x + ox, y + oy); }
function wrapMottle(ctx, W, H, rng, n, a, rMin = 0.1, rMax = 0.3) {
  for (let i = 0; i < n; i++) {
    const x = rng.float(0, W), y = rng.float(0, H), r = rng.float(W * rMin, W * rMax), light = rng.chance(0.5);
    wrap(W, H, x, y, r, (px, py) => { const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2); });
  }
}
function setup(S, base) { const c = canvas(S, S), ctx = c.getContext('2d'), hc = canvas(S, S), hx = hc.getContext('2d'); const k = S / 256; ctx.scale(k, k); hx.scale(k, k); ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256); hx.fillStyle = grey(128); hx.fillRect(0, 0, 256, 256); return { c, ctx, hc, hx }; }

/** Painted model road: smooth dark paint, fine aggregate and faint hairline cracks. */
export function paintAsphalt({ seed = 4, color = '#3c3c42' } = {}, S = 256) {
  const { c, ctx, hc, hx } = setup(S, color), rng = new RNG(seed), W = 256;
  wrapMottle(ctx, W, W, rng, 5, 0.025, 0.25, 0.45); stipple(ctx, W, W, rng, 2600, 0.06);
  // no repair patches or other distinctive marks: this tile repeats every 4 m, and anything recognisable reads as a grid
  for (let i = 0; i < 3; i++) { // hairline cracks
    let x = rng.float(0, W), y = rng.float(0, W); const pts = [[x, y]]; for (let k = 0; k < 7; k++) { x += rng.float(-14, 14); y += rng.float(-14, 14); pts.push([x, y]); }
    wrap(W, W, pts[0][0], pts[0][1], 110, (px, py) => { const dx = px - pts[0][0], dy = py - pts[0][1];
      for (const [col, off, ctxx] of [['rgba(255,255,255,0.05)', 0.8, ctx], ['rgba(0,0,0,0.2)', 0, ctx], [grey(95), 0, hx]]) { ctxx.strokeStyle = col; ctxx.lineWidth = 1.2; ctxx.beginPath(); pts.forEach(([a, b], j) => (j ? ctxx.lineTo : ctxx.moveTo).call(ctxx, a + dx + off, b + dy + off)); ctxx.stroke(); } });
  }
  return { c, hc, repeat: [8, 8] };
}
/** Molded paving slabs, each a touch different in tone, gaps washed dark, the odd cracked slab. */
export function paintSidewalk({ seed = 5, color = '#9a9890' } = {}, S = 256) {
  const { c, ctx, hc, hx } = setup(S, shade(color, -0.22)), rng = new RNG(seed);
  hx.fillStyle = grey(70); hx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
    const col = C(color).offsetHSL(0, rng.float(-0.02, 0.02), rng.float(-0.04, 0.04)).getStyle();
    molded(ctx, hx, x + 1.5, y + 1.5, 61, 61, col, { edge: 1.5, hi: 0.06, lo: -0.08, height: 170 });
    ctx.save(); ctx.beginPath(); ctx.rect(x + 3, y + 3, 57, 57); ctx.clip(); stipple(ctx, 256, 256, rng, 120, 0.05); ctx.restore();
    if (rng.chance(0.12)) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + rng.float(4, 60), y + 2); ctx.lineTo(x + rng.float(20, 44), y + 32); ctx.lineTo(x + rng.float(4, 60), y + 62); ctx.stroke(); }
  }
  return { c, hc, repeat: [4, 4] };
}
/** Scenic earth: mottled brown base, fine ballast-style gravel, small static-grass tufts. */
export function paintDirt({ seed = 6, color = '#6b5a3e' } = {}, S = 256) {
  const { c, ctx, hc, hx } = setup(S, color), rng = new RNG(seed), W = 256;
  wrapMottle(ctx, W, W, rng, 10, 0.07, 0.08, 0.22); stipple(ctx, W, W, rng, 1800, 0.06);
  for (let i = 0; i < 900; i++) { // gravel: tiny raised stones toned to the earth, with a faint lit top
    const x = rng.float(0, W), y = rng.float(0, W), r = rng.float(0.5, 1.3), v = rng.float(-0.1, 0.1);
    ctx.fillStyle = shade(color, v, -0.15); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); ctx.fill();
    hx.fillStyle = grey(180); hx.beginPath(); hx.arc(x, y, r, 0, 7); hx.fill();
  }
  for (let i = 0; i < 9; i++) { // static-grass tufts
    const x = rng.float(0, W), y = rng.float(0, W), n = rng.int(14, 30), g = rng.pick(['#6f7f3a', '#5f7234', '#8a8a45']);
    wrap(W, W, x, y, 12, (px, py) => { for (let k = 0; k < n; k++) { const a = rng.float(0, 6.28), d = rng.float(0, 7); ctx.fillStyle = shade(g, rng.float(-0.08, 0.1)); ctx.fillRect(px + Math.cos(a) * d, py + Math.sin(a) * d, 1.6, 1.6); } });
  }
  return { c, hc, repeat: [6, 6] };
}
/** Flocked turf: short fibres in close greens with gentle clumping (no worn patches: they repeat visibly). */
export function paintGrass({ seed = 7, color = '#4f6b2e' } = {}, S = 256) {
  const { c, ctx, hc, hx } = setup(S, color), rng = new RNG(seed), W = 256;
  wrapMottle(ctx, W, W, rng, 12, 0.08, 0.06, 0.18);
  const greens = [0, 0.03, -0.03, 0.06, -0.045].map((v) => shade(color, v, rng.float(-0.03, 0.05)));
  for (let i = 0; i < 5200; i++) { const x = rng.float(0, W), y = rng.float(0, W), l = rng.float(1.5, 3.5); ctx.fillStyle = greens[i % greens.length]; ctx.fillRect(x, y, 1, l); hx.fillStyle = grey(rng.int(130, 190)); hx.fillRect(x, y, 1, l); }
  return { c, hc, repeat: [6, 6] };
}
/** Rounded molded cobbles in staggered rows, dark wash in the joints. */
export function paintCobble({ seed = 8, color = '#6f6a63' } = {}, S = 256) {
  const { c, ctx, hc, hx } = setup(S, shade(color, -0.3)), rng = new RNG(seed);
  hx.fillStyle = grey(60); hx.fillRect(0, 0, 256, 256);
  for (let y = 0, row = 0; y < 256; y += 16, row++) for (let x = -8; x < 256; x += 16) {
    const col = C(color).offsetHSL(0, rng.float(-0.03, 0.03), rng.float(-0.07, 0.07)).getStyle(), ox = (row % 2) * 8;
    molded(ctx, hx, x + ox + 1.2, y + 1.2, 13.6, 13.6, col, { edge: 1.5, hi: 0.1, lo: -0.12, height: 190, r: 4.5 });
  }
  return { c, hc, repeat: [6, 6] };
}
