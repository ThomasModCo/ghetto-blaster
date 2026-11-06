// usage: node scripts/process-props.mjs <rawGlbFolder> [outDir=public/models]
// (needs: @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp)
// Turns generated, textured prop GLBs into small vertex-coloured playset props for the map builder:
//   bake the base-colour texture into COLOR_0 (linear), drop UVs/textures, decimate to a per-prop budget,
//   orient (long axis / front per PROPS below), fit to the original prop's dimensions with the base on y=0,
//   and for tintable props normalise the neutral grey body to white so a per-placement colour multiplies onto it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, weld, quantize, meshopt, prune, dedup, transformPrimitive, simplify, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const RAW = process.argv[2] || 'props-src';
const OUT = process.argv[3] || 'public/models'; fs.mkdirSync(OUT, { recursive: true });

// size: target extents [x, y, z] of the original prop (metres); fit: which axes must match (others are capped);
// long: 'z' | 'x' (axis the longest horizontal side should lie on); yaw: extra turn after orienting (radians);
// tris: decimation budget; tint: grey body is normalised to white for per-placement colour.
export const PROPS = {
  car: { size: [1.9, 1.65, 4.4], fit: 'xyz', exact: true, long: 'z', tris: 2600, tint: true },
  van: { size: [2.1, 2.2, 5.2], fit: 'xyz', exact: true, long: 'z', tris: 2600, tint: true },
  truck: { size: [2.4, 3.2, 7.65], fit: 'xyz', exact: true, long: 'z', tris: 3000, tint: true },
  bus: { size: [2.6, 3.4, 11], fit: 'xyz', exact: true, long: 'z', tris: 3400, tint: true },
  container: { size: [6, 2.6, 2.4], fit: 'xyz', exact: true, long: 'x', tris: 900, tint: true },
  dumpster: { size: [2.0, 1.5, 1.3], fit: 'xyz', exact: true, long: 'x', tris: 1500, tint: true },
  phonebooth: { size: [0.9, 2.4, 0.9], fit: 'y', long: null, tris: 1000, tint: true },
  busstop: { size: [3.6, 2.7, 1.6], fit: 'x', long: 'x', tris: 1500, gain: 0.55 },
  newsstand: { size: [2.8, 2.6, 1.9], fit: 'xyz', exact: true, long: 'x', tris: 1500, tint: true },
  stall: { size: [3.4, 2.5, 1.9], fit: 'x', long: 'x', tris: 2000, tint: true },
  tires: { size: [1.1, 1.3, 1.1], fit: 'y', long: null, tris: 1400, gain: 0.32 },
  trafficlight: { size: [0.6, 5.6, 4.0], fit: 'y', cap: 0, long: 'z', tris: 1000, anchor: 'base', arm: true, gain: 0.5 },
  trashcan: { size: [0.75, 1.05, 0.75], fit: 'y', long: null, tris: 800, gain: 0.62 },
  barrel: { size: [0.66, 0.92, 0.66], fit: 'y', long: null, tris: 600, tint: true },
  crate: { size: [1, 1, 1], fit: 'xyz', exact: true, long: null, tris: 600 },
  bench: { size: [1.8, 0.95, 0.8], fit: 'x', cap: 1.6, long: 'x', tris: 1200 },
  lamp: { size: [0.5, 6.2, 1.9], fit: 'y', cap: 0, long: 'z', tris: 700, anchor: 'base', arm: true, gain: 0.5 },
  hydrant: { size: [0.6, 1.0, 0.6], fit: 'y', cap: 0, long: null, tris: 800, gain: 0.75 },
  tree: { size: [3.2, 5.4, 3.2], fit: 'y', cap: 0, long: null, tris: 2000, anchor: 'base', gain: 0.72, sat: 0.55 },
  palm: { size: [3.5, 9.0, 3.5], fit: 'y', cap: 0, long: null, tris: 1500, anchor: 'base', gain: 0.75 },
  cone: { size: [0.5, 0.7, 0.5], fit: 'y', long: null, tris: 300 },
  trashpile: { size: [1.9, 1.0, 1.9], fit: 'xz', cap: 1.6, long: null, tris: 1200 },
};
const YAW = JSON.parse(process.env.YAW || '{}'); // per-prop extra turn in degrees, decided by looking at renders

