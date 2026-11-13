// Generated 3D models (toy reskin). Figures are auto-rigged skinned meshes, guns and the dog are static meshes,
// painted miniatures with their own texture (older untextured builds get the game's plastic material). Everything is optional: if loading fails
// (or in the headless Node scripts, where nothing is loaded) the procedural box models are used instead.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { loadPaintDetail } from '../core/textures.js';

export const MODELS = { ready: false, figures: new Map(), guns: new Map(), dog: null, props: new Map(), propAtlas: null, hand: null, arms: {} };

const _propMats = new Map();
/** Vertex-coloured prop material. The colour attribute's alpha is a tint mask: where it is 1 the molded body takes the
 *  material colour (a car's paint, a dumpster's green), where it is 0 the baked colour is kept (tyres, glass, wood). */
export function propMaterial(tint) {
  const key = tint || 'none'; if (_propMats.has(key)) return _propMats.get(key);
  // one shared atlas for every generated prop (scripts/process-props.mjs); its alpha is the tint mask:
  // 255 = molded body that takes the placement colour, ~150 = keeps its own colour (tyres, glass, wood, fruit)
  // matte, like painted miniature scenery (was a 0.5 molded-plastic sheen before the painted pass)
  const m = new THREE.MeshStandardMaterial({ color: tint || '#ffffff', map: MODELS.propAtlas, roughness: 0.82, metalness: 0 });
  m.userData.prop = true;
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 propTexel = texture2D( map, vMapUv );\n diffuseColor.rgb = mix( propTexel.rgb, propTexel.rgb * diffuseColor.rgb, smoothstep( 0.78, 0.95, propTexel.a ) );\n#endif'); };
  m.customProgramCacheKey = () => 'playset-prop-atlas';
  _propMats.set(key, m); return m;
}
/** A generated unit or prop as a ready mesh (shared geometry), or null when models aren't loaded. */
export function unitMesh(id, tint = null) {
  const t = MODELS.props.get(id); if (!t) return null;
  const m = new THREE.Mesh(t.geo, propMaterial(t.tint ? tint : null)); m.castShadow = true; m.receiveShadow = true; return m;
}
/** Where the generated dog's neck is: a slice just behind the head, in the dog's own space (1 m long, feet at y=0, nose +Z). */
function dogCollar(scene) {
  scene.updateMatrixWorld(true); const v = new THREE.Vector3(); let zMax = -1e9, yMax = -1e9;
  const pts = []; scene.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); pts.push(v.clone()); zMax = Math.max(zMax, v.z); yMax = Math.max(yMax, v.y); } });
  // the neck: the upper body between 22% and 30% back from the nose
  const sl = pts.filter((p) => p.z < zMax - 0.22 && p.z > zMax - 0.3 && p.y > yMax * 0.45);
  if (sl.length < 8) return null;
  const c = sl.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(sl.length);
  let r = 0; for (const p of sl) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
  return { x: c.x, y: c.y, z: c.z, r: r * 0.92 };
}
/** One float, non-indexed, world-baked geometry per prop scene (quantised attributes can't be transformed in place),
 *  with crease-angle normals (the files carry none) and the atlas UVs. */
function propGeometry(scene) {
  scene.updateMatrixWorld(true); const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return; const g = new THREE.BufferGeometry();
    for (const k of ['position', 'uv']) { const a = o.geometry.attributes[k]; if (!a) continue; const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c); g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); }
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(o.matrixWorld); parts.push(g);
  });
  const geo = toCreasedNormals(parts[0], Math.PI / 4.5);
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** Underside profile of a generated gun (gun space: barrel +Z, up +Y, z = 0 the back of the receiver): the lowest
 *  point of the mesh's centre slab in 1 cm steps along the barrel. gripPoints() turns it into hand positions. */
