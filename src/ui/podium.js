// Results podium (toy reskin): the top three finishers as their plastic figures on a molded three-step podium,
// rendered into the results card. Purely presentational: it reads the final ranking and never touches the match.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CharacterModel } from '../game/character.js';
import { chamferBox } from '../maps/kit.js';

const STEP = [ // place -> x, height, plastic colour
  { x: 0, h: 0.9, col: '#da9b03' }, { x: -1.25, h: 0.6, col: '#c2b9b4' }, { x: 1.25, h: 0.4, col: '#b0683a' },
];

function sticker(text, place) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#f4f1e8'; x.beginPath(); x.roundRect(6, 6, 244, 116, 18); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#16181c'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 64px Anton, Impact, sans-serif'; x.fillText(String(place), 128, 50);
  x.font = 'bold 22px Anton, Impact, sans-serif'; x.fillText(text.slice(0, 14).toUpperCase(), 128, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Podium {
  constructor(el) { this.el = el; this.raf = 0; }
  show(match) {
    this.hide();
    const rank = match.ranking().filter((a) => a.model && !a.isDog && !a.isSentry);
    const ts = match.teamScore, crew = ts[0] === ts[1] ? (match.player ? match.player.team : 0) : ts[0] > ts[1] ? 0 : 1; // a draw shows your own crew
    const winners = match.mode.teams ? rank.filter((a) => a.team === crew) : rank;
    const top = winners.slice(0, 3); if (!top.length) return;
    const w = Math.max(320, this.el.clientWidth || 760), h = 240;
    let r; try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return; }
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(w, h); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    this.el.appendChild(r.domElement);
    const scene = new THREE.Scene(); scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight('#fff6e8', '#3a3530', 1.1)); const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(2, 5, 4); scene.add(key);
    const rig = new THREE.Group(); scene.add(rig);
    top.forEach((a, i) => {
      const S = STEP[i];
      const step = new THREE.Mesh(chamferBox(1.15, S.h, 1.0, 0.06), new THREE.MeshPhysicalMaterial({ color: S.col, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
      step.position.set(S.x, S.h / 2, 0); rig.add(step);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshStandardMaterial({ map: sticker(a.name || '', i + 1), roughness: 0.6 }));
      label.position.set(S.x, Math.max(0.24, S.h * 0.5), 0.502); rig.add(label);
      const fig = new CharacterModel({ faction: a.model.faction, plastic: a.model.plastic, hat: a.model.hat });
      if (a.weapon && a.weapon.def) fig.setGun(a.weapon.def);
      for (let k = 0; k < 12; k++) fig.update(0.05, { speed: 0, moving: false, onGround: true, pitch: i === 0 ? 0.25 : 0, lean: 0, dead: false });
      fig.group.position.set(S.x, S.h, 0.05); fig.group.rotation.y = -S.x * 0.22; fig.group.scale.setScalar(0.85); rig.add(fig.group);
    });
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 50); cam.position.set(0, 1.6, 5.0); cam.lookAt(0, 1.15, 0);
    const t0 = performance.now();
    const loop = () => { rig.rotation.y = Math.sin((performance.now() - t0) / 2400) * 0.18; r.render(scene, cam); this.raf = requestAnimationFrame(loop); };
    loop();
    this.r = r; this.scene = scene;
  }
  hide() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.r) { this.scene.traverse((o) => { if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose(); }); this.r.dispose(); this.r.forceContextLoss(); this.r.domElement.remove(); this.r = null; this.scene = null; }
  }
}
