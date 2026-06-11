# DEADLIGHT — Zombie Survival

A top-down (Pokemon-style) zombie survival game built for mobile browsers. Survive endless
waves inside 5 abandoned buildings, earn money and XP from every kill, unlock locked rooms
and wall guns mid-run, and spend banked XP on **persistent skill trees** that carry across
every game.

## How to play

The game is a single static web page — no build step, no dependencies.

**On your phone:** the easiest way is to enable GitHub Pages for this repo
(Settings → Pages → Deploy from branch), then open the page URL in Safari.
Tip: use Share → *Add to Home Screen* for a fullscreen app-like experience.

**Locally:** run any static server from the repo root and open it:

```
npx serve .        # or: python3 -m http.server
```

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Move | Drag anywhere on the screen (virtual joystick) | WASD / arrows |
| Shoot | Automatic — the player auto-aims at the nearest zombie in line of sight | automatic |
| Interact (doors / wall guns) | Green button, bottom-right | E |
| Pause | `II` button, top-right | — |

## The loop

- **Kill zombies → earn money + XP.** Rewards scale with zombie type, wave number, and map
  difficulty. Walkers are cheap; Brutes, Spitters and the wave-5 Abomination boss pay much more.
- **Money** buys locked doors (opening new rooms — and new zombie windows) and wall guns.
  You start every run with a basic M1911 pistol; gun prices scale with their power, up to the
  RG-9 Railgun.
- **Money, guns, and opened rooms reset every run.**
- **XP is banked permanently** (even if you quit mid-run) and is spent in the Skill Trees menu.

## Skill trees (persistent)

| Tree | Focus |
|---|---|
| Combat | Damage, fire rate, crits, piercing rounds |
| Survival | Max HP, speed, regen, a once-per-run revive |
| Economy | More money/XP per kill, cheaper doors and guns |
| Legacy | Overrides the run reset: starting cash, upgraded pistol, start with an SMG or rifle, Master Key (cheapest door pre-unlocked), armor |

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
  runtime errors and verifies economy, spawner unlocking, and skill persistence.