const M = {
  rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  scaleT(sx, sy, sz, tx, ty, tz) { return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1]; },
};
const prims = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const apply = (doc, mat) => { for (const p of prims(doc)) transformPrimitive(p, mat); };
function bbox(doc) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], v = [];
  for (const p of prims(doc)) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
  return { mn, mx, sz: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

async function bakeColors(doc) {
  for (const p of prims(doc)) {
    const mat = p.getMaterial(); const tex = mat && mat.getBaseColorTexture(); const uv = p.getAttribute('TEXCOORD_0'); const pos = p.getAttribute('POSITION');
    const fac = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const n = pos.getCount(); const col = new Float32Array(n * 4);
    if (tex && uv) {
      const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const W = info.width, H = info.height, t = [];
      // small box filter so a vertex on a seam line doesn't pick up a single dark texel
      const sample = (u, v, ch) => { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = Math.min(W - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * W) + dx)); const y = Math.min(H - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * H) + dy)); s += data[(y * W + x) * 4 + ch]; c++; } return s / c / 255; };
      for (let i = 0; i < n; i++) { uv.getElement(i, t); for (let ch = 0; ch < 3; ch++) col[i * 4 + ch] = s2l(sample(t[0], t[1], ch)) * fac[ch]; col[i * 4 + 3] = 1; }
    } else for (let i = 0; i < n; i++) col.set([fac[0], fac[1], fac[2], 1], i * 4);
    const acc = doc.createAccessor().setType('VEC4').setArray(col).setBuffer(pos.getBuffer());
    p.setAttribute('COLOR_0', acc);
    for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD')) p.setAttribute(sem, null);
    if (mat) { mat.setBaseColorTexture(null); mat.setMetallicRoughnessTexture(null); mat.setNormalTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null); mat.setBaseColorFactor([1, 1, 1, 1]); }
  }
}
// Normalise the molded grey body to white: the brightest low-saturation colour cluster is taken as "body".
function whitenBody(doc) {
  const lums = [];
  for (const p of prims(doc)) { const c = p.getAttribute('COLOR_0').getArray(); for (let i = 0; i < c.length; i += 4) { const mx = Math.max(c[i], c[i + 1], c[i + 2]), mn = Math.min(c[i], c[i + 1], c[i + 2]); if (mx > 0.12 && (mx - mn) / mx < 0.25) lums.push(mx); } }
  lums.sort((a, b) => a - b); const body = Math.max(0.3, lums.length ? lums[Math.floor(lums.length * 0.9)] : 1);
  for (const p of prims(doc)) { const a = p.getAttribute('COLOR_0'); const c = a.getArray(); for (let i = 0; i < c.length; i += 4) for (let k = 0; k < 3; k++) c[i + k] = Math.min(1, c[i + k] / body); a.setArray(c); }
  return body;
}