export function gunProfile(scene) {
  scene.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const pts = []; scene.traverse((o) => { if (!o.isMesh) return; m.multiplyMatrices(inv, o.matrixWorld); const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); if (Math.abs(v.x) < 0.035) pts.push(v.y, v.z); } });
  if (pts.length < 60) return null;
  let z0 = 1e9, z1 = -1e9; for (let i = 1; i < pts.length; i += 2) { z0 = Math.min(z0, pts[i]); z1 = Math.max(z1, pts[i]); }
  const BIN = 0.01, n = Math.max(1, Math.ceil((z1 - z0) / BIN)), lo = new Float32Array(n).fill(NaN);
  for (let i = 0; i < pts.length; i += 2) { const b = Math.min(n - 1, Math.floor((pts[i + 1] - z0) / BIN)); if (!(lo[b] <= pts[i])) lo[b] = pts[i]; }
  const filled = Array.from(lo).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return { z0, z1, BIN, lo, base: filled[Math.floor(filled.length * 0.7)] }; // base: the receiver's underside
}
/** Hand points on a generated gun from its profile and the weapon's model dims: the pistol grip (deepest part just in
 *  front of the stock), the magazine (deepest part in front of the grip) and the fore-end (underside part-way from
 *  the magazine to the muzzle). Gun space; null if the profile is missing. */
export function gripPoints(P, d) {
  if (!P) return null; const len = d.len, { z0, BIN, lo, base } = P, n = lo.length;
  const bin = (z) => Math.min(n - 1, Math.max(0, Math.floor((z - z0) / BIN))), zOf = (b) => z0 + (b + 0.5) * BIN;
  const deepest = (za, zb) => { let best = -1; for (let b = bin(za); b <= bin(zb); b++) if (!Number.isNaN(lo[b]) && (best < 0 || lo[b] < lo[best])) best = b; return best; };
  const runAround = (b) => { const cut = base - (base - lo[b]) * 0.6; let s = b, e = b; while (s > 0 && lo[s - 1] < cut) s--; while (e < n - 1 && lo[e + 1] < cut) e++; return [s, e]; };
  const gb = deepest(d.pistol ? 0 : len * 0.04, d.pistol ? len * 0.5 : len * 0.32); if (gb < 0 || lo[gb] > base - 0.03) return null;
  const [gs, ge] = runAround(gb), grip = new THREE.Vector3(0, base - (base - lo[gb]) * 0.42, (zOf(gs) + zOf(ge)) / 2);
  if (d.pistol) return { grip, mag: new THREE.Vector3(0, lo[gb] + 0.02, grip.z), fore: null };
  let end = zOf(ge), mag = null; const mb = deepest(end + 0.03, len * 0.68);
  if (mb >= 0 && lo[mb] < base - 0.05) { const [ms, me] = runAround(mb); mag = new THREE.Vector3(0, lo[mb] + 0.03, (zOf(ms) + zOf(me)) / 2); end = zOf(me); }
  // fore-end: part-way to the muzzle, on the nearest stretch of underside that isn't a magazine, drum or bipod
  const want = Math.min(end + 0.05 + Math.max(0, len - end - 0.05) * 0.3, len - 0.06); let fb = -1;
  for (let b = bin(end + 0.04); b <= bin(len - 0.04); b++) if (!Number.isNaN(lo[b]) && lo[b] > base - 0.045 && (fb < 0 || Math.abs(zOf(b) - want) < Math.abs(zOf(fb) - want))) fb = b;
  if (fb < 0) return { grip, mag, fore: null };
  let fy = lo[fb]; for (let b = fb - 1; b <= fb + 1; b++) if (b >= 0 && b < n && lo[b] > base - 0.045) fy = Math.min(fy, lo[b]);
  return { grip, mag, fore: new THREE.Vector3(0, fy - 0.012, zOf(fb)) };
}

