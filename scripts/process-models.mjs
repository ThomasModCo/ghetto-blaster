// usage: node scripts/process-models.mjs <rawGlbFolder>  (needs: npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer)
// Normalise generated GLBs for the game: guns barrel +Z / rear at -stock / muzzle at the original height,
// dog facing +Z with feet at y=0, figures untouched geometrically; then strip, weld, quantise and meshopt-compress.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, weld, quantize, meshopt, prune, dedup, transformPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import { WEAPONS } from '../src/game/weapons.js';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const OUT = new URL('../public/models', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const RAW = process.argv[2] || 'models-src'; // folder of raw generated GLBs (fig_*.glb, dog.glb, <weaponId>.glb)
const DOG_FLIP = process.env.DOG_FLIP === '1';
const manifest = { version: 1, figures: {}, guns: {}, dog: null };

function bake(doc) { for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !n.getSkin()) clearNodeTransform(n); }
function positions(doc) { const out = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, [])); } return out; }
function applyMatrix(doc, mat) { for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) transformPrimitive(p, mat); }
// column-major 4x4 helpers
const M = { rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  scaleT(k, tx, ty, tz) { return [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, tx * 1, ty * 1, tz * 1, 1]; } };
async function finish(doc, file) {
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD') || sem.startsWith('COLOR')) p.setAttribute(sem, null);
  await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 12, quantizeNormal: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(`${OUT}/${file}`, doc); return fs.statSync(`${OUT}/${file}`).size;
}
function ext(ps, axis, lo, hi) { // vertical extent of vertices whose coordinate on `axis` lies in [lo, hi]
  let mn = 1e9, mx = -1e9, sy = 0, n = 0; for (const p of ps) if (p[axis] >= lo && p[axis] <= hi) { mn = Math.min(mn, p[1]); mx = Math.max(mx, p[1]); sy += p[1]; n++; } return { h: n ? mx - mn : 0, cy: n ? sy / n : 0, n };
}
const bbox = (ps) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of ps) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); } return { mn, mx }; };

for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.glb'))) {
  const id = f.replace('.glb', ''); const doc = await io.read(RAW + '/' + f);
  if (id.startsWith('fig_')) { const sz = await finish(doc, `${id}.glb`); manifest.figures[id.slice(4)] = { file: `models/${id}.glb` }; console.log(id, sz); continue; }
  await doc.transform(flatten()); bake(doc);
  if (id === 'dog') {
    let ps = positions(doc); let b = bbox(ps);
    if (DOG_FLIP) applyMatrix(doc, M.rotY(Math.PI));
    ps = positions(doc); b = bbox(ps); const L = b.mx[2] - b.mn[2]; const k = 1.0 / L; // ~1 m nose to tail
    applyMatrix(doc, M.scaleT(k, -(b.mn[0] + b.mx[0]) / 2 * k, -b.mn[1] * k, -(b.mn[2] + b.mx[2]) / 2 * k));
    const sz = await finish(doc, 'dog.glb'); manifest.dog = { file: 'models/dog.glb' }; console.log('dog', sz); continue;
  }
  const w = WEAPONS[id]; if (!w) { console.log('skip', id); continue; }
  const d = w.model; let ps = positions(doc); let b = bbox(ps);
  const lenX = b.mx[0] - b.mn[0], lenZ = b.mx[2] - b.mn[2]; if (lenZ > lenX) applyMatrix(doc, M.rotY(Math.PI / 2)); // long axis -> X
  ps = positions(doc); b = bbox(ps); const L = b.mx[0] - b.mn[0];
  const front = ext(ps, 0, b.mx[0] - L * 0.06, b.mx[0]), back = ext(ps, 0, b.mn[0], b.mn[0] + L * 0.06);
  const muzzleAtPlusX = front.h <= back.h; // the muzzle end is the thin end
  applyMatrix(doc, M.rotY(muzzleAtPlusX ? -Math.PI / 2 : Math.PI / 2)); // muzzle -> +Z
  ps = positions(doc); b = bbox(ps);
  const supp = d.suppressor ? (d.pistol ? 0.14 : 0.2) : 0;
  const target = (d.stock || 0) + d.len + (d.barrel || 0) + supp;
  // fit the length, but never let a gun grow much taller than its box original (long magazines, drums, bipods)
  const maxH = (d.h + (d.mag || 0) + (d.drum ? 0.15 : 0) + (d.box ? 0.12 : 0) + (d.scope ? 0.06 : 0) + (d.bipod ? 0.16 : 0)) * ((d.mag || 0) >= 0.2 && !d.stock ? 1.1 : 1.35);
  const maxHf = Math.max(maxH, target * 0.35); // stocked guns without magazines are naturally taller than their box receiver
  const k = Math.min(target / (b.mx[2] - b.mn[2]), maxHf / (b.mx[1] - b.mn[1]));
  const fz = ext(ps, 2, b.mx[2] - (b.mx[2] - b.mn[2]) * 0.04, b.mx[2]);
  const muzzleY0 = d.pistol ? 0 : d.h * 0.15; // keep the original muzzle height so tracers and hands line up
  const tx = -(b.mn[0] + b.mx[0]) / 2 * k, ty = muzzleY0 - fz.cy * k, tz = -(d.stock || 0) - b.mn[2] * k;
  applyMatrix(doc, M.scaleT(k, tx, ty, tz));
  ps = positions(doc); b = bbox(ps);
  const muzzle = [0, +muzzleY0.toFixed(4), +b.mx[2].toFixed(4)];
  const sz = await finish(doc, `gun_${id}.glb`);
  manifest.guns[id] = { file: `models/gun_${id}.glb`, muzzle, flipped: !muzzleAtPlusX, bbox: [b.mn.map((v) => +v.toFixed(3)), b.mx.map((v) => +v.toFixed(3))] };
  console.log(id, sz, muzzleAtPlusX ? '+X' : '-X', 'front/back h', front.h.toFixed(2), back.h.toFixed(2));
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log('total', fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(`${OUT}/${f}`).size, 0));
