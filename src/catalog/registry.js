// Asset registry for the catalog. Every entry builds its object from the real game code, so the catalog
// always reflects what the game currently ships.
import * as THREE from 'three';
import { CharacterModel, buildGunMesh, buildThrowableMesh, TEAM_COLORS, FFA_COLORS, FACTION_PLASTIC } from '../game/character.js';
import { WEAPONS, GUN_GAME_ORDER } from '../game/weapons.js';
import { TACTICALS, LETHALS } from '../game/equipment.js';
import { STOCK_LOADOUTS } from '../game/loadouts.js';
import { streaksForMap } from '../game/streaks.js';
import { FACTIONS } from '../game/names.js';
import { ViewModel } from '../game/viewmodel.js';
import { MapBuilder, PROP_TYPES } from '../maps/builder.js';
import { unitMesh } from '../game/models.js';
import { MAPS } from '../maps/index.js';
import { tex } from '../core/textures.js';
import { FX, MUZZLE_PROFILES } from '../core/engine.js';
import { RNG } from '../core/rng.js';
import { streakIcon } from '../ui/icons.js';

export const CATEGORIES = ['Characters', 'Weapons', 'Equipment', 'Props', 'Structures', 'Maps', 'Textures', 'VFX', 'Icons'];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------- characters ----------------
function posed(model, pose = 'idle') {
  const st = { speed: 0, moving: false, sprint: false, crouch: false, ads: pose === 'aim', onGround: true, pitch: 0, lean: 0, dead: false };
  for (let i = 0; i < 30; i++) model.update(0.08, st);
  model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return model.group;
}
const RIG_NOTES = 'Procedural box rig. Pivots: hips at y 0.95 → torso → neck/head and shoulder pivots (armL/armR); hip pivots for legL/legR; gunMount inside torso. Forward is +Z, origin at the feet. Animated in code: walk, sprint, crouch, prone height, ADS, reload, flinch, death.';
const HITBOX = 'Head sphere r 0.17 m at (height − 0.18); body box 0.6 × (height − 0.25) × 0.6. Height 1.8 standing, 1.25 crouched, 0.6 prone.';
const CHARACTERS = [
  { key: 'gang-hood', name: 'Gang member — hoodie', opts: { faction: 'gang', hat: 'hood' }, desc: 'Default street faction, painted miniature. Hood up, denim joggers, boots; the hoodie takes the crew colour.' },
  { key: 'gang-cap', name: 'Gang member — cap', opts: { faction: 'gang', hat: 'cap', plastic: TEAM_COLORS[0] }, desc: 'Street faction: backwards cap, gold chain, baggy jeans. The puffer jacket takes the crew colour (shown blue).' },
  { key: 'gang-bandana', name: 'Gang member — bandana', opts: { faction: 'gang', hat: 'bandana', plastic: TEAM_COLORS[1] }, desc: 'Street faction: cargo shorts and high-tops. Tank top and bandanas take the crew colour (shown red).' },
  { key: 'hitman', name: 'Hitman', opts: { faction: 'hitman' }, desc: 'White shirt, black tie, shades. The suit jacket takes the crew colour (charcoal outside team modes).' },
  { key: 'sicario', name: 'Sicario', opts: { faction: 'sicario' }, desc: 'Woodland camo, balaclava, boots. The plate carrier takes the crew colour (olive outside team modes). Also the Colectivo streak crew.' },
  { key: 'cop', name: 'Police officer', opts: { faction: 'cop' }, desc: 'Navy trousers, duty belt, peaked cap. The uniform shirt takes the crew colour (light blue outside team modes). Also the LAPD / NYPD / CRS crews.' },
];
const CREW_SLOTS = [['tdm-blue', 'TDM blue crew', TEAM_COLORS[0]], ['tdm-red', 'TDM red crew', TEAM_COLORS[1]],
  ...FFA_COLORS.map((c, i) => ['ffa-' + (i + 1), 'FFA slot ' + (i + 1) + (i === 0 ? ' (you)' : ''), c])];
