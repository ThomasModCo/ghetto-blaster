// Renderer, scene, lighting, and pooled visual effects.
import * as THREE from 'three';
import { tex, skyGradient, roomPanorama, setTextureDetail } from './textures.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setGunEnvironment, setPlasticQuality } from '../game/character.js';
// toy reskin: view-model lights were tuned to lift dark metal guns; coloured plastic needs far less
const VM_PLASTIC = 0.55;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 600);
    // First-person view model gets its own scene and a narrower camera so the gun isn't distorted by the world FOV.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 8);
    this.vmScene.add(this.vmCamera);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0); this.vmScene.add(this.vmHemi);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 1.5); this.vmScene.add(this.vmSun); this.vmScene.add(this.vmSun.target);
    // soft fill from behind the camera so dark guns always read against dark backgrounds
    this.vmFill = new THREE.DirectionalLight(0xffffff, 0.55); this.vmScene.add(this.vmFill); this.vmScene.add(this.vmFill.target);
    this.lightBoost = 1.3;
    // Studio reflection environment for weapons: metal with nothing to reflect renders black, so guns get this.
    try {
      const pm = new THREE.PMREMGenerator(this.renderer); this.gunEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
      setGunEnvironment(this.gunEnv);
      this.vmScene.environment = this.gunEnv; this.vmScene.environmentIntensity = 0.45;
    } catch (e) { /* no PMREM support: guns just stay darker */ }
    this.renderer.autoClear = false;
    this.clock = new THREE.Clock();
    this.quality = 'high';
    this.onFrame = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.fx = new FX(this.scene);
    // Fixed pool of map lights: the nearest N defined lights are streamed through these slots with fades.
    // Keeping the light COUNT constant avoids shader recompiles and keeps per-pixel cost identical on every map.
    this.mapPool = []; this.mapLightDefs = []; this.maxMapLights = 8; this.mapLightT = 0;
    for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 1.6); l.position.set(0, -200, 0); l.userData.keep = true; this.scene.add(l); this.mapPool.push({ l, def: null, target: 0, cur: 0 }); }
    this._loop = this._loop.bind(this);
    this.running = false;
  }
  setQuality(q) {
    this.quality = q; setPlasticQuality(q); setTextureDetail(q);
    const pr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(pr, 1) : q === 'medium' ? Math.min(pr, 1.5) : Math.min(pr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.maxMapLights = q === 'low' ? 4 : q === 'medium' ? 6 : 8;
    if (this.sun) { this.sun.castShadow = q !== 'low'; this.sun.shadow.mapSize.setScalar(q === 'high' ? 2048 : 1024); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; if (o.userData.kit) o.visible = q !== 'low'; });
  }
  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setEnvironment(env) {
    const s = this.scene;
    // clear old lights
    for (const o of [...s.children]) if ((o.isLight || o.userData.env) && !o.userData.keep) s.remove(o);
    // toy reskin: maps are dioramas on a table, so the backdrop is the (blurred) room instead of open sky
    s.background = env.room === false ? skyGradient(env.skyTop, env.skyHorizon, env.skyBottom) : roomPanorama(env);
    s.fog = new THREE.Fog(s.background.userData.wall ? s.background.userData.wall.clone() : new THREE.Color(env.fogColor), env.fogNear, env.fogFar);
    // Global brightness pass: stronger sky/ground fill so anything in shadow stays readable, brighter ambient,
    // higher exposure. Maps keep their own colours and mood; only the floor of the lighting is raised.
    const night = !!env.night;
    this.renderer.toneMappingExposure = env.exposure ?? (night ? 1.45 : 1.3);
    this.lightBoost = env.lightBoost ?? 1.3;
    const hemiGround = new THREE.Color(env.hemiGround).lerp(new THREE.Color(env.hemiSky), 0.45);
    const hemiI = Math.max(night ? 1.8 : 1.4, (env.hemiIntensity ?? 0.9) * 1.6);
    const hemi = new THREE.HemisphereLight(new THREE.Color(env.hemiSky), hemiGround, hemiI);
    hemi.userData.env = true; s.add(hemi);
    const sun = new THREE.DirectionalLight(new THREE.Color(env.sunColor), (env.sunIntensity ?? 2.2) * 1.1);
    sun.position.set(env.sunDir[0], env.sunDir[1], env.sunDir[2]).multiplyScalar(80);
    sun.castShadow = this.quality !== 'low';
    sun.shadow.mapSize.setScalar(this.quality === 'high' ? 2048 : 1024);
    const sz = env.shadowSize || 90;
    sun.shadow.camera.left = -sz; sun.shadow.camera.right = sz; sun.shadow.camera.top = sz; sun.shadow.camera.bottom = -sz;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 300; sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.03;
    sun.userData.env = true; s.add(sun); s.add(sun.target); sun.target.userData.env = true;
    this.sun = sun; this.hemi = hemi;
    const amb = new THREE.AmbientLight(new THREE.Color(env.ambient || '#404048').lerp(new THREE.Color('#ffffff'), 0.2), Math.min(1.1, Math.max(0.6, (env.ambientIntensity ?? 0.25) * 2.4))); amb.userData.env = true; s.add(amb);
    this.vmHemi.color.set(env.hemiSky).lerp(new THREE.Color('#ffffff'), 0.35); this.vmHemi.groundColor.copy(hemiGround).lerp(new THREE.Color('#ffffff'), 0.25); this.vmHemi.intensity = Math.max(1.8, hemiI) * VM_PLASTIC;
    this.vmSun.color.set(env.sunColor); this.vmSun.intensity = Math.min(2.6, Math.max(1.6, (env.sunIntensity ?? 2) * 0.9 + 0.4)) * VM_PLASTIC; this.vmFill.color.set(env.hemiSky).lerp(new THREE.Color('#ffffff'), 0.6); this.vmSunDir = new THREE.Vector3(env.sunDir[0], env.sunDir[1], env.sunDir[2]).normalize();
  }
  setMapLights(defs) { this.mapLightDefs = defs || []; for (const slot of this.mapPool) { slot.def = null; slot.target = 0; slot.cur = 0; slot.l.intensity = 0; slot.l.position.set(0, -200, 0); } this.mapLightT = 0; }
  updateMapLights(dt, focus) {
    const defs = this.mapLightDefs; if (!defs.length) return;
    this.mapLightT -= dt;
    if (this.mapLightT <= 0) {
      this.mapLightT = 0.3;
      const n = Math.min(this.maxMapLights, this.mapPool.length);
      const ranked = defs.map((d) => ({ d, dist: Math.hypot(d.x - focus.x, d.y - focus.y, d.z - focus.z) - d.dist * 0.5 })).sort((a, b) => a.dist - b.dist).slice(0, n).map((r) => r.d);
      for (const slot of this.mapPool) if (slot.def && !ranked.includes(slot.def)) slot.target = 0; // fade out, free when dark
      for (const d of ranked) {
        if (this.mapPool.some((sl) => sl.def === d)) { const sl = this.mapPool.find((x) => x.def === d); sl.target = d.intensity * this.lightBoost; continue; }
        const free = this.mapPool.find((sl) => !sl.def || (sl.target === 0 && sl.cur < 0.05)); if (!free) continue;
        free.def = d; free.l.position.set(d.x, d.y, d.z); free.l.color.set(d.color); free.l.distance = d.dist * 1.25; free.cur = 0; free.target = d.intensity * this.lightBoost;
      }
    }
    for (const slot of this.mapPool) { if (!slot.def) continue; slot.cur += (slot.target - slot.cur) * Math.min(1, dt * 6); slot.l.intensity = slot.cur; if (slot.target === 0 && slot.cur < 0.03) { slot.def = null; slot.cur = 0; slot.l.intensity = 0; slot.l.position.set(0, -200, 0); } }
  }
  // keep the shadow frustum centered on the camera target
  updateSunTarget(p) { if (!this.sun) return; const o = this.sun.position.clone().normalize(); this.sun.position.copy(p).addScaledVector(o, 120); this.sun.target.position.copy(p); this.sun.target.updateMatrixWorld(); }
  /** Compile every shader variant up front so the first shots/explosions don't hitch. */
  warmup() {
    const p = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(0, 0, 1);
    this.fx.vmScene = this.vmScene; this.fx.muzzle(p, d, 'shotgun'); this.fx.muzzle(p, d, 'revolver', { firstPerson: true }); this.fx.tracer(p, p.clone().add(d)); this.fx.explosion(p, 1); this.fx.smoke(p, 1, 1); this.fx.impact(p, d); this.fx.blood(p);
    this.fx.update(0.001, this.camera);
    try { this.renderer.compile(this.scene, this.camera); this.renderer.compile(this.vmScene, this.vmCamera); } catch (e) { /* ignore */ }
    this.fx.clear();
  }
  start() { if (this.running) return; this.running = true; this.clock.start(); requestAnimationFrame(this._loop); }
  stop() { this.running = false; }
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fx.update(dt, this.camera);
    if (this.onFrame) this.onFrame(dt);
    this.updateMapLights(dt, this.camera.position);
    this._resize2();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.vmCamera.children.some((c) => c.visible)) {
      // align the view-model camera with the world camera (world-space positions stay valid, e.g. muzzle flashes)
      this.vmCamera.position.copy(this.camera.position); this.vmCamera.quaternion.copy(this.camera.quaternion); this.vmCamera.updateMatrixWorld(true);
      if (this.vmSunDir) { this.vmSun.position.copy(this.camera.position).addScaledVector(this.vmSunDir, 10); this.vmSun.target.position.copy(this.camera.position); this.vmSun.target.updateMatrixWorld(); }
      const fwd = this.camera.getWorldDirection(this._vmTmp || (this._vmTmp = new THREE.Vector3()));
      this.vmFill.position.copy(this.camera.position).addScaledVector(fwd, -2).add(this.camera.up); this.vmFill.target.position.copy(this.camera.position).addScaledVector(fwd, 1); this.vmFill.target.updateMatrixWorld();
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }
  _resize2() { if (this.vmCamera.aspect !== this.camera.aspect) { this.vmCamera.aspect = this.camera.aspect; this.vmCamera.updateProjectionMatrix(); } }
}

