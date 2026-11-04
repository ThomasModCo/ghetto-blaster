# Ghetto Blaster

A hood-themed first-person shooter that runs in the browser on desktop and mobile as a PWA.
Seven maps based on real cities, three modes (Team Deathmatch, Free For All, Gun Game),
five stock loadouts plus three custom slots, and 15 score streaks per map.

The multiplayer is **simulated**: every opponent and teammate is a bot, and the result of each
match is decided before it starts. The in-game Director steers the simulation toward that
result through bot strength, rigged duels and off-screen kills, so the match still plays
like a real, competitive game. Bet on yourself before the match; payouts follow the
pre-rolled outcome.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (PWA ready)
npm run preview
```

Install it as an app from the browser menu ("Add to Home Screen" on mobile). Play in landscape.

## Controls

Desktop: WASD move, mouse look, LMB fire, RMB aim, Shift sprint, Space jump, C duck,
Q/E peek, 1/2/scroll swap, R reload, G lethal, F tactical, 3/4/5 streaks, Tab scoreboard, L loadout (pre-game).

Controller (PS5 DualSense or Xbox, plug in or pair over Bluetooth, then press any button): left stick move, right stick look,
R2/RT fire, L2/LT aim, L3/LS sprint, ✕/A jump, ○/B duck, □/X reload, △/Y switch weapon, R1/RB lethal, L1/LB tactical,
hold R3/RS to peek, D-pad ◀ ▲ ▶ streaks, D-pad ▼ loadout, Options/Menu pause, hold Create/View for the scoreboard.
Every menu is navigable with the D-pad or left stick. Aim assist (slowdown plus ADS snap) and vibration can be toggled in settings.

Mobile: left joystick (push to the edge to sprint), drag the right side to look, big red button to fire
(drag it to aim while firing), plus ADS / JUMP / DUCK / PEEK / SWAP / RLD / LETHAL / TAC buttons.

## Headless tools

```
node scripts/smoke-map.mjs <mapId>      # validates a map: colliders, nav reachability, spawns
node scripts/sim-match.mjs tdm 10       # simulates full matches and checks the Director lands the plan
node scripts/sim-match.mjs ffa 10 kowloon
```

Add `?t=60` to the URL to shorten match time limits while testing.

## Layout

- `src/core` renderer, input, physics, textures, RNG
- `src/game` actors, player, bots, weapons, equipment, streaks, modes, match, director
- `src/maps` map builder toolkit, nav grid and the seven city maps
- `src/ui` menus, HUD and styles