/** All six painted figures side by side in one crew colour. */
function crewLineup(color) {
  const g = new THREE.Group();
  [['gang', 'hood'], ['gang', 'cap'], ['gang', 'bandana'], ['hitman'], ['sicario'], ['cop']].forEach(([faction, hat], i) => {
    const m = new CharacterModel({ rng: new RNG(5), faction, hat, plastic: color }); m.setGun(i % 2 ? WEAPONS.nine : WEAPONS.chopper);
    const o = posed(m); o.position.x = (i - 2.5) * 0.95; g.add(o);
  });
  return g;
}
function characterItems() {
  const items = CHARACTERS.map((c) => ({
    id: 'character:' + c.key, name: c.name, category: 'Characters', group: 'Humans', view: 'front', desc: c.desc,
    tags: ['character', 'bot', c.opts.faction, 'rig'], source: 'src/game/character.js · CharacterModel',
    build: () => { const m = new CharacterModel({ rng: new RNG(5), ...c.opts }); m.setGun(WEAPONS.chopper); return posed(m); },
    info: [['Faction', c.opts.faction], ['Bot spawn weight', `${Math.round((FACTIONS.filter((f) => f === c.opts.faction).length / FACTIONS.length) * 100)}% of bots`], ['Skin tone', 'Painted on the figure'], ['Hitboxes', HITBOX]],
    notes: RIG_NOTES + ` Painted miniature (public/models/fig_*.glb): the main garment is a key-colour mask that takes the crew colour — TDM blue ${TEAM_COLORS[0]} / red ${TEAM_COLORS[1]}, the FFA slot colour, or the faction default ${FACTION_PLASTIC[c.opts.faction]}. See the Crew colours group for every slot.`,
  }));
  for (const [id, name, color] of CREW_SLOTS) items.push({
    id: 'crew:' + id, name: 'Crew colours — ' + name, category: 'Characters', group: 'Crew colours', view: 'front', frame: { center: V(0, 0.95, 0), radius: 2.75, minY: 0 }, desc: `All six figures with their garment in ${color}.`,
    tags: ['team', 'colour', 'crew', id], source: 'src/game/character.js · paintedMat(map, tint)', build: () => crewLineup(color),
    info: [['Colour', color], ['Used in', id.startsWith('tdm') ? 'Team Deathmatch' : 'Free For All and Gun Game (one slot per player)']],
    notes: 'Visual only. The tint multiplies the greyscale garment, so the painted wash and highlights stay.',
  });
  items.push({
    id: 'character:pitbull', name: 'Pitbull', category: 'Characters', group: 'Animals', view: 'iso', desc: 'Attack dog from the PITBULL and GATOR SEASON streaks. Hunts the nearest enemy.',
    tags: ['dog', 'streak', 'animal'], source: 'src/game/character.js · CharacterModel.makeDog',
    build: () => { const m = new CharacterModel({ rng: new RNG(2) }); m.makeDog(); m.updateDog(0.1, { speed: 0, moving: false, onGround: true, pitch: 0, dead: false }); m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return m.group; },
    info: [['Used by', 'Pitbull, Gator Season streaks'], ['Animation', 'Four-leg gallop cycle, head pitch, death roll']], notes: 'Origin at the feet, forward +Z. Legs are four pivots under the torso.',
  });
  // generated streak units (toy reskin); each falls back to an empty slot when models aren't loaded
  const unit = (id, tint) => () => { const g = new THREE.Group(); const m = unitMesh(id, tint); if (m) g.add(m); return g; };
  for (const [id, name, desc, used, tint] of [
    ['heli', 'Police helicopter', 'GHETTO BIRD: circles the block at 32 m with a spotlight, gunning enemies. A two-blade rotor spins on the molded mast in game.', 'Ghetto Bird', null],
    ['lowrider', 'Armored lowrider', 'LOW RIDER: plows down the lane the caller is aiming at. The body paint takes the caller\'s colour.', 'Low Rider', TEAM_COLORS[1]],
    ['driveby', 'Drive-by sedan', 'Drive-by car with a crew member leaning out of the back window. The body paint takes the caller\'s colour.', 'Drive-by', TEAM_COLORS[0]],
    ['nest', 'Sandbag nest', 'ROOFTOP SHOOTER: sandbag emplacement with a mounted gun; turns with the crouched gunner inside.', 'Rooftop Shooter', null],
    ['gator', 'Alligator', 'GATOR SEASON: runs the streets hunting enemies on the pitbull\'s rig and AI.', 'Gator Season', null],
    ['brass', 'Brass band', 'BRASS BAND: a second line that draws every enemy toward the decoy. Band uniforms take the caller\'s colour.', 'Brass Band', TEAM_COLORS[0]],
  ]) items.push({ id: 'streak:' + id, name, category: 'Characters', group: 'Streak units', view: 'iso', desc, tags: ['streak', 'unit', id], source: 'src/game/match.js · unitMesh(\'' + id + '\')', build: unit(id, tint), info: [['Used by', used], ['Model', 'Generated playset mesh (public/models/prop_' + id + '.glb)']], notes: 'Visual only: spawning, damage and timing are unchanged.' });
  items.push({
    id: 'character:fp-hands', name: 'First-person hands', category: 'Characters', group: 'View model', view: 'low', grounded: false, desc: 'The player\'s hands and sleeves holding the current weapon in first person.',
    tags: ['viewmodel', 'first person', 'hands', 'arms'], source: 'src/game/viewmodel.js · ViewModel',
    build: () => { const holder = new THREE.Object3D(); const vm = new ViewModel(holder, { skin: '#7b4b2f', plastic: TEAM_COLORS[0] }); vm.setWeapon(WEAPONS.stick); holder.remove(vm.root); vm.root.visible = true; vm.root.position.set(0, 0, 0); return vm.root; },
    info: [['Rendered in', 'Separate view-model scene, 52° camera, drawn over the world'], ['Colours', 'Skin tone of the player figure, sleeve in the crew colour']],
    notes: 'Gun sits in gunHolder (rotated 180° so the barrel points down −Z, away from the camera). Right hand at the grip (z = len × 0.2), left hand on the fore-end. Animated in code: sway, bob, ADS, sprint, reload, swap, slide, crawl, recoil.',
  });
  return items;
}

