// Generated 3D models (toy reskin). Figures are auto-rigged skinned meshes, guns and the dog are static meshes,
// all untextured: the game paints them with its own plastic material. Everything is optional: if loading fails
// (or in the headless Node scripts, where nothing is loaded) the procedural box models are used instead.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';

export const MODELS = { ready: false, figures: new Map(), guns: new Map(), dog: null, props: new Map() };

const _propMats = new Map();
/** Vertex-coloured prop material. The colour attribute's alpha is a tint mask: where it is 1 the molded body takes the
 *  material colour (a car's paint, a dumpster's green), where it is 0 the baked colour is kept (tyres, glass, wood). */
export function propMaterial(tint) {
  const key = tint || 'none'; if (_propMats.has(key)) return _propMats.get(key);
  const m = new THREE.MeshStandardMaterial({ color: tint || '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0.02 });
  m.userData.prop = true;
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#if defined( USE_COLOR_ALPHA )\n diffuseColor.rgb = mix( vColor.rgb, vColor.rgb * diffuseColor.rgb, vColor.a );\n#elif defined( USE_COLOR )\n diffuseColor.rgb *= vColor;\n#endif'); };
  m.customProgramCacheKey = () => 'playset-prop';
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
 *  with crease-angle normals (the files carry none) and a dummy uv so the map's static-mesh merge accepts it. */
function propGeometry(scene) {
  scene.updateMatrixWorld(true); const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return; const g = new THREE.BufferGeometry();
    for (const k of ['position', 'color']) { const a = o.geometry.attributes[k]; if (!a) continue; const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c); g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); }
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(o.matrixWorld); parts.push(g);
  });
  const geo = toCreasedNormals(parts[0], Math.PI / 4.5);
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** base: URL prefix of the site root relative to the current page ('./' for the game, '../' for the catalog). */
export async function loadModels(base = './') {
  if (MODELS.ready) return MODELS;
  const root = new URL(base, document.baseURI);
  const manifest = await (await fetch(new URL('models/manifest.json', root))).json();
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
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
  const load = (file) => (packed ? loader.parseAsync(packed.get(file), '') : loader.loadAsync(new URL(file, root).href)).then((g) => g.scene);
  const jobs = [];
  for (const [key, f] of Object.entries(manifest.figures || {})) jobs.push(load(f.file).then((s) => MODELS.figures.set(key, s)));
  for (const [id, g] of Object.entries(manifest.guns || {})) jobs.push(load(g.file).then((s) => MODELS.guns.set(id, { scene: s, muzzle: g.muzzle })));
  if (manifest.dog) jobs.push(load(manifest.dog.file).then((s) => { MODELS.dog = s; MODELS.dogCollar = dogCollar(s); }));
  // playset props (cars, dumpsters, trees...): optional, the map builder falls back to its procedural props
  const props = await fetch(new URL('models/props.json', root)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  for (const [id, p] of Object.entries(props)) jobs.push(load(p.file).then((s) => MODELS.props.set(id, { geo: propGeometry(s), tint: p.tint })));
  await Promise.all(jobs.map((j) => j.catch((e) => console.warn('model failed to load', e))));
  MODELS.ready = true;
  return MODELS;
}

/** Which figure mesh a faction + headwear variant uses. */
export function figureKey(faction, hat) {
  if (faction === 'gang') return hat === 'hood' ? 'hood' : hat === 'cap' ? 'cap' : 'bandana';
  return faction; // hitman, sicario, cop
}
