// First-person forearms (2026-11-13): painted Meshy forearms, one per outfit, for viewmodel.js.
// Output public/models/arm_<kind>.glb: wrist end at the origin, elbow at y = 1 (unit length), the arm's centre line on
// +Y. Textures (WebP, 512): keyed sleeves become a greyscale shade with alpha 0 = take the crew colour; the bare arm
// becomes a greyscale shade the game multiplies by the player's skin tone; the camo sleeve keeps its paint.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, prune, dedup, transformPrimitive, simplify, clearNodeTransform, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp'; import fs from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const SRC = process.argv[2] || 'arms', OUT = process.argv[3] || 'public/models';
const KINDS = { hoodie: 'key', puffer: 'key', suit: 'key', camo: 'paint', bare: 'skin' };
const man = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8')); man.arms = {};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
for (const [k, mode] of Object.entries(KINDS)) {
  const doc = await io.read(`${SRC}/${k}.glb`); await doc.transform(flatten()); for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01, lockBorder: false }));
  const pts = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) pts.push(a.getElement(i, [])); }
  const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
  // long axis by power iteration on the covariance
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of pts) { const q = p.map((x, i) => x - c[i]); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += q[a] * q[b]; }
  let ax = [1, 0.1, 0.1]; for (let it = 0; it < 80; it++) ax = norm([0, 1, 2].map((a) => C[a][0] * ax[0] + C[a][1] * ax[1] + C[a][2] * ax[2]));
  const t = pts.map((p) => dot(p.map((x, i) => x - c[i]), ax)), t0 = Math.min(...t), t1 = Math.max(...t), L = t1 - t0;
  // the wrist is the narrower end (cuffs, gloves and wrists all taper)
  const rad = (lo, hi) => { let s = 0, n = 0; pts.forEach((p, i) => { if (t[i] >= lo && t[i] <= hi) { const q = p.map((x, j) => x - c[j] - ax[j] * t[i]); s += Math.hypot(...q); n++; } }); return s / Math.max(1, n); };
  if (rad(t0, t0 + L * 0.15) > rad(t1 - L * 0.15, t1)) ax = ax.map((x) => -x);
  const tt = pts.map((p) => dot(p.map((x, i) => x - c[i]), ax)), w0 = Math.min(...tt);
  // basis: Y = ax (wrist -> elbow), X/Z any perpendicular pair; origin at the wrist end of the centre line
  const up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const X = norm([ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]]);
  const Z = [X[1] * ax[2] - X[2] * ax[1], X[2] * ax[0] - X[0] * ax[2], X[0] * ax[1] - X[1] * ax[0]];
  const o = c.map((x, i) => x + ax[i] * w0), s = 1 / L;
  // row-major rows X, ax, Z applied to (p - o), scaled: as a column-major 4x4
  const M = [X[0] * s, ax[0] * s, Z[0] * s, 0, X[1] * s, ax[1] * s, Z[1] * s, 0, X[2] * s, ax[2] * s, Z[2] * s, 0, -dot(X, o) * s, -dot(ax, o) * s, -dot(Z, o) * s, 1];
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) transformPrimitive(p, M);
  let rw = 0, re = 0; { const P2 = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) P2.push(a.getElement(i, [])); }
    const r = (lo, hi) => { let mx = 0; for (const p of P2) if (p[1] >= lo && p[1] <= hi) mx = Math.max(mx, Math.hypot(p[0], p[2])); return mx; }; rw = r(0, 0.08); re = r(0.92, 1); }
  // texture
  const root = doc.getRoot(), tex = root.listTextures()[0];
  const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(512, 512).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const n = info.width * info.height;
  if (mode === 'key' || mode === 'skin') {
    const vals = []; const w = new Float32Array(n), val = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
      let h = 0; if (mx - mn > 1e-5) { if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; }
      w[i] = mode === 'skin' ? 1 : (1 - Math.min(1, Math.max(0, (Math.abs(h - 305) - 22) / 18))) * Math.min(1, Math.max(0, (sat - 0.28) / 0.17)) * Math.min(1, Math.max(0, (mx - 0.08) / 0.1));
      val[i] = mode === 'skin' ? 0.2126 * r + 0.7152 * g + 0.0722 * b : mx; if (w[i] > 0.9) vals.push(val[i]); }
    vals.sort((a, b) => a - b); const ref = vals.length ? vals[Math.floor(vals.length * 0.85)] : 1;
    for (let i = 0; i < n; i++) { if (w[i] <= 0) continue; const grey = Math.min(1, (val[i] / ref) * 0.9) * 255;
      for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = Math.round(data[i * 4 + ch] * (1 - w[i]) + grey * w[i]); data[i * 4 + 3] = mode === 'skin' ? 255 : Math.round(255 * (1 - w[i])); }
  }
  const img = await sharp(data, { raw: { width: 512, height: 512, channels: 4 } }).webp(mode === 'key' ? { quality: 86, alphaQuality: 90, effort: 6, exact: true } : { quality: 84, effort: 6 }).toBuffer();
  const fin = mode === 'key' ? img : await sharp(img).removeAlpha().webp({ quality: 84, effort: 6 }).toBuffer();
  tex.setImage(new Uint8Array(fin)).setMimeType('image/webp'); for (const t of root.listTextures().slice(1)) t.dispose();
  for (const m of root.listMaterials()) { m.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85).setAlphaMode('OPAQUE'); m.setBaseColorTexture(tex); }
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if ((sem.startsWith('TEXCOORD') && sem !== 'TEXCOORD_0') || sem.startsWith('COLOR')) p.setAttribute(sem, null);
  await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(`${OUT}/arm_${k}.glb`, doc);
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  man.arms[k] = { file: `models/arm_${k}.glb`, mode, wristR: +rw.toFixed(3), elbowR: +re.toFixed(3) };
  console.log(k, mode, tris, 'tris', (fs.statSync(`${OUT}/arm_${k}.glb`).size / 1024).toFixed(0), 'KB', 'radius wrist', rw.toFixed(3), 'elbow', re.toFixed(3));
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(man, null, 1));
