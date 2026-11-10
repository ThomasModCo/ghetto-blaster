// usage: node scripts/process-props.mjs <rawGlbFolder> [outDir=public/models]
// (needs: @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp three three-mesh-bvh xatlasjs)
// Turns generated, textured prop GLBs into small playset props for the map builder:
//   weld and decimate to a per-prop budget, orient (long axis / front per PROPS below), fit to the original prop's
//   dimensions with the base on y=0, then give the simplified mesh its own UV layout (xatlas) and bake its colour from
//   the full-detail source mesh and texture. Every prop shares one atlas (one material per paint colour, so props still
//   merge into a handful of draw calls). Atlas alpha is the tint mask: 255 takes the per-placement colour.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, weld, quantize, meshopt, prune, dedup, transformPrimitive, simplify, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { MeshBVH, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import { Api as XatlasApi } from 'xatlasjs/dist/node/api.mjs';
import { createRequire } from 'node:module';
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
  car: { size: [1.9, 1.65, 4.4], fit: 'xyz', exact: true, long: 'z', tris: 1600, tint: true , key: true},
  van: { size: [2.1, 2.2, 5.2], fit: 'xyz', exact: true, long: 'z', tris: 1600, tint: true , key: true},
  truck: { size: [2.4, 3.2, 7.65], fit: 'xyz', exact: true, long: 'z', tris: 1900, tint: true , texScale: 0.8 , key: true},
  bus: { size: [2.6, 3.4, 11], fit: 'xyz', exact: true, long: 'z', tris: 2200, tint: true , texScale: 0.8 , key: true},
  container: { size: [6, 2.6, 2.4], fit: 'xyz', exact: true, long: 'x', tris: 700, tint: true , texScale: 0.7 , key: true},
  dumpster: { size: [2.0, 1.5, 1.3], fit: 'xyz', exact: true, long: 'x', tris: 1000, tint: true , key: true},
  phonebooth: { size: [0.9, 2.4, 0.9], fit: 'y', long: null, tris: 800, tint: true , key: true},
  busstop: { size: [3.6, 2.7, 1.6], fit: 'x', long: 'x', tris: 1000, gain: 0.55 },
  newsstand: { size: [2.8, 2.6, 1.9], fit: 'xyz', exact: true, long: 'x', tris: 1000, tint: true , key: true},
  stall: { size: [3.4, 2.5, 1.9], fit: 'x', long: 'x', tris: 1300, tint: true },
  tires: { size: [1.1, 1.3, 1.1], fit: 'y', long: null, tris: 900, gain: 0.32 },
  trafficlight: { size: [0.6, 5.6, 4.0], fit: 'y', cap: 0, long: 'z', tris: 800, anchor: 'base', arm: true, gain: 0.5 },
  trashcan: { size: [0.75, 1.05, 0.75], fit: 'y', long: null, tris: 600 },
  barrel: { size: [0.66, 0.92, 0.66], fit: 'y', long: null, tris: 450, tint: true , key: true},
  crate: { size: [1, 1, 1], fit: 'xyz', exact: true, long: null, tris: 450 },
  bench: { size: [1.8, 0.95, 0.8], fit: 'x', cap: 1.6, long: 'x', tris: 800 },
  lamp: { size: [0.5, 6.2, 1.9], fit: 'y', cap: 0, long: 'z', tris: 600, anchor: 'base', arm: true, gain: 0.5 },
  hydrant: { size: [0.6, 1.0, 0.6], fit: 'y', cap: 0, long: null, tris: 600 },
  tree: { size: [3.2, 5.4, 3.2], fit: 'y', cap: 0, long: null, tris: 1200, anchor: 'base', gain: 0.72, sat: 0.55 , texScale: 0.8 },
  palm: { size: [3.5, 9.0, 3.5], fit: 'y', cap: 0, long: null, tris: 1000, anchor: 'base', gain: 0.75 , texScale: 0.7 },
  cone: { size: [0.5, 0.7, 0.5], fit: 'y', long: null, tris: 250 },
  trashpile: { size: [1.9, 1.0, 1.9], fit: 'xz', cap: 1.6, long: null, tris: 800 },
  // second batch of map props
  planter: { size: [2.4, 1.15, 1.0], fit: 'xyz', exact: true, long: 'x', tris: 900 },
  pole: { size: [1.8, 8, 0.5], fit: 'xyz', exact: true, long: 'x', tris: 700, gain: 0.7, sat: 0.45 , texScale: 0.6 },
  deadtree: { size: [3.2, 5.0, 3.2], fit: 'y', cap: 0, long: null, tris: 1000, anchor: 'base', gain: 0.85 , texScale: 0.7 },
  picnic: { size: [1.8, 0.8, 1.6], fit: 'xyz', exact: true, long: 'x', tris: 800 },
  hoop: { size: [1.9, 3.9, 2.0], fit: 'xyz', exact: true, long: 'z', tris: 900, anchor: 'base', arm: true },
  barricade: { size: [2.4, 1.1, 0.7], fit: 'xyz', exact: true, long: 'x', tris: 700, tint: true , key: true},
  watertower: { size: [3.8, 10, 3.8], fit: 'xyz', exact: true, long: null, tris: 1500, gain: 0.85 , texScale: 0.55 },
  rubble: { size: [3.2, 0.8, 3.2], fit: 'xyz', exact: true, long: null, tris: 900, gain: 0.28 , texScale: 0.7 },
  tarp: { size: [3.0, 2.3, 2.6], fit: 'xyz', exact: true, long: 'x', tris: 1100, tint: true },
  tent: { size: [2.2, 1.4, 1.8], fit: 'xyz', exact: true, long: 'x', tris: 800, tint: true , key: true},
  cart: { size: [0.9, 1.3, 1.1], fit: 'y', cap: 1.6, long: 'z', tris: 900 },
  mattress: { size: [1.4, 0.3, 2.0], fit: 'xyz', exact: true, long: 'z', tris: 500 },
  sandbags: { size: [2.8, 0.9, 0.5], fit: 'xyz', exact: true, long: 'x', tris: 900 },
  statue: { size: [1.4, 3.0, 1.2], fit: 'y', cap: 0, long: null, tris: 2000 },
  // third batch: the remaining fixed-shape props
  shirt: { size: [0.5, 0.75, 0.08], fit: 'xyz', exact: true, long: 'x', tris: 300, tint: true, greyBody: true },
  bollard: { size: [0.28, 0.9, 0.28], fit: 'xyz', exact: true, long: null, tris: 300 },
  billboard: { size: [10, 11.75, 1.2], fit: 'xyz', exact: true, long: 'x', tris: 1600 , texScale: 0.35 },
  ac: { size: [0.8, 0.6, 0.6], fit: 'xyz', exact: true, long: 'x', tris: 500 },
  pallet: { size: [1.2, 0.14, 1.0], fit: 'xyz', exact: true, long: 'x', tris: 400 },
  pipes: { size: [5, 1.2, 1.3], fit: 'xyz', exact: true, long: 'x', tris: 900 },
  bush: { size: [1.6, 1.4, 1.6], fit: 'xyz', exact: true, long: null, tris: 900 },
  antenna: { size: [1.2, 4, 0.4], fit: 'y', cap: 0, long: 'x', tris: 600, anchor: 'base' },
  barrier: { size: [3, 0.9, 0.55], fit: 'xyz', exact: true, long: 'x', tris: 500 },
  shrine: { size: [1.6, 3.0, 1.1], fit: 'xyz', exact: true, long: 'x', tris: 1500 },
  dish: { size: [1.0, 1.0, 1.0], fit: 'y', long: null, tris: 800 },
  fountain: { size: [8, 3.8, 8], fit: 'xyz', exact: true, long: null, tris: 2000 , texScale: 0.7 },
  obelisk: { size: [3, 10.85, 3], fit: 'xyz', exact: true, long: null, tris: 600 , texScale: 0.5 },
  grave: { size: [1.2, 1.9, 0.4], fit: 'xyz', exact: true, long: 'x', tris: 600 },
  tomb: { size: [2.8, 2.9, 3.6], fit: 'xyz', exact: true, long: 'z', tris: 900 , texScale: 0.8 },
  horsestatue: { size: [1.4, 4.0, 2.8], fit: 'z', long: 'z', tris: 2500 },
  // streak units (not map props: spawned by match.js; same pipeline)
  heli: { size: [2.6, 3.2, 10], fit: 'z', cap: 0, long: 'z', tris: 2600, thickFront: true , texScale: 0.75 },
  lowrider: { size: [2.0, 1.35, 5.4], fit: 'xyz', exact: true, long: 'z', tris: 2000, tint: true , key: true},
  driveby: { size: [1.9, 1.75, 4.4], fit: 'xyz', exact: true, long: 'z', tris: 2000, tint: true , key: true},
  nest: { size: [2.4, 1.0, 2.2], fit: 'xz', cap: 1.6, long: 'x', tris: 1600, yaw: 180 },
  gator: { size: [0.9, 0.5, 2.3], fit: 'z', cap: 0, long: 'z', tris: 1800, thickFront: true, yaw: 180, gain: 0.55, sat: 0.8 },
  brass: { size: [1.7, 1.9, 0.9], fit: 'y', cap: 1.6, long: 'x', tris: 2400, tint: true , key: true},
};
const YAW = JSON.parse(process.env.YAW || '{}'); // per-prop extra turn in degrees, decided by looking at renders

