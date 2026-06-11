/* Persistent skill trees. Bought with banked XP; effects carry into every run.
   The LEGACY tree is what "overwrites" the per-run reset: starting weapons,
   pre-unlocked doors, starting cash, etc. */

var SKILL_TREES = [
  {
    id: 'combat', name: 'COMBAT', color: '#e04545',
    skills: [
      { id: 'dmg1',   name: 'Sharpshooter I',   desc: '+10% weapon damage',                cost: 60,   req: null },
      { id: 'dmg2',   name: 'Sharpshooter II',  desc: '+15% weapon damage',                cost: 180,  req: 'dmg1' },
      { id: 'rof1',   name: 'Quick Hands I',    desc: '+10% fire rate',                    cost: 120,  req: 'dmg1' },
      { id: 'rof2',   name: 'Quick Hands II',   desc: '+15% fire rate',                    cost: 320,  req: 'rof1' },
      { id: 'crit',   name: 'Deadeye',          desc: '15% chance to deal double damage',  cost: 450,  req: 'rof1' },
      { id: 'dmg3',   name: 'Sharpshooter III', desc: '+25% weapon damage',                cost: 600,  req: 'dmg2' },
      { id: 'pierce', name: 'Full Metal',       desc: 'Bullets pierce 1 extra zombie',     cost: 900,  req: 'dmg3' }
    ]
  },
  {
    id: 'survival', name: 'SURVIVAL', color: '#54d06a',
    skills: [
      { id: 'hp1',    name: 'Tough Skin I',     desc: '+25 max health',                          cost: 60,   req: null },
      { id: 'hp2',    name: 'Tough Skin II',    desc: '+25 max health',                          cost: 180,  req: 'hp1' },
      { id: 'spd1',   name: 'Fleet Foot I',     desc: '+8% move speed',                          cost: 140,  req: 'hp1' },
      { id: 'spd2',   name: 'Fleet Foot II',    desc: '+10% move speed',                         cost: 380,  req: 'spd1' },
      { id: 'regen',  name: 'Field Medic',      desc: 'Regenerate 2 HP/s after 5s without damage', cost: 420, req: 'hp2' },
      { id: 'hp3',    name: 'Tough Skin III',   desc: '+50 max health',                          cost: 650,  req: 'hp2' },
      { id: 'revive', name: 'Second Wind',      desc: 'Once per run, survive death with 50% HP', cost: 1000, req: 'hp3' }
    ]
  },
  {
    id: 'economy', name: 'ECONOMY', color: '#f5c84c',
    skills: [
      { id: 'scav1',  name: 'Scavenger I',      desc: '+10% money from kills',     cost: 60,   req: null },
      { id: 'scav2',  name: 'Scavenger II',     desc: '+15% money from kills',     cost: 200,  req: 'scav1' },
      { id: 'xp1',    name: 'Fast Learner',     desc: '+15% XP from kills',        cost: 250,  req: 'scav1' },
      { id: 'doors',  name: 'Crowbar',          desc: 'Doors cost 15% less',       cost: 300,  req: 'scav1' },
      { id: 'guns',   name: 'Arms Dealer',      desc: 'Wall guns cost 15% less',   cost: 350,  req: 'doors' },
      { id: 'scav3',  name: 'Scavenger III',    desc: '+25% money from kills',     cost: 550,  req: 'scav2' },
      { id: 'xp2',    name: 'Veteran Instinct', desc: '+25% XP from kills',        cost: 700,  req: 'xp1' }
    ]
  },
  {
    id: 'legacy', name: 'LEGACY', color: '#7fb6e8',
    skills: [
      { id: 'cash1',    name: 'Stashed Wallet',     desc: 'Start every run with +$300',                cost: 100,  req: null },
      { id: 'sidearm',  name: 'Reinforced Sidearm', desc: 'Your starting pistol deals +50% damage',    cost: 250,  req: 'cash1' },
      { id: 'cash2',    name: 'Buried Savings',     desc: 'Start every run with +$700 more',           cost: 500,  req: 'cash1' },
      { id: 'masterkey',name: 'Master Key',         desc: 'The cheapest door on each map starts unlocked', cost: 700, req: 'sidearm' },
      { id: 'smgstart', name: 'Armory Locker',      desc: 'Start every run armed with the MP-40 SMG',  cost: 900,  req: 'sidearm' },
      { id: 'vest',     name: 'Kevlar Vest',        desc: 'Take 15% less damage from zombies',         cost: 1100, req: 'masterkey' },
      { id: 'riflestart', name: 'Private Arsenal',  desc: 'Start every run armed with the AK-74 rifle', cost: 2200, req: 'smgstart' }
    ]
  }
];

var Skills = (function () {
  function find(id) {
    for (var t = 0; t < SKILL_TREES.length; t++) {
      var s = SKILL_TREES[t].skills;
      for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
    }
    return null;
  }

  function canBuy(id) {
    var s = find(id);
    if (!s || Save.hasSkill(id)) return false;
    if (s.req && !Save.hasSkill(s.req)) return false;
    return Save.get().xpBank >= s.cost;
  }

  function buy(id) {
    if (!canBuy(id)) return false;
    var s = find(id);
    if (!Save.spendXp(s.cost)) return false;
    Save.unlockSkill(id);
    return true;
  }

  /* Aggregate all owned skills into one perks object the game reads. */
  function perks() {
    var h = Save.hasSkill;
    return {
      dmgMul:    1 + (h('dmg1') ? .10 : 0) + (h('dmg2') ? .15 : 0) + (h('dmg3') ? .25 : 0),
      rofMul:    1 + (h('rof1') ? .10 : 0) + (h('rof2') ? .15 : 0),
      critChance: h('crit') ? 0.15 : 0,
      pierceBonus: h('pierce') ? 1 : 0,

      maxHp:     100 + (h('hp1') ? 25 : 0) + (h('hp2') ? 25 : 0) + (h('hp3') ? 50 : 0),
      speedMul:  1 + (h('spd1') ? .08 : 0) + (h('spd2') ? .10 : 0),
      regen:     h('regen') ? 2 : 0,
      revive:    h('revive'),

      moneyMul:  1 + (h('scav1') ? .10 : 0) + (h('scav2') ? .15 : 0) + (h('scav3') ? .25 : 0),
      xpMul:     1 + (h('xp1') ? .15 : 0) + (h('xp2') ? .25 : 0),
      doorMul:   h('doors') ? 0.85 : 1,
      gunMul:    h('guns') ? 0.85 : 1,

      startMoney: 200 + (h('cash1') ? 300 : 0) + (h('cash2') ? 700 : 0),
      pistolDmgMul: h('sidearm') ? 1.5 : 1,
      masterKey: h('masterkey'),
      dmgTakenMul: h('vest') ? 0.85 : 1,
      startWeapon: h('riflestart') ? 'rifle' : (h('smgstart') ? 'smg' : 'pistol')
    };
  }

  return { find: find, canBuy: canBuy, buy: buy, perks: perks };
})();
