// Gripping hand (2026-11-13): a painted miniature fist (Meshy) for the figures' and first-person hands.
// Output public/models/hand.glb: ~1k tris, centred on the fist, longest side 1, texture a greyscale shade that the
// game multiplies by each figure's skin tone. manifest.hand gives the frame: wrist (unit direction to the wrist cut,
// from the fist centre) and grip (axis of the tunnel the handle goes through).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, prune, dedup, transformPrimitive, simplify, clearNodeTransform, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp'; import fs from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const SRC = process.argv[2] || 'fist.glb', OUT = process.argv[3] || 'public/models';
const doc = await io.read(SRC); await doc.transform(flatten()); for (const n of doc.getRoot().listNodes()) if (n.getMesh()) clearNodeTransform(n);
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.02, lockBorder: false }));
const pts = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) pts.push(a.getElement(i, [])); }
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); }, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// wrist: the flat cut face = the direction with the most vertices within 2% of the extreme
let best = null;
for (let i = 0; i < 4000; i++) { const z = 1 - 2 * (i + 0.5) / 4000, r = Math.sqrt(1 - z * z), t = i * 2.399963; const d = [r * Math.cos(t), r * Math.sin(t), z];
  let mx = -1e9; for (const p of pts) mx = Math.max(mx, dot(p, d)); let n = 0; for (const p of pts) if (dot(p, d) > mx - 0.03) n++; if (!best || n > best.n) best = { d, n, mx }; }
const wristPts = pts.filter((p) => dot(p, best.d) > best.mx - 0.03); const wc = [0, 1, 2].map((k) => wristPts.reduce((s, p) => s + p[k], 0) / wristPts.length);
// fist: the half away from the wrist; centre = its bbox centre; grip axis = its main axis perpendicular to the wrist direction
const span = pts.map((p) => dot(p, best.d)); const lo = Math.min(...span), hi = best.mx;
const fist = pts.filter((p) => dot(p, best.d) < lo + (hi - lo) * 0.55);
const c = [0, 1, 2].map((k) => (Math.min(...fist.map((p) => p[k])) + Math.max(...fist.map((p) => p[k]))) / 2);
const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of fist) { const q = [0, 1, 2].map((k) => p[k] - c[k]); const pr = dot(q, best.d); for (let k = 0; k < 3; k++) q[k] -= pr * best.d[k]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += q[a] * q[b]; }
let v = [0.3, 1, 0.2]; for (let it = 0; it < 60; it++) v = norm([0, 1, 2].map((a) => C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2]));
let ext = 0; for (const p of pts) ext = Math.max(ext, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); const k = 0.5 / ext;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) transformPrimitive(p, [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -c[0] * k, -c[1] * k, -c[2] * k, 1]);
// the automatic guesses above only centre the fist; the frame itself was read off renders of this mesh
const wrist = norm([0.45, -0.88, -0.1]), grip = norm([0.05, 1, 0]);
console.log('wrist dir', wrist.map((x) => x.toFixed(2)), 'cut n', best.n, 'grip', grip.map((x) => x.toFixed(2)), 'scale', k.toFixed(3));
// texture -> greyscale shade (lit skin ~0.9)
const root = doc.getRoot(); const tex = root.listTextures()[0];
const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(256, 256).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const L = new Float32Array(info.width * info.height); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
const sorted = Array.from(L).filter((x) => x > 20).sort((a, b) => a - b); const ref = sorted[Math.floor(sorted.length * 0.85)];
const g = Buffer.alloc(L.length * 3); for (let i = 0; i < L.length; i++) { const x = Math.round(Math.min(1, (L[i] / ref) * 0.9) * 255); g[i * 3] = g[i * 3 + 1] = g[i * 3 + 2] = x; }
tex.setImage(new Uint8Array(await sharp(g, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 84 }).toBuffer())).setMimeType('image/webp');
for (const t of root.listTextures().slice(1)) t.dispose();
for (const m of root.listMaterials()) { m.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85); m.setBaseColorTexture(tex); }
doc.createExtension(EXTTextureWebP).setRequired(true);
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const s of p.listSemantics()) if ((s.startsWith('TEXCOORD') && s !== 'TEXCOORD_0') || s.startsWith('COLOR')) p.setAttribute(s, null);
await doc.transform(prune(), dedup(), weld(), quantize({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(`${OUT}/hand.glb`, doc);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
const man = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8')); // where the handle passes: the fist is solid, so the handle simply runs through the middle of the curled fingers.
// Centre of mid-height slices across the grip axis, leaving out the wrist end.
const after = []; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) after.push(a.getElement(i, [])); }
const sl = after.filter((p) => Math.abs(dot(p, grip)) < 0.12 && dot(p, wrist) < 0.12);
const smn = [0, 1, 2].map((k) => Math.min(...sl.map((p) => p[k]))), smx = [0, 1, 2].map((k) => Math.max(...sl.map((p) => p[k])));
const tunnel = [0, 1, 2].map((k) => +((smn[k] + smx[k]) / 2).toFixed(3)); console.log('tunnel', tunnel, 'slice', sl.length);
let wmax = -1e9; for (const p of pts) wmax = Math.max(wmax, dot(p.map((x, i) => x - c[i]), wrist)); const wristDist = wmax * k * 0.92; // fist centre to the wrist cut
man.hand = { file: 'models/hand.glb', wrist: wrist.map((x) => +x.toFixed(3)), grip: grip.map((x) => +x.toFixed(3)), wristDist: +wristDist.toFixed(3), tunnel };
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(man, null, 1));
console.log('hand.glb', tris, 'tris', (fs.statSync(`${OUT}/hand.glb`).size / 1024).toFixed(0), 'KB');
