# DEADLIGHT — Zombie Survival

A top-down (Pokemon-style) zombie survival game built for mobile browsers. Survive endless
waves inside 5 abandoned buildings, earn money and XP from every kill, unlock locked rooms
and wall guns mid-run, and spend banked XP on **persistent skill trees** that carry across
every game.

## How to play

The game is a single static web page — no build step needed for solo play.

**On your phone:** the easiest way is to enable GitHub Pages for this repo
(Settings → Pages → Deploy from branch), then open the page URL in Safari.
Tip: use Share → *Add to Home Screen* for a fullscreen app-like experience.

**Locally:** run any static server from the repo root and open it:

```
npx serve .        # or: python3 -m http.server
```

## LAN co-op

Multiplayer runs over your own Wi-Fi via the bundled relay server (browsers
can't talk to each other directly, so one computer on the network hosts it):

```
npm install
npm start          # prints http://<your-LAN-IP>:8080
```

Open that address on every phone, tap **LAN CO-OP**, and the first player in
becomes the host and picks the map. In co-op:

- Zombies are shared (the host's machine runs the horde) and hunt whichever
  survivor is closest.
- **Money and XP are earned individually** — whoever lands the kill gets paid.
- Doors anyone opens unlock for everyone; guns and upgrades are personal.
- If you die, your run ends (XP banked as always); if the host falls, the
  run ends for everyone.

Note: GitHub Pages (https) can't reach a LAN server — use the `npm start`
address for multiplayer sessions.

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Move | Drag anywhere on the screen (virtual joystick) | WASD / arrows |
| Shoot | Automatic — the player auto-aims at the nearest zombie in line of sight | automatic |
| Interact (doors / wall guns) | Green button, bottom-right | E |
| Pause | `II` button, top-right | — |

## The loop

- **Kill zombies → earn money + XP.** Rewards scale with zombie type, wave number, and map
  difficulty. Walkers are cheap; Brutes, Spitters, wall-phasing Ghosts (wave 11+), and the
  dashing Abomination boss (wave 10, then every 5th wave) pay much more.
- **Money** buys locked doors (opening new rooms — and new zombie windows) and wall guns.
  You start every run with a basic M1911 pistol; gun prices scale with their power, up to the
  RG-9 Railgun.
- **The upgrade machine** (one per map) upgrades your held weapon up to 5 times. The first
  level costs double the gun's purchase price and each level doubles again.
- **Money, guns, upgrades, and opened rooms reset every run.**
- **XP is banked permanently** (even if you quit mid-run) and is spent in the Skill Trees
  menu. XP is scarce by design — skill unlocks are meant to be a long-term grind.

## Skill trees (persistent)

| Tree | Focus |
|---|---|
| Combat | Damage, fire rate, crits, piercing rounds |
| Survival | Max HP, speed, regen, **Keen Eyes** (sight range), **Adrenal Rush** (player dash), a once-per-run revive |
| Economy | More money/XP per kill, cheaper doors and guns |
| Legacy | Overrides the run reset: starting cash, upgraded pistol, start with an SMG or rifle, Master Key (cheapest door pre-unlocked), armor |

Darkness matters: you can only see (and auto-aim at) what's in your direct
line of sight within your vision radius, so long-range guns only reach their
full potential once Keen Eyes is unlocked. Furniture blocks movement but not
bullets — fight over the sofas, not through them.

Progress is saved to your device via `localStorage`.

## Maps

1. **Rotting House** — ★ tutorial-friendly layout, cheap doors
2. **Grayfall Offices** — ★★ wider halls, faster mix
3. **Sunset Motel** — ★★★ long sightlines, windows everywhere
4. **Kessler Warehouse** — ★★★★ huge open center
5. **Mercy General** — ★★★★★ the toughest horde, biggest payouts

## Development

- `node tools/check-maps.js` — validates every map layout (sealed borders, door/gun
  metadata, reachability of every room, locked rooms exist).
- `node tools/smoke-test.js` — headless simulation of full runs on all maps; catches
  runtime errors and verifies economy, spawner unlocking, skill persistence, boss
  dashes, ghosts, fog of war, the upgrade machine, and a host+guest co-op session.
- `node tools/test-server.js` — boots the LAN server and exercises the lobby
  protocol with real WebSocket clients.
