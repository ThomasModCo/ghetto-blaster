// Painted-miniature figures, guns and dog (2026-11-10): same fitting as process.mjs, but the Meshy texture is kept.
// - guns: barrel +Z, rear at -stock, muzzle at the original height, sized to the weapon's box dimensions (as before)
// - dog: facing +Z, feet at y=0, 1 m nose to tail (as before)
// - figures: geometry and rig untouched
// The base colour texture is resized and re-encoded as WebP. On figures the main garment was painted in a magenta
// key colour: it becomes a greyscale shade (keeping the wash and highlights) and the alpha channel marks it,
// alpha 0 = take the team / player colour at runtime, alpha 255 = keep the painted colour.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, weld, quantize, meshopt, prune, dedup, transformPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import { WEAPONS } from '../src/game/weapons.js';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const RAW = process.argv[2] || 'models-src', OUT = process.argv[3] || 'public/models';
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const manifest = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8'));
const TEX = { fig: 1024, dog: 1024, long: 1024, pistol: 512 };

function bake(doc) { for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !n.getSkin()) clearNodeTransform(n); }
function positions(doc) { const out = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, [])); } return out; }
function applyMatrix(doc, mat) { for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) transformPrimitive(p, mat); }
const M = { rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  scaleT(k, tx, ty, tz) { return [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, tx, ty, tz, 1]; } };
function ext(ps, axis, lo, hi) { let mn = 1e9, mx = -1e9, sy = 0, n = 0; for (const p of ps) if (p[axis] >= lo && p[axis] <= hi) { mn = Math.min(mn, p[1]); mx = Math.max(mx, p[1]); sy += p[1]; n++; } return { h: n ? mx - mn : 0, cy: n ? sy / n : 0, n }; }
const bbox = (ps) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of ps) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); } return { mn, mx }; };

/** Magenta key -> greyscale garment + alpha mask. Returns the share of texels that were keyed. */
async function paintTexture(doc, size, keyed) {
  const root = doc.getRoot(); const tex = root.listTextures()[0]; if (!tex) throw new Error('no texture');
  const src = sharp(Buffer.from(tex.getImage())).resize(size, size, { fit: 'fill' });
  const { data, info } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let share = 0;
  if (keyed) {
    const n = info.width * info.height, w = new Float32Array(n), val = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx > 0 ? (mx - mn) / mx : 0;
      let h = 0; if (mx - mn > 1e-5) { if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; }
      const dh = Math.abs(h - 305); // magenta sits around 300-310
      const kh = 1 - Math.min(1, Math.max(0, (dh - 22) / 18)), ks = Math.min(1, Math.max(0, (s - 0.28) / 0.17)), kv = Math.min(1, Math.max(0, (mx - 0.08) / 0.1));
      w[i] = kh * ks * kv; val[i] = mx;
    }
    // reference brightness of the garment: 85th percentile of keyed texels' value
    const vs = []; for (let i = 0; i < n; i++) if (w[i] > 0.9) vs.push(val[i]); vs.sort((a, b) => a - b);
    const ref = vs.length ? vs[Math.floor(vs.length * 0.85)] : 1; share = vs.length / n;
    for (let i = 0; i < n; i++) {
      if (w[i] <= 0) continue;
      const grey = Math.min(1, (val[i] / ref) * 0.9) * 255; // lit garment ~0.9, wash and shadows darker
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c] * (1 - w[i]) + grey * w[i]);
      data[i * 4 + 3] = Math.round(255 * (1 - w[i]));
    }
  }
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp(keyed ? { quality: 86, alphaQuality: 90, effort: 6 } : { quality: 84, effort: 6 }).toBuffer();
  // webp without alpha when nothing is keyed (decodes as alpha 1 = keep the paint)
  const final = keyed ? out : await sharp(out).removeAlpha().webp({ quality: 84, effort: 6 }).toBuffer();
  tex.setImage(new Uint8Array(final)).setMimeType('image/webp');
  for (const t of root.listTextures().slice(1)) t.dispose();
  for (const m of root.listMaterials()) { m.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85).setAlphaMode('OPAQUE'); m.setBaseColorTexture(tex); }
  doc.createExtension(EXTTextureWebP).setRequired(true);
  return share;
}