// ---------------- weapons ----------------
const TYPE_NAMES = { smg: 'SMG', ar: 'Assault rifle', shotgun: 'Shotgun', sniper: 'Sniper rifle', dmr: 'Marksman rifle', lmg: 'LMG', pistol: 'Pistol', revolver: 'Revolver', mpistol: 'Machine pistol' };
function weaponItems() {
  return Object.values(WEAPONS).map((w) => {
    const loadouts = STOCK_LOADOUTS.filter((l) => l.primary === w.id || l.secondary === w.id).map((l) => l.name);
    const ladder = GUN_GAME_ORDER.indexOf(w.id);
    const parts = Object.entries(w.model).filter(([k, v]) => v && !['len', 'h', 'color', 'metal'].includes(k)).map(([k, v]) => (v === true ? k : `${k} ${v}`));
    return {
      id: 'weapon:' + w.id, name: w.name, category: 'Weapons', group: TYPE_NAMES[w.type] || w.type, view: 'side', grounded: false, desc: w.desc,
      tags: ['weapon', 'gun', w.type, w.slot, ...(w.suppressed ? ['suppressed'] : [])], source: `src/game/weapons.js · WEAPONS.${w.id}`,
      build: () => buildGunMesh(w),
      usage: loadouts.length + (ladder >= 0 ? 1 : 0), usageLabel: [loadouts.length ? `Stock loadouts: ${loadouts.join(', ')}` : 'No stock loadout', ladder >= 0 ? `Gun game #${ladder + 1}` : null, 'Random bot loadouts'].filter(Boolean).join(' · '),
      info: [['Slot', w.slot], ['Damage', `${w.damage}${w.pellets > 1 ? ` × ${w.pellets} pellets` : ''} (min ${w.minDamage})`], ['Fire rate', `${w.rpm} rpm${w.burst ? `, ${w.burst}-round burst` : w.auto ? ', automatic' : ', semi-auto'}`], ['Magazine', `${w.mag} / ${w.reserve} reserve`], ['Range', `full damage to ${w.rangeFull} m, minimum from ${w.rangeMin} m`], ['Reload', w.reload + ' s'], ['ADS', `${w.adsTime} s, ${w.adsFov}° FOV${w.scope ? ', scope overlay' : ''}`], ['Muzzle flash', w.sound], ['Model parts', parts.join(', ') || 'body only'], ['Model colours', `body ${w.model.color}${w.model.metal ? `, metal ${w.model.metal}` : ''}`]],
      notes: `Built from boxes and cylinders along +Z (barrel forward, receiver rear at z = 0). Model length ${w.model.len} m, height ${w.model.h} m. The muzzle point (userData.muzzle) drives flashes and tracers; keep it at the barrel tip in a reskin. Used for bots (third person), the first-person view model and loadout icons.`,
    };
  });
}