const M = {
  rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  scaleT(sx, sy, sz, tx, ty, tz) { return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1]; },
};
const prims = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
// every transform applied to the low mesh is also accumulated, so the full-detail source can be moved into the same space
let ACC = null;
const mul4 = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const apply = (doc, mat) => { for (const p of prims(doc)) transformPrimitive(p, mat); ACC = mul4(mat, ACC); };
function bbox(doc) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], v = [];
  for (const p of prims(doc)) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
  return { mn, mx, sz: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---- xatlas (UV unwrap of the simplified mesh) ----
const require = createRequire(import.meta.url);
const XA = XatlasApi(require('xatlasjs/dist/node/xatlas.js'));
const xa = await new Promise((res) => { const a = new XA(() => res(a), (p, d) => require.resolve('xatlasjs/dist/node/' + p)); });
function unwrap(pos, idx, texelsPerUnit) {
  xa.createAtlas(); xa.addMesh(new Uint16Array(idx), new Float32Array(pos));
  const r = xa.generateAtlas({}, { texelsPerUnit, padding: 3, bilinear: true, rotateCharts: true, bruteForce: false }); xa.destroyAtlas();
  if (r.atlasCount !== 1) throw new Error('xatlas made ' + r.atlasCount + ' atlases');
  const m = r.meshes[0];
  return { w: r.width, h: r.height, pos: m.vertex.vertices, uv: m.vertex.coords1, idx: m.index };
}

// ---- 1. geometry: the same pipeline as before (weld, simplify, orient, fit), remembering the full-detail source ----
const items = [];
for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.glb'))) {
  const id = path.basename(f, '.glb'); const P = PROPS[id]; if (!P) { console.log('skip', id); continue; }
  const doc = await io.read(path.join(RAW, f));
  await doc.transform(flatten());
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  await doc.transform(join());
  // full-detail source: positions, indices, UVs and the base-colour texture of every primitive
  const src = { pos: [], idx: [], uv: [], tex: [], triTex: [] };
  let vBase = 0;
  for (const p of prims(doc)) {
    const a = p.getAttribute('POSITION'), u = p.getAttribute('TEXCOORD_0'), n = a.getCount(), v = [], t = [0, 0];
    const mat = p.getMaterial(), tx = mat && mat.getBaseColorTexture(), fac = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    let ti = -1;
    if (tx && u) { const { data, info } = await sharp(Buffer.from(tx.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true }); src.tex.push({ data, W: info.width, H: info.height, fac, raw: Buffer.from(tx.getImage()) }); ti = src.tex.length - 1; }
    else { src.tex.push({ data: null, fac }); ti = src.tex.length - 1; }
    for (let i = 0; i < n; i++) { a.getElement(i, v); src.pos.push(v[0], v[1], v[2]); if (u) u.getElement(i, t); src.uv.push(t[0], t[1]); }
    const ix = p.getIndices(); const cnt = ix ? ix.getCount() : n;
    for (let i = 0; i < cnt; i++) src.idx.push(vBase + (ix ? ix.getScalar(i) : i));
    for (let i = 0; i < cnt / 3; i++) src.triTex.push(ti);
    vBase += n;
  }
  ACC = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // UV seams and hard-edge normals split almost every vertex, which stops the simplifier collapsing anything:
  // strip to positions, weld and simplify. Normals are rebuilt at load time with a crease angle (src/game/models.js).
  for (const p of prims(doc)) for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
  await doc.transform(weld());
  const tri0 = prims(doc).reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
  if (tri0 > P.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: P.tris / tri0, error: 0.06, lockBorder: false }));
  // orient: longest horizontal side onto P.long, then any manual yaw
  let b = bbox(doc);
  if (P.long === 'z' && b.sz[0] > b.sz[2]) apply(doc, M.rotY(Math.PI / 2));
  if (P.long === 'x' && b.sz[2] > b.sz[0]) apply(doc, M.rotY(Math.PI / 2));
  if (P.thickFront) { // the bulkier end (cabin, head) goes to +Z, the thin end (tail) to -Z
    const bb = bbox(doc), L = bb.sz[2], v = [], ext = (lo, hi) => { let mn = 1e9, mx = -1e9; for (const p of prims(doc)) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); if (v[2] >= lo && v[2] <= hi) { mn = Math.min(mn, v[1]); mx = Math.max(mx, v[1]); } } } return mx - mn; };
    if (ext(bb.mx[2] - L * 0.15, bb.mx[2]) < ext(bb.mn[2], bb.mn[2] + L * 0.15)) apply(doc, M.rotY(Math.PI));
  }
  const yaw = (P.yaw || 0) + (YAW[id] || 0);
  if (yaw) apply(doc, M.rotY((yaw * Math.PI) / 180));
  b = bbox(doc);
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
  // the low mesh as plain arrays (one primitive after join)
  const p = prims(doc)[0], a = p.getAttribute('POSITION'), ix = p.getIndices(), pos = [], idx = [], v = [];
  for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pos.push(...v); }
  for (let i = 0; i < ix.getCount(); i++) idx.push(ix.getScalar(i));
  let area = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) { A.fromArray(pos, idx[i] * 3); B.fromArray(pos, idx[i + 1] * 3); C.fromArray(pos, idx[i + 2] * 3); area += B.sub(A).cross(C.sub(A)).length() / 2; }
  // move the source into the same space
  const sp = new Float32Array(src.pos); const m4 = new THREE.Matrix4().fromArray(ACC); const t3 = new THREE.Vector3();
  for (let i = 0; i < sp.length; i += 3) { t3.set(sp[i], sp[i + 1], sp[i + 2]).applyMatrix4(m4); sp[i] = t3.x; sp[i + 1] = t3.y; sp[i + 2] = t3.z; }
  src.pos = sp;
  items.push({ id, P, doc, pos, idx, area, src, tris: idx.length / 3, size: bbox(doc).sz });
}

