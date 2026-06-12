/* Weapon definitions. Price scales with power — dmg * rof (DPS) roughly
   tracks cost. The pistol is free and always your starting fallback.
   Ranges are tiered: pistol/shotgun shortest, rifles/railgun longest.
   Machine upgrades extend range by +8% per level (applied in game.js). */

var WEAPONS = {
  pistol: {
    name: 'M1911', price: 0,
    dmg: 16, rof: 2.6, range: 150, bulletSpeed: 620,
    pellets: 1, spread: 0.02, pierce: 0,
    color: '#d8d8d8', sfx: 'shoot'
  },
  smg: {
    name: 'MP-40 SMG', price: 750,
    dmg: 11, rof: 8, range: 200, bulletSpeed: 640,
    pellets: 1, spread: 0.09, pierce: 0,
    color: '#9fd0ff', sfx: 'shoot'
  },
  shotgun: {
    name: 'Pump Shotgun', price: 1000,
    dmg: 13, rof: 1.15, range: 140, bulletSpeed: 560,
    pellets: 6, spread: 0.34, pierce: 0,
    color: '#ffb35c', sfx: 'shotgun'
  },
  rifle: {
    name: 'AK-74', price: 1900,
    dmg: 27, rof: 5.5, range: 280, bulletSpeed: 760,
    pellets: 1, spread: 0.04, pierce: 0,
    color: '#ffe27a', sfx: 'shoot'
  },
  lmg: {
    name: 'MG-08 LMG', price: 3200,
    dmg: 30, rof: 7.2, range: 260, bulletSpeed: 720,
    pellets: 1, spread: 0.07, pierce: 1,
    color: '#ff8a8a', sfx: 'shoot'
  },
  railgun: {
    name: 'RG-9 Railgun', price: 4200,
    dmg: 150, rof: 0.95, range: 380, bulletSpeed: 1100,
    pellets: 1, spread: 0, pierce: 4,
    color: '#b48aff', sfx: 'rail'
  }
};