const manifest = {};
for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.glb'))) {
  const id = path.basename(f, '.glb'); const P = PROPS[id]; if (!P) { console.log('skip', id); continue; }
  const doc = await io.read(path.join(RAW, f));
  await doc.transform(flatten());
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  await doc.transform(join());
  await bakeColors(doc);
  // UV seams and hard-edge normals split almost every vertex, which stops the simplifier collapsing anything.
  // Remember colour by position, strip to positions only, weld, simplify, then put colours back by position.
  // Normals are rebuilt at load time with a crease angle (see src/game/models.js).
  const key = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
  const colorAt = new Map();
  for (const p of prims(doc)) {
    const a = p.getAttribute('POSITION'), c = p.getAttribute('COLOR_0').getArray(), v = [];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); const kk = key(...v); const e = colorAt.get(kk) || [0, 0, 0, 0]; e[0] += c[i * 4]; e[1] += c[i * 4 + 1]; e[2] += c[i * 4 + 2]; e[3]++; colorAt.set(kk, e); }
    for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
  }
  await doc.transform(weld());
  let tri = prims(doc).reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
  if (tri > P.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: P.tris / tri, error: 0.06, lockBorder: false }));
  for (const p of prims(doc)) {
    const a = p.getAttribute('POSITION'), n = a.getCount(), col = new Float32Array(n * 4), v = [];
    for (let i = 0; i < n; i++) { a.getElement(i, v); const e = colorAt.get(key(...v)) || [0.5, 0.5, 0.5, 1]; col.set([e[0] / e[3], e[1] / e[3], e[2] / e[3], 1], i * 4); }
    p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setBuffer(a.getBuffer()));
  }
  // orient: longest horizontal side onto P.long, then any manual yaw
  let b = bbox(doc);
  if (P.long === 'z' && b.sz[0] > b.sz[2]) apply(doc, M.rotY(Math.PI / 2));
  if (P.long === 'x' && b.sz[2] > b.sz[0]) apply(doc, M.rotY(Math.PI / 2));
  if (YAW[id]) apply(doc, M.rotY((YAW[id] * Math.PI) / 180));
  b = bbox(doc);
  // fit: uniform scale so the listed axes reach the target, never exceeding any other target axis by > 25%
  // exact: stretch each axis onto the collider box (vehicles, crates); otherwise uniform, fitting the listed axes and
  // capping the others at `cap` x their target (cap 0 = uncapped: poles, trees)
  const r = [0, 1, 2].map((i) => P.size[i] / b.sz[i]);
  let sc;
  if (P.exact) sc = r;
  else {
    let k = Math.min(...[...P.fit].map((ax) => r['xyz'.indexOf(ax)]));
    const capF = P.cap ?? 1.25; if (capF) k = Math.min(k, ...[0, 1, 2].map((i) => (P.size[i] * capF) / b.sz[i]));
    sc = [k, k, k];
  }
  apply(doc, M.scaleT(sc[0], sc[1], sc[2], -((b.mn[0] + b.mx[0]) / 2) * sc[0], -b.mn[1] * sc[1], -((b.mn[2] + b.mx[2]) / 2) * sc[2]));
  // poles and trunks: the original props stand the pole/trunk on the placement point (and lamp/traffic-light arms reach +Z)
  if (P.arm || P.anchor === 'base') {
    const H = bbox(doc).sz[1], cen = (lo, hi) => { let x = 0, z = 0, n = 0; const v = []; for (const p of prims(doc)) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); if (v[1] >= lo * H && v[1] <= hi * H) { x += v[0]; z += v[2]; n++; } } } return [x / n, z / n]; };
    if (P.arm && cen(0.75, 1)[1] < cen(0, 0.15)[1]) apply(doc, M.rotY(Math.PI));
    if (P.anchor === 'base') { const [bx, bz] = cen(0, 0.12); apply(doc, M.scaleT(1, 1, 1, -bx, 0, -bz)); }
  }
  const body = P.tint ? whitenBody(doc) : null;
  // alpha = tint mask: 1 on the neutral, light molded body (takes the per-placement colour), 0 on tyres, glass, wood, fruit
  for (const p of prims(doc)) {
    const a = p.getAttribute('COLOR_0'); const c = a.getArray(); const g = P.gain ?? 1;
    for (let i = 0; i < c.length; i += 4) {
      for (let k = 0; k < 3; k++) c[i + k] *= g;
      if (P.sat !== undefined) { const l = 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2]; for (let k = 0; k < 3; k++) c[i + k] = l + (c[i + k] - l) * P.sat; }
      const mx = Math.max(c[i], c[i + 1], c[i + 2]), mn = Math.min(c[i], c[i + 1], c[i + 2]), sat = mx > 0 ? (mx - mn) / mx : 0;
      const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      c[i + 3] = P.tint ? ss(0.1, 0.22, mx) * (1 - ss(0.14, 0.32, sat)) : 0;
    }
    a.setArray(c);
  }
  for (const m of doc.getRoot().listMaterials()) { m.setMetallicFactor(0); m.setRoughnessFactor(0.5); }
  const fb = bbox(doc);
  await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const file = `prop_${id}.glb`; await io.write(path.join(OUT, file), doc);
  tri = prims(doc).reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
  manifest[id] = { file: `models/${file}`, tint: !!P.tint, size: fb.sz.map((v) => +v.toFixed(3)) };
  console.log(id.padEnd(12), String(Math.round(tri)).padStart(5), 'tris', (fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0).padStart(4), 'KB', 'size', fb.sz.map((v) => v.toFixed(2)).join('x'), body ? 'body ' + body.toFixed(2) : '');
}
fs.writeFileSync(path.join(OUT, 'props.json'), JSON.stringify(manifest, null, 1));
