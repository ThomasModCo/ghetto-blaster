// Procedural humanoid rig + gun meshes. No external models; everything is boxes with a simple joint hierarchy.
// Toy reskin: every figure, gun and throwable is molded in ONE solid glossy plastic colour (team, FFA slot or faction).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MODELS, figureKey, propMaterial } from './models.js';
import { Figure } from './figure.js';
import { clamp, damp } from '../core/rng.js';
import { SKIN_TONES, HOODIE_COLORS } from './names.js';
const SKIN_TONE_SLOTS = SKIN_TONES, HOODIE_SLOTS = HOODIE_COLORS; // only used to replay the legacy RNG draws

// ---- plastic ----
export const TEAM_COLORS = ['#1e4fc0', '#b3271f']; // cobalt crew, crimson crew
export const FFA_COLORS = ['#1040bb', '#b12522', '#c2b9b4', '#da9b03', '#eb5404', '#611b96', '#04867e', '#68c41d', '#cf1477', '#505255'];
export const FACTION_PLASTIC = { gang: '#1e4fc0', hitman: '#2a2824', sicario: '#565a2a', cop: '#6a87a3', dog: '#3e3e42' };
export const DEFAULT_GUN_PLASTIC = '#1e4fc0';
const plasticMats = new Set();
const PLASTIC_ENV = 0.3;
let PLASTIC_LOW = false;
/** Low quality: plain standard material instead of the clear-coated physical one (cheaper on mobile GPUs). */
export function setPlasticQuality(q) { PLASTIC_LOW = q === 'low'; }
const plasticCache = new Map();
/** Glossy injection-molded plastic. shade < 1 darkens (recesses, eyes), > 1 lightens. */
export function plasticMat(c, shade = 1, rough = 0.32) {
  const k = c + '|' + shade + '|' + rough;
  if (!plasticCache.has(k)) {
    const col = new THREE.Color(c); if (shade !== 1) col.multiplyScalar(shade);
    // saturated base under a glossy clear coat: the gloss comes from the coat, so the colour never washes out
    const m = PLASTIC_LOW ? new THREE.MeshStandardMaterial({ color: col, roughness: rough + 0.05, metalness: 0 })
      : new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.55 + (rough - 0.32), metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.18 });
    if (GUN_ENV) { m.envMap = GUN_ENV; m.envMapIntensity = PLASTIC_ENV; }
    plasticMats.add(m); plasticCache.set(k, m);
  }
  return plasticCache.get(k);
}
const rbCache = new Map();
/** Soft-edged box so parts read as molded rather than voxel. */
function rbGeo(w, h, d) {
  const k = w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3);
  if (!rbCache.has(k)) rbCache.set(k, new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.22));
  return rbCache.get(k);
}
const bx = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(rbGeo(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = false; return m; };

let GUN_ENV = null;
const gunMats = new Set();
/** Reflection map for weapon and plastic materials (set once by the engine). */
export function setGunEnvironment(t) { GUN_ENV = t; for (const m of gunMats) { m.envMap = t; m.envMapIntensity = 0.85; m.needsUpdate = true; } for (const m of plasticMats) { m.envMap = t; m.envMapIntensity = PLASTIC_ENV; m.needsUpdate = true; } }
function gunEnv(group) { group.traverse((o) => { if (o.isMesh && o.material && !gunMats.has(o.material) && !plasticMats.has(o.material)) { gunMats.add(o.material); if (GUN_ENV) { o.material.envMap = GUN_ENV; o.material.envMapIntensity = 0.85; o.material.needsUpdate = true; } } }); return group; }

export function buildGunMesh(w, plastic = DEFAULT_GUN_PLASTIC, shade = 1) {
  const d = w.model; const g = new THREE.Group();
  const body = plasticMat(plastic, shade, 0.3), metal = plasticMat(plastic, 0.78 * shade, 0.36);
  const gen = MODELS.guns.get(w.id);
  if (gen) { // generated mesh, pre-oriented barrel +Z and sized to this weapon's dimensions
    const m = gen.scene.clone(); m.traverse((o) => { if (o.isMesh) { o.material = body; o.castShadow = true; } }); g.add(m);
    g.userData.muzzle = new THREE.Vector3(...gen.muzzle); g.userData.pistol = !!d.pistol; return g;
  }
  const h = d.h, len = d.len;
  if (d.pistol) {
    g.add(bx(0.04, h * 0.6, len, metal, 0, 0, len / 2)); // slide
    g.add(bx(0.035, 0.11, 0.045, body, 0, -h * 0.3 - 0.055, len * 0.25)); // grip
    if (d.mag) g.add(bx(0.03, d.mag, 0.04, metal, 0, -h * 0.3 - 0.11 - d.mag / 2, len * 0.25));
    if (d.revolver) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), metal); cyl.rotation.x = Math.PI / 2; cyl.position.set(0, -0.005, len * 0.45); g.add(cyl); if (d.barrel) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, d.barrel, 6), metal); b.rotation.x = Math.PI / 2; b.position.set(0, 0.0, len + d.barrel / 2); g.add(b); } }
    if (d.suppressor) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, 0, len + 0.07); g.add(s); }
    g.userData.muzzle = new THREE.Vector3(0, 0, len + (d.suppressor ? 0.14 : 0) + (d.barrel || 0));
    g.userData.pistol = true;
    return gunEnv(g);
  }
  g.add(bx(0.06, h, len, body, 0, 0, len / 2)); // receiver
  g.add(bx(0.05, h * 0.5, len * 0.55, metal, 0, h * 0.1, len * 0.5)); // upper
  if (d.barrel) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, d.barrel, 8), metal); b.rotation.x = Math.PI / 2; b.position.set(0, h * 0.15, len + d.barrel / 2); g.add(b); }
  if (d.suppressor) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, h * 0.15, len + d.barrel + 0.1); g.add(s); }
  if (d.stock) g.add(bx(0.05, h * 0.75, d.stock, body, 0, -h * 0.1, -d.stock / 2));
  g.add(bx(0.04, 0.12, 0.045, body, 0, -h / 2 - 0.06, len * 0.22)); // grip
  if (d.mag) { const m = bx(0.04, d.mag, 0.07, metal, 0, -h / 2 - d.mag / 2, len * 0.42); if (d.magCurve) m.rotation.x = 0.35; g.add(m); }
  if (d.drum) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12), metal); c.rotation.z = Math.PI / 2; c.position.set(0, -h / 2 - 0.06, len * 0.42); g.add(c); }
  if (d.box) g.add(bx(0.09, 0.12, 0.14, metal, 0, -h / 2 - 0.06, len * 0.4));
  if (d.scope) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, d.scope, 8), metal); s.rotation.x = Math.PI / 2; s.position.set(0, h / 2 + 0.035, len * 0.45); g.add(s); g.add(bx(0.03, 0.03, 0.03, metal, 0, h / 2 + 0.015, len * 0.45)); }
  else if (d.rail) g.add(bx(0.02, 0.03, 0.08, metal, 0, h / 2 + 0.015, len * 0.3));
  else g.add(bx(0.012, 0.03, 0.012, metal, 0, h / 2 + 0.015, len * 0.1)); // iron sight
  if (d.pump) g.add(bx(0.05, 0.05, 0.14, body, 0, -h * 0.3, len + 0.1));
  if (d.bipod) for (const s of [-1, 1]) { const l = bx(0.012, 0.16, 0.012, metal, s * 0.03, -0.1, len + 0.05); l.rotation.z = s * 0.3; g.add(l); }
  g.userData.muzzle = new THREE.Vector3(0, h * 0.15, len + (d.barrel || 0) + (d.suppressor ? 0.2 : 0));
  return gunEnv(g);
}