// ---------------- equipment ----------------
function equipmentItems() {
  const list = [...Object.values(TACTICALS).map((e) => ['Tactical', e]), ...Object.values(LETHALS).map((e) => ['Lethal', e])];
  return list.map(([kind, e]) => {
    const loadouts = STOCK_LOADOUTS.filter((l) => l.tactical === e.id || l.lethal === e.id).map((l) => l.name);
    const behaviour = [e.passive && 'passive', e.placed && 'placed on the ground', e.sticky && 'sticks to surfaces and players', e.impact && 'detonates on impact', e.retrievable && 'retrievable', e.burn && `burns ${e.burn} s`].filter(Boolean).join(', ') || `fuse ${e.fuse} s, bounces`;
    return {
      id: 'equipment:' + e.id, name: e.name, category: 'Equipment', group: kind, view: 'iso', grounded: true, desc: e.desc,
      tags: ['equipment', 'grenade', kind.toLowerCase(), e.shape], source: `src/game/equipment.js · ${kind === 'Tactical' ? 'TACTICALS' : 'LETHALS'}.${e.id}`,
      build: () => { const m = buildThrowableMesh(e); const g = new THREE.Group(); g.add(m); m.position.y = 0.08; g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g; },
      usage: loadouts.length, usageLabel: loadouts.length ? `Stock loadouts: ${loadouts.join(', ')}` : 'Custom loadouts and bots only',
      info: [['Type', kind], ['Count', e.count], ['Behaviour', behaviour], ...(e.radius ? [['Radius', e.radius + ' m']] : []), ...(e.damage ? [['Damage', e.damage]] : []), ...(e.throwSpeed ? [['Throw speed', e.throwSpeed + ' m/s']] : []), ['Mesh shape', e.shape]],
      notes: 'Small hand-held / thrown object. Origin at its centre. Spins in flight; the real size is a few centimetres, so detail needs to read at distance.',
    };
  });
}

