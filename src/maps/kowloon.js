// KOWLOON — Hong Kong at night. A walled-city maze of thin tenements dripping with neon, a wet market under
// tarps, a red Tin Hau temple, tong lau rooftops joined by a footbridge over Nathan Road, red taxis and
// green minibuses. Mong Kok / Sham Shui Po after dark.
import { MapBuilder, mat } from './builder.js';

export const def = {
  id: 'kowloon', name: 'Kowloon', city: 'Hong Kong', size: 160, seed: 88,
  teams: { tdm: 4, ffa: 7 },
  blurb: 'Hong Kong after dark. Neon alleys, a wet market, tong lau rooftops and a footbridge over Nathan Road.',
  env: { night: true, skyTop: '#0e1532', skyHorizon: '#43396e', skyBottom: '#0b0b16', fogColor: '#2a2b4e', fogNear: 55, fogFar: 220, hemiSky: '#6f80c8', hemiGround: '#3a3052', hemiIntensity: 1.4, sunColor: '#b4c3ff', sunIntensity: 1.7, sunDir: [-0.3, 0.9, 0.4], ambient: '#3c3c64', ambientIntensity: 0.55, shadowSize: 90, exposure: 1.5, lightBoost: 2.2 },
  lightBudget: 24,
  minimapBg: '#16141c',
};

const PI = Math.PI, H = PI / 2;
const TEAL = '#5f8a86', TEAL2 = '#6f9a94', PINK = '#b07a86', PINK2 = '#c48a94', GREY = '#7d7f82', GREY2 = '#8a9a98', MAUVE = '#a08a90', SLATE = '#6f7f85', MINT = '#9aa5a0', ROSE = '#b59aa0';
const TAXI = '#c0392b', MINIBUS = '#2f6f3f';

