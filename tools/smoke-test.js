/* Headless engine smoke test: `node tools/smoke-test.js`.
   Stubs the DOM/canvas, then simulates ~4 minutes on every map with a
   randomly-moving player who buys every door and gun he can afford.
   Catches runtime errors, sanity-checks economy/XP flow, and watches for
   zombies getting permanently stuck. */

// ---- stubs ----
const noop = () => {};
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createRadialGradient' || k === 'createLinearGradient')
      return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof t[k] !== 'undefined' ? t[k] : noop;
  },
  set: () => true
});
const canvasStub = () => ({ getContext: () => ctxStub, width: 0, height: 0 });
global.window = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
  addEventListener: noop
};
global.document = { getElementById: () => null, createElement: canvasStub };
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; }
};
global.performance = { now: () => Date.now() };

const fs = require('fs');
const path = require('path');
const load = f => (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));

load('save.js');
global.Save = Save;
global.SFX = new Proxy({}, { get: () => noop });
load('skills.js');
global.Skills = Skills; global.SKILL_TREES = SKILL_TREES;
load('weapons.js'); global.WEAPONS = WEAPONS;
load('zombies.js');
global.ZOMBIE_TYPES = ZOMBIE_TYPES; global.buildWave = buildWave;
global.waveHpScale = waveHpScale; global.waveSpeedScale = waveSpeedScale;
global.waveDmgScale = waveDmgScale;
load('maps.js'); global.MAPS = MAPS; global.TILE = TILE; global.validateMaps = validateMaps;

let inputVec = { x: 0, y: 0 };
global.Input = { vec: () => inputVec };
load('game.js'); global.Game = Game;

const cb = {
  onHud: noop,
  onWaveBanner: noop,
  onToast: noop,
  onInteract: noop,
  onGameOver: noop
};

let failures = 0;

for (const mapDef of MAPS) {
  const g = new Game(mapDef, canvasStub(), cb);

  const dt = 1 / 60;
  let doorsBought = 0, gunsBought = 0, maxStuck = 0;
  const startXpBank = Save.get().xpBank;

  // simulate 240 seconds of play
  for (let frame = 0; frame < 240 * 60 && !g.over; frame++) {
    // wander randomly, changing direction every second
    if (frame % 60 === 0) {
      const a = Math.random() * Math.PI * 2;
      inputVec = { x: Math.cos(a), y: Math.sin(a) };
    }
    // god mode so we can exercise many waves
    g.player.hp = g.player.maxHp;
    // free money to exercise purchases
    g.money += 10;

    g.update(dt);
    g.render();

    // buy whatever is in range
    if (g.interactTarget && g.interactTarget.afford) {
      const kind = g.interactTarget.kind;
      g.doInteract();
      if (kind === 'door') doorsBought++;
      if (kind === 'gun') gunsBought++;
    }

    for (const z of g.zombies) if (z.stuckT > maxStuck) maxStuck = z.stuckT;

    // sanity: player must remain inside map bounds and out of walls
    const ptx = Math.floor(g.player.x / TILE), pty = Math.floor(g.player.y / TILE);
    if (g.isSolidTile(ptx, pty)) {
      console.error(`  FAIL ${mapDef.id}: player inside solid tile at ${ptx},${pty}`);
      failures++;
      break;
    }
  }

  const xpGained = Save.get().xpBank - startXpBank;
  const activeSpawners = g.spawners.filter(s => s.active).length;
  console.log(
    `${mapDef.id}: wave ${g.wave}, kills ${g.kills}, doors ${doorsBought}, guns ${gunsBought}, ` +
    `spawners ${activeSpawners}/${g.spawners.length}, xp +${xpGained}, maxStuck ${maxStuck.toFixed(1)}s, weapon ${g.player.weapon.name}`
  );

  if (g.wave < 2) { console.error(`  FAIL ${mapDef.id}: never reached wave 2`); failures++; }
  if (g.kills < 5) { console.error(`  FAIL ${mapDef.id}: too few kills (${g.kills})`); failures++; }
  if (xpGained <= 0) { console.error(`  FAIL ${mapDef.id}: no XP banked`); failures++; }
  if (doorsBought < 1) { console.error(`  FAIL ${mapDef.id}: no doors purchased`); failures++; }
  if (maxStuck > 5) { console.error(`  FAIL ${mapDef.id}: zombie stuck for ${maxStuck.toFixed(1)}s`); failures++; }
}

// ---- skill tree persistence ----
Save.addXp(5000);
const before = Save.get().xpBank;
if (!Skills.buy('dmg1')) { console.error('FAIL: could not buy dmg1'); failures++; }
if (Skills.buy('dmg3')) { console.error('FAIL: bought dmg3 without prereq chain'); failures++; }
if (!Save.hasSkill('dmg1')) { console.error('FAIL: dmg1 not persisted'); failures++; }
if (Save.get().xpBank !== before - 60) { console.error('FAIL: XP not deducted correctly'); failures++; }

// legacy perks change starting state
Save.addXp(20000);
['cash1', 'sidearm', 'smgstart', 'masterkey'].forEach(id => Skills.buy(id));
const g2 = new Game(MAPS[0], canvasStub(), cb);
if (g2.player.weapon !== WEAPONS.smg) { console.error('FAIL: Armory Locker start weapon not applied'); failures++; }
if (g2.money < 500) { console.error('FAIL: Stashed Wallet start money not applied'); failures++; }
const openDoors = Object.values(g2.doors).filter(d => d.open).length;
if (openDoors !== 1) { console.error('FAIL: Master Key did not open exactly one door, got ' + openDoors); failures++; }

console.log(failures ? `\n${failures} FAILURES` : '\nSmoke test passed.');
process.exit(failures ? 1 : 0);
