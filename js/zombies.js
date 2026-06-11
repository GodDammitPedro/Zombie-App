/* Zombie types. Money and XP rewards are proportional to threat, and are
   further scaled by map difficulty + wave number inside game.js.
   `radius` is the PHYSICS radius and must stay under half a tile (16px) so
   every zombie can pass tile centers next to walls; big zombies look big
   via `drawScale`, which only affects rendering and hitbox. */

var ZOMBIE_TYPES = {
  walker: {
    name: 'Walker', hp: 42, speed: 44, dmg: 8, radius: 11, drawScale: 1,
    money: 50, xp: 5, color: '#6fae5a', eye: '#dfffd0'
  },
  runner: {
    name: 'Runner', hp: 32, speed: 96, dmg: 7, radius: 10, drawScale: 1,
    money: 75, xp: 8, color: '#c9c33d', eye: '#fff8c0'
  },
  spitter: {
    name: 'Spitter', hp: 65, speed: 56, dmg: 13, radius: 12, drawScale: 1,
    money: 110, xp: 13, color: '#9a5fd0', eye: '#efd0ff'
  },
  brute: {
    name: 'Brute', hp: 170, speed: 33, dmg: 22, radius: 14, drawScale: 1.2,
    money: 170, xp: 20, color: '#c46a31', eye: '#ffe0c0'
  },
  boss: {
    name: 'Abomination', hp: 700, speed: 38, dmg: 32, radius: 15, drawScale: 1.5,
    money: 600, xp: 75, color: '#8a1c1c', eye: '#ff5050'
  }
};

/* Build the spawn list for a wave. Higher waves and higher map difficulty
   mix in nastier types and more of them. */
function buildWave(wave, difficulty) {
  var list = [];
  var count = Math.round((5 + wave * 2.1) * (0.75 + 0.25 * difficulty));
  count = Math.min(count, 55);

  for (var i = 0; i < count; i++) {
    var roll = Math.random();
    var t = 'walker';
    if (wave >= 2 && roll < 0.18 + wave * 0.02) t = 'runner';
    if (wave >= 3 && roll > 0.88 - wave * 0.012) t = 'brute';
    if (wave >= 4 && roll > 0.45 && roll < 0.56) t = 'spitter';
    list.push(t);
  }

  // a boss (or several, later) every 5th wave
  if (wave % 5 === 0) {
    var bosses = 1 + Math.floor(wave / 12);
    for (var b = 0; b < bosses; b++) list.push('boss');
  }
  return list;
}

/* Per-wave stat scaling applied to every zombie. */
function waveHpScale(wave, difficulty) {
  return (1 + 0.10 * (wave - 1)) * Math.pow(difficulty, 0.65);
}
function waveSpeedScale(wave) {
  return Math.min(1.55, 1 + 0.025 * (wave - 1));
}
function waveDmgScale(wave) {
  return Math.min(3, 1 + 0.05 * (wave - 1));
}