/** base: URL prefix of the site root relative to the current page ('./' for the game, '../' for the catalog). */
export async function loadModels(base = './', opts = {}) {
  if (MODELS.ready) return MODELS;
  const root = new URL(base, document.baseURI);
  const manifest = await (await fetch(new URL('models/manifest.json', root))).json();
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const detail = loadPaintDetail(root); // painted overlays for the procedural scenery textures (core/textures.js)
  // Hosts that can't serve .glb get a single packed JSON (scripts/pack-models.mjs writes manifest.pack).
  let packed = null;
  if (manifest.pack) {
    const pack = await (await fetch(new URL(manifest.pack, root))).json();
    packed = new Map(Object.entries(pack).map(([f, b64]) => {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return [f, u8.buffer];
    }));
  }
  // painted models carry their own base-colour texture (see scripts/process-painted.mjs): keep it for paintedMat
  const mapOf = (s) => {
    let t = null; s.traverse((o) => { if (!t && o.isMesh && o.material && o.material.map) t = o.material.map; }); if (!t) return t;
    t.anisotropy = 4;
    // Low quality: half-size figure, gun and dog textures (a quarter of the GPU memory, kinder to phones)
    if (opts.lowTextures && t.image && t.image.width >= 512 && typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = t.image.width >> 1; c.height = t.image.height >> 1;
      c.getContext('2d').drawImage(t.image, 0, 0, c.width, c.height); if (t.image.close) t.image.close(); t.image = c; t.needsUpdate = true;
    }
    return t;
  };
  const load = (file) => (packed ? loader.parseAsync(packed.get(file), '') : loader.loadAsync(new URL(file, root).href)).then((g) => g.scene);
  const jobs = [];
  for (const [key, f] of Object.entries(manifest.figures || {})) jobs.push(load(f.file).then((s) => { s.userData.paint = mapOf(s); MODELS.figures.set(key, s); }));
  for (const [id, g] of Object.entries(manifest.guns || {})) jobs.push(load(g.file).then((s) => MODELS.guns.set(id, { scene: s, muzzle: g.muzzle, map: mapOf(s), profile: gunProfile(s) })));
  // gripping fist for the figures' hands (scripts/process-hand.mjs): greyscale shade x skin tone, with its frame
  if (manifest.hand) jobs.push(load(manifest.hand.file).then((s) => { MODELS.hand = { geo: propGeometry(s), map: mapOf(s), grip: new THREE.Vector3(...manifest.hand.grip), wrist: new THREE.Vector3(...manifest.hand.wrist), wristDist: manifest.hand.wristDist, tunnel: new THREE.Vector3(...(manifest.hand.tunnel || [0, 0, 0])) }; }));
  // painted first-person forearms, one per outfit (scripts/process-arms.mjs): wrist at the origin, elbow at y = 1
  for (const [k, a] of Object.entries(manifest.arms || {})) jobs.push(load(a.file).then((s) => { MODELS.arms[k] = { geo: propGeometry(s), map: mapOf(s), mode: a.mode, wristR: a.wristR }; }));
  if (manifest.dog) jobs.push(load(manifest.dog.file).then((s) => { MODELS.dog = s; MODELS.dogMap = mapOf(s); MODELS.dogCollar = dogCollar(s); }));
  // playset props (cars, dumpsters, trees...): optional, the map builder falls back to its procedural props
  const props = await fetch(new URL('models/props.json', root)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (props._atlas) {
    const t = await new THREE.TextureLoader().loadAsync(new URL(opts.lowTextures ? props._atlas.low : props._atlas.file, root).href).catch(() => null);
    if (t) { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; MODELS.propAtlas = t; }
  }
  for (const [id, p] of Object.entries(props)) if (id !== '_atlas') jobs.push(load(p.file).then((s) => MODELS.props.set(id, { geo: propGeometry(s), tint: p.tint })));
  await Promise.all(jobs.map((j) => j.catch((e) => console.warn('model failed to load', e)))); await detail;
  MODELS.ready = true;
  return MODELS;
}

/** Which figure mesh a faction + headwear variant uses. */
export function figureKey(faction, hat) {
  if (faction === 'gang') return hat === 'hood' ? 'hood' : hat === 'cap' ? 'cap' : 'bandana';
  return faction; // hitman, sicario, cop
}
