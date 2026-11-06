// Generated 3D models (toy reskin). Figures are auto-rigged skinned meshes, guns and the dog are static meshes,
// all untextured: the game paints them with its own plastic material. Everything is optional: if loading fails
// (or in the headless Node scripts, where nothing is loaded) the procedural box models are used instead.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const MODELS = { ready: false, figures: new Map(), guns: new Map(), dog: null };

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
  if (manifest.dog) jobs.push(load(manifest.dog.file).then((s) => { MODELS.dog = s; }));
  await Promise.all(jobs.map((j) => j.catch((e) => console.warn('model failed to load', e))));
  MODELS.ready = true;
  return MODELS;
}

/** Which figure mesh a faction + headwear variant uses. */
export function figureKey(faction, hat) {
  if (faction === 'gang') return hat === 'hood' ? 'hood' : hat === 'cap' ? 'cap' : 'bandana';
  return faction; // hitman, sicario, cop
}