export function build() {
  const b = new MapBuilder(def);
  b.ground('asphalt', { seed: 9, color: '#26262c' });

  // =====================================================================================
  // LIGHTS FIRST (budget 24): the ones that matter most are claimed before anything else.
  // 3 shrine lights are claimed later by the temple shrines (they always add one each).
  // =====================================================================================
  // street lamps along Nathan Road (z=0) and the two N-S streets (x=±32)
  const litLamps = [[-62, -8.6, PI], [-18, 7.4, 0], [18, -7.4, PI], [62, 8.6, 0], [-38.9, -30, H], [-25.6, 30, -H], [25.6, -30, H], [38.9, 30, -H], [-26, -58.4, 0], [26, 58.4, PI]];
  for (const [x, z, r] of litLamps) b.prop('lamp', { x, z, rot: r, light: true, lightColor: '#ffd9a0' });
  // red lantern glow at the temple gate
  b.light(0, 3.2, 30.5, '#ff3a2a', 7, 14);

  // =====================================================================================
  // STREETS. Nathan Road E-W through the middle; Shanghai St / Tung Choi St N-S; two E-W cross streets.
  // =====================================================================================
  b.road(-77, 0, 77, 0, 12, { sidewalk: true });
  b.road(-32, -77, -32, 77, 9, { sidewalk: true });
  b.road(32, -77, 32, 77, 9, { sidewalk: true });
  b.road(-77, -52, 77, -52, 8, { sidewalk: true });
  b.road(-77, 52, 77, 52, 8, { sidewalk: true });
  // pedestrianised wet-market section of the north cross street
  b.patch(0, -52, 50, 8.4, 'tile', { seed: 3, color: '#6d6a66', line: '#3b3936', size: 24, mmColor: '#55524e' }, 0.035);
  for (const x of [-32, 32]) for (const z of [-52, 0, 52]) b.prop('trafficlight', { x: x + 6, z: z - 6, rot: PI });
  // unlit lamps for silhouette
  for (const [x, z, r] of [[-64, 7.4, 0], [50, 8.6, 0], [-38.9, 30, H], [38.9, -30, -H], [-60, -45.6, 0], [74, 45.6, PI]]) b.prop('lamp', { x, z, rot: r });

  // =====================================================================================
  // WALLED CITY (north-centre block): 5 columns x 3 rows of 25-40 m tenements, 3.5 m alleys.
  // =====================================================================================
  const wcCols = [-20, -10, 0, 10, 20], wcRows = [-42, -32.5, -23];
  const wcSpec = [
    // row z=-42 (north face on the market street)
    [{ h: 32, c: TEAL, s: 'concrete', sign: '金城大廈', sc: '#c9a227' }, { h: 28, c: PINK, s: 'plaster' }, { h: 36, c: GREY, s: 'concrete', name: 'Walled City', graffiti: 'HK' }, { h: 30, c: MINT, s: 'plaster' }, { h: 26, c: MAUVE, s: 'concrete' }],
    // row z=-32.5 (middle; x=0 dropped for the courtyard)
    [{ h: 34, c: SLATE, s: 'concrete', graffiti: '九龍' }, { h: 38, c: TEAL2, s: 'plaster' }, null, { h: 29, c: GREY2, s: 'concrete' }, { h: 31, c: PINK2, s: 'plaster' }],
    // row z=-23 (south face on the dai pai dong lane)
    [{ h: 27, c: ROSE, s: 'plaster', sign: '麻雀', sc: '#1f7a4a' }, { h: 35, c: GREY, s: 'concrete' }, { h: 33, c: TEAL, s: 'plaster', sign: '茶餐廳', sc: '#b3121b' }, { h: 30, c: PINK, s: 'concrete', graffiti: 'KWC' }, { h: 28, c: SLATE, s: 'plaster', sign: 'PAWN', sc: '#c9a227' }],
  ];
  wcRows.forEach((z, ri) => wcCols.forEach((x, ci) => {
    const s = wcSpec[ri][ci]; if (!s) return;
    b.building({ x, z, w: 6.5, d: 6, h: s.h, style: s.s, color: s.c, lit: 0.5 + ((ri * 5 + ci) % 5) * 0.05, floors: Math.round(s.h / 3), sign: s.sign || null, signColor: s.sc || '#b3121b', graffiti: s.graffiti || null, name: s.name || null, rot: ri === 2 ? 0 : PI, winColor: '#241c22', rooftop: false, roof: 'flat' });
  }));
  // the dropped slot becomes a tiny courtyard: well, shrine-less junk, laundry
  b.prop('tires', { x: -2.2, z: -34.4 }); b.prop('crate', { x: 2.2, z: -30.6, size: 1.0 });
  b.prop('barrel', { x: -2.3, z: -30.5 }); b.prop('cart', { x: 2.3, z: -34.3, rot: 0.6 });
  b.prop('laundry', { x: 0, z: -32.5, rot: 0, y: 5, len: 6 }); b.prop('laundry', { x: 0, z: -30.5, rot: 0, y: 8, len: 6 });
  // neon hanging perpendicular over the N-S alleys (x=±15, ±5) and E-W alleys
  const wcNeon = [
    { x: -15, z: -40, y: 6, text: '麻雀', color: '#ff2d95', light: true }, { x: -15, z: -27, y: 8, text: 'KTV', color: '#00e5ff', light: false },
    { x: -5, z: -36, y: 7, text: '金', color: '#ffd166', light: true }, { x: -5, z: -24, y: 5, text: 'HK', color: '#ff3b3b', light: false },
    { x: 5, z: -42, y: 6, text: '茶餐廳', color: '#ff2d95', light: false }, { x: 5, z: -30, y: 8.5, text: 'NOODLE', color: '#00e5ff', light: true },
    { x: 15, z: -38, y: 5.5, text: 'PAWN', color: '#ffd166', light: false }, { x: 15, z: -25, y: 7.5, text: '藥', color: '#ff3b3b', light: false },
  ];
  for (const n of wcNeon) b.prop('neonSign', { x: n.x, z: n.z, rot: 0, y: n.y, w: 3, text: n.text, color: n.color, light: n.light });
  for (const [x, z, text, color] of [[-10, -37.25, '金舖', '#ffd166'], [10, -27.75, 'KTV', '#ff2d95'], [-20, -27.75, '涼茶', '#00e5ff'], [20, -37.25, '按', '#ff3b3b']]) b.prop('neonSign', { x, z, rot: H, y: 6.5, w: 3, text, color, light: false });
  // laundry lines across the alleys, AC units on the walls
  for (const [x, z, y] of [[-15, -35, 4.5], [-15, -22, 6], [5, -38, 7], [15, -34, 5.5], [-5, -27, 9]]) b.prop('laundry', { x, z, rot: 0, y, len: 3.4 });
  for (const [x, z, y] of [[-10, -40.5, 6.5], [-10, -40.5, 9.5], [0, -35.5, 7], [10, -45.3, 5], [-20, -45.3, 8], [20, -26.3, 6], [10, -19.7, 4.5], [-10, -19.7, 7.5]]) b.prop('ac', { x, z, y, rot: 0 });
  for (const [x, z, y] of [[-16.75, -42, 5], [-16.75, -32.5, 11], [6.75, -23, 6], [23.25, -32.5, 9], [-23.25, -23, 4]]) b.prop('ac', { x, z, y, rot: H });
  // bamboo scaffolding wrapping the SE tenement
  b.prop('scaffold', { x: 20, z: -19.3, rot: 0, h: 14, len: 6.5 });
  // alley clutter
  b.prop('dumpster', { x: -25, z: -47, rot: H, color: '#2f5f3f' }); b.prop('trashcan', { x: 5, z: -44.5 }); b.prop('crate', { x: 15.6, z: -42.8, size: 1.0 });
  b.prop('barrel', { x: -5.6, z: -29.6 }); b.prop('trashpile', { x: 15, z: -30 }); b.prop('mattress', { x: -14.7, z: -31, rot: 0.2 });
  b.prop('trashcan', { x: 6.4, z: -37 }); b.prop('trashcan', { x: -5.5, z: -21 });

  // =====================================================================================
  // DAI PAI DONG LANE (z -20..-8): food stalls under tarps, footbridge landing platform + twin stairs.
  // =====================================================================================
  b.platform({ x: 0, z: -15, w: 6, d: 6, y: 6.4, t: 0.4, rails: false });
  for (const sx of [-2.5, 2.5]) b.box({ x: sx, z: -17.6, w: 0.5, h: 6.4, d: 0.5, m: mat('concrete', { color: '#6a6a66', seed: 7 }), walkable: false });
  b.stairs({ x: 16.6, z: -15, dir: 'w', height: 6.8, width: 2 });
  b.stairs({ x: -16.6, z: -15, dir: 'e', height: 6.8, width: 2 });
  b.prop('overpass', { x: 0, z: -1.5, rot: 1, len: 21, w: 4, y: 6 });
  b.prop('neonSign', { x: 0, z: -9.2, rot: 0, y: 9.2, w: 4.5, text: '旺角', color: '#ff2d95', light: true });
  for (const [x, c] of [[-20, '#c0392b'], [-13, '#f39c12'], [13, '#27ae60'], [20, '#c0392b']]) b.prop('stall', { x, z: -11, rot: 0, color: c });
  b.prop('tarp', { x: -8.5, z: -11.5, rot: 0, color: '#2a5a8a' }); b.prop('tarp', { x: 8.5, z: -11.5, rot: 0, color: '#8a7a4a' });
  b.prop('picnic', { x: -20, z: -13.6, rot: 0 }); b.prop('picnic', { x: 20, z: -13.6, rot: 0 }); b.prop('picnic', { x: -10, z: -18.6, rot: 0 }); b.prop('picnic', { x: 10, z: -18.6, rot: 0 });
  b.prop('barrel', { x: -22.6, z: -16, color: '#2a5a8a' }); b.prop('barrel', { x: 22.6, z: -16, color: '#8a2a2a' }); b.prop('crate', { x: -22.5, z: -12.5, size: 1.2 }); b.prop('crate', { x: 22.5, z: -12.5, size: 1.0 });
  b.prop('neonSign', { x: -16.5, z: -13.3, rot: H, y: 4.2, w: 3.2, text: '大排檔', color: '#ffd166', light: false });
  b.prop('neonSign', { x: 16.5, z: -13.3, rot: H, y: 4.2, w: 3.2, text: 'NOODLE', color: '#00e5ff', light: false });

  // =====================================================================================
  // TONG LAU ROW (z 8.5..17.5): four enterable shophouses whose roofs form one long rooftop,
  // reached by stairs at both ends and by the footbridge from the north.
  // =====================================================================================
  const shops = [{ x: -18, c: '#6f8f8a', sign: 'GOLDEN PAWN', sc: '#c9a227', name: 'Golden Pawn' }, { x: -6, c: '#b08088', sign: '茶餐廳', sc: '#b3121b' }, { x: 6, c: '#8a8a84', sign: 'KTV', sc: '#6a1f8f' }, { x: 18, c: '#9a8f78', sign: 'NOODLE', sc: '#1f7a4a' }];
  for (const s of shops) b.shell({ x: s.x, z: 13, w: 12, d: 9, h: 6.5, doors: ['n', 's'], windows: false, style: 'plaster', color: s.c, lit: 0.5, sign: s.sign, signColor: s.sc, name: s.name || null });
  b.stairs({ x: -25, z: 26, dir: 'n', height: 6.8, width: 2 });
  b.stairs({ x: 25, z: 26, dir: 'n', height: 6.8, width: 2 });
  // hanging neon over the Nathan Road sidewalk
  for (const [x, text, color, light] of [[-21.5, 'PAWN', '#ffd166', true], [-9.5, '茶餐廳', '#ff2d95', false], [2.5, 'KTV', '#6a5cff', true], [14.5, 'NOODLE', '#00e5ff', false], [21.5, '金', '#ff3b3b', false]]) b.prop('neonSign', { x, z: 7.0, rot: H, y: 4.6, w: 3, text, color, light });
  b.prop('neonSign', { x: -14, z: 8.3, rot: 0, y: 6.0, w: 4, text: 'HK', color: '#ff2d95', light: false });
  for (const [x, c] of [[-18, '#b3121b'], [6, '#1f4f8f']]) b.awning(x, 13, 12, 9, PI, c, b.rng);
  // rooftop life
  const R = 6.8;
  b.box({ x: 0, y: R, z: 8.75, w: 48, h: 0.8, d: 0.3, m: mat('concrete', { color: '#6a6a66', seed: 7 }) });
  for (const [x, z, r] of [[-21, 15.5, 0.3], [-9, 10.5, 1.0], [3, 16, 2.1], [12, 10.5, 0.4], [21, 15, 1.6], [-3, 12, 0.8]]) b.prop('ac', { x, z, y: R, rot: r });
  for (const [x, z] of [[-15, 11], [9, 15.5], [23, 10]]) b.prop('antenna', { x, z, y: R, h: 4 });
  for (const [x, z, r] of [[-11, 16, 0.5], [16, 11, 2.4], [-23, 11, 1.1]]) b.prop('dish', { x, z, y: R, rot: r });
  b.prop('laundry', { x: -6, z: 14, rot: 0, y: R + 1.9, len: 6 }); b.prop('laundry', { x: 14, z: 13.5, rot: 0, y: R + 1.9, len: 5 });
  b.prop('watertower', { x: -18, z: 13.5, y: R, h: 2.6 }); b.prop('watertower', { x: 18, z: 14.5, y: R, h: 2.2 });
  b.box({ x: -2, y: R, z: 15.5, w: 3.2, h: 2.2, d: 2.6, m: mat('corrugated', { seed: 21, rust: 0.7 }) }); // rooftop hut
  b.prop('crate', { x: 9, z: 11, y: R, size: 1.0 }); b.prop('barrel', { x: 8, z: 16.5 }); b.box({ x: 6.5, y: R, z: 16.3, w: 1, h: 1, d: 1, m: mat('plaster', { color: '#9c7a4a', seed: 5 }) });

  // =====================================================================================
  // TIN HAU TEMPLE + courtyard (south-centre)
  // =====================================================================================
  b.shell({ x: 0, z: 38, w: 20, d: 12, h: 6, doors: ['n'], windows: false, style: 'plaster', color: '#9b2226', interior: true, name: 'Tin Hau Temple', sign: '天后古廟', signColor: '#c9a227' });
  const tileGreen = mat('concrete', { color: '#2f5f4f', seed: 13 });
  b.box({ x: 0, y: 6.3, z: 38, w: 21.4, h: 0.5, d: 13.4, m: tileGreen });
  b.box({ x: 0, y: 6.8, z: 38, w: 19, h: 0.5, d: 6, m: tileGreen });
  b.box({ x: 0, y: 7.3, z: 38, w: 17, h: 0.4, d: 1.2, m: mat('color', { color: '#c9a227', rough: 0.4, metal: 0.5 }) });
  b.stairs({ x: 11, z: 25, dir: 's', height: 6.8, width: 2 });
  b.prop('shrine', { x: 0, z: 42.5, rot: PI });
  b.plaza(0, 25, 44, 13, 'tile', { seed: 4, color: '#8a7a6a', line: '#4a3f36', size: 28, mmColor: '#5a4f45' });
  for (const s of [-1, 1]) { b.wall({ x: s * 23.5, z: 26, len: 12, h: 1.4, rot: H, color: '#8a2a2a' }); b.wall({ x: s * 23.5, z: 41, len: 8, h: 1.4, rot: H, color: '#8a2a2a' }); }
  for (const s of [-1, 1]) { b.prop('shrine', { x: s * 7, z: 24, rot: s < 0 ? H : -H }); b.prop('tree', { x: s * 19, z: 28, scale: 1.3, color: '#3f5a3a' }); b.prop('bench', { x: s * 15, z: 22, rot: 0 }); b.prop('planter', { x: s * 12, z: 19.5, rot: 0, w: 3 }); }
  b.cylinder(0, 0, 27, 1.1, 1.5, mat('metal', { color: '#6a5a2a', rust: 0.6, seed: 2 }), 12, true); // incense urn
  const lanternMat = mat('color', { color: '#ff4a3a', rough: 0.6 }, { emissive: '#ff2a1a', emissiveIntensity: 1.6 });
  for (let i = -3; i <= 3; i++) { b.box({ x: i * 2.4, y: 4.3, z: 31.4, w: 0.5, h: 0.7, d: 0.5, m: lanternMat, collide: false }); b.box({ x: i * 2.4, y: 3.8, z: 20.5, w: 0.5, h: 0.7, d: 0.5, m: lanternMat, collide: false }); }
  b.box({ x: 0, y: 4.65, z: 31.4, w: 21, h: 0.04, d: 0.04, m: mat('color', { color: '#ddd' }), collide: false });
  b.box({ x: 0, y: 4.15, z: 20.5, w: 21, h: 0.04, d: 0.04, m: mat('color', { color: '#ddd' }), collide: false });
  for (const x of [-4, 4]) b.cylinder(x, 0, 31.6, 0.35, 5, mat('color', { color: '#8a1a1a', rough: 0.7 }), 10, true); // gate posts
  for (const x of [-8, -2, 2, 8]) b.prop('bollard', { x, z: 19 });
  b.prop('trashcan', { x: -22, z: 21 }); b.prop('trashcan', { x: 22, z: 35 });
  // east side of the courtyard: scooter-ish clutter near the roof stairs
  b.prop('crate', { x: 15, z: 40, size: 1.2 }); b.prop('crate', { x: 16.4, z: 40.2, size: 1.0 }); b.prop('barrel', { x: 14, z: 43 });
  b.prop('car', { x: -16, z: 40, rot: H, color: TAXI }); b.prop('dumpster', { x: -20, z: 44, rot: 0 });

  // =====================================================================================
  // NORTH STRIP: Wet market hall + flanking tenements; stalls along the pedestrian street.
  // =====================================================================================
  b.shell({ x: 0, z: -68, w: 30, d: 16, h: 6, doors: ['s', 'e', 'w'], style: 'concrete', color: '#6f7a78', interior: true, name: 'Wet Market', sign: '街市', signColor: '#1f7a4a', lit: 0.4 });
  for (const [x, z, c] of [[-10, -72, '#c0392b'], [10, -72, '#2980b9'], [0, -64, '#f39c12']]) b.prop('stall', { x, z, rot: 0, color: c });
  b.prop('neonSign', { x: 0, z: -59.4, rot: 0, y: 5.2, w: 5, text: '街市 MARKET', color: '#00e5ff', light: true });
  b.building({ x: -22, z: -68, w: 6, d: 16, h: 14, style: 'plaster', color: PINK2, lit: 0.55, graffiti: 'SSP' });
  b.building({ x: 22, z: -68, w: 6, d: 16, h: 12, style: 'concrete', color: TEAL, lit: 0.6, sign: '魚', signColor: '#1f4f8f' });
  // market stalls on both sidewalks (aligned with the walled city columns so the alleys stay open)
  for (const x of [-20, -10, 0, 10, 20]) b.prop('stall', { x, z: -47, rot: 0 });
  for (const x of [-10, 10]) b.prop('stall', { x, z: -57, rot: 0 });
  for (const x of [-15, 15]) b.prop('tarp', { x, z: -57.2, rot: 0, color: '#2a5a8a' });
  for (const x of [-5, 5]) b.prop('tarp', { x: x * 1.0, z: -57.2, rot: 0, color: '#8a7a4a' });
  for (const [x, text, color, light] of [[-24, '魚', '#00e5ff', false], [-7, '肉', '#ff3b3b', false], [8, '菜', '#2ecc71', false], [24, '果', '#ffd166', false]]) b.prop('neonSign', { x, z: -49, rot: 0, y: 5.5, w: 3, text, color, light });
  for (const x of [-26.5, 26.5]) for (const z of [-54.5, -52, -49.5]) b.prop('bollard', { x, z });
  b.prop('crate', { x: -14, z: -50.5, size: 1.0 }); b.prop('crate', { x: 16, z: -54.8, size: 1.2 }); b.prop('cart', { x: 4, z: -50.8, rot: 2 }); b.prop('barrel', { x: -3, z: -54.6, color: '#2a5a8a' });
  b.prop('trashpile', { x: 18, z: -50.6 }); b.prop('pallet', { x: -9, z: -54.2, rot: 0.3 });

  // =====================================================================================
  // SOUTH STRIP: three tall blocks with a graffiti wall and a taxi rank on Nathan Road's south cross street.
  // =====================================================================================
  b.building({ x: -17, z: 68, w: 14, d: 16, h: 22, style: 'concrete', color: PINK, lit: 0.6, sign: 'HK', signColor: '#ff2d95', rot: PI, floors: 7, roof: 'flat' });
  b.building({ x: 0, z: 68, w: 14, d: 16, h: 30, style: 'plaster', color: TEAL, lit: 0.65, rot: PI, floors: 10, roof: 'flat' });
  b.building({ x: 17, z: 68, w: 14, d: 16, h: 26, style: 'concrete', color: GREY2, lit: 0.55, sign: '富', signColor: '#c9a227', rot: PI, floors: 8, roof: 'flat' });
  b.wall({ x: 0, z: 59, len: 10, h: 2.6, graffiti: 'KOWLOON', color: '#6a6a66' });
  b.prop('neonSign', { x: 0, z: 59.7, rot: 0, y: 9, w: 6, text: 'HK', color: '#ff2d95', light: false });
  b.prop('laundry', { x: -8.5, z: 63, rot: 0, y: 5, len: 3 });
  b.prop('neonSign', { x: 8.5, z: 61, rot: H, y: 6.5, w: 3, text: 'BAR', color: '#00e5ff', light: false });
  for (const [x, r] of [[-20, 0.05], [-14, 0], [-8, -0.05]]) b.prop('car', { x, z: 54.4, rot: r + H, color: TAXI });
  b.prop('sign', { x: -24, z: 58.3, rot: 0, text: 'TAXI', bg: '#c0392b', fg: '#fff' });
  b.prop('busstop', { x: 14, z: 58.5, rot: 0, ad: '九龍' });

  // =====================================================================================
  // WEST SIDE (team 0). W2: tenement yard (NW), W3: fountain square (SW). W1/W4: edge rows.
  // =====================================================================================
  // W1 (NW corner row)
  b.building({ x: -70, z: -68, w: 12, d: 16, h: 14, style: 'tenement', lit: 0.5, graffiti: 'SSP', fireEscape: true });
  b.building({ x: -55, z: -68, w: 10, d: 16, h: 11, style: 'plaster', color: MINT, lit: 0.5, sign: '當', signColor: '#c9a227' });
  b.building({ x: -43, z: -68, w: 8, d: 14, h: 9, style: 'concrete', color: GREY, lit: 0.4 });
  b.prop('dumpster', { x: -62, z: -74, rot: H }); b.prop('trashpile', { x: -62, z: -70 });
  b.prop('van', { x: -66, z: -56.5, rot: H, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });
  // W2 (NW yard)
  b.building({ x: -44.5, z: -38, w: 10, d: 14, h: 18, style: 'tenement', lit: 0.5, graffiti: 'KOWLOON' });
  b.building({ x: -44.5, z: -19, w: 10, d: 18, h: 22, style: 'concrete', color: TEAL2, lit: 0.6, sign: 'HOTEL', signColor: '#1f4f8f', floors: 7, balcony: true, roof: 'flat' });
  b.prop('neonSign', { x: -50.2, z: -24, rot: 0, y: 7, w: 4, text: 'HOTEL', color: '#ff2d95', light: true });
  b.prop('scaffold', { x: -50.4, z: -38, rot: H, h: 12, len: 10 });
  b.shell({ x: -57, z: -40, w: 8, d: 9, h: 5, doors: ['s'], style: 'plaster', color: '#9aa5a0', sign: '麻雀', signColor: '#1f7a4a', lit: 0.5 });
  b.prop('neonSign', { x: -52.6, z: -40, rot: H, y: 4, w: 3, text: '麻雀', color: '#ffd166', light: false });
  b.building({ x: -70, z: -40, w: 12, d: 10, h: 12, style: 'plaster', color: PINK, lit: 0.55 });
  b.building({ x: -70, z: -22, w: 12, d: 12, h: 15, style: 'brick', color: '#7a4a3a', lit: 0.5, graffiti: '深水埗', fireEscape: true });
  b.prop('car', { x: -58, z: -30, rot: 0.1, color: TAXI }); b.prop('car', { x: -63, z: -27, rot: H + 0.1, wreck: true }); b.prop('van', { x: -56, z: -18, rot: H, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });
  b.prop('dumpster', { x: -54, z: -32, rot: 0 }); b.prop('crate', { x: -53, z: -13, size: 1.3 }); b.prop('crate', { x: -54.4, z: -13.2, size: 1.0 }); b.prop('barrel', { x: -66, z: -12 }); b.prop('barrel', { x: -66.8, z: -13.1 });
  b.prop('tent', { x: -72, z: -12, rot: 0.3 }); b.prop('cart', { x: -69, z: -14, rot: 1 }); b.prop('trashcan', { x: -51, z: -10 });
  b.prop('billboard', { x: -70, z: -31, rot: 0, text: '歡迎光臨 九龍', bg: '#1f1f3a', fg: '#ff2d95', w: 9, h: 7 });
  b.fence({ x: -64, z: -10.2, len: 8, h: 2 });
  // W3 (SW fountain square)
  b.building({ x: -44.5, z: 16, w: 10, d: 14, h: 20, style: 'plaster', color: TEAL, lit: 0.6, sign: 'HK PAWN', signColor: '#c9a227', rot: PI, floors: 6, roof: 'flat' });
  b.building({ x: -44.5, z: 36, w: 10, d: 16, h: 26, style: 'concrete', color: PINK2, lit: 0.55, floors: 8, graffiti: 'MK', roof: 'flat' });
  b.prop('neonSign', { x: -50.2, z: 36, rot: 0, y: 6, w: 4, text: 'PAWN', color: '#ffd166', light: false });
  b.plaza(-62, 27, 24, 24, 'tile', { seed: 6, color: '#7a7570', line: '#45413c', size: 20, mmColor: '#4e4a46' });
  b.prop('fountain', { x: -62, z: 27, r: 3, name: 'Lucky Fountain' });
  for (const [x, z, r] of [[-68, 21, 0], [-56, 21, 0], [-68, 33, PI], [-56, 33, PI]]) b.prop('bench', { x, z, rot: r });
  for (const [x, z] of [[-70, 27], [-54, 27]]) b.prop('planter', { x, z, rot: H, w: 3 });
  for (const [x, z] of [[-70, 17], [-54, 17], [-70, 37], [-54, 37]]) b.prop('tree', { x, z, scale: 1.1 });
  b.shell({ x: -72, z: 12, w: 8, d: 7, h: 4.5, doors: ['e'], style: 'concrete', color: '#8a8a84', sign: '粥', signColor: '#b3121b', lit: 0.4 });
  b.building({ x: -72, z: 43, w: 8, d: 6, h: 10, style: 'plaster', color: MAUVE, lit: 0.5 });
  b.prop('newsstand', { x: -58, z: 10.5, rot: PI, text: '報' }); b.prop('phonebooth', { x: -52, z: 10.5, rot: 0, color: '#2a6a2a' });
  b.prop('car', { x: -58, z: 41, rot: H, color: TAXI });
  b.prop('trashcan', { x: -50.5, z: 27 }); b.prop('hydrant', { x: -40.5, z: 10 });
  // W4 (SW corner row)
  b.building({ x: -68, z: 68, w: 14, d: 14, h: 16, style: 'concrete', color: SLATE, lit: 0.5, sign: '海鮮', signColor: '#1f4f8f', rot: PI });
  b.building({ x: -50, z: 68, w: 14, d: 14, h: 12, style: 'plaster', color: ROSE, lit: 0.55, rot: PI, graffiti: 'HK' });
  b.prop('dumpster', { x: -59, z: 72, rot: H }); b.prop('tires', { x: -59, z: 66 });

  // =====================================================================================
  // EAST SIDE (team 1). E2: construction yard (NE), E3: minibus terminus (SE). E1/E4: edge rows.
  // =====================================================================================
  // E1 (NE corner row)
  b.building({ x: 70, z: -68, w: 12, d: 16, h: 15, style: 'plaster', color: TEAL2, lit: 0.55, sign: '餐廳', signColor: '#b3121b' });
  b.building({ x: 55, z: -68, w: 10, d: 16, h: 12, style: 'concrete', color: GREY, lit: 0.5, graffiti: 'MK' });
  b.building({ x: 43, z: -68, w: 8, d: 14, h: 10, style: 'tenement', lit: 0.45 });
  b.prop('dumpster', { x: 62, z: -74, rot: H }); b.prop('crate', { x: 62, z: -70, size: 1.2 });
  b.prop('truck', { x: 66, z: -57, rot: -H });
  // E2 (NE construction yard)
  b.building({ x: 44.5, z: -38, w: 10, d: 14, h: 24, style: 'plaster', color: PINK, lit: 0.6, graffiti: '旺角', roof: 'flat' });
  b.building({ x: 44.5, z: -19, w: 10, d: 18, h: 19, style: 'concrete', color: GREY2, lit: 0.55, sign: 'KTV', signColor: '#6a1f8f', floors: 6 });
  b.prop('neonSign', { x: 50.2, z: -24, rot: 0, y: 7, w: 4, text: 'KTV', color: '#6a5cff', light: true });
  b.prop('scaffold', { x: 50.4, z: -38, rot: H, h: 14, len: 10 });
  b.building({ x: 70, z: -40, w: 12, d: 10, h: 13, style: 'concrete', color: MINT, lit: 0.5, sign: '金', signColor: '#c9a227' });
  b.building({ x: 70, z: -22, w: 12, d: 12, h: 17, style: 'plaster', color: ROSE, lit: 0.55, fireEscape: true, graffiti: 'HK' });
  b.shell({ x: 57, z: -40, w: 8, d: 9, h: 5, doors: ['s'], style: 'concrete', color: '#7d7f82', sign: '五金', signColor: '#1f4f8f', lit: 0.4 });
  b.prop('neonSign', { x: 52.6, z: -40, rot: H, y: 4, w: 3, text: '五金', color: '#ff3b3b', light: false });
  b.fence({ x: 60, z: -31, len: 14, h: 2 }); b.prop('sign', { x: 53.5, z: -31.5, rot: 0, text: '工地 SITE', bg: '#ffd166', fg: '#111' });
  for (let i = 0; i < 3; i++) b.prop('barrier', { x: 54 + i * 3.2, z: -28, rot: 0 });
  b.prop('sandbags', { x: 66, z: -27, rot: 0 }); b.prop('pipes', { x: 60, z: -16, rot: 0, len: 5 }); b.prop('container', { x: 70, z: -13, rot: 0, color: '#8a2a2a' });
  b.prop('crate', { x: 56, z: -20, size: 1.5 }); b.prop('crate', { x: 57.6, z: -20.2, size: 1.0 }); b.prop('crate', { x: 56.3, z: -20, y: 1.5, size: 1.0 });
  b.prop('cone', { x: 52.5, z: -26 }); b.prop('cone', { x: 55, z: -24.5 }); b.prop('cone', { x: 58, z: -24 });
  b.prop('billboard', { x: 70, z: -31, rot: PI, text: 'HONG KONG', bg: '#0b1f3a', fg: '#00e5ff', w: 9, h: 7 });
  // E3 (SE minibus terminus)
  b.building({ x: 44.5, z: 16, w: 10, d: 14, h: 23, style: 'concrete', color: MAUVE, lit: 0.6, sign: '酒樓', signColor: '#b3121b', rot: PI, floors: 7, roof: 'flat' });
  b.building({ x: 44.5, z: 36, w: 10, d: 16, h: 28, style: 'plaster', color: TEAL, lit: 0.55, floors: 9, graffiti: 'KWC', roof: 'flat' });
  b.prop('neonSign', { x: 50.2, z: 36, rot: 0, y: 6, w: 4, text: '酒樓', color: '#ff2d95', light: true });
  b.patch(62, 25, 26, 22, 'asphalt', { seed: 5, color: '#232327', mmColor: '#2e2e34' }, 0.02);
  b.shell({ x: 62, z: 42, w: 16, d: 7, h: 4, doors: ['n'], style: 'concrete', color: '#5f6f6f', interior: true, name: 'Minibus Terminus', sign: '小巴站', signColor: '#2f6f3f', lit: 0.5 });
  for (let i = 0; i < 3; i++) b.prop('van', { x: 52 + i * 6, z: 30, rot: 0, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });
  b.prop('busstop', { x: 62, z: 36, rot: PI, ad: '小巴' });
  for (const [x, r] of [[52, 0.05], [64, -0.05]]) b.prop('car', { x, z: 18, rot: r, color: TAXI });
  b.prop('bus', { x: 74, z: 24, rot: 0, color: TAXI });
  b.prop('sign', { x: 50.5, z: 13, rot: 0, text: 'TAXI', bg: '#c0392b', fg: '#fff' });
    b.shell({ x: 72, z: 12, w: 8, d: 7, h: 4.5, doors: ['w'], style: 'plaster', color: '#9a8f78', sign: '茶', signColor: '#1f7a4a', lit: 0.4 });
  b.prop('trashcan', { x: 70, z: 36 }); b.prop('hydrant', { x: 40.5, z: 10 });
  // E4 (SE corner row)
  b.building({ x: 68, z: 68, w: 14, d: 14, h: 18, style: 'plaster', color: PINK2, lit: 0.55, sign: '大酒店', signColor: '#c9a227', rot: PI });
  b.building({ x: 50, z: 68, w: 14, d: 14, h: 13, style: 'concrete', color: SLATE, lit: 0.5, rot: PI, graffiti: 'HK' });
  b.prop('dumpster', { x: 59, z: 72, rot: H }); b.prop('trashpile', { x: 59, z: 66 });
  b.prop('van', { x: 70, z: 56.5, rot: -H, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });

  // =====================================================================================
  // Traffic on Nathan Road and the N-S streets
  // =====================================================================================
  for (const [x, z, r] of [[-66, -3, H], [-46, 3, -H], [28, 3, -H], [66, -3, H + 0.05]]) b.prop('car', { x, z, rot: r, color: TAXI });
  b.prop('van', { x: 12, z: 3.2, rot: -H, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });
  b.prop('bus', { x: -32, z: -64, rot: 0, color: TAXI });
  for (const [x, z, r] of [[-29.5, 30, 0], [29.5, -32, 0]]) b.prop('car', { x, z, rot: r, color: TAXI });
  b.prop('van', { x: -34.5, z: 66, rot: PI, color: MINIBUS, text: 'MINIBUS', textColor: '#f5f5f5' });
  for (const [x, z] of [[-40, 8.6], [40, -8.6]]) b.prop('hydrant', { x, z });
  b.prop('stopsign', { x: 38.9, z: -58.4, rot: PI }); b.prop('stopsign', { x: -38.9, z: 58.4, rot: 0 });
  for (const [x, z, r] of [[-70, 58.5, PI], [70, -58.5, 0]]) b.prop('busstop', { x, z, rot: r, ad: 'KMB' });

  // =====================================================================================
  // Spawns: team 0 west yards, team 1 east yards, neutrals around the centre.
  // =====================================================================================
  for (const [x, z] of [[-62, -32], [-60, -20], [-54, -24], [-73, -31], [-58, 32], [-66, 22], [-56, 14], [-72, 30], [-62, 44]]) b.spawn(0, x, z, H);
  for (const [x, z] of [[60, -24], [62, -19], [56, -34], [73, -31], [56, 24], [68, 20], [58, 14], [74, 36], [66, 36]]) b.spawn(1, x, z, -H);
  for (const [x, z] of [[0, -32.5], [-15, -37], [12, -54], [-7, -17], [7, -17], [0, 24], [-16, 28], [16, 30], [4, 57.4], [-32, -40], [32, 62], [-62, -58], [59, 62]]) b.spawn(null, x, z, 0);

  // =====================================================================================
  // Cinematics
  // =====================================================================================
  b.cinematic(30, 20, -46, 0, -32);   // neon alleys of the walled city
  b.cinematic(-24, 14, 30, 0, 0);     // footbridge over Nathan Road from the tong lau roof
  b.cinematic(18, 12, 10, 0, 38);     // temple lanterns from the courtyard
  b.cinematic(0, 18, -36, 0, -60);    // market street under the tarps
  return b.finish();
}
