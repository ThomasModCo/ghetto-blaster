// MapBuilder: a toolkit for authoring detailed city maps out of textured boxes and props.
// Every placed structure registers colliders in the physics World; finish() bakes a nav grid and a minimap.
import * as THREE from 'three';
import { World, Box } from '../core/physics.js';
import { NavGrid } from './nav.js';
import { tex, normalFor } from '../core/textures.js';
import { RNG } from '../core/rng.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chamferBox, scaleFaceUVs, splitGroups, trimColor, windowFrameGeo, facadeWindows } from './kit.js';
import { MODELS, propMaterial } from '../game/models.js';

const matCache = new Map();
export function mat(name, params = {}, extra = {}) {
  const key = name + JSON.stringify(params) + JSON.stringify(extra);
  if (matCache.has(key)) return matCache.get(key);
  let m;
  // playset: everything is cast or molded, so nothing is fully matte (caps roughness for a soft sheen)
  if (name === 'color') m = new THREE.MeshStandardMaterial({ color: new THREE.Color(params.color || '#888'), roughness: Math.min(0.72, params.rough ?? 0.85), metalness: params.metal ?? 0.05, ...extra });
  else { const map = tex(name, params); m = new THREE.MeshStandardMaterial({ map, roughness: Math.min(0.78, params.rough ?? 0.9), metalness: params.metal ?? 0.02, ...extra }); const nm = normalFor(map); if (nm) { m.normalMap = nm; m.normalScale.set(0.9, 0.9); } }
  m.userData.params = params; matCache.set(key, m); return m;
}
const col = (c, r = 0.85, mt = 0.05) => mat('color', { color: c, rough: r, metal: mt });
/** Tiled copy of a textured material. Repeats snap to quarter steps and copies are shared, so walls with the same
 *  texture and similar size end up with the same material and merge into one draw call. */
const repeatCache = new Map();
function repeatMaterial(material, repeat) {
  const rx = Math.max(0.25, Math.round(repeat[0] * 4) / 4), ry = Math.max(0.25, Math.round(repeat[1] * 4) / 4), key = material.uuid + '|' + rx + '|' + ry;
  let mm = repeatCache.get(key);
  if (!mm) { mm = material.clone(); mm.map = material.map.clone(); mm.map.repeat.set(rx, ry); mm.map.needsUpdate = true; if (material.normalMap) { mm.normalMap = material.normalMap.clone(); mm.normalMap.repeat.set(rx, ry); mm.normalMap.needsUpdate = true; } mm.userData = { ...material.userData }; repeatCache.set(key, mm); }
  return mm;
}
/** Ground material tiled `rx` x `ry` times, with the texture's shared normal map tiled to match (miniature scenics). */
function tiledMaterial(name, params, rx, ry, extra = {}) {
  const src = tex(name, params), t = src.clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88, metalness: 0, ...extra });
  const n = normalFor(src); if (n) { m.normalMap = n.clone(); m.normalMap.repeat.set(rx, ry); m.normalMap.needsUpdate = true; m.normalScale.set(0.8, 0.8); }
  return m;
}
const KIT_WINDOW_MAX_Y = 13; // 3D window surrounds only up to ~4 floors


export class MapBuilder {
  constructor(def) {
    this.def = def;
    this.size = def.size || 160;
    this.group = new THREE.Group();
    this.world = new World(this.size, 8);
    this.spawns = { 0: [], 1: [], all: [] };
    this.roads = []; this.footprints = []; this.patches = [];
    this.lights = []; this.lightBudget = def.lightBudget ?? 14;
    this.rng = new RNG(def.seed || 7);
    this.minimapBg = def.minimapBg || '#2a2a30';
    this.landmarks = []; // {x,z,name}
    this.cinematicPoints = def.cinematicPoints || [];
  }

