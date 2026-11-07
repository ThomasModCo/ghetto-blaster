// First-person view model: gun + hands parented to the camera, with sway, bob, ADS, sprint, reload and recoil.
import * as THREE from 'three';
import { buildGunMesh, plasticMat } from './character.js';
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
function toyHand(skin, sleeve, { pos, rx = 0, ry = 0, rz = 0, armDir, thumbSide = 1 }) {
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
  const dir = armDir.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const seg = (geo, mat, from, len) => { const m = new THREE.Mesh(geo, mat); m.quaternion.copy(q); m.scale.set(1, len, 1); m.position.copy(wrist).addScaledVector(dir, from + len / 2); g.add(m); return m; };
  seg(G.arm, skin, -0.01, 0.14);
  seg(G.sleeve, sleeve, 0.12, 0.6);
  const cuff = new THREE.Mesh(G.cuff, sleeve); cuff.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  cuff.position.copy(wrist).addScaledVector(dir, 0.125); g.add(cuff);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}


export class ViewModel {
  constructor(camera, { plastic = '#1e4fc0' } = {}) {
    this.camera = camera;
    this.root = new THREE.Group(); camera.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot); // recoil / reload offsets
    this.gunHolder = new THREE.Group(); this.gunHolder.rotation.y = Math.PI; this.pivot.add(this.gunHolder); // gun models point +Z; camera looks down -Z
    this.gun = null; this.weapon = null;
    // view-model lights are tuned for dark metal guns, so the plastic is molded a shade darker here to match the world
    this.plastic = plastic; this.vmShade = 0.9; this.skinMat = plasticMat(plastic, this.vmShade, 0.3); this.sleeveMat = plasticMat(plastic, this.vmShade * 0.88, 0.34);
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
    const d = w.model, len = d.len, h = d.h;
    // right hand on the grip, left hand under the fore-end (pistols: left hand cups the right at the grip).
    // gun space: +Z toward the muzzle, and gun -X is screen right (the holder is turned 180deg).
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.hands.add(toyHand(this.skinMat, this.sleeveMat, { pos: V(-0.005, -h / 2 - 0.07, len * 0.2 - 0.01), rx: -0.22, armDir: V(-0.28, -0.42, -1), thumbSide: 1 }));
    if (d.pistol) this.hands.add(toyHand(this.skinMat, this.sleeveMat, { pos: V(0.035, -h / 2 - 0.1, len * 0.2 + 0.012), rx: -0.12, rz: 0.35, armDir: V(0.6, -0.5, -1), thumbSide: -1 }));
    else {
      // the generated gun meshes don't follow the old box profile, so find the real underside of the fore-end
      const z = Math.min(len * 0.62, len - 0.06); let y = -h / 2 + 0.005;
      const under = this._underside(z); if (under !== null) y = under + 0.024;
      this.hands.add(toyHand(this.skinMat, this.sleeveMat, { pos: V(0.004, y, z), rx: -Math.PI / 2, rz: 0.15, armDir: V(0.95, -0.55, -0.75), thumbSide: -1 }));
    }
    this.swapT = 0.35;
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
    const adsPos = new THREE.Vector3(0, -sightY, -0.28 - (d.pistol ? 0 : 0.08));
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
  }
  setColors(skin, sleeve) { this.skinMat.color.set(skin); this.sleeveMat.color.set(sleeve); }
}
const h2 = (d) => d.h / 2;
