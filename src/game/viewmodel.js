// First-person view model: gun + hands parented to the camera, with sway, bob, ADS, sprint, reload and recoil.
import * as THREE from 'three';
import { buildGunMesh, matteMat, paintedMat } from './character.js';
import { MODELS, gripPoints } from './models.js';
import { damp, lerp, clamp } from '../core/rng.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Sculpted toy-figure hands: four curled finger rings around the grip, a palm pad, a thumb, then a tapered forearm
// into a hoodie cuff. Built in a local frame where the grip runs along Y, the palm faces -Z and the fingertips +Z.
let HG = null;
const handGeo = () => HG || (HG = {
  finger: new THREE.TorusGeometry(0.024, 0.0118, 8, 14, Math.PI * 1.45),
  pinky: new THREE.TorusGeometry(0.021, 0.0105, 8, 14, Math.PI * 1.45),
  palm: new RoundedBoxGeometry(0.056, 0.088, 0.03, 3, 0.012),
  thumb: new THREE.CapsuleGeometry(0.0125, 0.034, 4, 8),
  arm: new THREE.CylinderGeometry(0.037, 0.03, 1, 12, 1, true),
  sleeve: new THREE.CylinderGeometry(0.056, 0.047, 1, 14),
  cuff: new THREE.TorusGeometry(0.049, 0.011, 8, 18),
});
const UP = new THREE.Vector3(0, 1, 0);
// Painted fist (MODELS.hand, the same mesh the figures grip with) in place of the sculpted fingers, palm and thumb:
// its handle axis on the hand frame's Y, the wrist cut towards the old wrist point. Returns that wrist (hand frame).
const FP_FIST = 0.15;
// painted forearms (MODELS.arms) by outfit: the sleeve takes the crew colour; cops and bandana players show bare
// forearms (bandana: with the crew-colour wristband)
const ARM_W = 0.46, ARM_LEN = 0.8, ARM_OF = { hood: 'hoodie', cap: 'puffer', hitman: 'suit', sicario: 'camo', cop: 'bare', bandana: 'bare' };
function paintedFist(hand, mat, thumbSide) {
  const H = MODELS.hand, mir = thumbSide < 0 ? -1 : 1, M = new THREE.Vector3(mir, 1, 1);
  for (let i = hand.children.length - 1; i >= 0; i--) hand.remove(hand.children[i]);
  const g = H.grip.clone().multiply(M).normalize(), w = H.wrist.clone().multiply(M).normalize();
  const want = new THREE.Vector3(0, -0.035, -0.04).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(g, UP), w1 = w.clone().applyQuaternion(q1); w1.y = 0; const d = want.clone(); d.y = 0;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(w1.clone().cross(d).y, w1.normalize().dot(d.normalize()))).multiply(q1);
  const m = new THREE.Mesh(H.geo, mat); m.scale.set(FP_FIST * mir, FP_FIST, FP_FIST); m.quaternion.copy(q);
  m.position.copy(H.tunnel).multiply(M).multiplyScalar(-FP_FIST).applyQuaternion(q); hand.add(m);
  return m.position.clone().addScaledVector(w.applyQuaternion(q), H.wristDist * FP_FIST * 0.8);
}
function toyHand(skin, sleeve, { cuffMat = sleeve, fistMat = null, arm = null, pos, rx = 0, ry = 0, rz = 0, armDir, thumbSide = 1 }) {
  const G = handGeo(), g = new THREE.Group(); g.position.copy(pos);
  const hand = new THREE.Group(); hand.rotation.set(rx, ry, rz, 'YXZ'); g.add(hand);
  [0.03, 0.01, -0.01, -0.03].forEach((y, i) => {
    const f = new THREE.Mesh(i === 3 ? G.pinky : G.finger, skin);
    f.rotation.set(Math.PI / 2, 0, Math.PI * 0.775); // arc spans 0..1.45pi; this puts the gap (centre 1.725pi) on +Z
    f.position.set(0, y, i === 3 ? -0.003 : 0); hand.add(f);
  });
  const palm = new THREE.Mesh(G.palm, skin); palm.position.set(0, -0.002, -0.026); hand.add(palm);
  const th = new THREE.Mesh(G.thumb, skin); th.position.set(0.026 * thumbSide, 0.036, 0.004); th.rotation.set(Math.PI / 2 - 0.25, 0, 0.5 * thumbSide); hand.add(th);
  // forearm runs from the wrist (behind and below the palm) along armDir, in the hands-group frame
  const wrist = new THREE.Vector3(0, -0.035, -0.04).applyEuler(hand.rotation);
  if (fistMat && MODELS.hand) wrist.copy(paintedFist(hand, fistMat, thumbSide)).applyEuler(hand.rotation);
  const dir = armDir.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const seg = (geo, mat, from, len) => { const m = new THREE.Mesh(geo, mat); m.quaternion.copy(q); m.scale.set(1, len, 1); m.position.copy(wrist).addScaledVector(dir, from + len / 2); g.add(m); return m; };
  if (arm && arm.geo) {
    // painted forearm for the player's outfit, wrist at the fist, running back along armDir
    const m = new THREE.Mesh(arm.geo, arm.mat); m.quaternion.copy(q); m.scale.set(ARM_W, ARM_LEN, ARM_W); m.position.copy(wrist).addScaledVector(dir, -0.012); g.add(m);
    if (arm.band) { const b = new THREE.Mesh(G.cuff, cuffMat); b.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); b.scale.setScalar(arm.wristR * ARM_W / 0.049 * 0.92); b.position.copy(wrist).addScaledVector(dir, 0.03); g.add(b); }
  } else {
    seg(G.arm, skin, -0.01, 0.14);
    seg(G.sleeve, sleeve, 0.12, 0.6);
    const cuff = new THREE.Mesh(G.cuff, cuffMat); cuff.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    cuff.position.copy(wrist).addScaledVector(dir, 0.125); g.add(cuff);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}