  // ---------------- materials & low-level ----------------
  _mesh(geo, material, x, y, z, rot = 0, castShadow = true, receive = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.rotation.y = rot; m.castShadow = castShadow; m.receiveShadow = receive; this.group.add(m); return m;
  }
  _collide(x, y, z, w, h, d, rot = 0, opts = {}) {
    // rotated boxes become their AABB (fine for props; keep rotations at 0/90 for walls)
    let ww = w, dd = d;
    const r = ((rot % Math.PI) + Math.PI) % Math.PI;
    if (Math.abs(r - Math.PI / 2) < 0.01) { ww = d; dd = w; }
    else if (r > 0.01 && Math.abs(r - Math.PI) > 0.01) { const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r)); ww = w * c + d * s; dd = w * s + d * c; }
    const b = Box.fromCenter(x, y, z, ww, h, dd, opts.tag || 'solid'); b.walkable = opts.walkable ?? true; b.kind = opts.kind || 'prop';
    this.world.add(b); return b;
  }
  // generic textured box with a collider
  box({ x, y = 0, z, w, h, d, m = null, color = '#888', rot = 0, collide = true, walkable = true, repeat = null, tag, kind, castShadow = true }) {
    const material = m || col(color);
    const geo = chamferBox(w, h, d, Math.min(0.07, Math.min(w, h, d) * 0.18));
    if (repeat && material.map) { const mm = repeatMaterial(material, repeat); const mesh = this._mesh(geo, mm, x, y + h / 2, z, rot, castShadow); if (collide) this._collide(x, y, z, w, h, d, rot, { walkable, tag, kind }); return mesh; }
    const mesh = this._mesh(geo, material, x, y + h / 2, z, rot, castShadow);
    if (collide) this._collide(x, y, z, w, h, d, rot, { walkable, tag, kind });
    return mesh;
  }
  // flat textured plane on the ground (no collider)
  patch(x, z, w, d, texName, params = {}, y = 0.015, rot = 0) {
    const m = tiledMaterial(texName, params, w / (params.scale || 6), d / (params.scale || 6));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rot; mesh.position.set(x, y, z); mesh.receiveShadow = true; this.group.add(mesh);
    this.patches.push({ x, z, w, d, rot, color: params.mmColor || null });
    return mesh;
  }
  ground(texName = 'asphalt', params = {}) {
    const m = tiledMaterial(texName, params, this.size / 4, this.size / 4);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.size, this.size), m); mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true; this.group.add(mesh);
    // outer bounds walls (invisible)
    const s = this.size / 2, H = 30;
    for (const [x, z, w, d] of [[0, -s - 1, this.size + 4, 2], [0, s + 1, this.size + 4, 2], [-s - 1, 0, 2, this.size + 4], [s + 1, 0, 2, this.size + 4]]) { const b = this._collide(x, 0, z, w, H, d, 0, { walkable: false, kind: 'bounds' }); b.walkable = false; }
    // visible perimeter: graffiti-covered concrete wall just inside the bounds
    if (this.def.perimeter !== false) {
      const pm = mat('concrete', { color: this.def.perimeterColor || '#7d7a72', seed: 77 }); const e = s - 0.6;
      for (const [x, z, len, rot] of [[0, -e, this.size, 0], [0, e, this.size, 0], [-e, 0, this.size, Math.PI / 2], [e, 0, this.size, Math.PI / 2]]) {
        const diorama = this.def.diorama !== false; // toy reskin: a low kerb so the table and room beyond stay visible
        this.box({ x, z, w: len, h: diorama ? 1.1 : 3.2, d: 0.5, m: pm, rot, repeat: [len / 3, diorama ? 0.35 : 1], collide: false });
        if (!diorama) for (let i = -3; i <= 3; i++) { const t = i * (this.size / 7.5); const px = rot ? x : x + t, pz = rot ? z + t : z; this.graffitiDecal(px, pz, 6, 0.5, rot, this.rng.pick(['GB', 'HOOD', 'RIP', 'KING', 'OPPS', '187', 'BLAST', 'NO SNITCH']), this.rng, rot ? (x < 0 ? 0 : 2) : (z < 0 ? 0 : 2)); }
      }
    }
    return mesh;
  }
  // Road between two points (any angle). Draws asphalt, center marks, and optional sidewalks (with kerb colliders? no - kerbs are step-able so just visual).
  road(x1, z1, x2, z2, width = 10, { marks = true, sidewalk = true, sidewalkW = 2.2, dashed = true, y = 0.02 } = {}) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const m = tiledMaterial('asphalt', { seed: 4 }, width / 6, len / 6);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), m); mesh.rotation.order = 'YXZ'; mesh.rotation.y = ang; mesh.rotation.x = -Math.PI / 2; mesh.position.set(cx, y, cz); mesh.receiveShadow = true; this.group.add(mesh);
    if (marks) {
      const mt = tex('roadMarks', { dashed }).clone(); mt.repeat.set(1, len / 8); mt.needsUpdate = true;
      const mm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, len), new THREE.MeshStandardMaterial({ map: mt, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
      mm.rotation.order = 'YXZ'; mm.rotation.y = ang; mm.rotation.x = -Math.PI / 2; mm.position.set(cx, y + 0.012, cz); this.group.add(mm);
    }
    if (sidewalk) {
      const sm = tiledMaterial('sidewalk', {}, sidewalkW / 4, len / 4);
      const nx = Math.cos(ang), nz = -Math.sin(ang);
      for (const side of [-1, 1]) {
        const off = (width / 2 + sidewalkW / 2) * side;
        const sw = new THREE.Mesh(chamferBox(sidewalkW, 0.15, len), sm); sw.rotation.y = ang; sw.position.set(cx + nx * off, 0.075, cz + nz * off); sw.receiveShadow = true; sw.castShadow = false; this.group.add(sw);
      }
    }
    this.roads.push({ x1, z1, x2, z2, width: width + (sidewalk ? sidewalkW * 2 : 0) });
    return mesh;
  }
  plaza(x, z, w, d, texName = 'tile', params = {}, rot = 0) { return this.patch(x, z, w, d, texName, { scale: 8, ...params }, 0.03, rot); }

  // ---------------- buildings ----------------
  /** A solid building block with a windowed facade. style: brick|concrete|plaster|glass|tenement|shanty */
  building({ x, z, w, d, h, style = 'brick', color = null, floors = null, floorH = 3.2, lit = 0.3, roof = 'parapet', rot = 0, sign = null, signColor = '#b3121b', graffiti = null, awning = null, fireEscape = false, balcony = false, shutters = false, rooftop = true, seed = null, name = null, winColor = '#1a2230' }) {
    const rng = new RNG(seed ?? this.rng.int(1, 1e6));
    floors = floors || Math.max(1, Math.round(h / floorH));
    const palette = { brick: ['#8a3b2a', '#7a4a3a', '#9c4b32', '#6b3a2c', '#a85a3c'], concrete: ['#8d8d86', '#7b7f82', '#a39f94', '#6f7274'], plaster: ['#d9c9a3', '#c9a86a', '#b8c4b0', '#e0b07a', '#9fb3c8', '#d98a6a'], glass: ['#2d4a66', '#3b5b73'], tenement: ['#6b4a3a', '#5c4033', '#7d5a46'], shanty: ['#8a8f93', '#a3714a', '#6f8a5f', '#b06a4a'] };
    const wall = color || rng.pick(palette[style] || palette.concrete);
    const fstyle = style === 'brick' || style === 'tenement' ? 'brick' : style === 'glass' ? 'glass' : 'plain';
    // facade materials are shared across buildings (a handful of seeds per look) so merged geometry batches well
    const fm = mat('facade', { seed: 1 + (rng.int(1, 9999) % 5), wall, style: fstyle, cols: 3, rows: 2, lit, winColor, trim: '#' + trimColor(wall, style).getHexString(), balcony: balcony || style === 'tenement', shutters, ac: style !== 'glass' }, { roughness: style === 'glass' ? 0.35 : 0.9, metalness: style === 'glass' ? 0.3 : 0.02 });
    const roofMat = mat('concrete', { color: '#55544f', seed: 21 });
    const geo = chamferBox(w, h, d, 0.2);
    const ry = Math.max(1, floors / 2), Rd = Math.max(1, Math.round(d / 9)), Rw = Math.max(1, Math.round(w / 9));
    scaleFaceUVs(geo, [Rd, ry], [Rd, ry], null, null, [Rw, ry], [Rw, ry]);
    // walls and roof as two single-material meshes (not one 6-group mesh): the static merge can then batch every
    // building that shares a facade material into one draw call
    const [walls, caps] = splitGroups(geo, [[0, 1, 4, 5], [2, 3]]);
    const mesh = this._mesh(walls, fm, x, h / 2, z, rot); this._mesh(caps, roofMat, x, h / 2, z, rot);
    this._buildingKit({ x, z, w, d, h, rot, wall, style, floors, Rd, Rw, ry, parapet: roof === 'parapet' && style !== 'shanty' });
    this._collide(x, 0, z, w, h, d, rot, { kind: 'building' });
    this.footprints.push({ x, z, w, d, rot, h });
    if (style === 'shanty') { // corrugated roof overhang
      this.box({ x, y: h, z, w: w + 0.8, h: 0.12, d: d + 0.8, m: mat('corrugated', { seed: rng.int(1, 999) }), rot, collide: false });
    } else if (roof === 'parapet') {
      const pm = col(new THREE.Color(wall).offsetHSL(0, 0, -0.1).getStyle());
      const t = 0.35, ph = 0.9;
      // parapet walls (walkable rooftop stays; parapets are colliders so you can't fall off easily)
      this.box({ x, y: h, z: z - d / 2 + t / 2, w, h: ph, d: t, m: pm, rot, walkable: true });
      this.box({ x, y: h, z: z + d / 2 - t / 2, w, h: ph, d: t, m: pm, rot, walkable: true });
      this.box({ x: x - w / 2 + t / 2, y: h, z, w: t, h: ph, d, m: pm, rot, walkable: true });
      this.box({ x: x + w / 2 - t / 2, y: h, z, w: t, h: ph, d, m: pm, rot, walkable: true });
    }
    if (rooftop && h > 5 && rng.chance(0.8)) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) { const px = x + rng.float(-w / 2 + 2, w / 2 - 2), pz = z + rng.float(-d / 2 + 2, d / 2 - 2); const kind = rng.pick(['ac', 'ac', 'vent', 'tank', 'stair']); this._rooftopProp(kind, px, h, pz, rng); }
    }
    if (sign) this.signboard(x, z, w, d, h, rot, sign, signColor, rng);
    if (graffiti) this.graffitiDecal(x, z, w, d, rot, graffiti, rng);
    if (awning) this.awning(x, z, w, d, rot, awning, rng);
    if (fireEscape) this.fireEscape(x, z, w, d, h, floors, rot, rng);
    if (name) this.landmarks.push({ x, z, name });
    mesh.userData.building = true;
    return mesh;
  }
  _rooftopProp(kind, x, y, z, rng) {
    if (kind === 'ac') this.box({ x, y, z, w: 1.6, h: 1.0, d: 1.2, m: mat('metal', { seed: 3, color: '#9aa0a6' }), rot: rng.float(0, 3) });
    else if (kind === 'vent') { this.box({ x, y, z, w: 0.6, h: 1.8, d: 0.6, m: mat('metal', { seed: 5, color: '#777' }), walkable: false }); this.box({ x, y: y + 1.8, z, w: 1.1, h: 0.3, d: 1.1, m: mat('metal', { seed: 5, color: '#666' }), collide: false }); }
    else if (kind === 'tank') { this.cylinder(x, y, z, 1.2, 2.2, mat('metal', { seed: 8, rust: 0.6, color: '#8a6a4a' }), 10, true); }
    else if (kind === 'stair') this.box({ x, y, z, w: 2.4, h: 2.4, d: 2.8, m: mat('concrete', { color: '#6f6f6a', seed: 44 }), walkable: false });
  }
  cylinder(x, y, z, r, h, material, seg = 12, collide = true) {
    const m = this._mesh(new THREE.CylinderGeometry(r, r, h, seg), material, x, y + h / 2, z); if (collide) this._collide(x, y, z, r * 2, h, r * 2, 0, { walkable: true }); return m;
  }
  signboard(x, z, w, d, h, rot, text, bg, rng) {
    const side = rot; const sw = Math.min(w * 0.7, 10), sh = 1.2;
    const m = new THREE.MeshStandardMaterial({ map: tex('sign', { text, bg, w: 512, h: 128 }), roughness: 0.6, emissive: new THREE.Color(bg), emissiveIntensity: 0.15 });
    const s = new THREE.Mesh(chamferBox(sw, sh, 0.15), m); const off = d / 2 + 0.1; s.position.set(x + Math.sin(side) * off, Math.min(h - 0.8, 3.6), z + Math.cos(side) * off); s.rotation.y = side; s.castShadow = false; this.group.add(s);
  }
  graffitiDecal(x, z, w, d, rot, text, rng, side = null) {
    const t = tex('graffiti', { seed: rng.int(1, 9999), text });
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const sw = Math.min(5, w * 0.6), sh = sw / 2;
    const which = side ?? rng.int(0, 3); const ang = rot + which * Math.PI / 2; const off = (which % 2 ? w : d) / 2 + 0.02;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), m); p.position.set(x + Math.sin(ang) * off, 1.5, z + Math.cos(ang) * off); p.rotation.y = ang; this.group.add(p);
  }
  awning(x, z, w, d, rot, color, rng) {
    const m = new THREE.MeshStandardMaterial({ map: tex('cloth', { color, stripe: '#f0f0f0', seed: rng.int(1, 99) }), roughness: 0.9, side: THREE.DoubleSide });
    const aw = Math.min(w * 0.8, 8); const off = d / 2 + 0.9;
    const a = new THREE.Mesh(chamferBox(aw, 0.08, 1.8), m); a.position.set(x + Math.sin(rot) * off, 2.9, z + Math.cos(rot) * off); a.rotation.y = rot; a.rotation.x = 0.25; a.castShadow = true; this.group.add(a);
  }
  fireEscape(x, z, w, d, h, floors, rot, rng) {
    const m = col('#2b2b2b', 0.6, 0.6); const off = d / 2 + 0.6; const px = x + Math.sin(rot) * off, pz = z + Math.cos(rot) * off;
    for (let f = 1; f < floors; f++) {
      const y = f * (h / floors);
      const plat = new THREE.Mesh(chamferBox(Math.min(w * 0.5, 6), 0.08, 1.1), m); plat.position.set(px, y, pz); plat.rotation.y = rot; plat.castShadow = true; this.group.add(plat);
      const rail = new THREE.Mesh(chamferBox(Math.min(w * 0.5, 6), 0.9, 0.04), m); rail.position.set(px + Math.sin(rot) * 0.55, y + 0.5, pz + Math.cos(rot) * 0.55); rail.rotation.y = rot; this.group.add(rail);
      const lad = new THREE.Mesh(chamferBox(0.5, h / floors, 0.06), m); lad.position.set(px + Math.cos(rot) * 1.5, y - h / floors / 2, pz - Math.sin(rot) * 1.5); lad.rotation.y = rot; lad.rotation.z = 0.5; this.group.add(lad);
    }
  }
  /** Enterable hollow building: four walls, door gaps, a walkable roof, interior pillars; optional exterior stairs to roof. */
  shell({ x, z, w, d, h = 4, t = 0.4, doors = ['s'], windows = true, style = 'concrete', color = null, roof = true, stairs = null, interior = true, name = null, lit = 0.2, sign = null, signColor = '#b3121b', graffiti = null }) {
    const rng = new RNG(this.rng.int(1, 1e6));
    const wall = color || (style === 'brick' ? '#8a3b2a' : style === 'plaster' ? '#d9c9a3' : style === 'shanty' ? '#9a7a5a' : '#8d8d86');
    const m = style === 'shanty' ? mat('corrugated', { seed: rng.int(1, 999), rust: 0.7 }) : mat(style === 'brick' ? 'brick' : style === 'plaster' ? 'plaster' : 'concrete', { color: wall, seed: rng.int(1, 999) });
    const doorW = 1.6, doorH = 2.3;
    const sides = [
      { k: 'n', cx: x, cz: z - d / 2 + t / 2, len: w, horiz: true }, { k: 's', cx: x, cz: z + d / 2 - t / 2, len: w, horiz: true },
      { k: 'w', cx: x - w / 2 + t / 2, cz: z, len: d, horiz: false }, { k: 'e', cx: x + w / 2 - t / 2, cz: z, len: d, horiz: false },
    ];
    for (const s of sides) {
      const hasDoor = doors.includes(s.k);
      if (!hasDoor) {
        if (windows && s.len > 5) { // wall with a window gap at mid height
          const segs = [[-s.len / 2, -s.len / 2 + s.len * 0.3], [s.len / 2 - s.len * 0.3, s.len / 2]];
          for (const [a, b] of segs) { const c = (a + b) / 2, L = b - a; if (s.horiz) this.box({ x: s.cx + c, z: s.cz, w: L, h, d: t, m, repeat: [L / 3, h / 3] }); else this.box({ x: s.cx, z: s.cz + c, w: t, h, d: L, m, repeat: [L / 3, h / 3] }); }
          const midL = s.len * 0.4; // sill + lintel
          if (s.horiz) { this.box({ x: s.cx, z: s.cz, w: midL, h: 1.1, d: t, m }); this.box({ x: s.cx, y: 2.3, z: s.cz, w: midL, h: h - 2.3, d: t, m }); }
          else { this.box({ x: s.cx, z: s.cz, w: t, h: 1.1, d: midL, m }); this.box({ x: s.cx, y: 2.3, z: s.cz, w: t, h: h - 2.3, d: midL, m }); }
          this._shellOpeningTrim(s, midL, 1.1, 2.3, t, wall, style, true);
        } else { if (s.horiz) this.box({ x: s.cx, z: s.cz, w: s.len, h, d: t, m, repeat: [s.len / 3, h / 3] }); else this.box({ x: s.cx, z: s.cz, w: t, h, d: s.len, m, repeat: [s.len / 3, h / 3] }); }
      } else {
        const L = (s.len - doorW) / 2;
        this._shellOpeningTrim(s, doorW, 0, doorH, t, wall, style, false);
        if (s.horiz) { this.box({ x: s.cx - s.len / 2 + L / 2, z: s.cz, w: L, h, d: t, m, repeat: [L / 3, h / 3] }); this.box({ x: s.cx + s.len / 2 - L / 2, z: s.cz, w: L, h, d: t, m, repeat: [L / 3, h / 3] }); this.box({ x: s.cx, y: doorH, z: s.cz, w: doorW + 0.1, h: h - doorH, d: t, m }); }
        else { this.box({ x: s.cx, z: s.cz - s.len / 2 + L / 2, w: t, h, d: L, m, repeat: [L / 3, h / 3] }); this.box({ x: s.cx, z: s.cz + s.len / 2 - L / 2, w: t, h, d: L, m, repeat: [L / 3, h / 3] }); this.box({ x: s.cx, y: doorH, z: s.cz, w: t, h: h - doorH, d: doorW + 0.1, m }); }
      }
    }
    if (roof) this.box({ x, y: h, z, w, h: 0.3, d, m: mat('concrete', { color: '#5b5a55', seed: 31 }), repeat: [w / 4, d / 4] });
    if (roof && style !== 'shanty') this.box({ x, y: h - 0.12, z, w: w + 0.28, h: 0.38, d: d + 0.28, m: col(trimColor(wall, style).getStyle(), 0.6), collide: false }); // cast cornice
    if (interior) { // floor tile + a counter/pillar for cover
      this.patch(x, z, w - t * 2, d - t * 2, 'tile', { seed: rng.int(1, 99), color: rng.pick(['#9c9382', '#7f8a7a', '#8c7a6a']), scale: 4 }, 0.025);
      if (w > 6 && d > 6) this.box({ x: x + (rng.chance(0.5) ? -1 : 1) * w * 0.2, z: z + (rng.chance(0.5) ? -1 : 1) * d * 0.15, w: Math.min(3, w * 0.3), h: 1.0, d: 0.8, m: col('#4a3a2a'), rot: rng.chance(0.5) ? 0 : Math.PI / 2 });
    }
    if (stairs) this.stairs({ x: stairs.x, z: stairs.z, dir: stairs.dir, height: h + 0.3, width: stairs.width || 2 });
    this.footprints.push({ x, z, w, d, rot: 0, h });
    if (name) this.landmarks.push({ x, z, name });
    if (sign) this.signboard(x, z, w, d, h, doors.includes('n') ? Math.PI : doors.includes('e') ? Math.PI / 2 : doors.includes('w') ? -Math.PI / 2 : 0, sign, signColor, rng);
    if (graffiti) this.graffitiDecal(x, z, w, d, 0, graffiti, rng);
  }
  /** Playset trim for a building: plinth, first-floor string course, cornice and 3D window surrounds (visual only). */
  _buildingKit({ x, z, w, d, h, rot, wall, style, floors, Rd, Rw, ry, parapet }) {
    const trim = trimColor(wall, style), tm = col(trim.getStyle(), 0.6);
    const base = col(new THREE.Color(wall).offsetHSL(0, -0.04, -0.13).getStyle(), 0.75);
    const band = (y, hh, grow, m) => { const g = chamferBox(w + grow, hh, d + grow, Math.min(0.06, hh * 0.3)); this._mesh(g, m, x, y + hh / 2, z, rot, false, true); };
    if (style !== 'glass' && style !== 'shanty') {
      band(0, 0.75, 0.22, base);
      if (floors > 1) band(h / floors - 0.12, 0.2, 0.14, tm);
      band(h - 0.5, 0.46, 0.42, tm); // top stays just under the roof face, or the band would cover the roof
    } else if (style === 'glass') band(h - 0.34, 0.3, 0.2, col('#3c4248', 0.35, 0.6));
    if (style === 'glass') return;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const faces = [{ nx: 1, nz: 0, len: d, R: Rd, off: w / 2 }, { nx: -1, nz: 0, len: d, R: Rd, off: w / 2 }, { nx: 0, nz: 1, len: w, R: Rw, off: d / 2 }, { nx: 0, nz: -1, len: w, R: Rw, off: d / 2 }];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const f of faces) {
      const yaw = Math.atan2(f.nx, f.nz); // local yaw that turns +Z onto the face normal
      for (const win of facadeWindows(f.len, h, f.R, ry)) {
        if (win.y < 1.0 && floors > 1) continue; // the plinth covers ground-floor sills
        if (win.y > KIT_WINDOW_MAX_Y) continue; // higher up the painted facade reads fine; keeps triangle counts sane
        // face-local point: tangent runs along the face (perpendicular to its normal)
        const lx = f.nx * f.off + f.nz * win.t, lz = f.nz * f.off - f.nx * win.t;
        P.set(x + lx * c + lz * sn, win.y, z - lx * sn + lz * c);
        q.setFromEuler(e.set(0, yaw + rot, 0)); S.set(win.ww, win.wh, 1);
        (this.kitWindows ||= []).push({ m: M.compose(P, q, S).clone(), color: trim.clone() });
      }
    }
    if (this.def.immediateKit) this._flushKit();
  }
  /** Door / window surround for an enterable shell wall: two jambs and a head (plus a sill for windows). */
  _shellOpeningTrim(s, openW, y0, y1, t, wall, style, sill) {
    if (style === 'shanty') return;
    const m = col(trimColor(wall, style).getStyle(), 0.6), dt = t + 0.14, jw = 0.16;
    const put = (along, y, len, hh) => s.horiz ? this.box({ x: s.cx + along, y, z: s.cz, w: len, h: hh, d: dt, m, collide: false }) : this.box({ x: s.cx, y, z: s.cz + along, w: dt, h: hh, d: len, m, collide: false });
    for (const sg of [-1, 1]) put(sg * (openW / 2 + jw / 2 - 0.02), y0, jw, y1 - y0 + 0.12);
    put(0, y1, openW + jw * 2, 0.16);
    if (sill) put(0, y0 - 0.1, openW + 0.3, 0.12);
  }
  /** All facade window surrounds on the map as one instanced mesh (one draw call). */
  _flushKit() {
    const list = this.kitWindows; if (!list || !list.length) return;
    const im = new THREE.InstancedMesh(windowFrameGeo(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.02 }), list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.color); });
    im.castShadow = false; im.receiveShadow = true; im.userData.kit = true; this.group.add(im); this.kitWindows = [];
  }
  /** Stairs rising from ground at (x,z) in direction dir ('n','s','e','w') up to height. */
  stairs({ x, z, dir = 'n', height = 4, width = 2, stepH = 0.34, stepD = 0.62, m = null }) {
    const material = m || mat('concrete', { color: '#77756f', seed: 12 });
    const steps = Math.ceil(height / stepH); const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0, dz = dir === 's' ? 1 : dir === 'n' ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      const hh = Math.min(height, (i + 1) * stepH); const px = x + dx * (i + 0.5) * stepD, pz = z + dz * (i + 0.5) * stepD;
      if (dx) this.box({ x: px, z: pz, w: stepD, h: hh, d: width, m: material }); else this.box({ x: px, z: pz, w: width, h: hh, d: stepD, m: material });
    }
    // top landing
    const lx = x + dx * (steps * stepD + 0.6), lz = z + dz * (steps * stepD + 0.6);
    if (dx) this.box({ x: lx, z: lz, w: 1.2, h: height, d: width, m: material }); else this.box({ x: lx, z: lz, w: width, h: height, d: 1.2, m: material });
    // side rails
    const rm = col('#333', 0.5, 0.6); const len = steps * stepD + 1.2;
    // a thin sloped handrail on three posts (visual only — the rails never had colliders); the old solid 1 m planks read as black slabs
    const slope = Math.hypot(len, height), run = steps * stepD;
    for (const s of [-1, 1]) {
      const ox = dz ? s * (width / 2 - 0.05) : 0, oz = dx ? s * (width / 2 - 0.05) : 0;
      const r = new THREE.Mesh(chamferBox(dx ? slope : 0.07, 0.07, dz ? slope : 0.07, 0.02), rm); r.position.set(x + dx * len / 2 + ox, height / 2 + 0.95, z + dz * len / 2 + oz); r.rotation[dx ? 'z' : 'x'] = (dx ? dx : -dz) * Math.atan2(height, len); this.group.add(r);
      for (const t of [0.06, 0.5, 0.94]) {
        const a = t * len, top = a >= run ? height : Math.min(height, Math.ceil(a / stepD) * stepH), ph = t * height + 0.95 - top;
        if (ph < 0.2) continue;
        const pst = new THREE.Mesh(chamferBox(0.06, ph, 0.06, 0.015), rm); pst.position.set(x + dx * a + ox, top + ph / 2, z + dz * a + oz); this.group.add(pst);
      }
    }
  }
  /** Walkable elevated slab (bridge, overpass, catwalk). */
  platform({ x, z, w, d, y, t = 0.4, m = null, rails = true }) {
    const material = m || mat('concrete', { color: '#6f6f6a', seed: 15 });
    this.box({ x, y, z, w, h: t, d, m: material, repeat: [w / 4, d / 4] });
    if (rails) { const rm = col('#3a3a3a', 0.5, 0.6); for (const s of [-1, 1]) { this.box({ x, y: y + t, z: z + s * (d / 2 - 0.08), w, h: 1.0, d: 0.12, m: rm, walkable: false }); } }
    this.footprints.push({ x, z, w, d, rot: 0, h: y + t, platform: true });
  }
  wall({ x, z, len, h = 2.5, t = 0.3, rot = 0, m = null, color = '#8a8a82', graffiti = null, walkable = true }) {
    const material = m || mat('concrete', { color, seed: 17 });
    const mesh = this.box({ x, z, w: len, h, d: t, m: material, rot, repeat: [len / 3, h / 3], walkable });
    if (graffiti) { const t2 = tex('graffiti', { seed: this.rng.int(1, 9999), text: graffiti }); const gm = new THREE.MeshStandardMaterial({ map: t2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }); const sw = Math.min(5, len * 0.7); for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 2), gm); p.position.set(x + Math.sin(rot) * (t / 2 + 0.02) * s, Math.min(h * 0.55, 1.6), z + Math.cos(rot) * (t / 2 + 0.02) * s); p.rotation.y = rot + (s < 0 ? Math.PI : 0); this.group.add(p); } }
    return mesh;
  }
  fence({ x, z, len, h = 2.2, rot = 0 }) {
    const m = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.6, metalness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h), m); mesh.position.set(x, h / 2, z); mesh.rotation.y = rot; this.group.add(mesh);
    const pm = col('#6b6f73', 0.5, 0.6); const n = Math.max(2, Math.round(len / 3));
    for (let i = 0; i <= n; i++) { const t = i / n - 0.5; const p = new THREE.Mesh(chamferBox(0.08, h, 0.08), pm); p.position.set(x + Math.cos(rot) * t * len, h / 2, z - Math.sin(rot) * t * len); this.group.add(p); }
    const top = new THREE.Mesh(chamferBox(len, 0.06, 0.06), pm); top.position.set(x, h, z); top.rotation.y = rot; this.group.add(top);
    this._collide(x, 0, z, len, h, 0.2, rot, { walkable: false, kind: 'fence' });
  }

  // ---------------- props ----------------
  prop(type, o = {}) {
    const { x = 0, z = 0, rot = 0 } = o; const rng = this.rng;
    const P = PROPS[type]; if (!P) { console.warn('unknown prop', type); return; }
    const G = GLB_PROPS[type], tpl = G && (!G.when || G.when(o)) && MODELS.props.get(G.model ? G.model(o) : type);
    if (!tpl) { P.call(this, x, z, rot, o, rng); return; }
    // Run the original builder into a throwaway group: it makes exactly the same RNG draws, colliders, lights and
    // landmarks as before, so layouts, nav and pre-planned outcomes can't change. Then show the generated mesh instead,
    // in the colour and at the size the original picked; sticker decals (signs, adverts, van lettering) are kept.
    const real = this.group, tmp = new THREE.Group(), nLights = this.lights.length; this.group = tmp;
    try { P.call(this, x, z, rot, o, rng); } finally { this.group = real; }
    tmp.updateMatrixWorld(true);
    if (G.custom) { G.custom.call(this, tmp, tpl, o); return; }
    const m = new THREE.Mesh(tpl.geo, propMaterial(tpl.tint ? propTint(tmp) : null));
    const k = G.scale ? G.scale(tmp, o) : 1, off = G.offset || [0, 0, 0];
    m.scale.setScalar(k); m.rotation.y = rot;
    m.position.set(x + Math.cos(rot) * off[0] + Math.sin(rot) * off[2], (o.y || 0) + off[1] + (G.yOffset ? G.yOffset(o) : 0), z - Math.sin(rot) * off[0] + Math.cos(rot) * off[2]);
    if (G.stretchX) m.scale.x = G.stretchX(tmp, o);
    if (G.stretch) m.scale.fromArray(G.stretch(o));
    m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    if (G.head) G.head.call(this, tpl, m, o, nLights);
    if (G.keep) { const keep = []; tmp.traverse((c) => { if (c.isMesh && c.material && c.material.map && G.keep(c)) keep.push(c); }); for (const c of keep) { c.getWorldPosition(c.position); c.getWorldQuaternion(c.quaternion); c.getWorldScale(c.scale); c.removeFromParent(); this.group.add(c); } }
  }
  /** Registers a point light definition. The engine streams the nearest few through a fixed pool, so maps can define many. */
  light(x, y, z, color = '#ffd9a0', intensity = 8, dist = 18) {
    if (this.lights.length >= Math.max(this.lightBudget, 40)) return;
    this.lights.push({ x, y, z, color, intensity, dist });
  }
  spawn(team, x, z, yaw = 0) { const s = { x, z, yaw }; if (team === 0 || team === 1) this.spawns[team].push(s); this.spawns.all.push(s); }
  cinematic(x, y, z, lookX, lookZ) { this.cinematicPoints.push({ x, y, z, lookX, lookZ }); }

  // ---------------- finish ----------------
  /** Ring of distant buildings outside the playable area so the horizon is never empty. */
  _skyline() {
    if (this.def.diorama !== false) return this._diorama();
    if (this.def.skyline === false) return;
    const rng = new RNG((this.def.seed || 7) + 999); const s = this.size / 2; const night = this.def.env && this.def.env.sunIntensity < 1;
    const lit = night ? 0.6 : 0.15;
    const mats = [0, 1, 2].map((i) => { const t = tex('facade', { seed: 500 + i + (this.def.seed || 0), wall: rng.pick(['#4a4a52', '#5a4a42', '#3f4a55', '#55504a']), style: 'plain', cols: 4, rows: 3, lit, winColor: night ? '#0e1420' : '#222a36' }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); });
    for (let ring = 0; ring < 2; ring++) {
      const n = 22 + ring * 12; const dist = s + 40 + ring * 60;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.float(-0.05, 0.05); const r = dist + rng.float(-8, 8);
        const x = Math.cos(a) * r, z = Math.sin(a) * r; const w = rng.float(12, 30), d = rng.float(12, 30), h = rng.float(8, 28) * (ring ? 2.2 : 1);
        const m = rng.pick(mats).clone(); m.map = m.map.clone(); m.map.repeat.set(Math.max(1, Math.round(w / 10)), Math.max(1, Math.round(h / 9))); m.map.needsUpdate = true;
        m.color = new THREE.Color(this.def.env?.fogColor || '#888').lerp(new THREE.Color('#ffffff'), 0.5); const mesh = new THREE.Mesh(chamferBox(w, h, d), m); mesh.position.set(x, h / 2, z); mesh.rotation.y = rng.float(0, Math.PI); mesh.castShadow = false; mesh.receiveShadow = false; this.group.add(mesh);
      }
    }
    // ground slab under the skyline so it doesn't float on the fog
    const g = new THREE.Mesh(new THREE.PlaneGeometry(this.size * 3, this.size * 3), mat('asphalt', { seed: 4, color: '#26262a' })); g.rotation.x = -Math.PI / 2; g.position.y = -0.05; g.receiveShadow = false; this.group.add(g);
  }
  /**
   * Toy reskin: the map is a diorama board standing on a wooden table. Beyond the board edge the player sees the
   * cut foam edge, the table top with a few giant everyday objects (scale ~1 cm = 0.36 m) and the blurred room.
   */
  _diorama() {
    const rng = new RNG((this.def.seed || 7) + 4321); const s = this.size / 2, B = s + 3, TH = 1.4, ty = -TH - 0.03;
    const env = this.def.env || {};
    const std = (o) => new THREE.MeshStandardMaterial(o);
    // board: scenic border strip + cut foam sides
    const top = mat('dirt', { seed: 3, color: '#6a6250' });
    const side = tex('foam', { top: '#5d5a50' }).clone(); side.repeat.set((B * 2) / 10, 1); side.needsUpdate = true;
    const sideM = std({ map: side, roughness: 0.95 }), under = std({ color: '#2a2622', roughness: 1 });
    const board = new THREE.Mesh(chamferBox(B * 2, TH, B * 2), [sideM, sideM, top, under, sideM, sideM]);
    board.position.y = -TH / 2 - 0.03; board.receiveShadow = true; this.group.add(board);
    // table
    const T = B * 3.2; const wt = tex('wood', { seed: 2 }).clone(); wt.repeat.set((T * 2) / 30, (T * 2) / 30); wt.needsUpdate = true;
    const table = new THREE.Mesh(chamferBox(T * 2, 3, T * 2), std({ map: wt, roughness: 0.45, metalness: 0 }));
    table.position.y = ty - 1.5; table.receiveShadow = true; this.group.add(table);
    // giant props read as roughly 2.5 cm toy scale (~1 cm = 0.8 m); every prop is a group anchored on the table top
    const K = 2.2; const prop = (x, z) => { const g = new THREE.Group(); g.position.set(x, ty, z); g.scale.setScalar(K); this.group.add(g); return g; };
    // spots around the board, one or two objects per side, beyond the board edge
    const spot = (side, along, out) => { const d = B + out * K; return side === 0 ? [along, d] : side === 1 ? [along, -d] : side === 2 ? [d, along] : [-d, along]; };
    const sides = rng.shuffle([0, 1, 2, 3]);
    // coffee mug (8 cm across)
    { const [x, z] = spot(sides[0], rng.float(-s * 0.5, s * 0.5), rng.float(7, 12)); const g = prop(x, z);
      const cer = std({ color: '#f1ece2', roughness: 0.18 }); const body = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.35, 3.5, 40, 1, true), cer); body.position.y = 1.75; body.castShadow = true; g.add(body);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.15, 40), cer); base.position.y = 0.08; g.add(base);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), std({ color: '#2a160c', roughness: 0.1 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 3.1; g.add(coffee);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.24, 12, 24, Math.PI), cer); handle.rotation.z = -Math.PI / 2; handle.position.set(1.4, 1.8, 0); handle.castShadow = true; g.add(handle); g.rotation.y = rng.float(0, 6.28); }
    // pencil (19 cm) lying on the table
    { const [x, z] = spot(sides[1], rng.float(-s * 0.4, s * 0.4), rng.float(4, 8)); const g = prop(x, z); g.rotation.y = (sides[1] < 2 ? 0 : Math.PI / 2) + rng.float(-0.4, 0.4); const pg = new THREE.Group(); pg.position.y = 0.14; g.add(pg);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.6, 6), std({ color: '#e8b020', roughness: 0.5 })); shaft.rotation.z = Math.PI / 2; shaft.castShadow = true; pg.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9, 6), std({ color: '#d9b48a', roughness: 0.8 })); tip.rotation.z = -Math.PI / 2; tip.position.x = 3.25; pg.add(tip);
      const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.35, 12), std({ color: '#b8b8b0', roughness: 0.3, metalness: 0.8 })); ferrule.rotation.z = Math.PI / 2; ferrule.position.x = -2.97; pg.add(ferrule);
      const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.4, 12), std({ color: '#e88a92', roughness: 0.9 })); eraser.rotation.z = Math.PI / 2; eraser.position.x = -3.33; pg.add(eraser); }
    // stack of books
    { const [x, z] = spot(sides[2], rng.float(-s * 0.5, s * 0.5), rng.float(9, 14)); const st = prop(x, z); let y = 0; const ry = rng.float(0, 6.28);
      for (const col of rng.shuffle(['#7a2a24', '#2a4a6a', '#2f5a3a', '#3a3046'])) { const h = rng.float(0.9, 1.4); const bk = new THREE.Group(); bk.position.set(rng.float(-0.4, 0.4), y + h / 2, rng.float(-0.4, 0.4)); bk.rotation.y = ry + rng.float(-0.15, 0.15); st.add(bk);
        const cover = new THREE.Mesh(chamferBox(8.6, h, 6.1), std({ color: col, roughness: 0.7 })); cover.castShadow = true; cover.receiveShadow = true; bk.add(cover);
        const pages = new THREE.Mesh(chamferBox(8.4, h * 0.82, 5.9), std({ color: '#efe6cf', roughness: 0.9 })); pages.position.x = 0.12; bk.add(pages); y += h; } }
    // smartphone (15 cm) with a glowing screen
    { const [x, z] = spot(sides[3], rng.float(-s * 0.5, s * 0.5), rng.float(5, 9)); const g = prop(x, z); g.rotation.y = rng.float(0, 6.28);
      const body = new THREE.Mesh(chamferBox(2.6, 0.28, 5.4), std({ color: '#141518', roughness: 0.25, metalness: 0.3 })); body.position.y = 0.15; body.castShadow = true; g.add(body);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 5.1), std({ color: '#0e1220', emissive: env.night ? '#3a5aa8' : '#1c2a4a', emissiveIntensity: env.night ? 1.4 : 0.6, roughness: 0.05 })); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.295; g.add(scr); }
    // tall objects that show above the rooftops from the street: desk lamp, potted plant, drink can
    { const [x, z] = spot(sides[1], rng.chance(0.5) ? s * 0.75 : -s * 0.75, rng.float(8, 14)); const g = prop(x, z); g.rotation.y = Math.atan2(-x, -z);
      const blk = std({ color: '#1d1f24', roughness: 0.35, metalness: 0.4 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, 0.6, 32), blk); base.position.y = 0.3; base.castShadow = true; g.add(base);
      const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 11, 10), blk); arm1.position.set(0, 5.6, -1.8); arm1.rotation.x = -0.33; arm1.castShadow = true; g.add(arm1);
      const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9, 10), blk); arm2.position.set(0, 12.2, 1.6); arm2.rotation.x = 1.05; arm2.castShadow = true; g.add(arm2);
      const head = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.6, 24, 1, true), std({ color: '#1d1f24', roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide })); head.position.set(0, 13.2, 5.6); head.rotation.x = -0.35; head.castShadow = true; g.add(head);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), std({ color: '#fff4d0', emissive: '#ffd890', emissiveIntensity: env.night ? 3 : 1.2 })); bulb.position.set(0, 12.2, 5.9); g.add(bulb); }
    { const [x, z] = spot(sides[2], rng.chance(0.5) ? s * 0.8 : -s * 0.8, rng.float(9, 15)); const g = prop(x, z);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 2.7, 6.5, 28), std({ color: '#b5603a', roughness: 0.8 })); pot.position.y = 3.25; pot.castShadow = true; g.add(pot);
      const soil = new THREE.Mesh(new THREE.CircleGeometry(3.4, 28), std({ color: '#2e2116', roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.y = 6.2; g.add(soil);
      const leafM = std({ color: '#3f7a35', roughness: 0.55 });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + rng.float(-0.2, 0.2), len = rng.float(7, 11); const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), leafM); leaf.scale.set(0.9, len / 2, 0.25); leaf.position.set(Math.cos(a) * 1.6, 6.2 + len * 0.42, Math.sin(a) * 1.6); leaf.rotation.set(Math.sin(a) * 0.45, -a, -Math.cos(a) * 0.45); leaf.castShadow = true; g.add(leaf); } }
    { const [x, z] = spot(sides[3], rng.float(-s * 0.3, s * 0.3), rng.float(6, 10)); const cg = prop(x, z); const can = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.4, 28), std({ color: '#b3271f', roughness: 0.3, metalness: 0.6 })); can.position.y = 2.2; can.castShadow = true; cg.add(can);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.2, 28), std({ color: '#c8c8cc', roughness: 0.25, metalness: 0.9 })); lid.position.y = 4.5; cg.add(lid); }
    // a model-kit sprue frame with spare parts, and a couple of spare figures lying on the table
    { const [x, z] = spot(sides[0], rng.float(-s * 0.3, s * 0.3) + (rng.chance(0.5) ? s * 0.6 : -s * 0.6), rng.float(4, 7)); const g = prop(x, z); g.rotation.y = rng.float(0, 6.28);
      const pm = std({ color: '#8a8f99', roughness: 0.35 }); const rod = (w, d, px, pz) => { const r = new THREE.Mesh(chamferBox(w, 0.18, d), pm); r.position.set(px, 0.12, pz); r.castShadow = true; g.add(r); };
      rod(7, 0.2, 0, -2.4); rod(7, 0.2, 0, 2.4); rod(0.2, 5, -3.4, 0); rod(0.2, 5, 3.4, 0); rod(6.8, 0.15, 0, 0); for (const px of [-1.7, 0, 1.7]) rod(0.15, 4.8, px, 0); }
  }
  finish() {
    this._skyline();
    const nav = new NavGrid(this.world, 1.5);
    // spawn height = lowest walkable layer at that cell (ground, or a terrace that replaced the ground)
    for (const s of this.spawns.all) { const node = nav.nodeOf(s.x, s.z, 0); s.y = node >= 0 ? nav.h[node] : 0; if (Number.isNaN(s.y)) s.y = 0; }
    nav.prune(this.spawns.all.map((s) => ({ x: s.x, z: s.z, y: s.y })));
    // drop spawns that are not on walkable nav
    for (const k of [0, 1, 'all']) this.spawns[k] = this.spawns[k].filter((s) => nav.isWalkable(s.x, s.z, s.y));
    if (this.spawns.all.length < 8) { // fill with random nav points
      const rng = new RNG(99); for (let i = this.spawns.all.length; i < 16; i++) { const p = nav.randomPoint(rng); this.spawns.all.push({ x: p.x, y: p.y, z: p.z, yaw: rng.float(0, 6.28) }); }
    }
    for (const t of [0, 1]) if (this.spawns[t].length === 0) this.spawns[t] = this.spawns.all.filter((s, i) => i % 2 === t);
    this._flushKit();
    this._mergeStatic();
    this.group.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = false; o.updateMatrix(); });
    return { def: this.def, group: this.group, world: this.world, nav, spawns: this.spawns, size: this.size, minimap: this._minimap(nav), landmarks: this.landmarks, cinematicPoints: this.cinematicPoints, lights: this.lights };
  }
  /** Merge every single-material static mesh into one mesh per material: cuts draw calls ~10x. */
  _mergeStatic() {
    this.group.updateMatrixWorld(true);
    const buckets = new Map(); const remove = [];
    this.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.isPoints || o.isSprite || o.isLine) return;
      const g = o.geometry; if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv) return;
      const m = o.material;
      const key = [m.type, m.vertexColors ? 'vc' : '', m.userData.prop ? 'prop' : '', m.color?.getHex(), m.roughness, m.metalness, m.map?.uuid || '', m.transparent, m.opacity, m.side, m.emissive?.getHex(), m.emissiveIntensity, m.emissiveMap?.uuid || '', m.depthWrite, m.polygonOffset, m.polygonOffsetFactor, m.blending, o.castShadow ? 'c' : 'n'].join('|');
      if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, geos: [] });
      const gg = g.clone(); gg.applyMatrix4(o.matrixWorld); if (gg.index === null) gg.setIndex([...Array(gg.attributes.position.count).keys()]);
      for (const name of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) gg.deleteAttribute(name);
      buckets.get(key).geos.push(gg); remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    let count = 0;
    for (const { material, cast, geos } of buckets.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, material); m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = true; this.group.add(m); count++;
    }
    this.mergedCount = count;
  }
  _minimap(nav) {
    const c = document.createElement('canvas'); const S = 512; c.width = S; c.height = S; const ctx = c.getContext('2d'); const k = S / this.size;
    ctx.fillStyle = this.minimapBg; ctx.fillRect(0, 0, S, S);
    const tx = (x) => (x + this.size / 2) * k, tz = (z) => (z + this.size / 2) * k;
    for (const p of this.patches) if (p.color) { ctx.save(); ctx.translate(tx(p.x), tz(p.z)); ctx.rotate(-p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.w * k / 2, -p.d * k / 2, p.w * k, p.d * k); ctx.restore(); }
    ctx.strokeStyle = '#4a4a52'; ctx.lineCap = 'butt';
    for (const r of this.roads) { ctx.lineWidth = r.width * k; ctx.beginPath(); ctx.moveTo(tx(r.x1), tz(r.z1)); ctx.lineTo(tx(r.x2), tz(r.z2)); ctx.stroke(); }
    for (const f of this.footprints) { ctx.save(); ctx.translate(tx(f.x), tz(f.z)); ctx.rotate(-f.rot); ctx.fillStyle = f.platform ? 'rgba(170,170,180,0.6)' : f.h > 12 ? '#8a8a96' : f.h > 6 ? '#777784' : '#66666f'; ctx.fillRect(-f.w * k / 2, -f.d * k / 2, f.w * k, f.d * k); ctx.restore(); }
    // small props as dots
    for (const b of this.world.boxes) { if (b.kind !== 'prop') continue; const w = b.max.x - b.min.x, d = b.max.z - b.min.z; if (w > 12 || d > 12 || b.max.y - b.min.y < 0.8) continue; ctx.fillStyle = 'rgba(140,140,150,0.7)'; ctx.fillRect(tx(b.min.x), tz(b.min.z), w * k, d * k); }
    return c;
  }
}