// ---------------- props ----------------
const PROP_INFO = {
  car: ['Vehicles', 'Parked sedan; random paint, optional burnt-wreck variant.'], van: ['Vehicles', 'Panel van with optional side lettering.'], truck: ['Vehicles', 'Box truck with cab.'], bus: ['Vehicles', 'City bus.'],
  lamp: ['Street furniture', 'Street lamp with emissive head; optionally casts light.'], pole: ['Street furniture', 'Wooden utility pole with crossbar.'], trafficlight: ['Street furniture', 'Traffic light on a mast arm.'], hydrant: ['Street furniture', 'Fire hydrant.'], bollard: ['Street furniture', 'Steel bollard.'], bench: ['Street furniture', 'Park bench.'], picnic: ['Street furniture', 'Picnic table with benches.'], busstop: ['Street furniture', 'Bus shelter with glass back and ad panel.'], phonebooth: ['Street furniture', 'Phone booth.'], newsstand: ['Street furniture', 'Newsstand kiosk with sign.'], sign: ['Street furniture', 'Post-mounted street sign (double-sided).'], stopsign: ['Street furniture', 'Stop sign.'], billboard: ['Street furniture', 'Pole billboard with printed ad.'], neonSign: ['Street furniture', 'Emissive neon sign; optionally casts coloured light.'], flag: ['Street furniture', 'Flag pole with striped cloth.'],
  barrier: ['Cover & barriers', 'Concrete jersey barrier.'], jersey: ['Cover & barriers', 'Alias of the jersey barrier.'], barricade: ['Cover & barriers', 'Police barricade with stripe and lettering.'], cone: ['Cover & barriers', 'Traffic cone.'], sandbags: ['Cover & barriers', 'Sandbag wall (three rows).'], crate: ['Cover & barriers', 'Wooden crate (1–1.5 m).'], pallet: ['Cover & barriers', 'Wooden pallet.'], container: ['Cover & barriers', 'Shipping container, corrugated.'], barrel: ['Cover & barriers', 'Oil drum.'], dumpster: ['Cover & barriers', 'Dumpster with lid.'], trashcan: ['Cover & barriers', 'Metal trash can.'], tires: ['Cover & barriers', 'Stack of tyres.'],
  trashpile: ['Clutter', 'Pile of trash bags.'], rubble: ['Clutter', 'Concrete rubble pile.'], mattress: ['Clutter', 'Dumped mattress.'], cart: ['Clutter', 'Shopping cart with bags.'], laundry: ['Clutter', 'Laundry line with hanging clothes.'], ac: ['Clutter', 'Window AC unit (wall-mounted).'], antenna: ['Clutter', 'Rooftop antenna.'], dish: ['Clutter', 'Satellite dish.'], pipes: ['Clutter', 'Stack of large pipes.'], tarp: ['Clutter', 'Tarp shelter on poles with a box underneath.'], tent: ['Clutter', 'Pop-up tent.'],
  tree: ['Nature', 'Leafy street tree (three canopy blobs).'], palm: ['Nature', 'Palm tree.'], deadtree: ['Nature', 'Dead tree with bare branches.'], bush: ['Nature', 'Bush.'], planter: ['Nature', 'Concrete planter with shrubs.'],
  statue: ['Landmarks', 'Statue on a pedestal; optional equestrian version.'], fountain: ['Landmarks', 'Fountain with water basin and spire.'], obelisk: ['Landmarks', 'Obelisk with gold tip.'], shrine: ['Landmarks', 'Street shrine with candles (casts light).'],
  shack: ['Structures', 'Corrugated shanty shack, enterable, with barrels.'], scaffold: ['Structures', 'Scaffolding with walkable plank levels.'], watertower: ['Structures', 'Rooftop water tower on legs.'], overpass: ['Structures', 'Elevated concrete overpass with pillars and side walls.'], court: ['Structures', 'Sports court surface with line markings (flat).'], hoop: ['Structures', 'Basketball hoop.'], stall: ['Structures', 'Market stall with striped awning and produce.'], grave: ['Structures', 'Headstone with cross.'], tomb: ['Structures', 'Above-ground tomb.'],
};
const PROP_NAMES = { ac: 'AC unit', neonSign: 'Neon sign', trafficlight: 'Traffic light', busstop: 'Bus stop', phonebooth: 'Phone booth', newsstand: 'Newsstand', stopsign: 'Stop sign', watertower: 'Water tower', deadtree: 'Dead tree', trashcan: 'Trash can', trashpile: 'Trash pile', jersey: 'Jersey barrier', barrier: 'Concrete barrier', hoop: 'Basketball hoop', court: 'Sports court', dish: 'Satellite dish', picnic: 'Picnic table', tires: 'Tyre stack', cart: 'Shopping cart', pipes: 'Pipe stack', pallet: 'Pallet', tomb: 'Tomb', grave: 'Gravestone' };
const PROP_VIEW = { court: 'top', laundry: 'front', billboard: 'front', neonSign: 'front', sign: 'front', stopsign: 'front', overpass: 'iso' };
function propBuilder() { return new MapBuilder({ id: 'catalog', size: 160, seed: 3, lightBudget: 0, immediateKit: true }); }
function colliderSize(world) {
  if (!world.boxes.length) return 'none (visual only)';
  const b = new THREE.Box3(); for (const x of world.boxes) b.union(new THREE.Box3(x.min, x.max)); const s = b.getSize(V());
  return `${world.boxes.length} box${world.boxes.length > 1 ? 'es' : ''}, ${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} m`;
}
function propItems() {
  return PROP_TYPES.map((t) => {
    const [group, desc] = PROP_INFO[t] || ['Misc', 'Map prop.'];
    let collider = '';
    return {
      id: 'prop:' + t, name: PROP_NAMES[t] || t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), category: 'Props', group, view: PROP_VIEW[t] || 'iso', desc,
      tags: ['prop', group.toLowerCase(), t], source: `src/maps/builder.js · PROPS.${t}`, usageKey: 'prop:' + t,
      build() { const b = propBuilder(); b.prop(t, { x: 0, z: 0, rot: 0 }); collider = colliderSize(b.world); this.info = [['Collider', collider], ['Placement', "b.prop('" + t + "', { x, z, rot, ... })"]]; return b.group; },
      info: [], notes: 'Placed on the ground at (x, z) with rotation around Y. Collision uses axis-aligned boxes (listed above); a reskin should keep roughly the same footprint so cover and navigation still work.',
    };
  });
}