async function finish(doc, file) {
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if ((sem.startsWith('TEXCOORD') && sem !== 'TEXCOORD_0') || sem.startsWith('COLOR')) p.setAttribute(sem, null);
  await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(`${OUT}/${file}`, doc); return fs.statSync(`${OUT}/${file}`).size;
}

for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.glb'))) {
  const id = f.replace('.glb', ''); if (ONLY && !ONLY.includes(id)) continue;
  const doc = await io.read(`${RAW}/${f}`);
  if (id.startsWith('fig_')) {
    const share = await paintTexture(doc, TEX.fig, true);
    const sz = await finish(doc, `${id}.glb`); manifest.figures[id.slice(4)] = { file: `models/${id}.glb`, painted: true };
    console.log(id, sz, 'garment', (share * 100).toFixed(1) + '%'); continue;
  }
  await doc.transform(flatten()); bake(doc);
  if (id === 'dog') {
    let ps = positions(doc), b = bbox(ps);
    if (process.env.DOG_FLIP === '1') applyMatrix(doc, M.rotY(Math.PI));
    ps = positions(doc); b = bbox(ps); const k = 1.0 / (b.mx[2] - b.mn[2]);
    applyMatrix(doc, M.scaleT(k, -(b.mn[0] + b.mx[0]) / 2 * k, -b.mn[1] * k, -(b.mn[2] + b.mx[2]) / 2 * k));
    await paintTexture(doc, TEX.dog, false);
    const sz = await finish(doc, 'dog.glb'); manifest.dog = { file: 'models/dog.glb', painted: true }; console.log('dog', sz); continue;
  }
  const w = WEAPONS[id]; if (!w) { console.log('skip', id); continue; }
  const d = w.model; let ps = positions(doc); let b = bbox(ps);
  const lenX = b.mx[0] - b.mn[0], lenZ = b.mx[2] - b.mn[2]; if (lenZ > lenX) applyMatrix(doc, M.rotY(Math.PI / 2));
  ps = positions(doc); b = bbox(ps); const L = b.mx[0] - b.mn[0];
  const front = ext(ps, 0, b.mx[0] - L * 0.06, b.mx[0]), back = ext(ps, 0, b.mn[0], b.mn[0] + L * 0.06);
  const muzzleAtPlusX = process.env['FLIP_' + id] ? process.env['FLIP_' + id] === '1' : front.h <= back.h;
  applyMatrix(doc, M.rotY(muzzleAtPlusX ? -Math.PI / 2 : Math.PI / 2));
  ps = positions(doc); b = bbox(ps);
  const supp = d.suppressor ? (d.pistol ? 0.14 : 0.2) : 0;
  const target = (d.stock || 0) + d.len + (d.barrel || 0) + supp;
  const maxH = (d.h + (d.mag || 0) + (d.drum ? 0.15 : 0) + (d.box ? 0.12 : 0) + (d.scope ? 0.06 : 0) + (d.bipod ? 0.16 : 0)) * ((d.mag || 0) >= 0.2 && !d.stock ? 1.1 : 1.35);
  const maxHf = Math.max(maxH, target * 0.35);
  const k = Math.min(target / (b.mx[2] - b.mn[2]), maxHf / (b.mx[1] - b.mn[1]));
  const fz = ext(ps, 2, b.mx[2] - (b.mx[2] - b.mn[2]) * 0.04, b.mx[2]);
  const muzzleY0 = d.pistol ? 0 : d.h * 0.15;
  const tx = -(b.mn[0] + b.mx[0]) / 2 * k, ty = muzzleY0 - fz.cy * k, tz = -(d.stock || 0) - b.mn[2] * k;
  applyMatrix(doc, M.scaleT(k, tx, ty, tz));
  ps = positions(doc); b = bbox(ps);
  const muzzle = [0, +muzzleY0.toFixed(4), +b.mx[2].toFixed(4)];
  await paintTexture(doc, d.pistol ? TEX.pistol : TEX.long, false);
  const sz = await finish(doc, `gun_${id}.glb`);
  manifest.guns[id] = { file: `models/gun_${id}.glb`, muzzle, flipped: !muzzleAtPlusX, painted: true, bbox: [b.mn.map((v) => +v.toFixed(3)), b.mx.map((v) => +v.toFixed(3))] };
  console.log(id, sz, muzzleAtPlusX ? '+X' : '-X', 'front/back h', front.h.toFixed(2), back.h.toFixed(2));
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