export function buildThrowableMesh(eq, plastic = DEFAULT_GUN_PLASTIC) {
  const pm = plasticMat(plastic, 1, 0.3), pd = plasticMat(plastic, 0.78, 0.36);
  if (eq.shape === 'can') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), pm); return m; }
  if (eq.shape === 'ball') { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), pm); return m; }
  if (eq.shape === 'axe') { const g = new THREE.Group(); g.add(bx(0.02, 0.02, 0.4, pd, 0, 0, 0)); g.add(bx(0.03, 0.14, 0.1, pm, 0, 0.06, 0.15)); return g; }
  if (eq.shape === 'bottle') { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 10), pm)); const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ff7000', emissiveIntensity: 2 })); f.position.y = 0.15; g.add(f); return g; }
  return bx(0.12, 0.08, 0.16, pm);
}

/** Humanoid rig. forward = +Z local. */
export class CharacterModel {
  constructor({ faction = 'gang', team = null, accent = null, plastic = null, rng, big = false, shirt: shirtColor = null, pants: pantsColor = null, hat: hatOverride = undefined }) {
    this.group = new THREE.Group();
    this.faction = faction;
    // one plastic colour for the whole figure: explicit > team > faction
    const base = plastic || shirtColor || (team !== null && team !== undefined ? TEAM_COLORS[team] : (FACTION_PLASTIC[faction] || FACTION_PLASTIC.gang));
    const P = (shade = 1, r = 0.32) => plasticMat(base, shade, r);
    const acc = accent || base;
    const skin = P(1);
    let shirt = P(1), pants = P(0.9), shoes = P(0.82), headMat = P(1), hat = null; const extra = [];
    // Keep the exact random draws the old skin/clothing code made: the same RNG drives the bot's AI afterwards,
    // so changing how many numbers are consumed here would change every pre-planned match outcome.
    if (rng) { rng.pick(SKIN_TONE_SLOTS); if (faction === 'gang') { if (!rng.chance(0.5)) rng.pick(HOODIE_SLOTS); rng.chance(0.5); } }
    if (faction === 'gang') { hat = rng && rng.chance(0.6) ? (rng.chance(0.5) ? 'hood' : 'cap') : 'bandana'; }
    else if (faction === 'hitman') { hat = 'glasses'; extra.push(['tie', P(1.25)]); }
    else if (faction === 'sicario') { headMat = P(0.95); extra.push(['vest', P(0.86)]); }
    else { hat = 'cap'; extra.push(['badge', P(1.35)], ['belt', P(0.72)]); }
    if (hatOverride !== undefined) hat = hatOverride;
    this.hat = hat; // remembered so the results podium can rebuild the same figure
    this.plastic = base;
    this.accent = acc;
    const s = big ? 1.15 : 1;
    // hierarchy
    this.hips = new THREE.Group(); this.hips.position.y = 0.95 * s; this.group.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    const torsoMesh = bx(0.46 * s, 0.62 * s, 0.26 * s, shirt, 0, 0.31 * s, 0); this.torso.add(torsoMesh);
    // arms (shoulder pivots)
    this.armR = new THREE.Group(); this.armR.position.set(-0.3 * s, 0.56 * s, 0); this.torso.add(this.armR);
    this.armL = new THREE.Group(); this.armL.position.set(0.3 * s, 0.56 * s, 0); this.torso.add(this.armL);
    for (const [arm, side] of [[this.armR, -1], [this.armL, 1]]) { arm.add(bx(0.13 * s, 0.3 * s, 0.13 * s, shirt, 0, -0.15 * s, 0)); const fore = bx(0.11 * s, 0.3 * s, 0.11 * s, skin, 0, -0.44 * s, 0); arm.add(fore); const hand = bx(0.1 * s, 0.1 * s, 0.1 * s, P(0.95), 0, -0.62 * s, 0); arm.add(hand); }
    // head
    this.neck = new THREE.Group(); this.neck.position.y = 0.64 * s; this.torso.add(this.neck);
    const head = bx(0.26 * s, 0.28 * s, 0.26 * s, headMat, 0, 0.16 * s, 0); this.neck.add(head); this.headMesh = head;
    if (hat === 'hood') { const h = bx(0.3 * s, 0.32 * s, 0.3 * s, shirt, 0, 0.17 * s, -0.03 * s); this.neck.add(h); const face = bx(0.2 * s, 0.2 * s, 0.03 * s, P(0.8), 0, 0.14 * s, 0.14 * s); this.neck.add(face); }
    else if (hat === 'cap') { this.neck.add(bx(0.28 * s, 0.1 * s, 0.28 * s, P(0.92), 0, 0.28 * s, 0)); this.neck.add(bx(0.26 * s, 0.03 * s, 0.14 * s, P(0.85), 0, 0.25 * s, 0.18 * s)); }
    else if (hat === 'bandana') { this.neck.add(bx(0.27 * s, 0.07 * s, 0.27 * s, P(0.88), 0, 0.26 * s, 0)); this.neck.add(bx(0.24 * s, 0.1 * s, 0.05 * s, P(0.88), 0, 0.08 * s, 0.13 * s)); }
    else if (hat === 'glasses') { this.neck.add(bx(0.24 * s, 0.05 * s, 0.03 * s, P(0.35, 0.12), 0, 0.19 * s, 0.14 * s)); }
    // eyes
    for (const e of [-0.06, 0.06]) if (faction !== 'sicario' && hat !== 'glasses') { const eye = bx(0.03 * s, 0.03 * s, 0.012, P(0.4), e * s, 0.19 * s, 0.135 * s); this.neck.add(eye); }
    for (const [kind, m] of extra) {
      if (kind === 'tie') this.torso.add(bx(0.06 * s, 0.4 * s, 0.01, m, 0, 0.36 * s, 0.135 * s));
      if (kind === 'vest') this.torso.add(bx(0.5 * s, 0.46 * s, 0.32 * s, m, 0, 0.34 * s, 0));
      if (kind === 'badge') this.torso.add(bx(0.05 * s, 0.06 * s, 0.01, m, -0.14 * s, 0.48 * s, 0.135 * s));
      if (kind === 'belt') this.hips.add(bx(0.48 * s, 0.07 * s, 0.28 * s, m, 0, 0.02 * s, 0));
    }
    // legs (hip pivots)
    this.legR = new THREE.Group(); this.legR.position.set(-0.12 * s, 0, 0); this.hips.add(this.legR);
    this.legL = new THREE.Group(); this.legL.position.set(0.12 * s, 0, 0); this.hips.add(this.legL);
    for (const leg of [this.legR, this.legL]) { leg.add(bx(0.18 * s, 0.5 * s, 0.2 * s, pants, 0, -0.25 * s, 0)); leg.add(bx(0.16 * s, 0.4 * s, 0.18 * s, pants, 0, -0.68 * s, 0)); leg.add(bx(0.17 * s, 0.1 * s, 0.26 * s, shoes, 0, -0.9 * s, 0.04 * s)); }
    // gun mount (chest-right, pointing forward)
    this.gunMount = new THREE.Group(); this.torso.add(this.gunMount);
    this.gunMesh = null;
    this.scale = s;
    this.phase = 0; this.bobY = 0; this.aimPitch = 0; this.lean = 0; this.dead = false; this.deathT = 0; this.flinch = 0;
    this.adsBlend = 0; this.crouchBlend = 0; this.sprintBlend = 0;
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.shadowOnly = false;
    // generated skinned figure: the box rig stays as the (invisible) animation driver
    const tpl = MODELS.figures.get(figureKey(faction, hat));
    this.armorMat = P(1).clone(); this.armorMat.color.multiplyScalar(0.45); this.armorMat.roughness = 0.55; // Trap House Armor plates: same plastic, molded darker
    if (tpl) { const fig = new Figure(tpl, P(1), s); if (fig.ok) { this.group.traverse((o) => { if (o.isMesh) o.visible = false; }); this.figure = fig; this.group.add(fig.root); } }
  }
  setGun(weapon) {
    if (this.gunMesh) { this.gunMount.remove(this.gunMesh); }
    this.gunMesh = weapon ? buildGunMesh(weapon, this.plastic) : null;
    if (this.gunMesh) { this.gunMount.add(this.gunMesh); this.gunIsPistol = !!this.gunMesh.userData.pistol; }
    if (weapon) { const d = weapon.model, h = d.h, len = d.len; this.grips = d.pistol
      ? { Right: new THREE.Vector3(0, -h * 0.3 - 0.06, len * 0.25), Left: new THREE.Vector3(0.035, -h * 0.3 - 0.09, len * 0.2), mag: new THREE.Vector3(0, -h * 0.3 - 0.16, len * 0.25) }
      : { Right: new THREE.Vector3(0, -h / 2 - 0.05, len * 0.22), Left: new THREE.Vector3(0, -h * 0.35, Math.min(len * 0.42, len - 0.05)), mag: new THREE.Vector3(0, -h / 2 - 0.2, len * 0.42) }; }
  }
  muzzleWorld(out) { if (this.isDog) return out.set(0, 0.6, 0.6).applyMatrix4(this.group.matrixWorld); if (!this.gunMesh) return out.set(0, 1.4, 0).applyMatrix4(this.group.matrixWorld); return out.copy(this.gunMesh.userData.muzzle).applyMatrix4(this.gunMesh.matrixWorld); }
  /** state: { speed (m/s), moving(bool), sprint, crouch, ads, onGround, pitch, lean(-1..1), dead, reloading, firing } */
  update(dt, st) {
    if (this.isDog) return this.updateDog(dt, st);
    const s = this.scale;
    if (st.dead) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT * 2.2);
      const ease = 1 - Math.pow(1 - t, 3);
      this.hips.rotation.x = -ease * (Math.PI / 2) * (this.deathDir || 1);
      this.hips.position.y = (0.95 - ease * 0.72) * s;
      this.torso.rotation.set(0, 0, 0); this.neck.rotation.set(0, 0, 0);
      this.legL.rotation.x = ease * 0.3; this.legR.rotation.x = -ease * 0.2; this.armL.rotation.x = -ease * 1.2; this.armR.rotation.x = -ease * 0.8; this.armL.rotation.z = ease * 1.2; this.armR.rotation.z = -ease * 0.6;
      this._melt(); this._applyFigure(st); return;
    }
    this.deathT = 0;
    this.adsBlend = damp(this.adsBlend, st.ads ? 1 : 0, 14, dt);
    this.crouchBlend = damp(this.crouchBlend, st.crouch ? 1 : 0, 12, dt);
    this.sprintBlend = damp(this.sprintBlend, st.sprint && st.moving ? 1 : 0, 8, dt);
    this.lean = damp(this.lean, st.lean || 0, 10, dt);
    this.flinch = Math.max(0, this.flinch - dt * 6);
    const spd = st.speed;
    const stride = st.crouch ? 1.9 : 1.55;
    if (st.moving && st.onGround) this.phase += dt * spd * stride; else this.phase = damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 10, dt);
    const amp = st.onGround ? clamp(spd / 6.5, 0, 1) * (0.55 + this.sprintBlend * 0.35) : 0.25;
    const sw = Math.sin(this.phase) * amp, sw2 = Math.sin(this.phase + Math.PI) * amp;
    const crouch = this.crouchBlend;
    // legs
    this.legL.rotation.x = sw - crouch * 0.9 + (!st.onGround ? -0.5 : 0);
    this.legR.rotation.x = sw2 - crouch * 0.9 + (!st.onGround ? -0.3 : 0);
    // hips bob & crouch
    const bob = Math.abs(Math.cos(this.phase)) * 0.045 * amp;
    this.hips.position.y = (0.95 - crouch * 0.42 + bob) * s;
    this.hips.rotation.x = 0;
    this.hips.rotation.z = this.lean * 0.15;
    this.hips.position.x = -this.lean * 0.25 * s;
    // torso: aim pitch + sprint lean + lean
    const pitch = clamp(st.pitch || 0, -1.1, 1.1);
    this.aimPitch = damp(this.aimPitch, pitch, 16, dt);
    this.torso.rotation.x = -this.aimPitch * 0.35 + this.sprintBlend * 0.28 + crouch * 0.25 + this.flinch * 0.2;
    this.torso.rotation.z = this.lean * 0.2;
    this.torso.rotation.y = Math.sin(this.phase) * 0.06 * amp - this.adsBlend * 0.1;
    this.neck.rotation.x = -this.aimPitch * 0.45 - this.sprintBlend * 0.2;
    // arms: hold weapon
    const ads = this.adsBlend, sprint = this.sprintBlend;
    const holdR = -1.35 + sprint * 0.9 - this.aimPitch * 0.5, holdL = -1.3 + sprint * 0.9 - this.aimPitch * 0.5;
    this.armR.rotation.x = holdR; this.armR.rotation.z = 0.15 - ads * 0.1; this.armR.rotation.y = -0.2 + ads * 0.25;
    this.armL.rotation.x = holdL + (this.gunIsPistol ? 0.1 : -0.1); this.armL.rotation.z = -0.45 + ads * 0.2; this.armL.rotation.y = 0.5 - ads * 0.25;
    if (st.reloading) { const r = Math.sin(st.reloadT * 9) * 0.35; this.armL.rotation.x = -0.8 + r; this.armL.rotation.z = -0.3; }
    if (sprint > 0.5 && !st.ads) { this.armR.rotation.x = -0.4 - Math.sin(this.phase + Math.PI) * 0.5 * amp; this.armL.rotation.x = -0.4 - Math.sin(this.phase) * 0.5 * amp; this.armL.rotation.y = 0.1; this.armL.rotation.z = -0.1; }
    // gun mount position follows arms
    const gx = (-0.2 + ads * 0.2) * s, gy = (0.38 + this.aimPitch * 0.05) * s, gz = (0.22 + ads * 0.08) * s;
    this.gunMount.position.set(gx, gy, gz);
    this.gunMount.rotation.set(-this.aimPitch * 0.6 + (sprint > 0.5 && !st.ads ? 0.6 : 0) + (st.reloading ? -0.25 : 0), (sprint > 0.5 && !st.ads ? -0.5 : 0), 0);
    if (st.firing) this.gunMount.position.z -= 0.03;
    if (this.figure) { this.gunMount.position.z -= 0.1 * s; this.gunMount.position.y += 0.04 * s; } // stock into the shoulder: the figure's arms are shorter than the box rig's
    this._applyFigure(st);
  }
  _applyFigure(st) {
    if (this.figure && (st.jugg || this.figure.armor)) this.figure.setArmor(!!st.jugg && !st.dead, this.armorMat);
    if (!this.figure) return;
    const hands = this.gunMesh && this.grips ? { obj: this.gunMesh, Right: this.grips.Right, Left: st.reloading ? this._reloadHand(st) : this.grips.Left } : null;
    this.figure.apply(this, hands);
  }
  _reloadHand(st) { const v = (this._rh || (this._rh = new THREE.Vector3())).copy(this.grips.mag); v.y += Math.sin((st.reloadT || 0) * 9) * 0.06; return v; }
  makeDog(gator = false) {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.figure = null; this.isDog = true; const m = plasticMat(FACTION_PLASTIC.dog, 1, 0.3), d = plasticMat(FACTION_PLASTIC.dog, 0.6, 0.35);
    this.hips = new THREE.Group(); this.hips.position.y = 0.55; this.group.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    this.torso.add(bx(0.32, 0.34, 0.8, m, 0, 0, 0));
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.12, 0.45); this.torso.add(this.neck);
    this.neck.add(bx(0.24, 0.22, 0.3, m, 0, 0.05, 0.12)); this.neck.add(bx(0.14, 0.1, 0.16, d, 0, -0.02, 0.32));
    for (const e of [-0.09, 0.09]) this.neck.add(bx(0.06, 0.08, 0.04, d, e, 0.17, 0.08));
    this.neck.add(bx(0.27, 0.06, 0.2, plasticMat(this.plastic || FACTION_PLASTIC.gang, 1, 0.3), 0, -0.05, -0.02)); // collar in owner's colour
    this.legs = [];
    for (const [x, z] of [[-0.11, 0.3], [0.11, 0.3], [-0.11, -0.3], [0.11, -0.3]]) { const l = new THREE.Group(); l.position.set(x, -0.15, z); l.add(bx(0.1, 0.42, 0.12, m, 0, -0.2, 0)); this.torso.add(l); this.legs.push(l); }
    const tail = bx(0.06, 0.06, 0.3, m, 0, 0.1, -0.5); tail.rotation.x = -0.6; this.torso.add(tail);
    this.armR = new THREE.Group(); this.armL = new THREE.Group(); this.legR = new THREE.Group(); this.legL = new THREE.Group(); this.gunMount = new THREE.Group(); this.torso.add(this.gunMount); this.gunMesh = null;
    const gt = gator && MODELS.props.get('gator');
    if (gt) { // generated alligator for GATOR SEASON: same dog rig and AI, low body, smaller leg swing
      this.torso.traverse((o) => { if (o.isMesh) o.visible = false; }); this.figure = null; this.legAmp = 0.3;
      this.dogLegs = gallopMaterial(propMaterial(null)); const gm = new THREE.Mesh(gt.geo, this.dogLegs.material(gt.geo)); gm.castShadow = true; gm.position.y = -0.55; this.torso.add(gm); this.dogBody = gm;
    } else if (MODELS.dog) { // generated dog (static mid-gallop pose): ride it on the torso so the bob and death roll still apply
      this.torso.traverse((o) => { if (o.isMesh) o.visible = false; }); this.figure = null;
      const dg = MODELS.dog.clone(); this.dogLegs = gallopMaterial(m); dg.traverse((o) => { if (o.isMesh) { o.material = this.dogLegs.material(o.geometry); o.castShadow = true; } }); dg.position.y = -0.55; this.torso.add(dg);
      const c = MODELS.dogCollar; if (c) { // studded collar in the owner's colour
        const cm = plasticMat(this.plastic || FACTION_PLASTIC.gang, 1, 0.3), col = new THREE.Mesh(new THREE.TorusGeometry(c.r, Math.max(0.018, c.r * 0.16), 8, 20), cm);
        col.position.set(c.x, c.y - 0.55, c.z); col.rotation.x = 0.35; col.castShadow = true; this.torso.add(col);
        for (let i = 0; i < 6; i++) { const a = -Math.PI * 0.15 + (i / 5) * Math.PI * 1.3; const st = new THREE.Mesh(new THREE.SphereGeometry(c.r * 0.11, 6, 4), cm); st.position.set(Math.cos(a) * c.r * 1.12, Math.sin(a) * c.r * 1.12, 0); col.add(st); }
      }
      this.dogBody = dg; }
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  updateDog(dt, st) {
    if (st.dead) { this.deathT += dt; const t = Math.min(1, this.deathT * 2.5); this.hips.rotation.z = t * Math.PI / 2; this.hips.position.y = 0.55 - t * 0.35; this._melt(); return; }
    this.deathT = 0; this.hips.rotation.z = 0; this.hips.position.y = 0.55; this.group.scale.set(1, 1, 1);
    if (st.moving && st.onGround) this.phase += dt * st.speed * 2.2;
    const amp = Math.min(1, st.speed / 8) * 0.8;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i % 3 === 0 ? 0 : Math.PI)) * amp; });
    this.hips.position.y = 0.55 + Math.abs(Math.sin(this.phase)) * 0.06 * amp;
    this.neck.rotation.x = -(st.pitch || 0) * 0.5;
    // static gallop pose: rock and stretch the body with the stride so the run reads
    if (this.dogLegs) { this.dogLegs.uniforms.uPhase.value = this.phase * 2; this.dogLegs.uniforms.uAmp.value = (this.legAmp ?? 0.55) * amp; }
    if (this.dogBody) { const s = Math.sin(this.phase * 2); this.torso.rotation.x = s * 0.09 * amp; this.dogBody.scale.set(1, 1 - s * 0.04 * amp, 1 + s * 0.06 * amp); }
  }
  /** Toy death: after the fall the plastic slumps and spreads a little. */
  _melt() { const k = clamp((this.deathT - 0.55) / 1.4, 0, 1), e = k * (2 - k); this.group.scale.set(1 + e * 0.14, 1 - e * 0.32, 1 + e * 0.14); }
  die(dir = 1) { this.dead = true; this.deathDir = dir; this.deathT = 0; }
  revive() { this.dead = false; this.deathT = 0; this.group.scale.set(1, 1, 1); this.hips.rotation.set(0, 0, 0); this.hips.position.set(0, 0.95 * this.scale, 0); }
  hit() { this.flinch = 1; }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}

