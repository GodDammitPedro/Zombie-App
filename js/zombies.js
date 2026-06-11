/* Zombie types. Money and XP rewards are proportional to threat, and are
   further scaled by map difficulty + wave number inside game.js.
   `radius` is the PHYSICS radius and must stay under half a tile (16px) so
   every zombie can pass tile centers next to walls; big zombies look big
   via `drawScale`, which only affects rendering and hitbox. */

var ZOMBIE_TYPES = {
  walker: {
    name: 'Walker', hp: 42, speed: 44, dmg: 8, radius: 11, drawScale: 1,
    money: 50, xp: 1.25, color: '#6fae5a', eye: '#dfffd0'
  },
  runner: {
    name: 'Runner', hp: 32, speed: 96, dmg: 7, radius: 10, drawScale: 1,
    money: 75, xp: 2, color: '#c9c33d', eye: '#fff8c0'
  },
  spitter: {
    name: 'Spitter', hp: 65, speed: 56, dmg: 13, radius: 12, drawScale: 1,
    money: 110, xp: 3.25, color: '#9a5fd0', eye: '#efd0ff'
  },
  brute: {
    name: 'Brute', hp: 170, speed: 33, dmg: 22, radius: 14, drawScale: 1.2,
    money: 170, xp: 5, color: '#c46a31', eye: '#ffe0c0'
  },
  ghost: {
    /* Phases through walls. Untargetable while inside one (no line of
       sight), so it must be killed in the open. Spawns from wave 11 on. */
    name: 'Ghost', hp: 90, speed: 52, dmg: 16, radius: 11, drawScale: 1.05,
    money: 220, xp: 6.5, color: '#a8cfde', eye: '#ffffff', ghost: true
  },
  boss: {
    /* Periodically winds up and dashes at the player. First appears on
       wave 10, then every 5th wave. */
    name: 'Abomination', hp: 700, speed: 38, dmg: 32, radius: 15, drawScale: 1.5,
    money: 600, xp: 18.75, color: '#8a1c1c', eye: '#ff5050'
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

  // ghosts haunt the building from wave 11 onward
  if (wave >= 11) {
    var ghosts = Math.max(1, Math.round(count * Math.min(0.25, 0.06 + (wave - 10) * 0.015)));
    for (var gi = 0; gi < ghosts && gi < list.length; gi++) list[list.length - 1 - gi] = 'ghost';
  }

  // the first boss arrives on wave 10, then every 5th wave after
  if (wave >= 10 && wave % 5 === 0) {
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