// ---------------- Effects ----------------
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.items = [];
    this.particleTex = tex('particle'); this.muzzleTex = tex('muzzle');
    // muzzle flash layer materials (shared base, cloned per flash so opacity animates independently; same shader program)
    const add = (map, color) => new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mfMat = { core: new THREE.SpriteMaterial({ map: tex('flashCore'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), tongue: add(tex('flashTongue'), 0xffffff), ring: add(tex('flashRing'), 0xffffff), smoke: new THREE.SpriteMaterial({ map: tex('smokePuff'), transparent: true, depthWrite: false, fog: true, color: 0xdedad2 }) };
    const tg = new THREE.PlaneGeometry(1, 1); tg.translate(0, 0.5, 0); tg.rotateX(Math.PI / 2); this.tongueGeo = tg; // extends along +Z from the origin
    const rg = new THREE.PlaneGeometry(1, 1); this.ringGeo = rg; // faces +Z (perpendicular to the barrel)
    this.vmScene = null;
    // instanced-ish particle pool with Points
    this.MAX = 1500;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.MAX * 3); this.pCol = new Float32Array(this.MAX * 3); this.pSize = new Float32Array(this.MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3)); g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.particleTex } }, transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC,t.a); if(gl_FragColor.a<0.02) discard; }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.group.add(this.points);
    this.parts = []; // {p, v, life, maxLife, size, col, grav, drag}
    for (let i = 0; i < this.MAX; i++) this.pPos[i * 3 + 1] = -1000;
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, linewidth: 1 });
    this.smokes = [];
    // Fixed pool of dynamic lights. Adding/removing lights forces three.js to recompile every shader, so the
    // pool lives in the scene permanently and we only change intensity/position.
    this.lightPool = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.position.set(0, -100, 0); this.group.add(l); this.lightPool.push({ l, life: 0, maxLife: 1, decay: true }); }
    this.spot = new THREE.SpotLight(0xffffff, 0, 80, 0.4, 0.5, 1.2); this.spot.position.set(0, -100, 0); this.group.add(this.spot); this.group.add(this.spot.target);
  }
  /** Borrow a pooled light. Returns the slot so callers can move it. */
  light(pos, color = 0xffffff, intensity = 5, dist = 10, life = 0.05, decay = true) {
    let slot = this.lightPool.find((s) => s.life <= 0); if (!slot) slot = this.lightPool.reduce((a, b) => (a.life < b.life ? a : b));
    slot.l.position.copy(pos); slot.l.color.set(color); slot.l.intensity = intensity; slot.l.distance = dist; slot.life = life; slot.maxLife = life; slot.decay = decay; slot.base = intensity;
    return slot;
  }
  _spawn(p, v, life, size, col, grav = 0, drag = 0) {
    if (this.parts.length >= this.MAX) this.parts.shift();
    this.parts.push({ p: p.clone(), v: v.clone(), life, maxLife: life, size, col, grav, drag });
  }
  impact(point, normal, kind = 'concrete', plastic = null) {
    if (kind === 'blood') return this.chips(point, normal, plastic);
    const col = kind === 'metal' ? new THREE.Color(1, 0.8, 0.3) : kind === 'metal' ? new THREE.Color(1, 0.8, 0.3) : new THREE.Color(0.7, 0.65, 0.55);
    const n = kind === 'blood' ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 3));
      this._spawn(point, v, 0.3 + Math.random() * 0.3, kind === 'blood' ? 0.9 : 0.5, col, 9, 2);
    }
    if (kind !== 'blood') { // dust puff
      for (let i = 0; i < 4; i++) this._spawn(point, normal.clone().multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5))), 0.5, 2.5, new THREE.Color(0.5, 0.48, 0.45), -0.5, 3);
    }
  }
  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, this.tracerMat.clone()); l.frustumCulled = false;
    this.group.add(l); this.items.push({ obj: l, life: 0.06, kind: 'tracer' });
  }
  /** Muzzle flash. profile: pistol|revolver|smg|ar|lmg|shotgun|sniper|suppressed. opts.firstPerson puts the geometry in the view-model scene. */
  muzzle(pos, dir, profile = 'ar', opts = {}) {
    if (profile === true) profile = 'shotgun'; if (profile === false) profile = 'ar';
    const P = MUZZLE_PROFILES[profile] || MUZZLE_PROFILES.ar;
    const parent = opts.firstPerson && this.vmScene ? this.vmScene : this.group;
    const g = new THREE.Group(); g.position.copy(pos); g.lookAt(pos.clone().add(dir)); g.rotateZ(Math.random() * Math.PI * 2);
    const life = P.life * (0.85 + Math.random() * 0.3);
    const items = [];
    // core bloom
    if (P.core > 0) { const sp = new THREE.Sprite(this.mfMat.core.clone()); sp.material.color.set(P.tint); sp.position.z = P.coreOffset; sp.scale.setScalar(P.core * (0.8 + Math.random() * 0.4)); g.add(sp); items.push({ obj: sp, kind: 'core', base: sp.scale.x }); }
    // flame tongues along the barrel (crossed quads), with random lengths
    for (let i = 0; i < P.tongues; i++) { const m = new THREE.Mesh(this.tongueGeo, this.mfMat.tongue.clone()); m.material.color.set(P.tint); const len = P.length * (0.7 + Math.random() * 0.6), wid = P.width * (0.8 + Math.random() * 0.4); m.scale.set(wid, 1, len); m.rotation.z = (i / P.tongues) * Math.PI + Math.random() * 0.4; g.add(m); items.push({ obj: m, kind: 'tongue', len, wid }); }
    // side jets (compensator / revolver cylinder gap)
    for (let i = 0; i < P.jets; i++) { const m = new THREE.Mesh(this.tongueGeo, this.mfMat.tongue.clone()); m.material.color.set(P.tint); const len = P.jetLen * (0.7 + Math.random() * 0.6); m.scale.set(P.width * 0.6, 1, len); m.position.z = P.jetOffset; m.rotation.x = P.jetAngle; m.rotation.z = 0; const holder = new THREE.Group(); holder.rotation.z = (i / P.jets) * Math.PI * 2 + (P.jets === 2 ? Math.PI / 2 : 0); holder.add(m); g.add(holder); items.push({ obj: m, kind: 'tongue', len, wid: P.width * 0.6 }); }
    // shock ring
    if (P.ring > 0) { const m = new THREE.Mesh(this.ringGeo, this.mfMat.ring.clone()); m.position.z = P.length * 0.35; m.scale.setScalar(P.ring * 0.3); g.add(m); items.push({ obj: m, kind: 'ring', base: P.ring }); }
    parent.add(g);
    this.items.push({ obj: g, life, maxLife: life, kind: 'muzzle', parts: items, parent });
    // smoke puff drifting from the muzzle
    if (P.smoke > 0) { const sp = new THREE.Sprite(this.mfMat.smoke.clone()); sp.material.opacity = 0; sp.position.copy(pos).addScaledVector(dir, P.length * 0.5); sp.scale.setScalar(P.smoke * 0.5); sp.material.rotation = Math.random() * 6; this.group.add(sp); this.items.push({ obj: sp, life: 0.9, maxLife: 0.9, kind: 'smokepuff', vel: dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.5, 0)), grow: P.smoke * 0.8, peak: Math.min(0.85, P.smokeAlpha * 2.6) }); } // paper-cap puff: denser, a touch smaller
    // sparks
    for (let i = 0; i < P.sparks; i++) { const v = dir.clone().multiplyScalar(6 + Math.random() * 10).add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)); this._spawn(pos, v, 0.12 + Math.random() * 0.2, 0.35, new THREE.Color(1, 0.75, 0.3), 6, 3); }
    // light
    this.light(pos.clone().addScaledVector(dir, 0.2), P.lightColor, P.light, P.lightDist, life + 0.02);
  }
  explosion(pos, radius = 5) {
    for (let i = 0; i < 40; i++) { const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.2, (Math.random() - 0.5)).normalize().multiplyScalar(4 + Math.random() * 10); this._spawn(pos, v, 0.5 + Math.random() * 0.6, 2.5, new THREE.Color(1, 0.4 + Math.random() * 0.4, 0.1), 6, 2); }
    for (let i = 0; i < 30; i++) { const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6 + 0.3, (Math.random() - 0.5)).normalize().multiplyScalar(1 + Math.random() * 4); this._spawn(pos, v, 1.5 + Math.random() * 1.5, 6 + Math.random() * 6, new THREE.Color(0.2, 0.2, 0.2), -0.6, 1.5); }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.particleTex, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(pos); s.scale.setScalar(radius * 0.6); this.group.add(s); this.items.push({ obj: s, life: 0.25, kind: 'flash', grow: radius * 3 });
    this.light(pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xffa040, 40, radius * 5, 0.35);
  }
  smoke(pos, radius = 5, life = 14) {
    const sprites = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.particleTex, color: 0xb0b0b8, transparent: true, opacity: 0.0, depthWrite: false }));
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * radius, Math.random() * radius * 0.6 + 0.5, (Math.random() - 0.5) * radius));
      s.scale.setScalar(radius * 0.8); this.group.add(s); sprites.push(s);
    }
    this.smokes.push({ sprites, life, maxLife: life, pos: pos.clone(), radius });
  }
  sparkTrail(pos) { this._spawn(pos, new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5)), 0.4, 0.6, new THREE.Color(1, 0.6, 0.2), 4, 1); }
  /** Toy hit: a spray of chips in the victim's plastic colour plus a few white stress flecks. No blood. */
  chips(point, normal = null, plastic = null) {
    const base = new THREE.Color(plastic || '#1e4fc0'), hi = base.clone().lerp(new THREE.Color(1, 1, 1), 0.25), white = new THREE.Color(0.95, 0.95, 0.92);
    for (let i = 0; i < 12; i++) {
      const v = (normal ? normal.clone().multiplyScalar(1.5 + Math.random() * 2.5) : new THREE.Vector3()).add(new THREE.Vector3((Math.random() - 0.5) * 3.5, Math.random() * 3, (Math.random() - 0.5) * 3.5));
      this._spawn(point, v, 0.5 + Math.random() * 0.5, 0.16 + Math.random() * 0.14, i < 3 ? white : (i % 2 ? hi : base), 14, 0.6);
    }
  }
  blood(pos, plastic = null) { this.chips(pos, null, plastic); }
  casing(pos, right) { this._spawn(pos, right.clone().multiplyScalar(1.5 + Math.random()).add(new THREE.Vector3(0, 2 + Math.random(), 0)), 0.7, 0.35, new THREE.Color(0.9, 0.75, 0.3), 12, 0); }
  update(dt, camera) {
    // particles
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.v.y -= p.grav * dt; p.v.multiplyScalar(1 - p.drag * dt);
      p.p.addScaledVector(p.v, dt); if (p.p.y < 0.02) { p.p.y = 0.02; p.v.y *= -0.2; p.v.x *= 0.5; p.v.z *= 0.5; }
      const k = p.life / p.maxLife;
      this.pPos[n * 3] = p.p.x; this.pPos[n * 3 + 1] = p.p.y; this.pPos[n * 3 + 2] = p.p.z;
      this.pCol[n * 3] = p.col.r * k; this.pCol[n * 3 + 1] = p.col.g * k; this.pCol[n * 3 + 2] = p.col.b * k;
      this.pSize[n] = p.size * (p.grav < 0 ? (2 - k) : (0.5 + k * 0.5));
      n++;
    }
    for (let i = n; i < this.MAX; i++) this.pPos[i * 3 + 1] = -1000;
    const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true; g.setDrawRange(0, Math.max(n, 1));
    // timed items
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.life -= dt;
      if (it.kind === 'flash') { it.obj.scale.addScalar(it.grow * dt); it.obj.material.opacity = Math.max(0, it.life * 4); }
      if (it.kind === 'muzzle') {
        const k = it.life / it.maxLife; // 1 -> 0
        const flicker = 0.75 + Math.random() * 0.35; const env = k > 0.7 ? (1 - k) / 0.3 : k / 0.7; // fast attack, decay
        for (const p of it.parts) {
          if (p.kind === 'core') { p.obj.material.opacity = env * flicker; p.obj.scale.setScalar(p.base * (0.6 + 0.6 * (1 - k))); }
          else if (p.kind === 'tongue') { p.obj.material.opacity = env * flicker; p.obj.scale.z = p.len * (0.5 + 0.7 * (1 - k)); }
          else if (p.kind === 'ring') { p.obj.material.opacity = Math.max(0, k * 0.8) * flicker; p.obj.scale.setScalar(p.base * (0.3 + 1.2 * (1 - k))); }
        }
        if (it.life <= 0) { it.parent.remove(it.obj); for (const p of it.parts) p.obj.material.dispose(); this.items.splice(i, 1); continue; }
        continue;
      }
      if (it.kind === 'smokepuff') { const k = 1 - it.life / it.maxLife; it.obj.position.addScaledVector(it.vel, dt); it.vel.multiplyScalar(1 - 1.5 * dt); it.obj.scale.setScalar(it.grow * (0.5 + k * 1.6)); it.obj.material.opacity = it.peak * Math.sin(Math.min(1, k) * Math.PI); }
      if (it.kind === 'tracer') it.obj.material.opacity = Math.max(0, it.life * 15);
      if (it.life <= 0) { this.group.remove(it.obj); if (it.obj.geometry) it.obj.geometry.dispose(); if (it.obj.material) it.obj.material.dispose(); this.items.splice(i, 1); }
    }
    for (const slot of this.lightPool) { if (slot.life > 0) { slot.life -= dt; if (slot.decay) slot.l.intensity = slot.base * Math.max(0, slot.life / slot.maxLife); if (slot.life <= 0) { slot.l.intensity = 0; slot.l.position.set(0, -100, 0); } } }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]; s.life -= dt; const k = s.life / s.maxLife;
      const a = Math.min(1, (1 - k) * 6) * Math.min(1, k * 4) * 0.85;
      for (const sp of s.sprites) { sp.material.opacity = a; sp.position.y += dt * 0.15; sp.material.rotation += dt * 0.1; }
      if (s.life <= 0) { for (const sp of s.sprites) { this.group.remove(sp); sp.material.dispose(); } this.smokes.splice(i, 1); }
    }
  }
  // is a point inside any active smoke? (used by bot vision)
  inSmoke(p) { for (const s of this.smokes) if (s.life / s.maxLife > 0.08 && s.life / s.maxLife < 0.97 && p.distanceTo(s.pos) < s.radius) return true; return false; }
  clear() {
    for (const it of this.items) (it.parent || this.group).remove(it.obj);
    this.items.length = 0; this.parts.length = 0;
    for (const s of this.smokes) for (const sp of s.sprites) this.group.remove(sp);
    this.smokes.length = 0;
    for (const slot of this.lightPool) { slot.life = 0; slot.l.intensity = 0; slot.l.position.set(0, -100, 0); }
    this.spot.intensity = 0;
  }
}