export class ViewModel {
  constructor(camera, { plastic = '#1e4fc0', skin = null, bareArms = false, outfit = null } = {}) {
    this.outfit = outfit || (bareArms ? 'bandana' : 'hood');
    this.camera = camera;
    this.root = new THREE.Group(); camera.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot); // recoil / reload offsets
    this.gunHolder = new THREE.Group(); this.gunHolder.rotation.y = Math.PI; this.pivot.add(this.gunHolder); // gun models point +Z; camera looks down -Z
    this.gun = null; this.weapon = null;
    // painted miniature hands: the player's figure's skin tone, the sleeve (or a wristband on bare arms) in the crew colour.
    // View-model lights are tuned for dark metal guns, so everything is painted a shade darker here to match the world.
    this.plastic = plastic; this.vmShade = 0.9;
    this.skinMat = matteMat(skin || '#7b4b2f', this.vmShade).clone(); this.sleeveMat = matteMat(plastic, this.vmShade * 0.88).clone();
    this.cuffMat = this.sleeveMat; if (bareArms) this.sleeveMat = this.skinMat;
    this.fistMat = null; // painted fists once the models are in (setWeapon)
    this.hands = new THREE.Group(); this.gunHolder.add(this.hands);
    this.sway = new THREE.Vector2(); this.kick = 0; this.kickRot = 0; this.adsBlend = 0; this.sprintBlend = 0; this.reloadBlend = 0; this.swapT = 0; this.bob = new THREE.Vector2();
    this.root.renderOrder = 10;
    this.root.visible = false;
  }
  setWeapon(w) {
    if (this.gun) this.gunHolder.remove(this.gun);
    while (this.hands.children.length) this.hands.remove(this.hands.children[0]);
    this.weapon = w; this.gun = buildGunMesh(w, this.plastic, this.vmShade); this.gunHolder.add(this.gun);
    this.gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    if (!this.fistMat && MODELS.hand) this.fistMat = new THREE.MeshStandardMaterial({ color: this.skinMat.color.clone(), map: MODELS.hand.map, roughness: 0.85, metalness: 0 });
    const ak = ARM_OF[this.outfit], A = MODELS.arms[ak];
    if (A && !this.arm) this.arm = { geo: A.geo, wristR: A.wristR, band: this.outfit === 'bandana', mode: A.mode,
      mat: A.mode === 'skin' ? new THREE.MeshStandardMaterial({ color: this.skinMat.color.clone(), map: A.map, roughness: 0.85, metalness: 0 })
        : paintedMat(A.map, A.mode === 'key' ? this.plastic : null, this.vmShade, false) };
    const d = w.model, len = d.len, h = d.h;
    // right hand on the grip, left hand under the fore-end (pistols: left hand cups the right at the grip).
    // gun space: +Z toward the muzzle, and gun -X is screen right (the holder is turned 180deg).
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // generated guns: the painted fists close on the grip and fore-end read off the mesh (models.js gripPoints)
    const gp = this.fistMat && MODELS.guns.get(w.id) ? gripPoints(MODELS.guns.get(w.id).profile, d) : null;
    this.hands.add(toyHand(this.skinMat, this.sleeveMat, { cuffMat: this.cuffMat, fistMat: this.fistMat, arm: this.arm, pos: gp ? gp.grip.clone() : V(-0.005, -h / 2 - 0.07, len * 0.2 - 0.01), rx: -0.22, armDir: V(-0.28, -0.42, -1), thumbSide: 1 }));
    if (d.pistol) this.hands.add(toyHand(this.skinMat, this.sleeveMat, { cuffMat: this.cuffMat, fistMat: this.fistMat, arm: this.arm, pos: gp ? gp.grip.clone().add(V(0.035, -0.03, 0.012)) : V(0.035, -h / 2 - 0.1, len * 0.2 + 0.012), rx: -0.12, rz: 0.35, armDir: V(0.6, -0.5, -1), thumbSide: -1 }));
    else {
      // the generated gun meshes don't follow the old box profile, so find the real underside of the fore-end
      let z = Math.min(len * 0.62, len - 0.06), y = -h / 2 + 0.005;
      if (gp && gp.fore) { z = gp.fore.z; y = gp.fore.y + 0.025; } else { const under = this._underside(z); if (under !== null) y = under + 0.024; }
      this.hands.add(toyHand(this.skinMat, this.sleeveMat, { cuffMat: this.cuffMat, fistMat: this.fistMat, arm: this.arm, pos: V(0.004, y, z), rx: -Math.PI / 2, rz: 0.15, armDir: V(0.95, -0.55, -0.75), thumbSide: -1 }));
    }
    this.adsFit = this._adsFit(d);
    this.swapT = 0.35;
  }
  /** Generated guns don't follow the old box profile: aim over the real receiver top, with the stock behind the eye.
   *  Returns null for pistols, scoped guns and procedural box guns (they keep the old sight maths). */
  _adsFit(d) {
    if (d.pistol || !this.gun.children[0] || this.gun.children[0].isMesh) return null;
    this.gun.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(this.gun.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    let rearZ = 0; const pts = [];
    this.gun.traverse((o) => { if (!o.isMesh) return; m.multiplyMatrices(inv, o.matrixWorld); const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 2) { v.fromBufferAttribute(a, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); rearZ = Math.min(rearZ, v.z); } });
    if (rearZ > -0.1) return null; // no stock to clear
    // eye over the back of the receiver with the stock behind it; look over everything past the clip distance
    const eyeZ = Math.max(rearZ + 0.02, -0.04), z0 = eyeZ + 0.075, z1 = d.len * 0.5; let top = -1;
    for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] > z0 && pts[i + 2] < z1 && Math.abs(pts[i]) < 0.03) top = Math.max(top, pts[i + 1]);
    // scoped guns too: the modelled lenses are opaque, so aim just over the top like iron sights (FIFTY and CANNON
    // switch to the scope overlay once fully aimed anyway)
    return top > -1 ? { sightY: top + 0.006, z: eyeZ } : null;
  }
  /** Lowest surface of the gun mesh at gun-space depth z (null if the ray misses). */
  _underside(z) {
    const H = this.gunHolder; H.updateMatrixWorld(true);
    const o = H.localToWorld(new THREE.Vector3(0, -1, z)), up = H.localToWorld(new THREE.Vector3(0, 0, z)).sub(H.localToWorld(new THREE.Vector3(0, -1, z))).normalize();
    const hit = new THREE.Raycaster(o, up, 0, 2).intersectObject(this.gun, true)[0];
    return hit ? H.worldToLocal(hit.point.clone()).y : null;
  }
  muzzleWorld(out) { if (!this.gun) return out.copy(this.camera.position); return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  onShot(w) { this.kick = Math.min(0.12, this.kick + w.recoilV * 0.02 + 0.015); this.kickRot = Math.min(0.25, this.kickRot + w.recoilV * 0.03); }
  /** st: { ads, sprint, moving, speed, onGround, reloading, reloadT, reloadTime, look:{dx,dy}, bobPhase, dead, swapping, lean } */
  update(dt, st) {
    if (!this.gun || st.dead || st.hidden) { this.root.visible = false; return; }
    this.root.visible = true;
    const w = this.weapon, d = w.model;
    const adsRate = 1 / Math.max(0.08, w.adsTime);
    this.adsBlend = damp(this.adsBlend, st.ads ? 1 : 0, adsRate * 3.2, dt);
    this.sprintBlend = damp(this.sprintBlend, st.sprint && st.moving && !st.ads ? 1 : 0, 9, dt);
    this.reloadBlend = damp(this.reloadBlend, st.reloading ? 1 : 0, 12, dt);
    this.swapT = Math.max(0, this.swapT - dt);
    // sway follows look input with lag
    this.sway.x = damp(this.sway.x, clamp(-st.look.dx * 0.0025, -0.06, 0.06), 10, dt);
    this.sway.y = damp(this.sway.y, clamp(-st.look.dy * 0.0025, -0.06, 0.06), 10, dt);
    // bob
    const bobA = st.moving && st.onGround ? (st.sprint ? 0.022 : 0.011) * (1 - this.adsBlend * 0.85) : 0;
    this.bob.x = damp(this.bob.x, Math.cos(st.bobPhase) * bobA, 12, dt); this.bob.y = damp(this.bob.y, Math.abs(Math.sin(st.bobPhase)) * bobA * 1.4, 12, dt);
    // recoil recovery
    this.kick = damp(this.kick, 0, 16, dt); this.kickRot = damp(this.kickRot, 0, 14, dt);
    // base poses
    const ads = this.adsBlend, spr = this.sprintBlend, rl = this.reloadBlend;
    const sightY = d.pistol ? h2(d) * 0.6 + 0.015 : (d.scope ? h2(d) + 0.035 + d.scope * 0 : h2(d) + 0.015);
    const hipPos = new THREE.Vector3(0.17, -0.19 - (d.pistol ? 0.02 : 0), -0.36 - (d.pistol ? 0 : 0.05));
    const fit = this.adsFit, adsPos = fit ? new THREE.Vector3(0, -(fit.sightY ?? sightY), fit.z) : new THREE.Vector3(0, -sightY, -0.28 - (d.pistol ? 0 : 0.08));
    const pos = hipPos.lerp(adsPos, ads);
    const rot = new THREE.Vector3(0, 0, 0);
    // sprint: lower and angle the gun
    pos.lerp(new THREE.Vector3(0.2, -0.21, -0.34), spr); rot.x -= spr * 0.3; rot.y += spr * 0.55; rot.z += spr * 0.2;
    // reload: dip and tilt, with a little shake pattern
    const rt = st.reloadTime || 2; const rk = clamp(st.reloadT / rt, 0, 1); const wob = Math.sin(rk * Math.PI * 3) * 0.08;
    pos.y -= rl * 0.1; rot.x += rl * (0.35 + wob); rot.z += rl * 0.3;
    // weapon swap: raise from below
    const sw = this.swapT / 0.35; pos.y -= sw * sw * 0.35; rot.x -= sw * 0.6;
    // slide: gun tilts in and drops slightly; crawl: gun lowered, rocking with each pull
    this.slideB = damp(this.slideB || 0, st.slide ? 1 : 0, 10, dt); this.crawlB = damp(this.crawlB || 0, st.crawl ? 1 : 0, 7, dt);
    pos.x -= this.slideB * 0.05; pos.y -= this.slideB * 0.035; rot.z += this.slideB * 0.42; rot.y -= this.slideB * 0.08;
    const cs = Math.sin(st.bobPhase * 0.5);
    pos.y -= this.crawlB * (0.05 + Math.abs(cs) * 0.025); pos.x += this.crawlB * (0.02 + cs * 0.03); rot.x -= this.crawlB * 0.18; rot.z += this.crawlB * (0.28 + cs * 0.12);
    // sway, bob, recoil, lean
    pos.x += this.sway.x * (1 - ads * 0.6) + this.bob.x; pos.y += this.sway.y * (1 - ads * 0.6) + this.bob.y; pos.z += this.kick;
    rot.y += this.sway.x * 1.5 * (1 - ads * 0.5); rot.x += this.sway.y * 1.5 * (1 - ads * 0.5) + this.kickRot; rot.z += (st.lean || 0) * 0.06;
    this.root.position.copy(pos); this.root.rotation.set(rot.x, rot.y, rot.z);
    // aiming: the stock and cheek riser sit a few cm from the eye; clip them like a real cheek weld does
    const near = 0.01 + 0.065 * ads * (d.pistol ? 0 : 1);
    if (this.camera.isPerspectiveCamera && Math.abs(this.camera.near - near) > 1e-4) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
  }
  setColors(skin, sleeve) { this.skinMat.color.set(skin).multiplyScalar(this.vmShade); if (this.fistMat) this.fistMat.color.copy(this.skinMat.color); if (this.arm) { if (this.arm.mode === 'skin') this.arm.mat.color.copy(this.skinMat.color); else if (this.arm.mode === 'key') this.arm.mat.userData.tint.value.set(sleeve); } this.cuffMat.color.set(sleeve).multiplyScalar(this.vmShade * 0.88); }
}
const h2 = (d) => d.h / 2;
