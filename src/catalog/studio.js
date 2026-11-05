// Studio renderer for the asset catalog: one WebGL renderer shared by thumbnails, the 3D viewer and map shots.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setGunEnvironment } from '../game/character.js';
import { skyGradient } from '../core/textures.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const VIEWS = { iso: V(0.85, 0.55, 1).normalize(), side: V(1, 0.12, 0.0001).normalize(), front: V(0.25, 0.22, 1).normalize(), top: V(0.0001, 1, 0.45).normalize(), low: V(0.9, 0.25, 1).normalize() };

export class Studio {
  constructor() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const pm = new THREE.PMREMGenerator(r); this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    setGunEnvironment(this.env);
    const s = this.scene = new THREE.Scene(); s.environment = this.env; s.environmentIntensity = 0.35;
    s.add(new THREE.HemisphereLight('#ffffff', '#6a6458', 1.4));
    this.key = new THREE.DirectionalLight('#fff4e6', 2.4); this.key.castShadow = true; this.key.shadow.mapSize.setScalar(2048); this.key.shadow.bias = -0.0005; this.key.shadow.normalBias = 0.02;
    this.rim = new THREE.DirectionalLight('#cfe0ff', 1.2);
    s.add(this.key, this.key.target, this.rim, this.rim.target);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.3 })); this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; s.add(this.ground);
    this.cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 4000);
    this.slot = new THREE.Group(); s.add(this.slot);
  }
  /** Frame `obj` (or an explicit frame {center, radius}) from a named view or an orbit {yaw, pitch, zoom}. */
  place(obj, { view = 'iso', aspect = 4 / 3, orbit = null, frame = null } = {}) {
    obj.updateMatrixWorld(true);
    let center, radius, minY;
    if (frame) { center = frame.center.clone(); radius = frame.radius; minY = frame.minY ?? center.y - radius; }
    else { const box = new THREE.Box3().setFromObject(obj); if (box.isEmpty()) box.setFromCenterAndSize(V(), V(1, 1, 1)); center = box.getCenter(V()); radius = Math.max(box.getSize(V()).length() / 2, 0.05); minY = box.min.y; }
    const dir = orbit ? V(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)) : (VIEWS[view] || VIEWS.iso).clone();
    const cam = this.cam; cam.aspect = aspect; const vf = (cam.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const dist = (radius / Math.sin(Math.min(vf, hf) / 2)) * (orbit ? orbit.zoom : 1.04);
    cam.position.copy(center).addScaledVector(dir, dist); cam.near = Math.max(0.005, dist / 200); cam.far = dist * 20; cam.lookAt(center); cam.updateProjectionMatrix();
    const right = V().crossVectors(dir, UP).normalize();
    const kd = V().addScaledVector(dir, 0.7).addScaledVector(right, -0.6).addScaledVector(UP, 1.1).normalize();
    this.key.position.copy(center).addScaledVector(kd, radius * 4 + 4); this.key.target.position.copy(center); this.key.target.updateMatrixWorld();
    const sc = this.key.shadow.camera; const b = radius * 1.6; Object.assign(sc, { left: -b, right: b, top: b, bottom: -b, near: 0.05, far: radius * 10 + 10 }); sc.updateProjectionMatrix();
    this.rim.position.copy(center).addScaledVector(V().addScaledVector(dir, -1).addScaledVector(UP, 0.6).normalize(), radius * 4 + 4); this.rim.target.position.copy(center); this.rim.target.updateMatrixWorld();
    this.ground.position.set(center.x, minY + 0.002, center.z); this.ground.scale.setScalar(radius * 6);
  }
  render(obj, { w = 320, h = 240, view = 'iso', grounded = true, background = null, exposure = 1.15, orbit = null, frame = null } = {}) {
    const r = this.renderer;
    if (obj.parent !== this.slot) this.slot.add(obj);
    for (const c of this.slot.children) c.visible = c === obj;
    this.ground.visible = grounded; this.scene.background = background ? new THREE.Color(background) : null;
    this.place(obj, { view, aspect: w / h, orbit, frame });
    r.setSize(w, h, false); r.toneMappingExposure = exposure; r.setClearColor(0x000000, 0); r.render(this.scene, this.cam);
  }
  snapshot(obj, opts = {}) { this.render(obj, opts); const url = this.renderer.domElement.toDataURL('image/png'); this.slot.remove(obj); return url; }
  /** Render a built map from its first cinematic camera with the same lighting rules the game uses. */
  mapShot(map, w = 640, h = 400) {
    const env = map.def.env, night = !!env.night, s = new THREE.Scene(), r = this.renderer;
    s.background = skyGradient(env.skyTop, env.skyHorizon, env.skyBottom); s.fog = new THREE.Fog(env.fogColor, env.fogNear, env.fogFar * 1.2);
    const ground = new THREE.Color(env.hemiGround).lerp(new THREE.Color(env.hemiSky), 0.45);
    s.add(new THREE.HemisphereLight(env.hemiSky, ground, Math.max(night ? 1.8 : 1.4, (env.hemiIntensity ?? 0.9) * 1.6)));
    s.add(new THREE.AmbientLight(new THREE.Color(env.ambient || '#404048').lerp(new THREE.Color('#ffffff'), 0.2), Math.min(1.1, Math.max(0.6, (env.ambientIntensity ?? 0.25) * 2.4))));
    const sun = new THREE.DirectionalLight(env.sunColor, (env.sunIntensity ?? 2.2) * 1.1); sun.castShadow = true; sun.shadow.mapSize.setScalar(2048);
    const sz = env.shadowSize || 90; Object.assign(sun.shadow.camera, { left: -sz, right: sz, top: sz, bottom: -sz, near: 10, far: 400 }); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.03;
    sun.position.set(env.sunDir[0], env.sunDir[1], env.sunDir[2]).multiplyScalar(160); s.add(sun, sun.target);
    const cp = map.cinematicPoints[0] || { x: 40, y: 20, z: 40, lookX: 0, lookZ: 0 };
    const cam = new THREE.PerspectiveCamera(55, w / h, 0.1, 900); cam.position.set(cp.x, cp.y, cp.z); cam.lookAt(cp.lookX, 2, cp.lookZ);
    const boost = env.lightBoost ?? 1.3;
    for (const d of [...(map.lights || [])].sort((a, b) => cam.position.distanceTo(V(a.x, a.y, a.z)) - cam.position.distanceTo(V(b.x, b.y, b.z))).slice(0, 8)) { const l = new THREE.PointLight(d.color, d.intensity * boost, d.dist * 1.25, 1.6); l.position.set(d.x, d.y, d.z); s.add(l); }
    s.add(map.group);
    r.setSize(w, h, false); r.toneMappingExposure = env.exposure ?? (night ? 1.45 : 1.3); r.setClearColor(0x000000, 1); r.render(s, cam);
    const url = r.domElement.toDataURL('image/jpeg', 0.88);
    s.remove(map.group); if (sun.shadow.map) sun.shadow.map.dispose();
    return url;
  }
}