// ---------------- structures ----------------
function structureItems() {
  const S = [];
  const add = (key, name, group, desc, build, usageKey, info = [], view = 'iso') => S.push({ id: 'structure:' + key, name, category: 'Structures', group, desc, view, tags: ['structure', group.toLowerCase(), key], source: 'src/maps/builder.js · MapBuilder', usageKey, build, info, notes: 'Built from textured boxes at any size; dimensions shown are this sample. Facade textures tile one window bay every ~9 m horizontally and two floors vertically.' });
  for (const [style, desc] of [['brick', 'Red-brick block with parapet and rooftop clutter.'], ['concrete', 'Concrete block.'], ['plaster', 'Painted plaster block (pastel palette).'], ['glass', 'Glass-curtain tower.'], ['tenement', 'Tenement block with balconies.'], ['shanty', 'Corrugated shanty block with overhanging roof.']]) {
    add('building-' + style, `Building — ${style}`, 'Buildings', desc, () => { const b = propBuilder(); b.building({ x: 0, z: 0, w: 10, d: 10, h: 12, style, seed: 11 }); return b.group; }, 'building:' + style, [['Call', `b.building({ x, z, w, d, h, style: '${style}' })`], ['Floor height', '3.2 m']]);
  }
  for (const [style, desc] of [['concrete', 'Enterable concrete room with doorway, window gaps and roof.'], ['brick', 'Enterable brick room.'], ['plaster', 'Enterable plaster room.'], ['shanty', 'Enterable corrugated room.']]) {
    add('shell-' + style, `Enterable shell — ${style}`, 'Interiors', desc, () => { const b = propBuilder(); b.shell({ x: 0, z: 0, w: 8, d: 6, h: 4, style, doors: ['s'] }); return b.group; }, 'shell:' + style, [['Call', `b.shell({ x, z, w, d, h, style: '${style}', doors: ['s'] })`], ['Door', '1.6 × 2.3 m gap']]);
  }
  add('stairs', 'Stairs', 'Access', 'Concrete stair run with rails and top landing; connects roofs and platforms.', () => { const b = propBuilder(); b.stairs({ x: 0, z: 0, dir: 'n', height: 3.4, width: 2 }); return b.group; }, 'stairs', [['Step', '0.34 m rise, 0.62 m run']]);
  add('platform', 'Elevated platform', 'Access', 'Walkable slab with side rails (bridges, catwalks, train platforms).', () => { const b = propBuilder(); b.platform({ x: 0, z: 0, w: 8, d: 3, y: 3 }); return b.group; }, 'platform');
  add('wall', 'Wall with graffiti', 'Walls & fences', 'Concrete wall segment with a graffiti decal on both sides.', () => { const b = propBuilder(); b.wall({ x: 0, z: 0, len: 8, h: 2.6, graffiti: 'GB' }); return b.group; }, 'wall', [], 'front');
  add('fence', 'Chain-link fence', 'Walls & fences', 'Chain-link panel with posts (see-through, blocks movement).', () => { const b = propBuilder(); b.fence({ x: 0, z: 0, len: 8 }); return b.group; }, 'fence', [], 'front');
  add('road', 'Road segment', 'Ground', 'Asphalt road with centre markings and raised sidewalks.', () => { const b = propBuilder(); b.road(-10, 0, 10, 0, 10, { sidewalk: true }); return b.group; }, 'road', [['Call', 'b.road(x1, z1, x2, z2, width, { sidewalk })']], 'top');
  return S;
}