/**
 * Leg motion for the generated animals, which are one static mid-stride mesh: a vertex shader swings everything below
 * the hips fore and aft around the hip line, front and back pairs in opposite phase and left/right offset (a gallop).
 * Bounds come from each mesh's own local bounding box, so it works on the quantised GLB as loaded.
 */
export function gallopMaterial(base) {
  const uniforms = { uPhase: { value: 0 }, uAmp: { value: 0 } };
  return {
    uniforms,
    material(geo) {
      geo.computeBoundingBox(); const bb = geo.boundingBox;
      const hip = bb.min.y + (bb.max.y - bb.min.y) * 0.45, cz = (bb.min.z + bb.max.z) / 2, cx = (bb.min.x + bb.max.x) / 2;
      const m = base.clone(), prev = base.onBeforeCompile; m.vertexColors = base.vertexColors; m.userData = { ...base.userData };
      m.onBeforeCompile = (sh, r) => {
        prev.call(base, sh, r);
        Object.assign(sh.uniforms, uniforms); sh.uniforms.uLeg = { value: new THREE.Vector4(hip, bb.min.y, cz, cx) };
        sh.vertexShader = 'uniform float uPhase; uniform float uAmp; uniform vec4 uLeg;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float legW = clamp((uLeg.x - transformed.y) / max(1e-4, uLeg.x - uLeg.y), 0.0, 1.0);
          float ph = uPhase + (transformed.z > uLeg.z ? 0.0 : 3.14159) + (transformed.x > uLeg.w ? 0.0 : 0.9);
          float a = sin(ph) * uAmp * legW; float dy = transformed.y - uLeg.x;
          if (legW > 0.0) { transformed.z += dy * sin(a); transformed.y = uLeg.x + dy * cos(a); }`);
      };
      m.customProgramCacheKey = () => 'gallop|' + base.customProgramCacheKey();
      return m;
    },
  };
}