/** Geometry / material statistics for an object. */
export function measure(obj) {
  obj.updateMatrixWorld(true);
  // size from visible meshes and sprites only: particle pools park unused points far away and lights have no extent
  const box = new THREE.Box3(); obj.traverse((o) => { if ((o.isMesh || o.isSprite) && o.visible) box.expandByObject(o, false); });
  const size = box.isEmpty() ? V() : box.getSize(V());
  let tris = 0, meshes = 0; const mats = new Set(), colors = new Map(), textures = new Set();
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return; meshes++;
    const g = o.geometry; if (g) tris += g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue; mats.add(m);
      if (m.map) textures.add(m.map.name || 'canvas');
      if (m.color && !m.map) { const hex = '#' + m.color.getHexString(); colors.set(hex, (colors.get(hex) || 0) + 1); }
      if (m.emissive && m.emissiveIntensity > 0.2 && m.emissive.getHex() !== 0) textures.add('emissive');
    }
  });
  const palette = [...colors.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 10);
  return { w: +size.x.toFixed(2), h: +size.y.toFixed(2), d: +size.z.toFixed(2), tris: Math.round(tris), meshes, materials: mats.size, palette, textures: [...textures].filter((t) => t !== 'emissive'), emissive: textures.has('emissive') };
}
export function disposeGeometry(obj) { obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
