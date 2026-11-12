// Skinned plastic figure driven by the procedural rig (toy reskin).
//
// CharacterModel keeps animating its invisible box-rig pivots exactly as before (hips, torso, neck, arms, legs,
// gun mount). Each frame Figure.apply() retargets that pose onto the generated mesh's 24-bone skeleton:
//  - hips / spine / neck / head copy the pivots' rotations (as deltas on top of the bind pose),
//  - arms use two-bone IK so both hands stay on the gun wherever the gun mount puts it,
//  - legs use two-bone IK towards the box rig's feet, so crouching and striding bend the knees.
// All maths happens in the CharacterModel group's space, so melt scaling and world placement don't matter.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _invG = new THREE.Matrix4(), _p = V(), _s = V(), _q = Q(), _q2 = Q(), _q3 = Q();
const _a = V(), _t = V(), _e = V(), _d = V(), _n = V(), _pole = V(), _tmp = V(), _tw1 = V(), _tw2 = V(), _tw3 = V(), _bend = V();

export class Figure {
  constructor(template, material, scale = 1) {
    this.root = SkeletonUtils.clone(template);
    this.root.scale.setScalar(scale);
    this.b = {};
    this.root.traverse((o) => {
      if (o.isBone) this.b[o.name] = o;
      if (o.isMesh) { o.material = material; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
    });
    this.ok = ['Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].every((n) => this.b[n]);
    // bind pose in "group space" (the figure root's parent space; the root itself sits at identity apart from scale)
    this.root.updateMatrixWorld(true);
    this.rest = {};
    for (const [n, bone] of Object.entries(this.b)) {
      const p = V(), q = Q(), s = V(); bone.matrixWorld.decompose(p, q, s);
      this.rest[n] = { p, q, lq: bone.quaternion.clone(), lp: bone.position.clone(), dir: Y.clone().applyQuaternion(q) };
    }
    if (!this.ok) return;
    // rest bend axis per limb bone (group space, perpendicular to the bone): elbows bend back, knees bend forward.
    // _aim uses it to add twist, so a limb rolls to face its IK pole instead of only swinging (no corkscrewed wrists).
    for (const [names, ax] of [[['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'], [0, 0, -1]], [['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'], [0, 0, 1]]]) {
      for (const n of names) { const r = this.rest[n], v = V().fromArray(ax); v.addScaledVector(r.dir, -v.dot(r.dir)); if (v.lengthSq() > 1e-6) r.bend = v.normalize(); }
    }
    const len = (a, b) => this.rest[a].p.distanceTo(this.rest[b].p);
    this.len = {
      Left: [len('LeftArm', 'LeftForeArm'), len('LeftForeArm', 'LeftHand')], Right: [len('RightArm', 'RightForeArm'), len('RightForeArm', 'RightHand')],
      LeftLeg: [len('LeftUpLeg', 'LeftLeg'), len('LeftLeg', 'LeftFoot')], RightLeg: [len('RightUpLeg', 'RightLeg'), len('RightLeg', 'RightFoot')],
    };
    this.ankleH = (this.rest.LeftFoot.p.y + this.rest.RightFoot.p.y) / 2;
    // step length: the box rig swings 0.95 m legs; scale that to this figure's hip height, then shorten a touch more
    this.stepK = Math.min(1, ((this.rest.LeftUpLeg.p.y + this.rest.RightUpLeg.p.y) / 2) / (0.95 * scale)) * 0.8;
    this.posScale = 1 / this.b.Hips.parent.matrixWorld.getMaxScaleOnAxis(); // group metres -> Armature units (cm)
  }
  /** Trap House Armor: a molded plate carrier, shoulder plates and a helmet, parented to the chest, arm and head
   *  bones so they follow the pose. Built lazily the first time the streak is active. */
  setArmor(on, material, trim = material) {
    if (!this.ok) return;
    if (!this.armor && on) this._buildArmor(material, trim);
    if (this.armor) for (const a of this.armor) a.visible = on;
  }
  _buildArmor(material, trim = material) {
    const R = this.rest, sh = R.LeftArm.p.distanceTo(R.RightArm.p), head = R.Head.p, chest = R.Spine02.p, hips = R.Hips.p;
    const box = (w, h, d, c) => { const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2), pa = g.attributes.position, v = V(); // pillowed box: corners pulled in
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const k = 1 - c * (Math.abs(v.x / (w / 2)) * Math.abs(v.y / (h / 2)) + Math.abs(v.y / (h / 2)) * Math.abs(v.z / (d / 2)) + Math.abs(v.x / (w / 2)) * Math.abs(v.z / (d / 2))) / 3; pa.setXYZ(i, v.x * k, v.y * k, v.z * k); }
      g.computeVertexNormals(); return g; };
    const mesh = (geo, mat = material) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
    this.armor = [];
    const attach = (bone, obj, gx, gy, gz) => { // place obj at group-space rest position, keep it upright in the rest pose
      const bw = this.b[bone].matrixWorld, inv = new THREE.Matrix4().copy(bw).invert();
      const M = new THREE.Matrix4().compose(V().set(gx, gy, gz), Q(), V().setScalar(1)).premultiply(inv);
      M.decompose(obj.position, obj.quaternion, obj.scale); this.b[bone].add(obj); obj.visible = false; this.armor.push(obj);
    };
    const neckY = R.neck.p.y, top = neckY - (neckY - hips.y) * 0.04, bot = hips.y + (neckY - hips.y) * 0.3, torsoH = Math.max(0.2, top - bot);
    const vest = new THREE.Group(); vest.add(mesh(box(sh * 1.6, torsoH, sh * 1.2, 0.45)));
    const pouch = box(sh * 0.17, sh * 0.16, sh * 0.1, 0.4); for (const x of [-0.24, 0, 0.24]) { const p = mesh(pouch, trim); p.position.set(x * sh * 1.5, -torsoH * 0.28, sh * 0.62); vest.add(p); }
    const collar = mesh(new THREE.TorusGeometry(sh * 0.3, sh * 0.08, 8, 16), trim); collar.rotation.x = Math.PI / 2; collar.position.y = torsoH * 0.5; vest.add(collar);
    attach('Spine02', vest, chest.x, (top + bot) / 2, chest.z + sh * 0.04);
    for (const side of ['Left', 'Right']) { const a = R[side + 'Arm'].p; const pad = mesh(box(sh * 0.42, sh * 0.16, sh * 0.48, 0.6)); attach(side + 'Arm', pad, a.x * 1.05, a.y + sh * 0.1, a.z); }
    // helmet: sits up on the crown so the painted face stays visible; crew-colour band, no visor
    const hr = sh * 0.38, helm = new THREE.Group();
    const dome = mesh(new THREE.SphereGeometry(hr, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)); dome.scale.set(1, 0.85, 1.08); helm.add(dome);
    const band = mesh(new THREE.CylinderGeometry(hr * 1.02, hr * 1.04, hr * 0.16, 20), trim); band.position.y = hr * 0.04; helm.add(band);
    attach('Head', helm, head.x, head.y + hr * 1.05, head.z - hr * 0.08);
  }
  // ---- helpers (all in group space) ----
  _driverQ(obj, out) { _m.multiplyMatrices(_invG, obj.matrixWorld); _m.decompose(_p, out, _s); return out; }
  _driverPos(obj, local, out) { out.copy(local); obj.localToWorld(out); return out.applyMatrix4(_invG); }
  _pos(name, out) { return out.setFromMatrixPosition(this.b[name].matrixWorld).applyMatrix4(_invG); }
  _setRootQ(name, qRoot) {
    const bone = this.b[name]; _m.multiplyMatrices(_invG, bone.parent.matrixWorld); _m.decompose(_p, _q3, _s);
    bone.quaternion.copy(_q3.invert().multiply(qRoot)); bone.updateMatrixWorld(true);
  }
  /** Point a bone along `dir` (group space). With `bend`, also roll it about `dir` so its rest bend axis faces `bend`. */
  _aim(name, dir, bend = null) {
    const r = this.rest[name], d = _tmp.copy(dir).normalize();
    _q2.setFromUnitVectors(r.dir, d);
    if (bend && r.bend) {
      const cur = _tw1.copy(r.bend).applyQuaternion(_q2), want = _tw2.copy(bend).addScaledVector(d, -bend.dot(d));
      if (want.lengthSq() > 1e-8) { want.normalize(); const ang = Math.atan2(_tw3.crossVectors(cur, want).dot(d), cur.dot(want)); _q3.setFromAxisAngle(d, ang); _q2.premultiply(_q3); }
    }
    _q2.multiply(r.q); this._setRootQ(name, _q2);
  }
  /** Two-bone IK: aims `upper` and `lower` so the chain's end reaches `target` with the middle joint towards `pole`. */
  _ik(upper, lower, [l1, l2], target, pole) {
    this._pos(upper, _a); _d.subVectors(target, _a);
    const dist = Math.min(Math.max(_d.length(), 1e-4), (l1 + l2) * 0.999); _n.copy(_d).normalize();
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _pole.sub(_a); _pole.addScaledVector(_n, -_pole.dot(_n)); if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0); _pole.normalize();
    _e.copy(_a).addScaledVector(_n, x).addScaledVector(_pole, h);
    _bend.copy(_pole); // perpendicular to the chain, towards the elbow / knee
    this._aim(upper, _tmp.subVectors(_e, _a), _bend);
    this._aim(lower, _d.subVectors(target, _e), _bend);
  }
  /**
   * cm: the CharacterModel (pivots already posed this frame). hands: { obj, Right, Left } grip points in obj's local
   * space (the gun mesh), or null so the hands follow the box arms. Feet follow the box legs' soles.
   */
  apply(cm, hands) {
    if (!this.ok) return;
    cm.group.updateMatrixWorld(true); _invG.copy(cm.group.matrixWorld).invert();
    const R = this.rest, b = this.b;
    // hips: position offset from the rig's rest height, rotation delta on the bind pose
    const dh = this._driverPos(cm.hips.parent, cm.hips.position, V()).sub(_tmp.set(0, 0.95 * cm.scale, 0));
    b.Hips.position.copy(R.Hips.lp).addScaledVector(dh, this.posScale);
    const qh = this._driverQ(cm.hips, Q()), qt = this._driverQ(cm.torso, Q()), qn = this._driverQ(cm.neck, Q());
    this._setRootQ('Hips', _q.copy(qh).multiply(R.Hips.q));
    this._setRootQ('Spine02', _q.copy(qh).slerp(qt, 0.34).multiply(R.Spine02.q));
    this._setRootQ('Spine01', _q.copy(qh).slerp(qt, 0.67).multiply(R.Spine01.q));
    this._setRootQ('Spine', _q.copy(qt).multiply(R.Spine.q));
    this._setRootQ('neck', _q.copy(qn).multiply(R.neck.q));
    this._setRootQ('Head', _q.copy(qn).multiply(R.Head.q));
    // arms: hands on the gun (or following the box arms), elbows down/out/back
    for (const side of ['Right', 'Left']) {
      const sgn = side === 'Right' ? -1 : 1, arm = side === 'Right' ? cm.armR : cm.armL;
      if (hands && hands[side]) this._driverPos(hands.obj, hands[side], _t); else this._driverPos(arm, _tmp.set(0, -0.62 * cm.scale, 0), _t);
      this._pos(side + 'Arm', _pole); _pole.add(_e.set(sgn * 0.45, -0.8, -0.55).applyQuaternion(qt));
      this._ik(side + 'Arm', side + 'ForeArm', this.len[side], _t, _pole);
      b[side + 'Hand'].quaternion.copy(R[side + 'Hand'].lq); b[side + 'Hand'].updateMatrixWorld(true);
    }
    // legs: feet to the box rig's soles (ankle lifted), knees forward
    for (const side of ['Left', 'Right']) {
      // the box rig's sole, but with the step measured from the figure's own hip and scaled to its (shorter) legs,
      // so a sprint stride doesn't become a lunge. Height stays the box sole's, so crouch and jumps still land.
      const legPivot = side === 'Left' ? cm.legL : cm.legR;
      this._driverPos(legPivot, _tmp.set(0, -0.95 * cm.scale, 0.04 * cm.scale), _t); this._driverPos(legPivot, _tmp.set(0, 0, 0.04 * cm.scale), _bend);
      const sy = _t.y; _t.sub(_bend).multiplyScalar(this.stepK || 1); this._pos(side + 'UpLeg', _bend); _t.x += _bend.x; _t.z += _bend.z; _t.y = sy + this.ankleH;
      this._pos(side + 'UpLeg', _pole); _pole.add(_e.set(0, -0.2, 1).applyQuaternion(qh));
      this._ik(side + 'UpLeg', side + 'Leg', this.len[side + 'Leg'], _t, _pole);
      this._setRootQ(side + 'Foot', _q.copy(qh).multiply(R[side + 'Foot'].q));
    }
  }
}