// ---------------- textures ----------------
const TEXTURES = [
  ['brick', {}, 'Surfaces'], ['concrete', {}, 'Surfaces'], ['plaster', {}, 'Surfaces'], ['asphalt', {}, 'Ground'], ['sidewalk', {}, 'Ground'], ['dirt', {}, 'Ground'], ['grass', {}, 'Ground'], ['cobble', {}, 'Ground'], ['tile', {}, 'Ground'], ['water', {}, 'Ground'],
  ['metal', {}, 'Surfaces'], ['corrugated', {}, 'Surfaces'], ['cloth', {}, 'Surfaces'],
  ['facade', { style: 'brick', wall: '#8a3b2a' }, 'Facades', 'Facade — brick'], ['facade', { style: 'plain', wall: '#d9c9a3' }, 'Facades', 'Facade — plaster / concrete'], ['facade', { style: 'glass', wall: '#2d4a66' }, 'Facades', 'Facade — glass'],
  ['graffiti', { text: 'GB' }, 'Decals'], ['sign', { text: 'LIQUOR' }, 'Decals'], ['neon', { text: 'OPEN' }, 'Decals'], ['roadMarks', {}, 'Decals'],
  ['particle', {}, 'VFX'], ['muzzle', {}, 'VFX'], ['flashCore', {}, 'VFX'], ['flashTongue', {}, 'VFX'], ['flashRing', {}, 'VFX'], ['smokePuff', {}, 'VFX'],
];
function textureItems() {
  return TEXTURES.map(([name, params, group, label]) => {
    const t = tex(name, params); const img = t.image;
    return {
      id: 'texture:' + name + (params.style ? '-' + params.style : ''), name: label || name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), category: 'Textures', group,
      desc: `Procedural ${name} texture generated on a canvas at load time.`, tags: ['texture', group.toLowerCase(), name], source: `src/core/textures.js · tex('${name}')`,
      usageKey: 'tex:' + name, image: () => img.toDataURL('image/png'), size2d: `${img.width} × ${img.height} px`, flat: true,
      info: [['Resolution', `${img.width} × ${img.height} px`], ['Wrapping', t.wrapS === THREE.RepeatWrapping ? 'tiling (repeat)' : 'clamped'], ['Parameters', Object.keys(params).length ? JSON.stringify(params) : 'defaults (colour and seed vary per use)']],
      notes: 'Generated procedurally, so it can be replaced by a hand-painted texture with the same name and tiling. Many uses tint or re-seed it; tiling textures should loop seamlessly.',
    };
  });
}

// ---------------- VFX ----------------
const BLACK = '#0d0d12';
function vfxItems() {
  const items = [];
  const container = (fn, settle) => { const g = new THREE.Group(); const fx = new FX(g); fn(fx); for (const dt of settle) fx.update(dt, null); g.userData.fx = fx; return g; };
  for (const [p, P] of Object.entries(MUZZLE_PROFILES)) {
    if (p === 'none') continue;
    items.push({ id: 'vfx:muzzle-' + p, name: `Muzzle flash — ${p}`, category: 'VFX', group: 'Muzzle flashes', view: 'side', grounded: false, background: BLACK, exposure: 1.2,
      desc: `Layered muzzle flash used by ${p} weapons: core bloom, ${P.tongues} flame tongue${P.tongues === 1 ? '' : 's'}${P.jets ? `, ${P.jets} side jets` : ''}${P.ring ? ', shock ring' : ''}, sparks, smoke puff and a ${P.light}-intensity light.`,
      tags: ['vfx', 'muzzle', 'flash', p], source: 'src/core/engine.js · MUZZLE_PROFILES.' + p,
      frame: { center: V(0, 0, Math.max(0.2, P.length * 0.45)), radius: Math.max(0.35, P.length * 0.75) },
      build: () => container((fx) => fx.muzzle(V(), V(0, 0, 1), p), [P.life * 0.3]),
      live: { every: 0.45, spawn: (fx) => fx.muzzle(V(), V(0, 0, 1), p) },
      info: [['Length', P.length + ' m'], ['Core size', P.core + ' m'], ['Life', (P.life * 1000).toFixed(0) + ' ms'], ['Light', `${P.light} @ ${P.lightDist} m`], ['Textures', 'flashCore, flashTongue, flashRing, smokePuff']],
      notes: 'Additive-blended sprites and crossed quads oriented down the barrel (+Z). Randomised roll and length per shot; fast attack, decay with flicker.' });
  }
  items.push({ size2d: '~5 m blast radius', sizeM: 10, id: 'vfx:explosion', name: 'Explosion', category: 'VFX', group: 'Explosions', view: 'iso', grounded: false, background: BLACK, desc: 'Grenade / streak explosion: fireball sparks, smoke, flash sprite and a light.', tags: ['vfx', 'explosion', 'grenade'], source: 'src/core/engine.js · FX.explosion', frame: { center: V(0, 1.2, 0), radius: 4 }, build: () => container((fx) => fx.explosion(V(0, 0.4, 0), 5), [0.06, 0.06]), live: { every: 1.6, spawn: (fx) => fx.explosion(V(0, 0.4, 0), 5) }, info: [['Particles', '40 fire + 30 smoke'], ['Flash', '0.25 s sprite + light']] });
  items.push({ size2d: '~6 m cloud radius', sizeM: 12, id: 'vfx:smoke', name: 'Smoke grenade cloud', category: 'VFX', group: 'Explosions', view: 'iso', grounded: false, background: '#2a2d33', desc: 'Smoke grenade cloud that blocks bot vision for 14 s.', tags: ['vfx', 'smoke'], source: 'src/core/engine.js · FX.smoke', frame: { center: V(0, 2, 0), radius: 5 }, build: () => container((fx) => fx.smoke(V(), 6, 14), [1, 1, 1]), info: [['Sprites', 14], ['Life', '14 s']] });
  items.push({ size2d: '~0.5 m debris spray', sizeM: 0.5, id: 'vfx:impact', name: 'Bullet impact', category: 'VFX', group: 'Impacts', view: 'iso', grounded: false, background: BLACK, desc: 'Surface hit: debris particles and a dust puff.', tags: ['vfx', 'impact', 'bullet'], source: 'src/core/engine.js · FX.impact', frame: { center: V(0, 0.3, 0.3), radius: 1 }, build: () => container((fx) => fx.impact(V(0, 0.2, 0), V(0, 0.3, 1).normalize(), 'concrete'), [0.05]), live: { every: 0.5, spawn: (fx) => fx.impact(V(0, 0.2, 0), V(0, 0.3, 1).normalize(), 'concrete') } });
  items.push({ size2d: '~1 m spray', sizeM: 1, id: 'vfx:blood', name: 'Plastic chip hit', category: 'VFX', group: 'Impacts', view: 'iso', grounded: false, background: BLACK, desc: 'Player / bot hit: a spray of chips in the victim\'s plastic colour plus white stress flecks (toy reskin; replaces the blood splash).', tags: ['vfx', 'hit', 'chips', 'plastic'], source: 'src/core/engine.js · FX.blood', frame: { center: V(0, 1, 0), radius: 1.2 }, build: () => container((fx) => fx.blood(V(0, 1, 0)), [0.06]), live: { every: 0.6, spawn: (fx) => fx.blood(V(0, 1, 0)) } });
  return items;
}

