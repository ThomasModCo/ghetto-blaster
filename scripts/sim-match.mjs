// Headless match simulation: node scripts/sim-match.mjs [mode] [seeds] [mapId]
// Runs full matches without rendering (player driven by bot AI) and checks the Director lands the planned result.
const noop = () => {};
const ctxProxy = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : typeof k === 'string' ? noop : undefined), set: () => true });
globalThis.document = { createElement: (tag) => ({ tag, width: 0, height: 0, getContext: () => ctxProxy, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => true } }), getElementById: () => null, addEventListener: noop };
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop, matchMedia: () => ({ matches: false }), AudioContext: undefined };
try { Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true }); } catch (e) {}
globalThis.localStorage = { getItem: () => null, setItem: noop };
globalThis.requestAnimationFrame = noop;
const THREE = await import('three');
const { Match } = await import('../src/game/match.js');
const { Bot } = await import('../src/game/bot.js');
const { MODES } = await import('../src/game/modes.js');
const { resolveLoadout, STOCK_LOADOUTS } = await import('../src/game/loadouts.js');
const { loadMap } = await import('../src/maps/index.js');
const { findStreak, streaksForMap } = await import('../src/game/streaks.js');

const modeId = process.argv[2] || 'tdm', seeds = +(process.argv[3] || 5), mapArg = process.argv[4] || null;
const mapIds = mapArg ? [mapArg] : ['skidrow', 'projects', 'tenements', 'ward', 'barrio', 'kowloon', 'banlieue'];
const fxStub = { tracer: noop, impact: noop, muzzle: noop, explosion: noop, smoke: noop, sparkTrail: noop, blood: noop, casing: noop, inSmoke: () => false, clear: noop, update: noop, light: () => ({ life: 0, l: { intensity: 0 } }), spot: { intensity: 0, position: { copy: noop }, target: { position: { set: noop }, updateMatrixWorld: noop } } };
const maps = new Map();
async function getMap(id) { if (!maps.has(id)) { const { def, build } = await loadMap(id); const d = build(); d.def = def; maps.set(id, d); } return maps.get(id); }
let fails = 0;
for (let s = 0; s < seeds; s++) {
  const mapId = mapIds[s % mapIds.length]; const map = await getMap(mapId);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  const engine = { scene, camera, fx: fxStub, updateSunTarget: noop, vmCamera: new THREE.PerspectiveCamera(), vmScene: new THREE.Scene() };
  const input = { poll: () => ({ move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, fire: false, ads: false, sprint: false, peek: 0, pressed: new Set() }), mobile: false, crouchHold: false };
  const seed = 1000 + s * 7919;
  const m = new Match({ engine, input, map, mode: MODES[modeId], settings: { fov: 75 }, seed, loadout: STOCK_LOADOUTS[s % 5], mapId, bet: 0, playerName: 'SIM' });
  // drive the player with a strong bot brain (a "rampaging" player)
  const p = m.player; for (const k of Object.getOwnPropertyNames(Bot.prototype)) if (!['constructor', 'update'].includes(k)) p[k] = Bot.prototype[k]; Bot.prototype.initBrain.call(p, { skill: 0.95, persona: 'rusher' }); p.reaction = 0.15; p.aggro = 1;
  p.update = function (dt) { this.frozen = false; Bot.prototype.update.call(this, dt); };
  p.computeAim = function () { this.aimPoint = this.pos.clone().addScaledVector(this.forward(new THREE.Vector3()), 10); return this.aimPoint; };
  const st = streaksForMap(mapId); m.streakState.picks = [st.starter[0], st.medium[0], st.powerful[0]];
  m.events.end = noop;
  const plan = m.director.plan; const planStr = modeId === 'tdm' ? `playerWins=${plan.playerWins} loserFinal=${plan.loserFinal}` : `placement=${plan.placement}/${plan.n} winner=${plan.winner.name}`;
  const dt = 1 / 30; let steps = 0; const t0 = Date.now(); let streakUses = 0;
  while (!m.ended && steps < (MODES[modeId].timeLimit + 20) / dt) { m.update(dt); steps++; if (p.alive && m.state === 'live' && steps % 30 === 0) { for (let i = 0; i < 3; i++) if (!m.streakState.used[i] && m.streakState.picks[i] && p.streakScore >= m.streakState.picks[i].cost) { m.useStreak(p, i); streakUses++; } } }
  const r = m.endResult; if (!r) { console.log(`seed ${seed} ${mapId}: DID NOT END`); fails++; continue; }
  const ok = modeId === 'tdm' ? (r.win === plan.playerWins && !r.draw) : (r.place === plan.placement);
  if (!ok) fails++;
  const rank = r.rank.map((a) => `${a.name}:${modeId === 'gungame' ? a.gunGameIndex : a.kills}/${a.deaths}`).slice(0, 6).join(' ');
  console.log(`${ok ? 'OK  ' : 'FAIL'} seed=${seed} ${mapId.padEnd(9)} ${planStr.padEnd(38)} -> ${modeId === 'tdm' ? `score ${m.teamScore[p.team]}-${m.teamScore[1 - p.team]} (${r.win ? 'WIN' : r.draw ? 'DRAW' : 'LOSS'})` : `place ${r.place}`} | player K/D ${p.kills}/${p.deaths} | elapsed ${m.elapsed.toFixed(0)}s | streaks ${streakUses} | fate ${m.director.log.filter((l) => l.startsWith('fate')).length} rig ${m.director.log.filter((l) => l.startsWith('rig')).length} | ${(Date.now() - t0)}ms`);
  if (!ok) console.log('   top:', rank);
}
console.log(fails ? `FAILURES: ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