// ---------------- Prop library ----------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// ---- generated playset props ----
/** The colour the original builder chose: an explicit tint tag, else the colour of its biggest mesh. */
function propTint(tmp) {
  let tag = null; tmp.traverse((c) => { if (c.userData.tint) tag = c.userData.tint; }); if (tag) return tag;
  let best = null, vol = -1; const b = new THREE.Box3(), v = new THREE.Vector3();
  tmp.traverse((c) => { if (!c.isMesh || !c.geometry) return; c.geometry.computeBoundingBox(); b.copy(c.geometry.boundingBox).getSize(v); const vv = v.x * v.y * v.z * c.scale.x * c.scale.y * c.scale.z; if (vv > vol) { vol = vv; best = c; } });
  if (!best) return '#888888'; const mm = best.material; return mm.userData?.params?.color || '#' + mm.color.getHexString();
}
const LENS_GEO = new THREE.CylinderGeometry(0.2, 0.24, 0.06, 12), LENS_MAT = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd9a0', emissiveIntensity: 1.4 });
const geoSize = (mesh, axis) => { mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox; return bb.max[axis] - bb.min[axis]; };
const firstMesh = (tmp, pred = () => true) => { let f = null; tmp.traverse((c) => { if (!f && c.isMesh && pred(c)) f = c; }); return f; };
const hasMap = (c) => !!c.material.map;
/** Which props use a generated mesh, and how to read the original's scale from its throwaway build. */
const GLB_PROPS = {
  // lamp: the generated arm is longer than the old one, so the lens and the streamed light go to the real head
  lamp: { head(tpl, m, o, nLights) {
    const bb = tpl.geo.boundingBox, reach = bb.max.z - 0.32, y = bb.max.y - 0.28, sx = Math.sin(m.rotation.y), cz = Math.cos(m.rotation.y);
    const hx = m.position.x + sx * reach, hz = m.position.z + cz * reach;
    if (o.on !== false) { const lens = new THREE.Mesh(LENS_GEO, LENS_MAT); lens.position.set(hx, y, hz); lens.rotation.y = m.rotation.y; this.group.add(lens); }
    for (let i = nLights; i < this.lights.length; i++) { const L = this.lights[i]; L.x = hx; L.z = hz; L.y = y - 0.4; }
  } },
  car: {}, van: { keep: hasMap }, truck: { offset: [0, 0, -0.125] }, bus: {}, dumpster: {}, phonebooth: {}, busstop: { keep: hasMap }, newsstand: { keep: hasMap },
  stall: {}, tires: {}, trafficlight: {}, trashcan: {}, barrel: {}, bench: {}, hydrant: {}, cone: {}, trashpile: {},
  crate: { scale: (tmp) => geoSize(firstMesh(tmp), 'x') },
  container: { stretchX: (tmp, o) => (o.len || 6) / 6 },
  tree: { scale: (tmp) => firstMesh(tmp, (c) => c.geometry.type === 'CylinderGeometry').geometry.parameters.radiusTop / 0.22 },
  palm: { scale: (tmp) => firstMesh(tmp, (c) => c.geometry.type === 'CylinderGeometry').geometry.parameters.radiusTop / 0.18 },
  // second batch
  planter: { stretch: (o) => [(o.w || 2.4) / 2.4, 1, (o.d || 1.0) / 1.0] },
  pole: { when: (o) => o.wires !== false, scale: (tmp, o) => (o.h || 8) / 8 }, // bare laundry-line posts stay plain
  deadtree: {}, picnic: {}, hoop: {}, rubble: {}, tarp: {}, tent: {}, cart: {}, mattress: {}, sandbags: {},
  barricade: { keep: hasMap },
  // legs scale with the tower height, the tank keeps most of its girth so short roof towers don't turn into pucks
  watertower: { stretch: (o) => { const sy = ((o.h || 6) + 4) / 10; const sx = 0.55 + 0.45 * sy; return [sx, sy, sx]; } },
  statue: { model: (o) => (o.horse ? 'horsestatue' : 'statue'), keep: hasMap, yOffset: (o) => o.h || 2.2 }, // the figure only; the concrete pedestal stays
  // third batch: the rest of the fixed-shape props
  bollard: {}, pallet: {}, shrine: {}, grave: {}, tomb: {}, dish: {},
  barrier: { stretchX: (tmp, o) => (o.len || 3) / 3 },
  pipes: { stretchX: (tmp, o) => (o.len || 5) / 5 },
  ac: { yOffset: (o) => (o.y ? 0 : 2.4) }, // the old box sat at 2.4 m when no height was given
  antenna: { scale: (tmp, o) => (o.h || 4) / 4 },
  bush: { scale: (tmp) => firstMesh(tmp).geometry.parameters.radius }, // the random size the old builder drew
  fountain: { stretch: (o) => [(o.r || 4) / 4, 1, (o.r || 4) / 4] }, // molded water replaces the old transparent disc
  obelisk: { stretch: (o) => [1, ((o.h || 9) + 1.85) / 10.85, 1] },
  // the generated pole, frame and catwalk; the advert itself stays the original sticker board in front
  billboard: { keep: hasMap, stretch: (o) => { const w = o.w || 10; return [w / 10, ((o.h || 8) + w * 0.375) / 11.75, w / 10]; },
    // slide the frame back so its blank panel sits just behind the sticker board (whose back face is at -0.1)
    head(tpl, m) {
      if (tpl.panelFront === undefined) { const a = tpl.geo.attributes.position, H = tpl.geo.boundingBox.max.y; let z = -1e9; for (let i = 0; i < a.count; i++) { const y = a.getY(i); if (y > H * 0.8 && y < H * 0.95) z = Math.max(z, a.getZ(i)); } tpl.panelFront = z; }
      const back = tpl.panelFront * m.scale.z + 0.13; m.position.x -= Math.sin(m.rotation.y) * back; m.position.z -= Math.cos(m.rotation.y) * back;
    } },
  // laundry: the line stays; every cloth becomes a molded shirt in that cloth's colour (same RNG draws, same spacing)
  laundry: { model: () => 'shirt', custom(tmp, tpl) {
    const cloth = []; tmp.traverse((c) => { if (c.isMesh) cloth.push(c); });
    for (const c of cloth) {
      c.getWorldPosition(c.position); c.getWorldQuaternion(c.quaternion);
      if (c.geometry.type !== 'PlaneGeometry') { c.removeFromParent(); this.group.add(c); continue; }
      const m = new THREE.Mesh(tpl.geo, propMaterial('#' + c.material.color.getHexString()));
      m.position.copy(c.position); m.position.y += 0.39 - 0.75; m.quaternion.copy(c.quaternion); m.castShadow = true; this.group.add(m);
    }
  } },
};
const PROPS = {
  car(x, z, rot, o, rng) {
    const color = o.color || rng.pick(['#8c1c1c', '#1c3f8c', '#d8d8d8', '#1e1e1e', '#5a6b3a', '#c9a227', '#6b2a6b', '#777']);
    const bm = col(color, 0.4, 0.4), gm = col('#1b2430', 0.2, 0.6), wm = col('#111', 0.9, 0);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const body = new THREE.Mesh(chamferBox(1.9, 0.7, 4.4), bm); body.position.y = 0.65; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(chamferBox(1.7, 0.6, 2.2), gm); cab.position.set(0, 1.3, -0.2); cab.castShadow = true; g.add(cab);
    const roof = new THREE.Mesh(chamferBox(1.75, 0.08, 2.3), bm); roof.position.set(0, 1.62, -0.2); g.add(roof);
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); g.add(w); }
    const lm = new THREE.MeshStandardMaterial({ color: '#fff4c0', emissive: '#ffe9a0', emissiveIntensity: 0.6 });
    for (const s of [-0.6, 0.6]) { const l = new THREE.Mesh(chamferBox(0.4, 0.2, 0.1), lm); l.position.set(s, 0.75, 2.2); g.add(l); const t = new THREE.Mesh(chamferBox(0.4, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: '#b00', emissive: '#800', emissiveIntensity: 0.5 })); t.position.set(s, 0.75, -2.2); g.add(t); }
    if (o.wreck) { body.material = col('#2a2420', 0.95, 0.1); cab.material = col('#111', 0.9, 0); roof.material = body.material; }
    this.group.add(g);
    this._collide(x, 0, z, 1.9, 1.65, 4.4, rot, { walkable: true });
  },
  van(x, z, rot, o, rng) {
    const color = o.color || rng.pick(['#e8e8e8', '#2a3a5a', '#8a2a2a', '#3a5a3a']);
    const bm = col(color, 0.5, 0.3), gm = col('#1b2430', 0.2, 0.6), wm = col('#111', 0.9, 0);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const body = new THREE.Mesh(chamferBox(2.1, 1.9, 5.2), bm); body.position.y = 1.25; body.castShadow = true; g.add(body);
    const win = new THREE.Mesh(chamferBox(2.12, 0.6, 1.2), gm); win.position.set(0, 1.6, 1.9); g.add(win);
    for (const [wx, wz] of [[-1.05, 1.7], [1.05, 1.7], [-1.05, -1.7], [1.05, -1.7]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); g.add(w); }
    if (o.text) { const sm = new THREE.MeshStandardMaterial({ map: tex('sign', { text: o.text, bg: color, fg: o.textColor || '#222', w: 512, h: 128 }) }); for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), sm); p.position.set(s * 1.06, 1.3, -0.4); p.rotation.y = s * Math.PI / 2; g.add(p); } }
    this.group.add(g); this._collide(x, 0, z, 2.1, 2.2, 5.2, rot, { walkable: true });
  },
  truck(x, z, rot, o, rng) {
    const bm = col(o.color || rng.pick(['#c8c8c8', '#5a5a5a', '#8a3a2a']), 0.6, 0.3), cm = col('#2a3a5a', 0.5, 0.3), wm = col('#111');
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const box = new THREE.Mesh(chamferBox(2.4, 2.6, 5.5), bm); box.position.set(0, 1.9, -1.2); box.castShadow = true; g.add(box);
    const cab = new THREE.Mesh(chamferBox(2.3, 2.0, 2.2), cm); cab.position.set(0, 1.5, 2.6); cab.castShadow = true; g.add(cab);
    for (const [wx, wz] of [[-1.15, 2.6], [1.15, 2.6], [-1.15, -1.0], [1.15, -1.0], [-1.15, -2.4], [1.15, -2.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.48, wz); g.add(w); }
    this.group.add(g); this._collide(x, 0, z - 1.2, 2.4, 3.2, 5.5, rot, { walkable: true }); this._collide(x + Math.sin(rot) * 2.6, 0, z + Math.cos(rot) * 2.6, 2.3, 2.5, 2.2, rot, { walkable: true });
  },
  bus(x, z, rot, o, rng) {
    const bm = col(o.color || '#d9c23a', 0.5, 0.3), gm = col('#1b2430', 0.2, 0.6), wm = col('#111');
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const body = new THREE.Mesh(chamferBox(2.6, 3.0, 11), bm); body.position.y = 1.9; body.castShadow = true; g.add(body);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(chamferBox(0.05, 1.0, 10), gm); w.position.set(s * 1.31, 2.4, 0); g.add(w); }
    for (const wz of [3.6, -3.6]) for (const wx of [-1.3, 1.3]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12), wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.5, wz); g.add(w); }
    this.group.add(g); this._collide(x, 0, z, 2.6, 3.4, 11, rot, { walkable: true });
  },
  dumpster(x, z, rot, o, rng) {
    const m = col(o.color || rng.pick(['#2f5f3f', '#3a4a7a', '#6a3a2a', '#444']), 0.7, 0.4);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const b = new THREE.Mesh(chamferBox(2.0, 1.3, 1.3), m); b.position.y = 0.75; b.castShadow = true; g.add(b);
    const lid = new THREE.Mesh(chamferBox(2.05, 0.12, 1.35), col('#222', 0.8, 0.3)); lid.position.y = 1.44; g.add(lid);
    this.group.add(g); this._collide(x, 0, z, 2.0, 1.5, 1.3, rot);
  },
  trashcan(x, z, rot, o) { this.cylinder(x, 0, z, 0.35, 1.0, mat('metal', { seed: 9, rust: 0.5, color: '#555' }), 10, true); },
  trashpile(x, z, rot, o, rng) { for (let i = 0; i < 4; i++) { const px = x + rng.float(-0.8, 0.8), pz = z + rng.float(-0.8, 0.8); const s = rng.float(0.5, 0.9); this._mesh(new THREE.SphereGeometry(s * 0.5, 7, 6), col(rng.pick(['#1a1a1a', '#2a2a2a', '#3a3a3a'])), px, s * 0.3, pz); } this._collide(x, 0, z, 1.8, 0.5, 1.8, 0); },
  tires(x, z, rot, o, rng) { const m = col('#151515', 0.95, 0); for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.15, 6, 12), m); t.rotation.x = Math.PI / 2; t.position.set(x + rng.float(-0.1, 0.1), 0.15 + i * 0.3, z + rng.float(-0.1, 0.1)); t.castShadow = true; this.group.add(t); } this._collide(x, 0, z, 1.1, 1.3, 1.1, 0); },
  lamp(x, z, rot, o) {
    const m = col('#3a3a3a', 0.5, 0.7); this.cylinder(x, 0, z, 0.12, 6, m, 8, true);
    const arm = new THREE.Mesh(chamferBox(0.1, 0.1, 1.6), m); arm.position.set(x + Math.sin(rot) * 0.8, 6, z + Math.cos(rot) * 0.8); arm.rotation.y = rot; this.group.add(arm);
    const head = new THREE.Mesh(chamferBox(0.4, 0.15, 0.7), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd9a0', emissiveIntensity: o.on === false ? 0 : 1.2 })); head.position.set(x + Math.sin(rot) * 1.5, 5.95, z + Math.cos(rot) * 1.5); head.rotation.y = rot; this.group.add(head);
    if (o.light) this.light(x + Math.sin(rot) * 1.5, 5.5, z + Math.cos(rot) * 1.5, o.lightColor || '#ffd9a0', 10, 20);
  },
  pole(x, z, rot, o) { this.cylinder(x, 0, z, 0.15, o.h || 8, col('#6b5a45', 0.9), 8, true); if (o.wires !== false) { const w = new THREE.Mesh(chamferBox(1.6, 0.08, 0.08), col('#4a3a2a')); w.position.set(x, (o.h || 8) - 0.5, z); w.rotation.y = rot; this.group.add(w); } },
  trafficlight(x, z, rot, o) {
    const m = col('#2a2a2a', 0.5, 0.6); this.cylinder(x, 0, z, 0.12, 5.5, m, 8, true);
    const arm = new THREE.Mesh(chamferBox(0.12, 0.12, 4), m); arm.position.set(x + Math.sin(rot) * 2, 5.4, z + Math.cos(rot) * 2); arm.rotation.y = rot; this.group.add(arm);
    const box = new THREE.Mesh(chamferBox(0.35, 1.0, 0.35), col('#1a1a1a')); box.position.set(x + Math.sin(rot) * 3.6, 4.8, z + Math.cos(rot) * 3.6); this.group.add(box);
    const lights = ['#ff2020', '#ffb020', '#20ff40']; lights.forEach((c, i) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i === 0 ? 1.5 : 0.2 })); l.position.set(x + Math.sin(rot) * 3.6 + Math.cos(rot) * 0.18, 5.1 - i * 0.3, z + Math.cos(rot) * 3.6 - Math.sin(rot) * 0.18); this.group.add(l); });
  },
  tree(x, z, rot, o, rng) {
    const s = o.scale || rng.float(0.9, 1.4); const trunk = col('#4a3524', 0.95);
    this.cylinder(x, 0, z, 0.22 * s, 2.6 * s, trunk, 7, true);
    const lm = col(o.color || rng.pick(['#3f6b2e', '#4f7b3a', '#5a7a2a', '#6a8a3a']), 0.95);
    for (let i = 0; i < 3; i++) { const r = (1.5 - i * 0.3) * s; const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), lm); c.position.set(x + rng.float(-0.4, 0.4) * s, 2.8 * s + i * 0.9 * s, z + rng.float(-0.4, 0.4) * s); c.castShadow = true; this.group.add(c); }
  },
  palm(x, z, rot, o, rng) {
    const s = o.scale || rng.float(0.9, 1.3); const trunk = col('#7a6a4a', 0.95);
    for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 1.6 * s, 7), trunk); t.position.set(x + i * 0.12 * s, 0.8 * s + i * 1.5 * s, z); t.rotation.z = -0.08; t.castShadow = true; this.group.add(t); }
    const lm = col('#3f7a2e', 0.95, 0); const top = V(x + 0.6 * s, 8 * s, z);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const leaf = new THREE.Mesh(chamferBox(0.5 * s, 0.08, 3.2 * s), lm); leaf.position.set(top.x + Math.sin(a) * 1.3 * s, top.y - 0.4, top.z + Math.cos(a) * 1.3 * s); leaf.rotation.y = a; leaf.rotation.x = 0.5; leaf.castShadow = true; this.group.add(leaf); }
    this._collide(x, 0, z, 0.5 * s, 7 * s, 0.5 * s, 0, { walkable: false });
  },
  deadtree(x, z, rot, o, rng) { const m = col('#3a2e24', 0.95); this.cylinder(x, 0, z, 0.2, 4, m, 6, true); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 2, 5), m); b.position.set(x, 3.2 + i * 0.4, z); b.rotation.z = rng.float(-1, 1); b.rotation.y = rng.float(0, 6); this.group.add(b); } },
  bush(x, z, rot, o, rng) { const s = o.scale || rng.float(0.6, 1.1); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), col(o.color || '#3f6b2e', 0.95)); c.position.set(x, s * 0.7, z); c.castShadow = true; this.group.add(c); this._collide(x, 0, z, s * 1.6, s * 1.4, s * 1.6, 0, { walkable: false }); },
  planter(x, z, rot, o, rng) { this.box({ x, z, w: o.w || 2.4, h: 0.6, d: o.d || 1.0, m: mat('concrete', { color: '#8a8880', seed: 23 }), rot }); for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), col('#4f7b3a')); c.position.set(x + Math.cos(rot) * (i - 1) * 0.7, 0.85, z - Math.sin(rot) * (i - 1) * 0.7); this.group.add(c); } },
  bench(x, z, rot, o) { const m = col('#5a3f2a', 0.9); const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; const seat = new THREE.Mesh(chamferBox(1.8, 0.08, 0.5), m); seat.position.y = 0.45; seat.castShadow = true; g.add(seat); const back = new THREE.Mesh(chamferBox(1.8, 0.45, 0.06), m); back.position.set(0, 0.75, -0.24); g.add(back); for (const s of [-0.8, 0.8]) { const leg = new THREE.Mesh(chamferBox(0.08, 0.45, 0.5), col('#222', 0.5, 0.6)); leg.position.set(s, 0.22, 0); g.add(leg); } this.group.add(g); this._collide(x, 0, z, 1.8, 0.9, 0.5, rot); },
  picnic(x, z, rot, o) { const m = col('#6b4a2a', 0.9); this.box({ x, y: 0.7, z, w: 1.8, h: 0.08, d: 0.8, m, rot }); this._collide(x, 0, z, 1.8, 0.8, 0.8, rot); for (const s of [-0.8, 0.8]) this.box({ x: x + Math.cos(rot) * s, y: 0.4, z: z - Math.sin(rot) * s, w: 0.3, h: 0.06, d: 1.8, m, rot: rot + Math.PI / 2, collide: false }); },
  busstop(x, z, rot, o) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; const pm = col('#2a2a2a', 0.5, 0.6); for (const s of [-1.6, 1.6]) { const p = new THREE.Mesh(chamferBox(0.1, 2.6, 0.1), pm); p.position.set(s, 1.3, -0.6); g.add(p); } const roof = new THREE.Mesh(chamferBox(3.6, 0.1, 1.6), pm); roof.position.set(0, 2.6, 0); roof.castShadow = true; g.add(roof); const back = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshStandardMaterial({ color: '#8fb4d9', transparent: true, opacity: 0.3, side: THREE.DoubleSide })); back.position.set(0, 1.3, -0.65); g.add(back); const seat = new THREE.Mesh(chamferBox(3.0, 0.08, 0.4), col('#444')); seat.position.set(0, 0.5, -0.3); g.add(seat); this.group.add(g); this._collide(x - Math.cos(rot) * 0, 0, z, 3.6, 2.7, 0.3, rot, { walkable: false }); if (o.ad) { const a = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshStandardMaterial({ map: tex('sign', { text: o.ad, bg: '#223', fg: '#ffd166', w: 256, h: 384 }) })); a.position.set(x + Math.cos(rot) * 1.0, 1.4, z - Math.sin(rot) * 1.0 - Math.cos(rot) * 0.0); a.rotation.y = rot; this.group.add(a); } },
  phonebooth(x, z, rot, o) { this.box({ x, z, w: 0.9, h: 2.3, d: 0.9, m: col(o.color || '#1b3f8c', 0.6, 0.3), rot }); },
  newsstand(x, z, rot, o) { this.box({ x, z, w: 2.6, h: 2.4, d: 1.6, m: col('#2f6f4f', 0.8), rot }); this.box({ x, y: 2.4, z, w: 3.0, h: 0.1, d: 2.0, m: col('#1f4f3f'), rot, collide: false }); if (o.text) this.signboard(x, z, 2.6, 1.6, 2.4, rot, o.text, '#2f6f4f', this.rng); },
  hydrant(x, z, rot, o) { this.cylinder(x, 0, z, 0.16, 0.8, col(o.color || '#c0392b', 0.6, 0.3), 8, true); const c = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), col(o.color || '#c0392b', 0.6, 0.3)); c.position.set(x, 0.82, z); this.group.add(c); },
  bollard(x, z, rot, o) { this.cylinder(x, 0, z, 0.14, 0.9, col('#333', 0.5, 0.6), 8, true); },
  barrier(x, z, rot, o) { this.box({ x, z, w: o.len || 3, h: 0.9, d: 0.55, m: mat('concrete', { color: '#9a9a92', seed: 33 }), rot }); },
  barricade(x, z, rot, o) { const m = col(o.color || '#1f4f8f', 0.7); this.box({ x, z, w: 2.4, h: 1.1, d: 0.15, m, rot, walkable: false }); const stripe = new THREE.Mesh(chamferBox(2.4, 0.3, 0.17), col('#fff')); stripe.position.set(x, 0.75, z); stripe.rotation.y = rot; this.group.add(stripe); if (o.text) { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.28), new THREE.MeshStandardMaterial({ map: tex('sign', { text: o.text, bg: '#fff', fg: '#1f4f8f', w: 512, h: 64 }) })); s.position.set(x + Math.sin(rot) * 0.09, 0.75, z + Math.cos(rot) * 0.09); s.rotation.y = rot; this.group.add(s); } },
  cone(x, z, rot, o) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), col('#ff6a00', 0.7)); c.position.set(x, 0.35, z); c.castShadow = true; this.group.add(c); },
  crate(x, z, rot, o, rng) { const s = o.size || rng.pick([1, 1.2, 1.5]); this.box({ x, y: o.y || 0, z, w: s, h: s, d: s, m: mat('plaster', { color: '#9c7a4a', seed: rng.int(1, 99), dirty: 0.4 }), rot }); },
  pallet(x, z, rot, o) { this.box({ x, z, w: 1.2, h: 0.14, d: 1.0, m: col('#8a6a3a'), rot }); },
  container(x, z, rot, o, rng) { const color = o.color || rng.pick(['#8a2a2a', '#2a5a8a', '#2f6f3f', '#c87a2a', '#6a6a6a']); this.box({ x, y: o.y || 0, z, w: o.len || 6, h: 2.6, d: 2.4, m: mat('corrugated', { seed: rng.int(1, 999), color, rust: 0.4 }), rot, repeat: [(o.len || 6) / 2, 1] }); },
  barrel(x, z, rot, o, rng) { this.cylinder(x, 0, z, 0.32, 0.9, mat('metal', { seed: rng.int(1, 99), rust: 0.8, color: o.color || rng.pick(['#8a2a2a', '#2a5a8a', '#4a4a4a', '#c87a2a']) }), 10, true); },
  sandbags(x, z, rot, o) { const m = col('#9a8a5a', 0.95); for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - (r === 2 ? 1 : 0); i++) { const b = new THREE.Mesh(chamferBox(0.7, 0.3, 0.45), m); const off = (i - 1.5 + (r % 2) * 0.5) * 0.7; b.position.set(x + Math.cos(rot) * off, 0.15 + r * 0.3, z - Math.sin(rot) * off); b.rotation.y = rot; b.castShadow = true; this.group.add(b); } this._collide(x, 0, z, 2.8, 0.9, 0.5, rot); },
  stall(x, z, rot, o, rng) {
    const color = o.color || rng.pick(['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad']);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; g.userData.tint = color;
    const table = new THREE.Mesh(chamferBox(3, 0.9, 1.4), col('#7a5a3a', 0.9)); table.position.y = 0.45; table.castShadow = true; g.add(table);
    const pm = col('#333', 0.5, 0.6); for (const [px, pz] of [[-1.4, -0.6], [1.4, -0.6], [-1.4, 0.6], [1.4, 0.6]]) { const p = new THREE.Mesh(chamferBox(0.06, 2.4, 0.06), pm); p.position.set(px, 1.2, pz); g.add(p); }
    const roof = new THREE.Mesh(chamferBox(3.4, 0.06, 1.9), new THREE.MeshStandardMaterial({ map: tex('cloth', { color, seed: rng.int(1, 99) }), side: THREE.DoubleSide })); roof.position.y = 2.45; roof.castShadow = true; g.add(roof);
    for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), col(rng.pick(['#e74c3c', '#f1c40f', '#2ecc71', '#e67e22', '#9b59b6']))); f.position.set(rng.float(-1.2, 1.2), 1.0, rng.float(-0.5, 0.5)); g.add(f); }
    this.group.add(g); this._collide(x, 0, z, 3, 1.0, 1.4, rot);
  },
  tent(x, z, rot, o, rng) { const color = o.color || rng.pick(['#2a5a8a', '#7a7a7a', '#3a6a3a', '#8a6a2a']); const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; g.userData.tint = color; const t = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.5, 4), col(color, 0.95)); t.rotation.y = Math.PI / 4; t.position.y = 0.75; t.scale.set(1.2, 1, 1); t.castShadow = true; g.add(t); this.group.add(g); this._collide(x, 0, z, 2.0, 1.3, 1.6, rot, { walkable: false }); },
  tarp(x, z, rot, o, rng) { const color = o.color || rng.pick(['#2a5a8a', '#4a4a4a', '#8a7a4a']); const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; g.userData.tint = color; const pm = col('#444'); for (const [px, pz] of [[-1.2, -1], [1.2, -1], [-1.2, 1], [1.2, 1]]) { const p = new THREE.Mesh(chamferBox(0.08, 2.2, 0.08), pm); p.position.set(px, 1.1, pz); g.add(p); } const r = new THREE.Mesh(chamferBox(3, 0.05, 2.6), col(color, 0.95)); r.position.y = 2.2; r.rotation.z = 0.08; r.castShadow = true; g.add(r); const b = new THREE.Mesh(chamferBox(1.2, 0.5, 2.0), col('#3a2a2a')); b.position.set(-0.5, 0.25, 0); g.add(b); this.group.add(g); this._collide(x - Math.cos(rot) * 0.5, 0, z + Math.sin(rot) * 0.5, 1.2, 0.5, 2.0, rot); },
  statue(x, z, rot, o, rng) {
    const pm = mat('concrete', { color: o.pedestal || '#8a8680', seed: 41 }); const h = o.h || 2.2;
    this.box({ x, z, w: 2.4, h: h * 0.3, d: 2.4, m: pm }); this.box({ x, y: h * 0.3, z, w: 1.6, h: h * 0.7, d: 1.6, m: pm });
    const sm = col(o.color || '#4a6b5a', 0.5, 0.7); // bronze/verdigris figure: stylized
    const g = new THREE.Group(); g.position.set(x, h, z); g.rotation.y = rot;
    const torso = new THREE.Mesh(chamferBox(0.9, 1.3, 0.5), sm); torso.position.y = 1.6; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), sm); head.position.y = 2.55; g.add(head);
    const legs = new THREE.Mesh(chamferBox(0.8, 1.0, 0.45), sm); legs.position.y = 0.5; g.add(legs);
    const arm = new THREE.Mesh(chamferBox(0.25, 1.1, 0.25), sm); arm.position.set(0.65, 2.0, 0.3); arm.rotation.x = -1.2; g.add(arm);
    const arm2 = new THREE.Mesh(chamferBox(0.25, 1.1, 0.25), sm); arm2.position.set(-0.65, 1.5, 0); g.add(arm2);
    if (o.horse) { const horse = new THREE.Mesh(chamferBox(1.0, 1.1, 2.6), sm); horse.position.set(0, 1.3, 0); g.add(horse); const hn = new THREE.Mesh(chamferBox(0.5, 1.2, 0.6), sm); hn.position.set(0, 2.2, 1.5); hn.rotation.x = 0.5; g.add(hn); for (const [lx, lz] of [[-0.35, 0.9], [0.35, 0.9], [-0.35, -0.9], [0.35, -0.9]]) { const l = new THREE.Mesh(chamferBox(0.22, 1.1, 0.22), sm); l.position.set(lx, 0.5, lz); g.add(l); } torso.position.set(0, 2.5, -0.2); head.position.set(0, 3.45, -0.2); legs.position.set(0, 1.75, -0.2); legs.scale.set(1.2, 0.6, 1); arm.position.set(0.55, 2.9, 0.2); arm2.position.set(-0.55, 2.5, -0.2); }
    this.group.add(g); this._collide(x, h, z, 1.4, o.horse ? 4 : 3, o.horse ? 2.8 : 1.0, rot, { walkable: false });
    if (o.name) this.landmarks.push({ x, z, name: o.name });
  },
  fountain(x, z, rot, o, rng) {
    const r = o.r || 4; const pm = mat('concrete', { color: '#9a968e', seed: 51 });
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.7, 24), pm); rim.position.set(x, 0.35, z); rim.castShadow = true; this.group.add(rim);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.4, r - 0.4, 0.72, 24), new THREE.MeshStandardMaterial({ map: tex('water'), roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85 })); water.position.set(x, 0.36, z); this.group.add(water);
    this.cylinder(x, 0.7, z, 0.6, 1.6, pm, 12, false);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.4, 0.3, 16), pm); top.position.set(x, 2.3, z); this.group.add(top);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), pm); spire.position.set(x, 3.1, z); this.group.add(spire);
    // ring collider approximated by boxes around the rim so you can't walk through the basin center
    this._collide(x, 0, z, r * 1.6, 0.7, r * 1.6, 0, { walkable: true }); this._collide(x, 0, z, 1.4, 3.8, 1.4, 0, { walkable: false });
    if (o.name) this.landmarks.push({ x, z, name: o.name });
  },
  obelisk(x, z, rot, o) { const h = o.h || 9; const pm = mat('concrete', { color: '#a8a39a', seed: 61 }); this.box({ x, z, w: 3, h: 1.2, d: 3, m: pm }); const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.8, h, 4), pm); ob.position.set(x, 1.2 + h / 2, z); ob.rotation.y = Math.PI / 4; ob.castShadow = true; this.group.add(ob); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 4), col('#d4af37', 0.3, 0.8)); tip.position.set(x, 1.2 + h + 0.3, z); tip.rotation.y = Math.PI / 4; this.group.add(tip); this._collide(x, 1.2, z, 1.6, h, 1.6, 0, { walkable: false }); if (o.name) this.landmarks.push({ x, z, name: o.name }); },
  shrine(x, z, rot, o, rng) { this.box({ x, z, w: 1.6, h: 1.0, d: 1.0, m: mat('concrete', { color: '#6a4a3a', seed: 71 }), rot }); const g = new THREE.Group(); g.position.set(x, 1.0, z); g.rotation.y = rot; const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.6, 4), col('#8a1a1a')); roof.rotation.y = Math.PI / 4; roof.position.y = 1.5; g.add(roof); const b = new THREE.Mesh(chamferBox(1.2, 1.2, 0.7), col('#b8860b', 0.4, 0.6)); b.position.y = 0.6; g.add(b); for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: '#ff2020', emissiveIntensity: 1.5 })); c.position.set(-0.45 + i * 0.3, 0.15, 0.5); g.add(c); } this.group.add(g); this.light(x, 1.6, z, '#ff6a2a', 4, 7); this._collide(x, 1.0, z, 1.4, 1.5, 0.9, rot, { walkable: false }); },
  hoop(x, z, rot, o) { const pm = col('#333', 0.5, 0.6); this.cylinder(x, 0, z, 0.1, 3.9, pm, 8, true); const board = new THREE.Mesh(chamferBox(1.8, 1.1, 0.08), col('#f0f0f0', 0.7)); board.position.set(x + Math.sin(rot) * 0.6, 3.5, z + Math.cos(rot) * 0.6); board.rotation.y = rot; this.group.add(board); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 16), col('#ff6a00', 0.4, 0.6)); ring.rotation.x = Math.PI / 2; ring.position.set(x + Math.sin(rot) * 0.95, 3.05, z + Math.cos(rot) * 0.95); this.group.add(ring); },
  court(x, z, rot, o) { this.patch(x, z, o.w || 28, o.d || 15, 'concrete', { color: o.color || '#6a7a6a', seed: 81, scale: 6, mmColor: '#4f5f5a' }, 0.02, rot); const lm = new THREE.MeshStandardMaterial({ color: '#f0f0f0', polygonOffset: true, polygonOffsetFactor: -2 }); const w = o.w || 28, d = o.d || 15; for (const [lx, lz, lw, ld] of [[0, -d / 2, w, 0.1], [0, d / 2, w, 0.1], [-w / 2, 0, 0.1, d], [w / 2, 0, 0.1, d], [0, 0, 0.1, d]]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), lm); l.rotation.x = -Math.PI / 2; l.position.set(x + lx, 0.03, z + lz); this.group.add(l); } const c = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.8, 24), lm); c.rotation.x = -Math.PI / 2; c.position.set(x, 0.03, z); this.group.add(c); },
  scaffold(x, z, rot, o) { const h = o.h || 6, len = o.len || 6; const pm = col('#8a8a8a', 0.5, 0.7); const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; for (let i = 0; i <= Math.round(len / 2); i++) for (const pz of [-0.6, 0.6]) { const p = new THREE.Mesh(chamferBox(0.07, h, 0.07), pm); p.position.set(-len / 2 + i * 2, h / 2, pz); g.add(p); } for (let lvl = 1; lvl * 2 <= h; lvl++) { const plank = new THREE.Mesh(chamferBox(len, 0.08, 1.3), col('#9a7a4a')); plank.position.set(0, lvl * 2, 0); plank.castShadow = true; g.add(plank); } this.group.add(g); for (let lvl = 1; lvl * 2 <= h; lvl++) this._collide(x, lvl * 2 - 0.08, z, len, 0.08, 1.3, rot, { walkable: true }); this._collide(x, 0, z, len, 0.3, 1.3, rot, { walkable: true }); },
  billboard(x, z, rot, o) { const pm = col('#444', 0.5, 0.6); const h = o.h || 8; this.cylinder(x, 0, z, 0.3, h, pm, 8, true); const m = new THREE.MeshStandardMaterial({ map: tex('sign', { text: o.text || 'GHETTO BLASTER', bg: o.bg || '#ffd166', fg: o.fg || '#111', w: 1024, h: 384 }), roughness: 0.6, side: THREE.DoubleSide }); const b = new THREE.Mesh(chamferBox(o.w || 10, (o.w || 10) * 0.375, 0.2), m); b.position.set(x, h + (o.w || 10) * 0.19, z); b.rotation.y = rot; b.castShadow = true; this.group.add(b); },
  watertower(x, z, rot, o) { const h = o.h || 6; const pm = col('#5a4a3a', 0.9); for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) { const l = new THREE.Mesh(chamferBox(0.15, h, 0.15), pm); l.position.set(x + lx, (o.y || 0) + h / 2, z + lz); this.group.add(l); } const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.6, 3, 14), mat('metal', { seed: 77, rust: 0.7, color: '#7a6a5a' })); tank.position.set(x, (o.y || 0) + h + 1.5, z); tank.castShadow = true; this.group.add(tank); const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.0, 14), pm); cone.position.set(x, (o.y || 0) + h + 3.5, z); this.group.add(cone); this._collide(x, o.y || 0, z, 2.8, h + 4, 2.8, 0, { walkable: false }); },
  sign(x, z, rot, o) { const pm = col('#444', 0.5, 0.6); this.cylinder(x, 0, z, 0.06, 2.6, pm, 6, false); const sm = new THREE.MeshStandardMaterial({ map: tex('sign', { text: o.text || 'ONE WAY', bg: o.bg || '#fff', fg: o.fg || '#111', w: 256, h: 128 }) }); for (const side of [0, Math.PI]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(o.w || 0.9, o.h || 0.5), sm); s.position.set(x + Math.sin(rot + side) * 0.01, 2.3, z + Math.cos(rot + side) * 0.01); s.rotation.y = rot + side; this.group.add(s); } },
  stopsign(x, z, rot, o) { this.prop('sign', { x, z, rot, text: 'STOP', bg: '#c0392b', fg: '#fff', w: 0.8, h: 0.8 }); },
  neon(x, y, z, rot, o) { /* use neonSign */ },
  neonSign(x, z, rot, o) { const t = tex('neon', { text: o.text || 'OPEN', color: o.color || '#ff2d95', w: 512, h: 160 }); const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, emissive: new THREE.Color(o.color || '#ff2d95'), emissiveMap: t, emissiveIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }); const p = new THREE.Mesh(new THREE.PlaneGeometry(o.w || 4, (o.w || 4) * 0.31), m); p.position.set(x, o.y || 3.5, z); p.rotation.y = rot; this.group.add(p); if (o.light !== false) this.light(x + Math.sin(rot) * 0.6, o.y || 3.5, z + Math.cos(rot) * 0.6, o.color || '#ff2d95', 6, 10); },
  ac(x, z, rot, o) { this.box({ x, y: o.y || 2.4, z, w: 0.8, h: 0.6, d: 0.6, m: mat('metal', { seed: 3, color: '#9aa0a6' }), rot, collide: false }); },
  antenna(x, z, rot, o) { this.cylinder(x, o.y || 0, z, 0.05, o.h || 4, col('#333', 0.4, 0.8), 6, false); },
  dish(x, z, rot, o) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), col('#ddd', 0.5, 0.4)); d.position.set(x, (o.y || 0) + 0.5, z); d.rotation.x = -1.0 + 0; d.rotation.y = rot; this.group.add(d); },
  laundry(x, z, rot, o, rng) { const len = o.len || 5; const line = new THREE.Mesh(chamferBox(len, 0.02, 0.02), col('#ddd')); line.position.set(x, o.y || 3, z); line.rotation.y = rot; this.group.add(line); for (let i = 0; i < Math.floor(len / 0.8); i++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ color: rng.pick(['#e74c3c', '#f1c40f', '#ecf0f1', '#3498db', '#2ecc71']), side: THREE.DoubleSide })); const t = -len / 2 + 0.5 + i * 0.8; c.position.set(x + Math.cos(rot) * t, (o.y || 3) - 0.38, z - Math.sin(rot) * t); c.rotation.y = rot; this.group.add(c); } },
  flag(x, z, rot, o) { this.cylinder(x, 0, z, 0.06, 7, col('#ccc', 0.4, 0.7), 6, true); const f = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshStandardMaterial({ map: tex('cloth', { color: o.color || '#c0392b', stripe: o.stripe || '#f1c40f' }), side: THREE.DoubleSide })); f.position.set(x + Math.cos(rot) * 1.1, 6.2, z - Math.sin(rot) * 1.1); f.rotation.y = rot; this.group.add(f); },
  rubble(x, z, rot, o, rng) { const m = mat('concrete', { color: '#7a7a72', seed: 91 }); for (let i = 0; i < 6; i++) { const s = rng.float(0.4, 1.1); const b = new THREE.Mesh(chamferBox(s, s * 0.6, s * 0.8), m); b.position.set(x + rng.float(-1.5, 1.5), s * 0.3, z + rng.float(-1.5, 1.5)); b.rotation.set(rng.float(-0.3, 0.3), rng.float(0, 3), rng.float(-0.3, 0.3)); b.castShadow = true; this.group.add(b); } this._collide(x, 0, z, 3.2, 0.7, 3.2, 0); },
  mattress(x, z, rot, o) { this.box({ x, z, w: 1.4, h: 0.25, d: 2.0, m: col('#c8c0a8', 0.95), rot }); },
  cart(x, z, rot, o, rng) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; const b = new THREE.Mesh(chamferBox(0.8, 0.8, 1.0), col('#aaa', 0.4, 0.7)); b.position.y = 0.7; g.add(b); for (let i = 0; i < 3; i++) { const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), col(rng.pick(['#222', '#1a3a6a', '#eee']))); bag.position.set(rng.float(-0.3, 0.3), 1.2, rng.float(-0.3, 0.3)); g.add(bag); } this.group.add(g); this._collide(x, 0, z, 0.9, 1.3, 1.1, rot); },
  grave(x, z, rot, o) { this.box({ x, z, w: 1.2, h: 1.0, d: 0.3, m: mat('concrete', { color: '#b8b4aa', seed: 93 }), rot }); const c = new THREE.Mesh(chamferBox(0.5, 0.9, 0.12), mat('concrete', { color: '#b8b4aa', seed: 93 })); c.position.set(x, 1.4, z); c.rotation.y = rot; this.group.add(c); const c2 = new THREE.Mesh(chamferBox(0.12, 0.25, 0.14), mat('concrete', { color: '#b8b4aa', seed: 93 })); c2.position.set(x, 1.5, z); c2.rotation.y = rot; this.group.add(c2); },
  tomb(x, z, rot, o) { this.box({ x, z, w: 2.4, h: 2.6, d: 3.2, m: mat('plaster', { color: '#d8d2c4', seed: 94, dirty: 0.9 }), rot }); const r = new THREE.Mesh(chamferBox(2.8, 0.3, 3.6), mat('concrete', { color: '#8a8680', seed: 95 })); r.position.set(x, 2.75, z); r.rotation.y = rot; r.castShadow = true; this.group.add(r); },
  pipes(x, z, rot, o) { const m = mat('metal', { seed: 97, rust: 0.8, color: '#6a5a4a' }); for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, o.len || 5, 10), m); p.rotation.z = Math.PI / 2; p.rotation.y = rot; p.position.set(x, 0.3 + (i === 2 ? 0.55 : 0), z + (i - 0.5) * 0.6 * (i === 2 ? 0 : 1)); p.castShadow = true; this.group.add(p); } this._collide(x, 0, z, o.len || 5, 1.2, 1.3, rot); },
  jersey(x, z, rot, o) { this.prop('barrier', { x, z, rot, len: o.len }); },
  shack(x, z, rot, o, rng) { const w = o.w || 4, d = o.d || 3.5, h = o.h || 2.6; const color = o.color || rng.pick(['#b06a4a', '#6f8a5f', '#8a8f93', '#a3714a', '#5a7a9a']); this.shell({ x, z, w, d, h, t: 0.15, doors: [o.door || 's'], windows: false, style: 'shanty', color, roof: true, interior: false }); const r = this.box({ x, y: h + 0.3, z, w: w + 0.6, h: 0.1, d: d + 0.6, m: mat('corrugated', { seed: rng.int(1, 999), rust: 0.8 }), collide: false }); r.rotation.z = 0.04; for (let i = 0; i < 2; i++) this.prop('barrel', { x: x + w / 2 + 0.6, z: z + (i - 0.5) * 1.2 }); },
  overpass(x, z, rot, o) { const len = o.len || 40, w = o.w || 10, y = o.y || 6; const pm = mat('concrete', { color: '#7a7a74', seed: 98 }); this.box({ x, y, z, w: rot ? w : len, h: 0.8, d: rot ? len : w, m: pm, repeat: [len / 4, w / 4] }); for (const s of [-1, 1]) this.box({ x: rot ? x + s * (w / 2 - 0.2) : x, y: y + 0.8, z: rot ? z : z + s * (w / 2 - 0.2), w: rot ? 0.4 : len, h: 1.0, d: rot ? len : 0.4, m: pm, walkable: false }); const n = Math.floor(len / 10); for (let i = 0; i <= n; i++) { const t = -len / 2 + i * (len / n); const px = rot ? x : x + t, pz = rot ? z + t : z; this.box({ x: px, z: pz, w: 1.6, h: y, d: 1.6, m: pm }); } this.footprints.push({ x, z, w: rot ? w : len, d: rot ? len : w, rot: 0, h: y, platform: true }); },
};

/** Every prop type the builder can place (for tools such as the asset catalog). */
export const PROP_TYPES = Object.keys(PROPS).filter((k) => k !== 'neon');