// ---- 2. one texel density for every prop, chosen so all the unwrapped props fill one atlas ----
const AW = 4096, AH = 2048, GAP = 2;
function shelfPack(rects) {
  const order = rects.map((r, i) => i).sort((i, j) => rects[j].h - rects[i].h || rects[j].w - rects[i].w);
  let x = 0, y = 0, rowH = 0; const out = new Array(rects.length);
  for (const i of order) { const r = rects[i]; if (x + r.w > AW) { x = 0; y += rowH + GAP; rowH = 0; } if (y + r.h > AH || r.w > AW) return null; out[i] = { x, y }; x += r.w + GAP; rowH = Math.max(rowH, r.h); }
  return out;
}
// texScale: relative texel density for props whose surfaces are big, plain or far away (billboard backs, monuments)
const TS = (it) => it.P.texScale ?? 1;
let density = Math.sqrt((AW * AH * 0.62) / items.reduce((s, it) => s + it.area * TS(it) ** 2, 0)), placed = null;
for (let tries = 0; tries < 30 && !placed; tries++) {
  for (const it of items) it.uw = unwrap(it.pos, it.idx, density * TS(it));
  placed = shelfPack(items.map((it) => ({ w: it.uw.w, h: it.uw.h })));
  if (!placed) density *= 0.95;
}
if (!placed) throw new Error('props do not fit the atlas');
console.log('texel density', density.toFixed(1), 'px/m');