// Muzzle flash profiles: sizes in metres, life in seconds.
export const MUZZLE_PROFILES = {
  pistol:     { core: 0.32, coreOffset: 0.03, tongues: 2, length: 0.28, width: 0.12, jets: 0, jetLen: 0, jetOffset: 0, jetAngle: 0, ring: 0,    smoke: 0.35, smokeAlpha: 0.175, sparks: 3,  light: 5,  lightDist: 7,  lightColor: 0xffc070, tint: 0xffe4b0, life: 0.05 },
  revolver:   { core: 0.42, coreOffset: 0.03, tongues: 3, length: 0.4,  width: 0.14, jets: 2, jetLen: 0.22, jetOffset: -0.12, jetAngle: Math.PI / 2, ring: 0.3, smoke: 0.5, smokeAlpha: 0.225, sparks: 6,  light: 9,  lightDist: 9,  lightColor: 0xffb860, tint: 0xffd9a0, life: 0.06 },
  smg:        { core: 0.3,  coreOffset: 0.03, tongues: 3, length: 0.32, width: 0.11, jets: 0, jetLen: 0, jetOffset: 0, jetAngle: 0, ring: 0,    smoke: 0.3,  smokeAlpha: 0.125, sparks: 3,  light: 5,  lightDist: 7,  lightColor: 0xffc878, tint: 0xfff0c8, life: 0.045 },
  ar:         { core: 0.4,  coreOffset: 0.04, tongues: 3, length: 0.55, width: 0.15, jets: 3, jetLen: 0.2, jetOffset: 0.02, jetAngle: Math.PI / 2.6, ring: 0.35, smoke: 0.4, smokeAlpha: 0.15, sparks: 5, light: 8, lightDist: 10, lightColor: 0xffbe70, tint: 0xffe0b0, life: 0.055 },
  lmg:        { core: 0.5,  coreOffset: 0.05, tongues: 4, length: 0.7,  width: 0.2,  jets: 4, jetLen: 0.28, jetOffset: 0.02, jetAngle: Math.PI / 2.4, ring: 0.5, smoke: 0.55, smokeAlpha: 0.2, sparks: 7, light: 11, lightDist: 12, lightColor: 0xffb060, tint: 0xffd8a0, life: 0.06 },
  shotgun:    { core: 0.7,  coreOffset: 0.06, tongues: 4, length: 0.9,  width: 0.3,  jets: 0, jetLen: 0, jetOffset: 0, jetAngle: 0, ring: 0.9,  smoke: 0.9,  smokeAlpha: 0.275, sparks: 16, light: 16, lightDist: 14, lightColor: 0xffa850, tint: 0xffcf90, life: 0.08 },
  sniper:     { core: 0.6,  coreOffset: 0.06, tongues: 4, length: 1.2,  width: 0.22, jets: 4, jetLen: 0.45, jetOffset: 0.0, jetAngle: Math.PI / 2.2, ring: 1.1, smoke: 0.8, smokeAlpha: 0.25, sparks: 10, light: 18, lightDist: 16, lightColor: 0xffb868, tint: 0xffe6c0, life: 0.09 },
  suppressed: { core: 0.12, coreOffset: 0.02, tongues: 1, length: 0.12, width: 0.06, jets: 0, jetLen: 0, jetOffset: 0, jetAngle: 0, ring: 0,    smoke: 0.5,  smokeAlpha: 0.15,  sparks: 1,  light: 1.5, lightDist: 4, lightColor: 0xffd0a0, tint: 0xffe8d0, life: 0.04 },
  none:       { core: 0, coreOffset: 0, tongues: 0, length: 0, width: 0, jets: 0, jetLen: 0, jetOffset: 0, jetAngle: 0, ring: 0, smoke: 0, smokeAlpha: 0.0, sparks: 0, light: 0, lightDist: 1, lightColor: 0, tint: 0, life: 0.01 },
};
