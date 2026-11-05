// Builds every map in the browser to count asset usage, measure texture coverage, and photograph it.
import { MapBuilder } from '../maps/builder.js';
import { MAPS, loadMap } from '../maps/index.js';
import { disposeGeometry } from './studio.js';

const tick = () => new Promise((r) => setTimeout(r, 16));

/** usage[key][mapId] = count (props/structures) or triangles (textures). onMap fires as each map finishes. */
export async function analyseMaps(studio, onMap) {
  const usage = {}; let cur = null, depth = 0;
  const count = (k) => { (usage[k] ||= {})[cur] = (usage[k][cur] || 0) + 1; };
  const wraps = [['prop', (t) => 'prop:' + t], ['building', (o) => 'building:' + (o.style || 'brick')], ['shell', (o) => 'shell:' + (o.style || 'concrete')], ['wall', () => 'wall'], ['fence', () => 'fence'], ['stairs', () => 'stairs'], ['platform', () => 'platform'], ['road', () => 'road']];
  const originals = {};
  for (const [name, key] of wraps) {
    const orig = originals[name] = MapBuilder.prototype[name];
    MapBuilder.prototype[name] = function (...args) { if (cur && depth === 0) count(key(...args)); depth++; try { return orig.apply(this, args); } finally { depth--; } };
  }
  try {
    for (const m of MAPS) {
      await tick();
      const { def, build } = await loadMap(m.id);
      cur = m.id; const map = build(); map.def = def; cur = null;
      // triangles per texture (multi-material meshes are split by geometry group)
      let tris = 0, meshes = 0; const texTris = {};
      map.group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return; meshes++; const g = o.geometry; const total = g.index ? g.index.count / 3 : g.attributes.position.count / 3; tris += total;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (Array.isArray(o.material) && g.groups.length) for (const gr of g.groups) { const mt = mats[gr.materialIndex]; const n = (mt && mt.map && mt.map.name) || 'flat colour (no texture)'; texTris[n] = (texTris[n] || 0) + gr.count / 3; }
        else { const n = (mats[0] && mats[0].map && mats[0].map.name) || 'flat colour (no texture)'; texTris[n] = (texTris[n] || 0) + total; }
      });
      for (const [n, t] of Object.entries(texTris)) (usage['tex:' + n] ||= {})[m.id] = Math.round(t);
      await tick();
      const shot = studio.mapShot(map);
      const minimap = map.minimap.toDataURL('image/png');
      const stats = { size: map.size, tris: Math.round(tris), meshes, colliders: map.world.boxes.length, lights: (map.lights || []).length, navCells: map.nav.walkable.length, landmarks: map.landmarks.map((l) => l.name), spawns: map.spawns.all.length, teams: def.teams, night: !!def.env.night, texTris };
      disposeGeometry(map.group);
      onMap({ id: m.id, def, shot, minimap, stats });
    }
  } finally {
    for (const [name] of wraps) MapBuilder.prototype[name] = originals[name];
  }
  return usage;
}