// ---- 3. bake each prop's texels from its full-detail source ----
const atlas = new Uint8ClampedArray(AW * AH * 4);
const tmpTri = new THREE.Triangle(), tp = new THREE.Vector3(), tn = new THREE.Vector3(), bary = new THREE.Vector3();
for (let n = 0; n < items.length; n++) {
  const it = items[n], P = it.P, { w, h, pos, uv, idx } = it.uw, src = it.src;
  // source texture, pre-shrunk to about twice the target density so sampling it doesn't alias
  let srcArea = 0; { const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); for (let i = 0; i < src.idx.length; i += 3) { A.fromArray(src.pos, src.idx[i] * 3); B.fromArray(src.pos, src.idx[i + 1] * 3); C.fromArray(src.pos, src.idx[i + 2] * 3); srcArea += B.sub(A).cross(C.sub(A)).length() / 2; } }
  for (const T of src.tex) if (T.data) {
    const srcDensity = Math.sqrt((T.W * T.H * 0.7) / srcArea), f = Math.min(1, (2.2 * density * TS(it)) / srcDensity);
    if (f < 0.98) { const W2 = Math.max(16, Math.round(T.W * f)), H2 = Math.max(16, Math.round(T.H * f)); const { data, info } = await sharp(T.raw).removeAlpha().resize(W2, H2, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true }); T.data = data; T.W = info.width; T.H = info.height; }
    // linear float copy
    T.lin = new Float32Array(T.W * T.H * 3); for (let i = 0; i < T.lin.length; i++) T.lin[i] = s2l(T.data[i] / 255);
  }
  const sample = (T, u, v, out) => {
    if (!T.data) { out[0] = T.fac[0]; out[1] = T.fac[1]; out[2] = T.fac[2]; return; }
    const x = ((((u % 1) + 1) % 1) * T.W) - 0.5, y = ((((v % 1) + 1) % 1) * T.H) - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (xx, yy, c) => T.lin[(((yy + T.H) % T.H) * T.W + ((xx + T.W) % T.W)) * 3 + c];
    for (let c = 0; c < 3; c++) out[c] = ((at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy) * T.fac[c];
  };
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(src.pos, 3)); g.setIndex(src.idx);
  // the BVH reorders the index buffer; keep each triangle's texture id with it via a per-triangle lookup built afterwards
  const triKey = new Map(); for (let t = 0; t < src.idx.length / 3; t++) triKey.set(`${src.idx[t * 3]},${src.idx[t * 3 + 1]},${src.idx[t * 3 + 2]}`, src.triTex[t]);
  const bvh = new MeshBVH(g); const gi = g.index.array;
  const triTexOf = (t) => triKey.get(`${gi[t * 3]},${gi[t * 3 + 1]},${gi[t * 3 + 2]}`) ?? 0;
  const diag = Math.hypot(...it.size), pen = diag * 0.02;
  const col = new Float32Array(w * h * 3), cov = new Uint8Array(w * h), rgb = [0, 0, 0];
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3(), fn = new THREE.Vector3(), q = new THREE.Vector3(), best = new THREE.Vector3();
  const uA = new THREE.Vector2(), uB = new THREE.Vector2(), uC = new THREE.Vector2();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    pA.fromArray(pos, i0 * 3); pB.fromArray(pos, i1 * 3); pC.fromArray(pos, i2 * 3);
    fn.subVectors(pC, pB).cross(tp.subVectors(pA, pB)).normalize();
    const ax = uv[i0 * 2] * w, ay = uv[i0 * 2 + 1] * h, bx = uv[i1 * 2] * w, by = uv[i1 * 2 + 1] * h, cx = uv[i2 * 2] * w, cy = uv[i2 * 2 + 1] * h;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    // conservative: a texel counts if its centre is within ~0.7 px of the triangle (edges, thin slivers)
    const e = 0.7 / Math.sqrt(Math.abs(den));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l2 = 1 - l0 - l1;
      if (l0 < -e || l1 < -e || l2 < -e) continue;
      const k = y * w + x; if (cov[k] === 2) continue; // a texel fully inside an earlier triangle stays
      const inside = l0 >= 0 && l1 >= 0 && l2 >= 0;
      l0 = Math.max(0, l0); l1 = Math.max(0, l1); l2 = Math.max(0, l2); const s = l0 + l1 + l2; l0 /= s; l1 /= s; l2 /= s;
      q.set(pA.x * l0 + pB.x * l1 + pC.x * l2, pA.y * l0 + pB.y * l1 + pC.y * l2, pA.z * l0 + pB.z * l1 + pC.z * l2);
      // nearest source surface that faces the same way (thin panels: don't pick up the far side)
      let bd = Infinity, bt = -1;
      bvh.shapecast({
        boundsTraverseOrder: (box) => box.distanceToPoint(q),
        intersectsBounds: (box, isLeaf, score) => (score < bd ? INTERSECTED : NOT_INTERSECTED),
        intersectsTriangle: (tri, ti) => { tri.closestPointToPoint(q, tp); let d = tp.distanceTo(q); tri.getNormal(tn); if (tn.dot(fn) < 0.15) d += pen; if (d < bd) { bd = d; bt = ti; best.copy(tp); } return false; },
      });
      if (bt < 0) continue;
      const j0 = gi[bt * 3], j1 = gi[bt * 3 + 1], j2 = gi[bt * 3 + 2];
      tmpTri.a.fromArray(src.pos, j0 * 3); tmpTri.b.fromArray(src.pos, j1 * 3); tmpTri.c.fromArray(src.pos, j2 * 3);
      tmpTri.getBarycoord(best, bary);
      uA.fromArray(src.uv, j0 * 2); uB.fromArray(src.uv, j1 * 2); uC.fromArray(src.uv, j2 * 2);
      const su = uA.x * bary.x + uB.x * bary.y + uC.x * bary.z, sv = uA.y * bary.x + uB.y * bary.y + uC.y * bary.z;
      sample(src.tex[triTexOf(bt)], su, sv, rgb);
      col[k * 3] = rgb[0]; col[k * 3 + 1] = rgb[1]; col[k * 3 + 2] = rgb[2]; cov[k] = inside ? 2 : 1;
    }
  }
  // colour grading, per texel (the same rules the vertex colours used)
  const covered = (k) => cov[k] > 0;
  if (P.greyBody) for (let k = 0; k < w * h; k++) if (covered(k)) { const c = col.subarray(k * 3, k * 3 + 3), mx = Math.max(...c), mn = Math.min(...c); if (mx > 0.15 && (mx - mn) / mx < 0.55) { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; c[0] = c[1] = c[2] = l; } }
  if (P.darkGreys) for (let k = 0; k < w * h; k++) if (covered(k)) { const c = col.subarray(k * 3, k * 3 + 3), mx = Math.max(...c), mn = Math.min(...c); if (mx > 0 && (mx - mn) / mx < 0.15) for (let i = 0; i < 3; i++) c[i] *= P.darkGreys; }
  // tint: the molded body takes the placement colour. Find the body's own colour (the bright, low-saturation texels),
  // white-balance against it so the body is neutral white (a beige or bluish cast would otherwise fail the mask and tint
  // the paint), and mask the texels that are then bright and neutral. Everything else keeps its colour, just brightened.
  let body = null; const mask = new Uint8Array(w * h), G = P.gain ?? 1;
  const grade = (c) => { for (let i = 0; i < 3; i++) c[i] *= G; if (P.sat !== undefined) { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * P.sat; } };
  if (P.tint && P.key) {
    // painted-miniature source (2026-11-10): the paintable body was painted in a magenta key colour. Keyed texels become
    // a neutral shade (wash and highlights kept) and take the placement colour; everything else keeps its paint as is.
    const vs = [], hueA = new Float32Array(w * h).fill(999), satA = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) {
      if (!covered(k)) continue; const c = col.subarray(k * 3, k * 3 + 3), s = [l2s(c[0]), l2s(c[1]), l2s(c[2])];
      const mx = Math.max(...s), mn = Math.min(...s), sat = mx > 0 ? (mx - mn) / mx : 0; let hue = 0;
      if (mx - mn > 1e-5) { if (mx === s[0]) hue = ((s[1] - s[2]) / (mx - mn)) % 6; else if (mx === s[1]) hue = (s[2] - s[0]) / (mx - mn) + 2; else hue = (s[0] - s[1]) / (mx - mn) + 4; hue *= 60; if (hue < 0) hue += 360; }
      const wk = (1 - ss(32, 52, Math.abs(hue - 305))) * ss(0.16, 0.3, sat) * ss(0.06, 0.14, mx); hueA[k] = Math.abs(hue - 305); satA[k] = sat;
      mask[k] = wk > 0.5 ? 1 : 0; if (mask[k]) vs.push(mx);
    }
    // grow into the anti-aliased fringe: pinkish texels next to the key (two passes)
    for (let pass = 0; pass < 2; pass++) { const add = []; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x; if (mask[k] || !covered(k) || hueA[k] > 70 || satA[k] < 0.08) continue; if (mask[k - 1] || mask[k + 1] || mask[k - w] || mask[k + w]) add.push(k); } for (const k of add) { mask[k] = 1; vs.push(Math.max(l2s(col[k * 3]), l2s(col[k * 3 + 1]), l2s(col[k * 3 + 2]))); } }
    vs.sort((x, y) => x - y); const ref = vs.length ? vs[Math.floor(vs.length * 0.85)] : 1; body = ref;
    for (let k = 0; k < w * h; k++) {
      if (!covered(k)) continue; const c = col.subarray(k * 3, k * 3 + 3);
      if (mask[k]) { const v = Math.max(l2s(c[0]), l2s(c[1]), l2s(c[2])); const g = s2l(Math.min(1, (v / ref) * 0.88)); c[0] = c[1] = c[2] = g; }
      grade(c);
    }
    if (process.env.MASKDBG) { let on = 0, n = 0; for (let k = 0; k < w * h; k++) if (covered(k)) { on += mask[k]; n++; } console.log('KEY', it.id, 'on', (on / n).toFixed(2)); }
  } else if (P.tint) {
    const mxs = []; for (let k = 0; k < w * h; k++) if (covered(k)) mxs.push(Math.max(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]));
    mxs.sort((x, y) => x - y); const bright = mxs[Math.floor(mxs.length * 0.55)];
    const ch = [[], [], []];
    for (let k = 0; k < w * h; k++) if (covered(k)) { const c = col.subarray(k * 3, k * 3 + 3), mx = Math.max(...c), mn = Math.min(...c); if (mx >= bright && mx > 0.08 && (mx - mn) / mx < 0.45) for (let i = 0; i < 3; i++) ch[i].push(c[i]); }
    const med = ch.map((a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length * 0.6)] : 1; });
    const bmax = Math.max(0.25, ...med); body = bmax;
    for (let k = 0; k < w * h; k++) {
      if (!covered(k)) continue; const c = col.subarray(k * 3, k * 3 + 3);
      const wb = [c[0] / Math.max(0.02, med[0]), c[1] / Math.max(0.02, med[1]), c[2] / Math.max(0.02, med[2])];
      const mx = Math.max(...wb), mn = Math.min(...wb), sat = mx > 0 ? (mx - mn) / mx : 0;
      mask[k] = ss(0.45, 0.6, mx) * (1 - ss(0.14, 0.32, sat)) > 0.5 ? 1 : 0;
      if (mask[k]) { const l = Math.min(1, 0.2126 * wb[0] + 0.7152 * wb[1] + 0.0722 * wb[2]); c[0] = c[1] = c[2] = l; } // neutral, shading kept
      else for (let i = 0; i < 3; i++) c[i] = Math.min(1, c[i] / bmax);
      grade(c);
    }
    if (process.env.MASKDBG) { let on = 0, n = 0; for (let k = 0; k < w * h; k++) if (covered(k)) { on += mask[k]; n++; } console.log('MASK', it.id, 'on', (on / n).toFixed(2), 'body', med.map((x) => x.toFixed(2)).join(',')); }
  } else for (let k = 0; k < w * h; k++) if (covered(k)) grade(col.subarray(k * 3, k * 3 + 3));
  // tint mask: 3x3 majority so single texels of grime don't punch holes in a painted panel
  const mask2 = new Uint8Array(mask);
  if (P.tint) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x; if (!covered(k)) continue; let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const kk = k + dy * w + dx; if (covered(kk)) { s += mask[kk]; c++; } } mask2[k] = s * 2 > c ? 1 : 0; }
  // molded plastic: the paintable body is smooth, so blur away the source's grime and grain inside the mask
  // (a 7x7 box over masked texels only: panel gaps, trim and decals sit outside the mask and stay sharp)
  if (P.tint && !P.key) {
    const R = 3, sm = new Float32Array(col);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x; if (!mask2[k]) continue; let r = 0, g2 = 0, b2 = 0, c = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const kk = yy * w + xx; if (!mask2[kk]) continue; r += col[kk * 3]; g2 += col[kk * 3 + 1]; b2 += col[kk * 3 + 2]; c++; } }
      const t = P.smooth ?? 0.8; sm[k * 3] = col[k * 3] * (1 - t) + (r / c) * t; sm[k * 3 + 1] = col[k * 3 + 1] * (1 - t) + (g2 / c) * t; sm[k * 3 + 2] = col[k * 3 + 2] * (1 - t) + (b2 / c) * t;
    }
    col.set(sm);
  }
  // dilate into the padding so mipmaps and bilinear filtering don't pull in black
  const filled = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) filled[k] = covered(k) ? 1 : 0;
  for (let pass = 0; pass < 8; pass++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; if (filled[k]) continue; let r = 0, g2 = 0, b2 = 0, m = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const kk = yy * w + xx; if (!filled[kk]) continue; r += col[kk * 3]; g2 += col[kk * 3 + 1]; b2 += col[kk * 3 + 2]; m += mask2[kk]; c++; } if (c) add.push([k, r / c, g2 / c, b2 / c, m * 2 >= c ? 1 : 0]); }
    for (const [k, r, g2, b2, m] of add) { col[k * 3] = r; col[k * 3 + 1] = g2; col[k * 3 + 2] = b2; mask2[k] = m; filled[k] = 1; }
  }
  // into the atlas: sRGB colour; alpha 255 = takes the placement colour, 150 = keeps its own (never 0, so no browser
  // premultiplies the colour away)
  const { x: ox, y: oy } = placed[n];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, o = ((oy + y) * AW + ox + x) * 4;
    for (let i = 0; i < 3; i++) atlas[o + i] = Math.round(l2s(Math.min(1, Math.max(0, col[k * 3 + i]))) * 255);
    atlas[o + 3] = mask2[k] ? 255 : 150;
  }
  it.body = body; it.rect = { x: ox, y: oy, w, h };
  process.stdout.write(`baked ${it.id} ${w}x${h}\n`);
}