// ---------------- streak icons ----------------
const TIER = { starter: '#7cd3ff', medium: '#ffd166', powerful: '#ff7a1a' };
function iconItems() {
  const byId = new Map();
  for (const m of MAPS) { const s = streaksForMap(m.id); for (const tier of ['starter', 'medium', 'powerful']) for (const st of s[tier]) { if (!byId.has(st.id)) byId.set(st.id, { st, tier, maps: [] }); byId.get(st.id).maps.push(m.name); } }
  return [...byId.values()].map(({ st, tier, maps }) => ({
    id: 'icon:streak-' + st.id, name: st.name, category: 'Icons', group: `Streak — ${tier}`, desc: st.desc, flat: true, iconBg: true,
    tags: ['icon', 'streak', tier, st.effect], source: 'src/ui/icons.js · streakIcon / src/game/streaks.js',
    image: () => streakIcon(st.effect, TIER[tier], 192), size2d: 'vector glyph, rendered at any size',
    usage: maps.length, usageLabel: maps.length === MAPS.length ? 'Every map' : maps.join(', '),
    info: [['Tier', tier], ['Cost', st.cost + ' score'], ['Effect', st.effect], ['Maps', maps.length === MAPS.length ? 'all 7' : maps.join(', ')]],
    notes: 'Canvas-drawn glyph keyed by effect type; several streaks share a glyph. Shown on the loadout screen (tier colour when selected) and in the HUD streak slots (white).',
  }));
}

// ---------------- maps ----------------
function mapItems() {
  return MAPS.map((m) => ({ id: 'map:' + m.id, name: m.name, category: 'Maps', group: m.city, desc: `${m.name} — based on ${m.city}.`, tags: ['map', m.city.toLowerCase(), m.id], source: `src/maps/${m.id}.js`, mapId: m.id, flat: true, pending: true, info: [], notes: 'Analysed in the browser when the catalog loads: built from its module, photographed from its first cinematic camera, and scanned for prop usage and texture coverage.' }));
}

export function buildRegistry() {
  return [...characterItems(), ...weaponItems(), ...equipmentItems(), ...propItems(), ...structureItems(), ...mapItems(), ...textureItems(), ...vfxItems(), ...iconItems()];
}
