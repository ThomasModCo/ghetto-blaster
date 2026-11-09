// Every UI screen: node ui.mjs <outDir> [map]   env: BASE, MOBILE=1, ONLY=comma list of stages
import puppeteer from 'puppeteer-core';
const [, , out = 'screens', map = 'barrio'] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOB = !!process.env.MOBILE;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport(MOB ? { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 720 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument(() => { try { localStorage.setItem('gb.save.v1', JSON.stringify({ settings: { quality: 'low' } })); } catch (e) {} });
await p.goto(`${process.env.BASE || 'http://localhost:5173/'}?map=${map}`, { waitUntil: 'load', timeout: 90000 });
await sleep(12000);
const pre = MOB ? 'm-' : '';
const snap = async (n) => { await p.screenshot({ path: `${out}/${pre}${n}.png` }); };
const tap = async (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
if (!MOB) {
  await snap('01-title');
  for (const k of ['settings', 'controls', 'loadouts']) { await tap(`[data-open="${k}"]`); await sleep(1200); await snap('02-dlg-' + k); await tap('#dialog-close'); await sleep(500); }
}
await p.mouse.click(640, 300); await sleep(2500); if (!MOB) await snap('03-modes');
await p.evaluate(() => document.querySelector('#modes-grid .mode-panel')?.click()); await sleep(2500);
if (!MOB) await snap('04-lobby');
await p.waitForFunction(() => !document.getElementById('screen-loadout').classList.contains('hidden'), { timeout: 60000 }).catch(() => {});
await sleep(2500); await snap('05-loadout');
await tap('#loadout-ready'); await sleep(1500);
await p.waitForFunction(() => window.__gb?.app?.match?.state === 'live', { timeout: 120000, polling: 1000 }).catch(() => errs.push('never live'));
await p.evaluate(() => { const m = window.__gb.app.match; m.player.streakPoints = 9999; }).catch(() => {});
await sleep(9000); await snap('06-hud');
if (!MOB) {
  await p.evaluate(() => { window.__gb.app.match.events.pause?.(); }); await sleep(1200); await snap('07-pause'); await tap('#p-resume'); await sleep(800);
  await p.evaluate(() => { const g = window.__gb; (g.ui || g.UI)?.showScoreboard?.(g.app.match); }).catch(() => {});
  await p.keyboard.down('Tab'); await sleep(900); await snap('08-scoreboard'); await p.keyboard.up('Tab');
}
await p.evaluate(() => window.__gb.app.match.endMatch()); await sleep(7000); await snap('09-results');
console.log(errs.slice(0, 8).join('\n') || 'ok'); await b.close();