// ---- 4. write: the low mesh with atlas UVs (no colours, no textures), the atlas, the manifest ----
const manifest = {};
for (const it of items) {
  const { doc, P, id, rect } = it, { pos, uv, idx } = it.uw;
  const p = prims(doc)[0], buf = p.getAttribute('POSITION').getBuffer();
  const auv = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) { auv[i] = (rect.x + uv[i] * rect.w) / AW; auv[i + 1] = (rect.y + uv[i + 1] * rect.h) / AH; }
  for (const sem of p.listSemantics()) p.setAttribute(sem, null);
  p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf));
  p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(auv).setBuffer(buf));
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  for (const m of doc.getRoot().listMaterials()) { m.setBaseColorTexture(null); m.setMetallicRoughnessTexture(null); m.setNormalTexture(null); m.setOcclusionTexture(null); m.setEmissiveTexture(null); m.setBaseColorFactor([1, 1, 1, 1]); m.setMetallicFactor(0); m.setRoughnessFactor(0.5); }
  const fb = bbox(doc);
  await doc.transform(prune({ keepAttributes: true }), dedup(), quantize({ quantizePosition: 12, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const file = `prop_${id}.glb`; await io.write(path.join(OUT, file), doc);
  manifest[id] = { file: `models/${file}`, tint: !!P.tint, size: fb.sz.map((v) => +v.toFixed(3)), rect: [rect.x, rect.y, rect.w, rect.h] };
  console.log(id.padEnd(12), String(it.tris).padStart(5), 'tris', (fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0).padStart(4), 'KB', 'tex', `${rect.w}x${rect.h}`, it.body ? 'body ' + it.body.toFixed(2) : '');
}
// atlas: full size and a half-size copy for low quality (WebP keeps the alpha tint mask)
const img = sharp(Buffer.from(atlas.buffer), { raw: { width: AW, height: AH, channels: 4 } });
await img.clone().webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'props-atlas.webp'));
await img.clone().resize(AW / 2, AH / 2, { kernel: 'lanczos3' }).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'props-atlas-low.webp'));
manifest._atlas = { file: 'models/props-atlas.webp', low: 'models/props-atlas-low.webp', w: AW, h: AH, density: +density.toFixed(1) };
fs.writeFileSync(path.join(OUT, 'props.json'), JSON.stringify(manifest, null, 1));
for (const f of ['props-atlas.webp', 'props-atlas-low.webp']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0), 'KB');
