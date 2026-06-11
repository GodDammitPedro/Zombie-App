/* Core game engine: one Game instance per run. Everything here resets when
   the run ends — only Save/Skills persist. */

/* Deterministic per-tile noise so the baked floor/wall texture is stable. */
function hash2(x, y) {
  var n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function shade(hex, f) { // f > 0 lighten, f < 0 darken
  var r = parseInt(hex.substr(1, 2), 16);
  var g = parseInt(hex.substr(3, 2), 16);
  var b = parseInt(hex.substr(5, 2), 16);
  var m = function (v) {
    v = f > 0 ? v + (255 - v) * f : v * (1 + f);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
}

var DEFAULT_PALETTE = {
  floorA: '#3a3f42', floorB: '#34393c', floorLine: 'rgba(0,0,0,0.3)',
  wallTop: '#5a6266', wallFace: '#3c4347', stain: 'rgba(10,10,12,0.45)'
};

function Game(mapDef, canvas, callbacks) {
  this.map = mapDef;
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.cb = callbacks; // { onHud, onWaveBanner, onToast, onInteract, onGameOver }

  this.perks = Skills.perks();
  this.palette = mapDef.palette || DEFAULT_PALETTE;

  // --- parse layout ---
  var rows = mapDef.layout;
  this.H = rows.length;
  this.W = rows[0].length;
  this.grid = [];           // chars
  this.doors = {};          // letter -> {letter, cost, tiles:[], open}
  this.guns = [];           // {x, y, weapon, price}
  this.machines = [];       // {x, y} weapon upgrade stations
  this.spawners = [];       // {x, y, active}
  this.playerStart = { x: 0, y: 0 };

  for (var y = 0; y < this.H; y++) {
    var row = [];
    for (var x = 0; x < this.W; x++) {
      var c = rows[y][x];
      if (c === 'P') { this.playerStart = { x: x, y: y }; c = '.'; }
      else if (c === 'Z') { this.spawners.push({ x: x, y: y, active: false }); c = '.'; }
      else if (c >= 'A' && c <= 'J') {
        if (!this.doors[c]) this.doors[c] = { letter: c, cost: Math.round(mapDef.doors[c] * this.perks.doorMul), open: false, tiles: [] };
        this.doors[c].tiles.push({ x: x, y: y });
      }
      else if (c >= '1' && c <= '9') {
        var wkey = mapDef.guns[c];
        this.guns.push({ x: x, y: y, weapon: wkey, price: Math.round(WEAPONS[wkey].price * this.perks.gunMul) });
      }
      else if (c === 'U') this.machines.push({ x: x, y: y });
      row.push(c);
    }
    this.grid.push(row);
  }

  // --- run state ---
  this.player = {
    x: (this.playerStart.x + 0.5) * TILE,
    y: (this.playerStart.y + 0.5) * TILE,
    r: 10,
    hp: this.perks.maxHp,
    maxHp: this.perks.maxHp,
    speed: 160 * this.perks.speedMul,
    weapon: WEAPONS[this.perks.startWeapon],
    weaponKey: this.perks.startWeapon,
    upgrades: {},     // weaponKey -> machine upgrade level (0-5), per run
    aim: 0,
    moveA: 0,         // facing of last movement, for feet animation
    walk: 0,          // walk cycle accumulator
    moving: false,
    fireCd: 0,
    muzzle: 0,        // muzzle flash timer
    sinceHurt: 99,
    reviveUsed: false,
    flash: 0
  };
  this.money = this.perks.startMoney;
  this.runXp = 0;
  this.kills = 0;
  this.moneyEarned = this.money;

  this.zombies = [];
  this.nextZombieId = 1;
  this.bullets = [];
  this.particles = [];
  this.floats = [];
  this.decals = [];

  this.wave = 0;
  this.spawnQueue = [];
  this.spawnTimer = 0;
  this.intermission = 2.5;   // short delay before wave 1
  this.waveActive = false;

  this.flow = null;          // BFS distance field toward player
  this.flowTimer = 0;
  this.time = 0;
  this.growlT = 3;           // ambient zombie groan scheduler

  // pre-rendered film grain tile, drawn as a repeating pattern each frame
  this.grain = document.createElement('canvas');
  this.grain.width = 160; this.grain.height = 160;
  var gctx = this.grain.getContext('2d');
  for (var gy = 0; gy < 160; gy += 2) {
    for (var gx = 0; gx < 160; gx += 2) {
      var l = Math.floor(Math.random() * 255);
      gctx.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',' + (Math.random() * 0.5).toFixed(2) + ')';
      gctx.fillRect(gx, gy, 2, 2);
    }
  }
  this.corpses = [];         // baked into the map layer, re-stamped on rebuild

  this.cam = { x: this.player.x, y: this.player.y, zoom: 1.6 };
  this.over = false;
  this.paused = false;
  this.shake = 0;

  // Legacy perk: Master Key opens the cheapest door on every map
  if (this.perks.masterKey) {
    var cheapest = null;
    for (var L in this.doors) {
      if (!cheapest || this.doors[L].cost < cheapest.cost) cheapest = this.doors[L];
    }
    if (cheapest) cheapest.open = true;
  }

  this.recomputeSpawners();
  this.buildMapLayer();
  this.resize();
}

// ---------------------------------------------------------------- helpers

Game.prototype.isSolidTile = function (tx, ty) {
  if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
  var c = this.grid[ty][tx];
  if (c === '#' || c === 'U') return true;
  if (c >= '1' && c <= '9') return true;
  if (c >= 'A' && c <= 'J') return !this.doors[c].open;
  return false;
};

Game.prototype.circleHitsWall = function (x, y, r) {
  var x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  var y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (var ty = y0; ty <= y1; ty++) {
    for (var tx = x0; tx <= x1; tx++) {
      if (!this.isSolidTile(tx, ty)) continue;
      var cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
      var cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return true;
    }
  }
  return false;
};

Game.prototype.moveCircle = function (e, dx, dy) {
  if (dx !== 0 && !this.circleHitsWall(e.x + dx, e.y, e.r)) e.x += dx;
  if (dy !== 0 && !this.circleHitsWall(e.x, e.y + dy, e.r)) e.y += dy;
};

/* Push a body out of any wall it overlaps. Destination-based movement
   checks can't free an already-embedded body (every small step still
   overlaps), so anything that overlaps gets nudged out here. */
Game.prototype.depenetrate = function (e) {
  for (var iter = 0; iter < 3; iter++) {
    var x0 = Math.floor((e.x - e.r) / TILE), x1 = Math.floor((e.x + e.r) / TILE);
    var y0 = Math.floor((e.y - e.r) / TILE), y1 = Math.floor((e.y + e.r) / TILE);
    var clean = true;
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (!this.isSolidTile(tx, ty)) continue;
        var cx = Math.max(tx * TILE, Math.min(e.x, (tx + 1) * TILE));
        var cy = Math.max(ty * TILE, Math.min(e.y, (ty + 1) * TILE));
        var dx = e.x - cx, dy = e.y - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 >= e.r * e.r) continue;
        var d = Math.sqrt(d2);
        if (d > 0.001) {
          e.x += (dx / d) * (e.r - d + 0.1);
          e.y += (dy / d) * (e.r - d + 0.1);
        } else {
          e.y += e.r; // degenerate: center exactly on a wall edge
        }
        clean = false;
      }
    }
    if (clean) return;
  }
};

Game.prototype.hasLOS = function (x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0;
  var dist = Math.hypot(dx, dy);
  var steps = Math.ceil(dist / 10);
  for (var i = 1; i < steps; i++) {
    var t = i / steps;
    if (this.isSolidTile(Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return false;
  }
  return true;
};

/* Spawners activate when their window becomes reachable from the player
   (i.e. the room has been purchased open). */
Game.prototype.recomputeSpawners = function () {
  var seen = {};
  var q = [this.playerStart.x + ',' + this.playerStart.y];
  seen[q[0]] = true;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    var cur = q.pop().split(',');
    var cx = +cur[0], cy = +cur[1];
    for (var d = 0; d < 4; d++) {
      var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      var key = nx + ',' + ny;
      if (seen[key] || this.isSolidTile(nx, ny)) continue;
      seen[key] = true;
      q.push(key);
    }
  }
  for (var i = 0; i < this.spawners.length; i++) {
    var s = this.spawners[i];
    s.active = !!seen[s.x + ',' + s.y];
  }
};

/* BFS distance field from the player's tile — zombies descend the gradient. */
Game.prototype.computeFlow = function () {
  var W = this.W, H = this.H;
  var flow = new Array(W * H).fill(-1);
  var px = Math.floor(this.player.x / TILE), py = Math.floor(this.player.y / TILE);
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  var q = [px + py * W];
  flow[px + py * W] = 0;
  var head = 0;
  while (head < q.length) {
    var idx = q[head++];
    var cx = idx % W, cy = (idx / W) | 0;
    var d = flow[idx] + 1;
    var n;
    if (cx > 0 && flow[n = idx - 1] === -1 && !this.isSolidTile(cx - 1, cy)) { flow[n] = d; q.push(n); }
    if (cx < W - 1 && flow[n = idx + 1] === -1 && !this.isSolidTile(cx + 1, cy)) { flow[n] = d; q.push(n); }
    if (cy > 0 && flow[n = idx - W] === -1 && !this.isSolidTile(cx, cy - 1)) { flow[n] = d; q.push(n); }
    if (cy < H - 1 && flow[n = idx + W] === -1 && !this.isSolidTile(cx, cy + 1)) { flow[n] = d; q.push(n); }
  }
  this.flow = flow;
};

// ---------------------------------------------------------------- waves

Game.prototype.startWave = function () {
  this.wave++;
  this.waveActive = true;
  this.spawnQueue = buildWave(this.wave, this.map.difficulty);
  this.spawnTimer = 0.5;
  this.cb.onWaveBanner('WAVE ' + this.wave);
  SFX.wave();
};

Game.prototype.spawnZombie = function () {
  var typeKey = this.spawnQueue.shift();
  var t = ZOMBIE_TYPES[typeKey];
  var p = this.player;
  var pick;

  if (t.ghost) {
    // ghosts ignore locked rooms — they can rise from ANY window
    pick = this.spawners[Math.floor(Math.random() * this.spawners.length)];
    SFX.ghost();
  } else {
    var active = this.spawners.filter(function (s) { return s.active; });
    if (!active.length) { this.spawnQueue.unshift(typeKey); return; }
    // bias toward spawners closer to the player so action stays nearby
    active.sort(function (a, b) {
      var da = Math.hypot((a.x + .5) * TILE - p.x, (a.y + .5) * TILE - p.y);
      var db = Math.hypot((b.x + .5) * TILE - p.x, (b.y + .5) * TILE - p.y);
      return da - db;
    });
    pick = active[Math.floor(Math.random() * Math.min(active.length, 3))];
  }
  var hpScale = waveHpScale(this.wave, this.map.difficulty);
  // jitter must keep the body clear of walls around the spawn tile
  var jit = Math.max(0, TILE / 2 - t.radius - 1);
  this.zombies.push({
    id: this.nextZombieId++,
    type: typeKey,
    x: (pick.x + 0.5) * TILE + (Math.random() * 2 - 1) * jit,
    y: (pick.y + 0.5) * TILE + (Math.random() * 2 - 1) * jit,
    r: t.radius,                       // physics radius (< half tile)
    hitR: t.radius * t.drawScale,      // visual + hitbox radius
    hp: t.hp * hpScale,
    maxHp: t.hp * hpScale,
    speed: t.speed * waveSpeedScale(this.wave) * (0.9 + Math.random() * 0.2),
    dmg: t.dmg * waveDmgScale(this.wave),
    atkCd: 0,
    rise: 0.7,           // spawn-in animation, invulnerable-ish window
    wob: Math.random() * 6.28,
    stuckT: 0,
    flash: 0,
    ghost: !!t.ghost,
    // boss dash ability
    dashState: null,     // null | 'windup' | 'dash'
    dashT: 0,
    dashCd: 4 + Math.random() * 3,
    dashDir: { x: 0, y: 0 },
    dashHit: false
  });
};

/* Apply damage to the player, handling armor, Second Wind, and death. */
Game.prototype.hurtPlayer = function (raw) {
  var p = this.player;
  p.hp -= raw * this.perks.dmgTakenMul;
  p.sinceHurt = 0;
  p.flash = 0.3;
  this.shake = Math.max(this.shake, 0.25);
  SFX.hurt();
  if (p.hp > 0) return;
  if (this.perks.revive && !p.reviveUsed) {
    p.reviveUsed = true;
    p.hp = p.maxHp * 0.5;
    this.cb.onToast('SECOND WIND!');
    // shove everything back
    for (var k = 0; k < this.zombies.length; k++) {
      var zk = this.zombies[k];
      var a = Math.atan2(zk.y - p.y, zk.x - p.x);
      this.moveCircle(zk, Math.cos(a) * 60, Math.sin(a) * 60);
      zk.atkCd = 1.5;
    }
  } else {
    this.gameOver();
  }
};

Game.prototype.killZombie = function (z) {
  var t = ZOMBIE_TYPES[z.type];
  var waveBonus = 1 + 0.04 * (this.wave - 1);
  var money = Math.round(t.money * this.map.difficulty * waveBonus * this.perks.moneyMul);
  var xp = Math.round(t.xp * this.map.difficulty * waveBonus * this.perks.xpMul);

  this.money += money;
  this.moneyEarned += money;
  this.runXp += xp;
  Save.addXp(xp);          // XP banks immediately — quitting never loses it
  this.kills++;

  this.addFloat(z.x, z.y - z.hitR - 4, '+$' + money, '#f5c84c');
  if (z.ghost) {
    // ghosts dissipate: pale wisps, no blood, no corpse
    for (var w = 0; w < 10; w++) {
      var wa = Math.random() * 6.28;
      this.particles.push({
        x: z.x, y: z.y,
        vx: Math.cos(wa) * 30, vy: Math.sin(wa) * 30 - 25,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        size: 2 + Math.random() * 3, color: 'rgba(190,225,240,0.5)', type: 'wisp'
      });
    }
  } else {
    this.splatter(z.x, z.y, t.color, z.type === 'boss' ? 26 : 12);
    this.stampCorpse(z);
  }
  SFX.zdie();
  if (z.type === 'boss') this.shake = Math.max(this.shake, 0.5);
};

// ---------------------------------------------------------------- update

Game.prototype.update = function (dt) {
  if (this.over || this.paused) return;
  this.time += dt;
  var p = this.player;

  // --- player movement ---
  var v = Input.vec();
  var moving = Math.hypot(v.x, v.y) > 0.05;
  p.moving = moving;
  if (moving) {
    p.moveA = Math.atan2(v.y, v.x);
    p.walk += p.speed * dt;
  }
  this.moveCircle(p, v.x * p.speed * dt, v.y * p.speed * dt);
  this.depenetrate(p);

  // --- regen ---
  p.sinceHurt += dt;
  if (this.perks.regen > 0 && p.sinceHurt > 5 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + this.perks.regen * dt);
  }
  if (p.flash > 0) p.flash -= dt;
  if (p.muzzle > 0) p.muzzle -= dt;

  // --- flow field ---
  this.flowTimer -= dt;
  if (this.flowTimer <= 0 || !this.flow) {
    this.computeFlow();
    this.flowTimer = 0.35;
  }

  // --- wave logic ---
  if (!this.waveActive) {
    this.intermission -= dt;
    if (this.intermission <= 0) this.startWave();
  } else {
    if (this.spawnQueue.length && this.zombies.length < 16) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnZombie();
        this.spawnTimer = Math.max(0.25, 0.9 - this.wave * 0.04);
      }
    }
    if (!this.spawnQueue.length && !this.zombies.length) {
      this.waveActive = false;
      this.intermission = 5;
      this.cb.onToast('Wave cleared! +$' + (50 + this.wave * 25) + ' bonus');
      var bonus = Math.round((50 + this.wave * 25) * this.perks.moneyMul);
      this.money += bonus;
      this.moneyEarned += bonus;
    }
  }

  // --- ambient groans from nearby zombies ---
  this.growlT -= dt;
  if (this.growlT <= 0) {
    this.growlT = 2 + Math.random() * 3;
    var nearest = Infinity;
    for (var gz = 0; gz < this.zombies.length; gz++) {
      var gd2 = Math.hypot(this.zombies[gz].x - p.x, this.zombies[gz].y - p.y);
      if (gd2 < nearest) nearest = gd2;
    }
    if (nearest < 450) SFX.growl(Math.max(0.2, 1 - nearest / 480));
  }

  // --- zombies ---
  for (var i = this.zombies.length - 1; i >= 0; i--) {
    var z = this.zombies[i];
    if (z.flash > 0) z.flash -= dt;
    if (z.rise > 0) { z.rise -= dt; continue; }
    z.wob += dt * 6;

    var distP = Math.hypot(p.x - z.x, p.y - z.y);
    var reach = p.r + z.hitR + 3;

    // --- boss dash ability ---
    if (z.type === 'boss') {
      if (z.dashState === 'windup') {
        z.dashT -= dt;
        if (z.dashT <= 0) {
          z.dashState = 'dash';
          z.dashT = 0.5;
          var dwd = distP || 1;
          z.dashDir.x = (p.x - z.x) / dwd;
          z.dashDir.y = (p.y - z.y) / dwd;
          z.dashHit = false;
        }
        continue; // rooted while telegraphing
      }
      if (z.dashState === 'dash') {
        z.dashT -= dt;
        this.moveCircle(z, z.dashDir.x * 430 * dt, z.dashDir.y * 430 * dt);
        this.depenetrate(z);
        var dNow = Math.hypot(p.x - z.x, p.y - z.y);
        if (!z.dashHit && dNow <= reach + 4) {
          z.dashHit = true;
          z.dashT = Math.min(z.dashT, 0.08);
          this.hurtPlayer(z.dmg * 1.4);
          if (this.over) return;
        }
        if (z.dashT <= 0) {
          z.dashState = null;
          z.dashCd = 5 + Math.random() * 4;
        }
        continue;
      }
      z.dashCd -= dt;
      if (z.dashCd <= 0 && distP < 340 && distP > reach + 14 && this.hasLOS(z.x, z.y, p.x, p.y)) {
        z.dashState = 'windup';
        z.dashT = 0.65;
        SFX.roar();
        this.shake = Math.max(this.shake, 0.15);
        continue;
      }
    }

    if (distP <= reach + 2) {
      // attack
      z.stuckT = 0;
      z.atkCd -= dt;
      if (z.atkCd <= 0) {
        z.atkCd = 0.85;
        this.hurtPlayer(z.dmg);
        if (this.over) return;
      }
    } else if (z.ghost) {
      // ghosts drift straight at the player, through anything
      var gdd = distP || 1;
      z.x += ((p.x - z.x) / gdd) * z.speed * dt;
      z.y += ((p.y - z.y) / gdd) * z.speed * dt;
    } else {
      /* Steering. A wedged zombie (corner/doorway) trips stuckT, which
         forces strict flow-field navigation through tile centers until
         it frees itself. */
      var oldX = z.x, oldY = z.y;
      var tx = Math.floor(z.x / TILE), ty = Math.floor(z.y / TILE);
      var stuck = z.stuckT > 0.35;
      var dirX = 0, dirY = 0;

      if (!stuck && distP < 200 && this.hasLOS(z.x, z.y, p.x, p.y)) {
        dirX = (p.x - z.x) / distP;
        dirY = (p.y - z.y) / distP;
      } else if (this.flow) {
        var best = -1, bx = tx, by = ty;
        var cur = this.flow[tx + ty * this.W];
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = tx + dirs[d][0], ny = ty + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
          var f = this.flow[nx + ny * this.W];
          if (f >= 0 && (best === -1 || f < best)) { best = f; bx = nx; by = ny; }
        }
        if (best >= 0 && (cur === -1 || best < cur)) {
          var gx = (bx + 0.5) * TILE, gy = (by + 0.5) * TILE;
          var gd = Math.hypot(gx - z.x, gy - z.y) || 1;
          dirX = (gx - z.x) / gd;
          dirY = (gy - z.y) / gd;
        }
        if (stuck) {
          // pull toward the center of the current tile to slip off corners
          var ccx = (tx + 0.5) * TILE, ccy = (ty + 0.5) * TILE;
          var cd = Math.hypot(ccx - z.x, ccy - z.y);
          if (cd > 2) {
            dirX = dirX * 0.4 + ((ccx - z.x) / cd) * 0.6;
            dirY = dirY * 0.4 + ((ccy - z.y) / cd) * 0.6;
          }
        }
      }

      // separation from other zombies (suppressed while unsticking)
      var sx = 0, sy = 0;
      if (!stuck) {
        for (var j = 0; j < this.zombies.length; j++) {
          if (j === i) continue;
          var o = this.zombies[j];
          var dx = z.x - o.x, dy = z.y - o.y;
          var dd = dx * dx + dy * dy;
          var min = (z.r + o.r) * (z.r + o.r);
          if (dd > 0 && dd < min) {
            var l = Math.sqrt(dd);
            sx += (dx / l) * (1 - l / (z.r + o.r));
            sy += (dy / l) * (1 - l / (z.r + o.r));
          }
        }
      }
      var wobble = stuck ? 0 : Math.sin(z.wob) * 0.15;
      var mx = dirX + sx * 0.8 - dirY * wobble;
      var my = dirY + sy * 0.8 + dirX * wobble;
      var ml = Math.hypot(mx, my);
      if (ml > 0.01) this.moveCircle(z, (mx / ml) * z.speed * dt, (my / ml) * z.speed * dt);
      this.depenetrate(z);

      // stuck detection: wanted to move but barely did
      if (ml > 0.3) {
        var moved = Math.hypot(z.x - oldX, z.y - oldY);
        if (moved < z.speed * dt * 0.3) z.stuckT += dt;
        else z.stuckT = Math.max(0, z.stuckT - dt * 3);
        // hard rescue: glide to own tile center if jammed for a long time
        // (collision-checked so it can never embed a zombie in a wall)
        if (z.stuckT > 1.6) {
          var rk = Math.min(1, dt * 8);
          this.moveCircle(z, (((tx + 0.5) * TILE) - z.x) * rk, (((ty + 0.5) * TILE) - z.y) * rk);
        }
      }
    }
  }

  // --- auto aim + auto fire ---
  var w = p.weapon;
  p.fireCd -= dt;
  var target = null, bestD = Infinity;
  for (var i2 = 0; i2 < this.zombies.length; i2++) {
    var z2 = this.zombies[i2];
    if (z2.rise > 0) continue;
    var dz = Math.hypot(z2.x - p.x, z2.y - p.y);
    if (dz < bestD && dz <= w.range && this.hasLOS(p.x, p.y, z2.x, z2.y)) {
      bestD = dz; target = z2;
    }
  }
  if (target) {
    var ta = Math.atan2(target.y - p.y, target.x - p.x);
    // smooth aim turn
    var da = ta - p.aim;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    p.aim += da * Math.min(1, dt * 18);

    if (p.fireCd <= 0) {
      var lvl = p.upgrades[p.weaponKey] || 0;
      p.fireCd = 1 / (w.rof * this.perks.rofMul * (1 + 0.06 * lvl));
      p.muzzle = 0.06;
      var dmgMul = this.perks.dmgMul * (1 + 0.4 * lvl) *
        (w === WEAPONS.pistol ? this.perks.pistolDmgMul : 1);

      // shell casing + smoke puff
      var perpA = ta + Math.PI / 2;
      this.particles.push({
        x: p.x + Math.cos(ta) * 6, y: p.y + Math.sin(ta) * 6,
        vx: Math.cos(perpA) * (40 + Math.random() * 50), vy: Math.sin(perpA) * (40 + Math.random() * 50),
        life: 0.5 + Math.random() * 0.3, maxLife: 0.8,
        size: 1.4, color: '#d9b15c', type: 'shell'
      });
      this.particles.push({
        x: p.x + Math.cos(ta) * (p.r + 10), y: p.y + Math.sin(ta) * (p.r + 10),
        vx: Math.cos(ta) * 26, vy: Math.sin(ta) * 26,
        life: 0.45, maxLife: 0.45,
        size: 3 + Math.random() * 2, color: 'rgba(180,180,180,0.25)', type: 'smoke'
      });

      for (var pe = 0; pe < w.pellets; pe++) {
        var ang = ta + (Math.random() - 0.5) * 2 * w.spread;
        this.bullets.push({
          x: p.x + Math.cos(ang) * (p.r + 6),
          y: p.y + Math.sin(ang) * (p.r + 6),
          vx: Math.cos(ang) * w.bulletSpeed,
          vy: Math.sin(ang) * w.bulletSpeed,
          dmg: w.dmg * dmgMul,
          left: w.range * 1.15,
          pierce: w.pierce + this.perks.pierceBonus,
          color: w.color,
          hit: {}
        });
      }
      SFX[w.sfx]();
    }
  }

  // --- bullets ---
  for (var b = this.bullets.length - 1; b >= 0; b--) {
    var bl = this.bullets[b];
    var step = Math.hypot(bl.vx, bl.vy) * dt;
    bl.x += bl.vx * dt;
    bl.y += bl.vy * dt;
    bl.left -= step;
    var dead = bl.left <= 0;

    if (!dead && this.isSolidTile(Math.floor(bl.x / TILE), Math.floor(bl.y / TILE))) {
      dead = true;
      this.sparks(bl.x, bl.y);
    }
    if (!dead) {
      for (var zi = 0; zi < this.zombies.length; zi++) {
        var zb = this.zombies[zi];
        if (zb.rise > 0 || bl.hit[zb.id]) continue;
        var bdx = zb.x - bl.x, bdy = zb.y - bl.y;
        if (bdx * bdx + bdy * bdy <= (zb.hitR + 3) * (zb.hitR + 3)) {
          var crit = Math.random() < this.perks.critChance;
          var dealt = bl.dmg * (crit ? 2 : 1);
          zb.hp -= dealt;
          zb.flash = 0.08;
          bl.hit[zb.id] = true;
          this.splatter(zb.x, zb.y, ZOMBIE_TYPES[zb.type].color, crit ? 6 : 3);
          if (zb.hp <= 0) {
            this.killZombie(zb);
            this.zombies.splice(zi, 1);
            zi--;
          }
          if (bl.pierce > 0) bl.pierce--;
          else { dead = true; break; }
        }
      }
    }
    if (dead) this.bullets.splice(b, 1);
  }

  // --- particles / floats ---
  for (var pi = this.particles.length - 1; pi >= 0; pi--) {
    var pt = this.particles[pi];
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.9; pt.vy *= 0.9;
    if (pt.life <= 0) this.particles.splice(pi, 1);
  }
  for (var fi = this.floats.length - 1; fi >= 0; fi--) {
    var f = this.floats[fi];
    f.life -= dt;
    f.y -= 26 * dt;
    if (f.life <= 0) this.floats.splice(fi, 1);
  }

  // --- interact prompt ---
  this.updateInteract();

  // --- camera ---
  var lerp = Math.min(1, dt * 6);
  this.cam.x += (p.x - this.cam.x) * lerp;
  this.cam.y += (p.y - this.cam.y) * lerp;
  if (this.shake > 0) this.shake -= dt;

  this.cb.onHud(this);
};

// ---------------------------------------------------------------- interact

Game.prototype.updateInteract = function () {
  var p = this.player;
  var best = null, bestD = 58;

  for (var L in this.doors) {
    var d = this.doors[L];
    if (d.open) continue;
    for (var i = 0; i < d.tiles.length; i++) {
      var t = d.tiles[i];
      var dd = Math.hypot((t.x + .5) * TILE - p.x, (t.y + .5) * TILE - p.y);
      if (dd < bestD) {
        bestD = dd;
        best = { kind: 'door', door: d, label: 'OPEN DOOR  $' + d.cost, afford: this.money >= d.cost };
      }
    }
  }
  for (var g = 0; g < this.guns.length; g++) {
    var gun = this.guns[g];
    var gd = Math.hypot((gun.x + .5) * TILE - p.x, (gun.y + .5) * TILE - p.y);
    if (gd < bestD) {
      bestD = gd;
      var w = WEAPONS[gun.weapon];
      if (p.weapon === w) best = { kind: 'owned', label: w.name + '  EQUIPPED', afford: false };
      else best = { kind: 'gun', gun: gun, label: 'BUY ' + w.name + '  $' + gun.price, afford: this.money >= gun.price };
    }
  }
  for (var mi = 0; mi < this.machines.length; mi++) {
    var mc = this.machines[mi];
    var md = Math.hypot((mc.x + .5) * TILE - p.x, (mc.y + .5) * TILE - p.y);
    if (md < bestD) {
      bestD = md;
      var lvl = p.upgrades[p.weaponKey] || 0;
      if (lvl >= 5) {
        best = { kind: 'maxed', label: p.weapon.name + '  FULLY UPGRADED', afford: false };
      } else {
        var cost = this.upgradeCost(p.weaponKey, lvl);
        best = {
          kind: 'machine',
          cost: cost,
          label: 'UPGRADE TO LV.' + (lvl + 1) + '  $' + cost,
          afford: this.money >= cost
        };
      }
    }
  }
  this.interactTarget = best;
  this.cb.onInteract(best);
};

/* Upgrade pricing: starts at double the gun's purchase price and doubles
   with each level. The free pistol upgrades off a $300 baseline. */
Game.prototype.upgradeCost = function (weaponKey, lvl) {
  var base = Math.max(WEAPONS[weaponKey].price, 300);
  return base * Math.pow(2, lvl + 1);
};

Game.prototype.doInteract = function () {
  var t = this.interactTarget;
  if (!t || this.over || this.paused) return;
  if (t.kind === 'door') {
    if (this.money < t.door.cost) { SFX.deny(); this.cb.onToast('Not enough money'); return; }
    this.money -= t.door.cost;
    t.door.open = true;
    this.recomputeSpawners();
    this.computeFlow();
    this.buildMapLayer();
    SFX.door();
    this.cb.onToast('Area unlocked');
  } else if (t.kind === 'gun') {
    if (this.money < t.gun.price) { SFX.deny(); this.cb.onToast('Not enough money'); return; }
    this.money -= t.gun.price;
    this.player.weapon = WEAPONS[t.gun.weapon];
    this.player.weaponKey = t.gun.weapon;
    SFX.buy();
    this.cb.onToast(WEAPONS[t.gun.weapon].name + ' equipped');
  } else if (t.kind === 'machine') {
    if (this.money < t.cost) { SFX.deny(); this.cb.onToast('Not enough money'); return; }
    this.money -= t.cost;
    var key = this.player.weaponKey;
    this.player.upgrades[key] = (this.player.upgrades[key] || 0) + 1;
    SFX.upgrade();
    this.cb.onToast(this.player.weapon.name + ' upgraded to Lv.' + this.player.upgrades[key]);
  }
};

// ---------------------------------------------------------------- fx

Game.prototype.splatter = function (x, y, color, n) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * 6.28, s = 30 + Math.random() * 90;
    this.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.25 + Math.random() * 0.3, maxLife: 0.5,
      size: 1.5 + Math.random() * 2.5, color: color, type: 'blood'
    });
  }
  if (n >= 6 && this.decals.length < 400) {
    var d = { x: x, y: y, r: 6 + Math.random() * 8, color: color };
    this.decals.push(d);
    this.stampDecal(d);   // bake into the map layer so it persists for free
  }
};

Game.prototype.sparks = function (x, y) {
  for (var i = 0; i < 3; i++) {
    var a = Math.random() * 6.28, s = 40 + Math.random() * 80;
    this.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.12 + Math.random() * 0.1, maxLife: 0.2,
      size: 1 + Math.random(), color: '#ffd9a0', type: 'spark'
    });
  }
};

Game.prototype.addFloat = function (x, y, text, color) {
  if (this.floats.length > 40) this.floats.shift();
  this.floats.push({ x: x, y: y, text: text, color: color, life: 0.8 });
};

Game.prototype.gameOver = function () {
  this.over = true;
  SFX.gameover();
  Save.recordRun(this.map.id, this.wave);
  Save.addKills(this.kills);
  this.cb.onGameOver({
    wave: this.wave,
    kills: this.kills,
    moneyEarned: this.moneyEarned,
    xp: this.runXp
  });
};

// ---------------------------------------------------------------- baked map layer

/* The static world (floors, walls, doors, windows, gun racks, blood) is
   rendered once into an offscreen canvas and redrawn only when a door
   opens. Per-frame rendering then becomes a single drawImage. */
Game.prototype.buildMapLayer = function () {
  if (!this.mapLayer) this.mapLayer = document.createElement('canvas');
  this.mapLayer.width = this.W * TILE;
  this.mapLayer.height = this.H * TILE;
  var m = this.mapLayer.getContext('2d');
  var pal = this.palette;
  var self = this;

  function drawFloor(tx, ty) {
    var X = tx * TILE, Y = ty * TILE;
    m.fillStyle = hash2(tx, ty) < 0.5 ? pal.floorA : pal.floorB;
    m.fillRect(X, Y, TILE, TILE);
    // per-tile brightness variation
    var v = hash2(tx * 3 + 11, ty * 7 + 5);
    m.fillStyle = 'rgba(0,0,0,' + (v * 0.10).toFixed(3) + ')';
    m.fillRect(X, Y, TILE, TILE);
    // board/tile seams
    m.fillStyle = pal.floorLine;
    m.fillRect(X, Y + TILE - 1, TILE, 1);
    m.fillRect(X + TILE - 1, Y, 1, TILE);
    // occasional grime
    if (hash2(tx + 211, ty + 97) > 0.93) {
      m.fillStyle = pal.stain;
      m.beginPath();
      m.arc(X + 8 + hash2(tx, ty + 1) * 16, Y + 8 + hash2(tx + 1, ty) * 16, 4 + hash2(tx + 2, ty) * 6, 0, 6.29);
      m.fill();
    }
    // contact shadow under walls above
    if (self.isSolidTile(tx, ty - 1)) {
      var g = m.createLinearGradient(X, Y, X, Y + 9);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(X, Y, TILE, 9);
    }
  }

  function drawWall(tx, ty) {
    var X = tx * TILE, Y = ty * TILE;
    m.fillStyle = pal.wallTop;
    m.fillRect(X, Y, TILE, TILE);
    // subtle top noise
    var v = hash2(tx * 5 + 3, ty * 3 + 7);
    m.fillStyle = 'rgba(0,0,0,' + (v * 0.12).toFixed(3) + ')';
    m.fillRect(X, Y, TILE, TILE);
    // front face where floor is below (fake depth)
    if (!self.isSolidTile(tx, ty + 1)) {
      m.fillStyle = pal.wallFace;
      m.fillRect(X, Y + TILE - 12, TILE, 12);
      m.fillStyle = 'rgba(0,0,0,0.35)';
      m.fillRect(X, Y + TILE - 12, TILE, 2);
      // brick seams on the face
      m.fillStyle = 'rgba(0,0,0,0.2)';
      m.fillRect(X + (hash2(tx, ty) < 0.5 ? 9 : 17), Y + TILE - 10, 1, 10);
    }
    // edge highlight along the top of wall runs
    if (!self.isSolidTile(tx, ty - 1)) {
      m.fillStyle = shade(pal.wallTop, 0.18);
      m.fillRect(X, Y, TILE, 2);
    }
  }

  function drawClosedDoor(tx, ty) {
    var X = tx * TILE, Y = ty * TILE;
    // frame
    m.fillStyle = '#241a10';
    m.fillRect(X, Y, TILE, TILE);
    // wood planks
    m.fillStyle = '#5a4126';
    m.fillRect(X + 2, Y + 2, TILE - 4, TILE - 4);
    m.fillStyle = '#6b4e2e';
    for (var pl = 0; pl < 3; pl++) m.fillRect(X + 4 + pl * 9, Y + 3, 7, TILE - 6);
    // metal bands
    m.fillStyle = '#3a3f45';
    m.fillRect(X + 2, Y + 7, TILE - 4, 3);
    m.fillRect(X + 2, Y + TILE - 10, TILE - 4, 3);
    // rivets
    m.fillStyle = '#8b939c';
    m.fillRect(X + 5, Y + 8, 1, 1);
    m.fillRect(X + TILE - 6, Y + 8, 1, 1);
    m.fillRect(X + 5, Y + TILE - 9, 1, 1);
    m.fillRect(X + TILE - 6, Y + TILE - 9, 1, 1);
    // handle
    m.fillStyle = '#c9a04c';
    m.beginPath();
    m.arc(X + TILE / 2, Y + TILE / 2, 2.5, 0, 6.29);
    m.fill();
  }

  function drawOpenDoor(tx, ty) {
    drawFloor(tx, ty);
    var X = tx * TILE, Y = ty * TILE;
    // threshold + frame posts against the adjoining walls
    m.fillStyle = 'rgba(0,0,0,0.18)';
    m.fillRect(X, Y, TILE, TILE);
    m.fillStyle = '#3a2c1c';
    if (self.isSolidTile(tx - 1, ty)) m.fillRect(X, Y, 3, TILE);
    if (self.isSolidTile(tx + 1, ty)) m.fillRect(X + TILE - 3, Y, 3, TILE);
    if (self.isSolidTile(tx, ty - 1)) m.fillRect(X, Y, TILE, 3);
    if (self.isSolidTile(tx, ty + 1)) m.fillRect(X, Y + TILE - 3, TILE, 3);
  }

  // pass 1: tiles
  for (var ty = 0; ty < this.H; ty++) {
    for (var tx = 0; tx < this.W; tx++) {
      var c = this.grid[ty][tx];
      if (c === '.') drawFloor(tx, ty);
      else if (c >= 'A' && c <= 'J') {
        if (this.doors[c].open) drawOpenDoor(tx, ty);
        else drawClosedDoor(tx, ty);
      }
      else drawWall(tx, ty); // '#' and gun digits
    }
  }

  // pass 2: spawner windows (boarded up; reddened when active)
  for (var s = 0; s < this.spawners.length; s++) {
    var sp = this.spawners[s];
    var SX = sp.x * TILE, SY = sp.y * TILE;
    m.fillStyle = sp.active ? '#201012' : '#15181b';
    m.fillRect(SX + 3, SY + 3, TILE - 6, TILE - 6);
    // broken boards
    m.strokeStyle = sp.active ? '#6b4030' : '#4a3a28';
    m.lineWidth = 3;
    m.beginPath();
    m.moveTo(SX + 4, SY + 7); m.lineTo(SX + TILE - 4, SY + 13);
    m.moveTo(SX + 4, SY + TILE - 8); m.lineTo(SX + TILE - 4, SY + TILE - 16);
    m.stroke();
    if (sp.active) {
      m.fillStyle = 'rgba(190,40,40,0.16)';
      m.fillRect(SX + 3, SY + 3, TILE - 6, TILE - 6);
    }
  }

  // pass 3: gun racks (panel + weapon silhouette on the wall block)
  for (var g = 0; g < this.guns.length; g++) {
    var gn = this.guns[g];
    var GX = gn.x * TILE, GY = gn.y * TILE;
    var wdef = WEAPONS[gn.weapon];
    m.fillStyle = '#10161a';
    m.fillRect(GX + 3, GY + 5, TILE - 6, TILE - 10);
    m.strokeStyle = '#2c3a42';
    m.lineWidth = 1;
    m.strokeRect(GX + 3.5, GY + 5.5, TILE - 7, TILE - 11);
    // weapon silhouette
    m.fillStyle = wdef.color;
    m.fillRect(GX + 7, GY + TILE / 2 - 2, 19, 4);             // barrel/body
    m.fillRect(GX + 9, GY + TILE / 2 + 2, 4, 6);              // grip
    m.fillRect(GX + 16, GY + TILE / 2 + 2, 3, 4);             // mag
    m.fillRect(GX + 23, GY + TILE / 2 - 4, 3, 2);             // sight
  }

  // pass 4: upgrade machines (arcane workbench on the wall block)
  for (var um = 0; um < this.machines.length; um++) {
    var mc = this.machines[um];
    var MX = mc.x * TILE, MY = mc.y * TILE;
    m.fillStyle = '#141019';
    m.fillRect(MX + 2, MY + 3, TILE - 4, TILE - 6);
    m.strokeStyle = '#4a3a64';
    m.lineWidth = 1.5;
    m.strokeRect(MX + 3, MY + 4, TILE - 6, TILE - 8);
    // screen
    m.fillStyle = '#1d3a2a';
    m.fillRect(MX + 6, MY + 7, TILE - 12, 8);
    m.fillStyle = '#54d06a';
    m.fillRect(MX + 8, MY + 9, 6, 1.5);
    m.fillRect(MX + 8, MY + 12, 9, 1.5);
    // anvil / cradle
    m.fillStyle = '#3a3f45';
    m.fillRect(MX + 7, MY + TILE - 11, TILE - 14, 5);
    m.fillStyle = '#c9a04c';
    m.fillRect(MX + TILE / 2 - 1.5, MY + TILE - 13, 3, 3);
  }

  // pass 5: corpses, then persistent blood
  for (var cp = 0; cp < this.corpses.length; cp++) this.drawCorpse(this.corpses[cp]);
  for (var dcl = 0; dcl < this.decals.length; dcl++) this.stampDecal(this.decals[dcl]);
};

/* Bake a fallen zombie into the floor — bodies stay where they died. */
Game.prototype.stampCorpse = function (z) {
  if (this.corpses.length < 250) {
    this.corpses.push({ x: z.x, y: z.y, r: z.hitR, color: ZOMBIE_TYPES[z.type].color, a: Math.random() * 6.28 });
  }
  this.drawCorpse(this.corpses[this.corpses.length - 1]);
};

Game.prototype.drawCorpse = function (c) {
  var m = this.mapLayer.getContext('2d');
  m.save();
  m.translate(c.x, c.y);
  m.rotate(c.a);
  m.globalAlpha = 0.55;
  m.fillStyle = shade(c.color, -0.45);
  m.beginPath();
  m.ellipse(0, 0, c.r * 1.15, c.r * 0.6, 0, 0, 6.29);
  m.fill();
  m.globalAlpha = 0.35;
  m.fillStyle = shade(c.color, -0.2);
  m.beginPath();
  m.ellipse(-c.r * 0.2, -c.r * 0.1, c.r * 0.6, c.r * 0.4, 0, 0, 6.29);
  m.fill();
  m.restore();
  m.globalAlpha = 1;
};

Game.prototype.stampDecal = function (d) {
  var m = this.mapLayer.getContext('2d');
  m.globalAlpha = 0.22;
  m.fillStyle = d.color;
  m.beginPath();
  m.arc(d.x, d.y, d.r, 0, 6.29);
  m.fill();
  m.globalAlpha = 0.14;
  m.beginPath();
  m.arc(d.x + d.r * 0.5, d.y + d.r * 0.3, d.r * 0.5, 0, 6.29);
  m.fill();
  m.globalAlpha = 1;
};

// ---------------------------------------------------------------- render

Game.prototype.resize = function () {
  var dpr = window.devicePixelRatio || 1;
  this.canvas.width = window.innerWidth * dpr;
  this.canvas.height = window.innerHeight * dpr;
  this.dpr = dpr;
  var minDim = Math.min(window.innerWidth, window.innerHeight);
  this.cam.zoom = Math.max(1.15, Math.min(2.1, minDim / 300));
};

Game.prototype.render = function () {
  var ctx = this.ctx, p = this.player;
  var vw = this.canvas.width, vh = this.canvas.height;
  var scale = this.cam.zoom * this.dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06080a';
  ctx.fillRect(0, 0, vw, vh);

  var shx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 16 : 0;
  var shy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 16 : 0;
  var camX = this.cam.x + shx, camY = this.cam.y + shy;

  // clamp camera to map bounds
  var halfW = vw / 2 / scale, halfH = vh / 2 / scale;
  camX = Math.max(halfW - TILE, Math.min(this.W * TILE - halfW + TILE, camX));
  camY = Math.max(halfH - TILE, Math.min(this.H * TILE - halfH + TILE, camY));
  if (this.W * TILE < halfW * 2) camX = this.W * TILE / 2;
  if (this.H * TILE < halfH * 2) camY = this.H * TILE / 2;

  ctx.setTransform(scale, 0, 0, scale, vw / 2 - camX * scale, vh / 2 - camY * scale);

  var x0 = Math.max(0, Math.floor((camX - halfW) / TILE));
  var x1 = Math.min(this.W - 1, Math.ceil((camX + halfW) / TILE));
  var y0 = Math.max(0, Math.floor((camY - halfH) / TILE));
  var y1 = Math.min(this.H - 1, Math.ceil((camY + halfH) / TILE));

  // --- baked world ---
  ctx.drawImage(this.mapLayer, 0, 0);

  // --- active spawner pulse ---
  for (var s = 0; s < this.spawners.length; s++) {
    var sp = this.spawners[s];
    if (!sp.active || sp.x < x0 - 1 || sp.x > x1 + 1 || sp.y < y0 - 1 || sp.y > y1 + 1) continue;
    ctx.globalAlpha = 0.10 + 0.07 * Math.sin(this.time * 3 + sp.x);
    ctx.fillStyle = '#e04545';
    ctx.beginPath();
    ctx.arc((sp.x + 0.5) * TILE, (sp.y + 0.5) * TILE, TILE * 0.55, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- price tags ---
  ctx.textAlign = 'center';
  ctx.font = 'bold 9px sans-serif';
  var shownDoor = {};
  for (var L in this.doors) {
    var dr = this.doors[L];
    if (dr.open || shownDoor[L]) continue;
    var t0 = dr.tiles[0];
    if (t0.x >= x0 - 1 && t0.x <= x1 + 1 && t0.y >= y0 - 1 && t0.y <= y1 + 1) {
      this.drawTag(ctx, (t0.x + 0.5) * TILE, t0.y * TILE - 8, '$' + dr.cost,
        this.money >= dr.cost ? '#f5c84c' : '#c9866a');
      shownDoor[L] = true;
    }
  }
  for (var gi = 0; gi < this.guns.length; gi++) {
    var gn = this.guns[gi];
    if (gn.x < x0 - 1 || gn.x > x1 + 1 || gn.y < y0 - 1 || gn.y > y1 + 1) continue;
    var afford = this.money >= gn.price;
    if (afford) {
      // soft pulse on affordable racks
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.time * 4 + gn.x);
      ctx.strokeStyle = '#7ddc8e';
      ctx.lineWidth = 2;
      ctx.strokeRect(gn.x * TILE + 2, gn.y * TILE + 4, TILE - 4, TILE - 8);
      ctx.globalAlpha = 1;
    }
    this.drawTag(ctx, (gn.x + 0.5) * TILE, gn.y * TILE - 8, '$' + gn.price, afford ? '#7ddc8e' : '#e0a08a');
  }

  // --- upgrade machines: arcane glow + price for the held weapon ---
  for (var mi2 = 0; mi2 < this.machines.length; mi2++) {
    var mc2 = this.machines[mi2];
    if (mc2.x < x0 - 1 || mc2.x > x1 + 1 || mc2.y < y0 - 1 || mc2.y > y1 + 1) continue;
    var mcx = (mc2.x + 0.5) * TILE, mcy = (mc2.y + 0.5) * TILE;
    ctx.globalAlpha = 0.16 + 0.1 * Math.sin(this.time * 2.2);
    ctx.fillStyle = '#9a6cff';
    ctx.beginPath();
    ctx.arc(mcx, mcy, TILE * 0.8, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
    var ulvl = p.upgrades[p.weaponKey] || 0;
    if (ulvl >= 5) {
      this.drawTag(ctx, mcx, mc2.y * TILE - 8, 'MAX', '#b48aff');
    } else {
      var ucost = this.upgradeCost(p.weaponKey, ulvl);
      this.drawTag(ctx, mcx, mc2.y * TILE - 8, '$' + ucost, this.money >= ucost ? '#b48aff' : '#e0a08a');
    }
  }

  // --- zombies ---
  for (var zi2 = 0; zi2 < this.zombies.length; zi2++) {
    this.drawZombie(ctx, this.zombies[zi2]);
  }

  // --- player ---
  this.drawPlayer(ctx);

  // --- bullets (glowing tracers) ---
  ctx.lineCap = 'round';
  for (var bi = 0; bi < this.bullets.length; bi++) {
    var bu = this.bullets[bi];
    ctx.strokeStyle = bu.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bu.x, bu.y);
    ctx.lineTo(bu.x - bu.vx * 0.02, bu.y - bu.vy * 0.02);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bu.x, bu.y);
    ctx.lineTo(bu.x - bu.vx * 0.014, bu.y - bu.vy * 0.014);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // --- particles ---
  for (var pi2 = 0; pi2 < this.particles.length; pi2++) {
    var pt = this.particles[pi2];
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, 6.29);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- floating text ---
  ctx.font = 'bold 9px sans-serif';
  for (var fi2 = 0; fi2 < this.floats.length; fi2++) {
    var fl = this.floats[fi2];
    ctx.globalAlpha = Math.min(1, fl.life * 2.5);
    ctx.fillStyle = fl.color;
    ctx.fillText(fl.text, fl.x, fl.y);
  }
  ctx.globalAlpha = 1;

  // --- lighting: a warm pool around the player, darkness at the edges ---
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  var psx = vw / 2 + (p.x - camX) * scale;
  var psy = vh / 2 + (p.y - camY) * scale;
  var lr = Math.max(vw, vh);
  var flicker = 1 + 0.015 * Math.sin(this.time * 9) + 0.01 * Math.sin(this.time * 23);
  var warm = ctx.createRadialGradient(psx, psy, 0, psx, psy, lr * 0.18 * flicker);
  warm.addColorStop(0, 'rgba(255,226,170,0.07)');
  warm.addColorStop(1, 'rgba(255,226,170,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, vw, vh);
  var light = ctx.createRadialGradient(psx, psy, lr * 0.09 * flicker, psx, psy, lr * 0.60);
  light.addColorStop(0, 'rgba(3,5,8,0)');
  light.addColorStop(0.5, 'rgba(3,5,8,0.24)');
  light.addColorStop(1, 'rgba(3,5,8,0.74)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, vw, vh);
  // cold desaturating grade
  ctx.fillStyle = 'rgba(38,52,62,0.06)';
  ctx.fillRect(0, 0, vw, vh);

  // --- hurt vignette ---
  if (p.flash > 0 || p.hp < p.maxHp * 0.3) {
    var alpha = p.flash > 0 ? 0.35 : 0.12 + 0.1 * Math.sin(Date.now() / 200);
    var grad = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    grad.addColorStop(0, 'rgba(160,20,20,0)');
    grad.addColorStop(1, 'rgba(160,20,20,' + alpha + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  // --- film grain ---
  if (!this.grainPat) this.grainPat = ctx.createPattern(this.grain, 'repeat');
  if (this.grainPat) {
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.translate((Math.random() * 16 - 8) | 0, (Math.random() * 16 - 8) | 0);
    ctx.fillStyle = this.grainPat;
    ctx.fillRect(-16, -16, vw + 32, vh + 32);
    ctx.restore();
  }
};

Game.prototype.drawTag = function (ctx, x, y, text, color) {
  var w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(8,10,12,0.75)';
  ctx.fillRect(x - w / 2, y - 8, w, 11);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
};

Game.prototype.drawZombie = function (ctx, z) {
  var zt = ZOMBIE_TYPES[z.type];
  var riseScale = z.rise > 0 ? Math.max(0.15, 1 - z.rise / 0.7) : 1;
  var breathe = 1 + 0.05 * Math.sin(z.wob * 0.9);
  var zr = z.hitR * riseScale * breathe;
  var p = this.player;
  var za = Math.atan2(p.y - z.y, p.x - z.x);

  // --- ghost: translucent, no shadow, trailing wisps ---
  if (z.ghost) {
    var ga = (0.42 + 0.16 * Math.sin(this.time * 4 + z.id)) * riseScale;
    ctx.globalAlpha = ga * 0.5;
    ctx.fillStyle = '#cfe8f2';
    // trailing tail away from its heading
    for (var tw = 1; tw <= 3; tw++) {
      ctx.beginPath();
      ctx.arc(z.x - Math.cos(za) * tw * 6, z.y - Math.sin(za) * tw * 6 + Math.sin(this.time * 5 + tw) * 2,
        zr * (1 - tw * 0.22), 0, 6.29);
      ctx.fill();
    }
    ctx.globalAlpha = ga;
    ctx.fillStyle = z.flash > 0 ? '#ffffff' : zt.color;
    ctx.beginPath(); ctx.arc(z.x, z.y, zr, 0, 6.29); ctx.fill();
    ctx.globalAlpha = Math.min(1, ga + 0.3);
    ctx.fillStyle = zt.eye;
    var gex = Math.cos(za) * zr * 0.4, gey = Math.sin(za) * zr * 0.4;
    ctx.beginPath();
    ctx.arc(z.x + gex - gey * 0.5, z.y + gey + gex * 0.5, zr * 0.15, 0, 6.29);
    ctx.arc(z.x + gex + gey * 0.5, z.y + gey - gex * 0.5, zr * 0.15, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (z.hp < z.maxHp && z.rise <= 0) {
      var gbw = z.hitR * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(z.x - gbw / 2, z.y - z.hitR - 8, gbw, 3);
      ctx.fillStyle = '#9fd4e8';
      ctx.fillRect(z.x - gbw / 2, z.y - z.hitR - 8, gbw * Math.max(0, z.hp / z.maxHp), 3);
    }
    return;
  }

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(z.x, z.y + zr * 0.55, zr, zr * 0.45, 0, 0, 6.29); ctx.fill();

  // boss dash telegraph: expanding red ring while winding up
  if (z.dashState === 'windup') {
    var wt = 1 - z.dashT / 0.65;
    ctx.strokeStyle = 'rgba(255,60,50,' + (0.25 + 0.55 * wt).toFixed(2) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(z.x, z.y, zr + 4 + wt * 10, 0, 6.29);
    ctx.stroke();
  }

  var bodyC = z.flash > 0 ? '#ffffff' : zt.color;

  // arms swing while shambling
  var swing = Math.sin(z.wob) * 0.22;
  ctx.strokeStyle = z.flash > 0 ? '#ffffff' : shade(zt.color, -0.25);
  ctx.lineWidth = z.type === 'boss' ? 5 : 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(z.x + Math.cos(za + 0.5) * zr * 0.6, z.y + Math.sin(za + 0.5) * zr * 0.6);
  ctx.lineTo(z.x + Math.cos(za + 0.35 + swing) * (zr + 7), z.y + Math.sin(za + 0.35 + swing) * (zr + 7));
  ctx.moveTo(z.x + Math.cos(za - 0.5) * zr * 0.6, z.y + Math.sin(za - 0.5) * zr * 0.6);
  ctx.lineTo(z.x + Math.cos(za - 0.35 - swing) * (zr + 7), z.y + Math.sin(za - 0.35 - swing) * (zr + 7));
  ctx.stroke();
  ctx.lineCap = 'butt';

  // body: dark rim + main fill + offset highlight for volume
  ctx.fillStyle = shade(zt.color, -0.4);
  ctx.beginPath(); ctx.arc(z.x, z.y, zr + 1.5, 0, 6.29); ctx.fill();
  ctx.fillStyle = bodyC;
  ctx.beginPath(); ctx.arc(z.x, z.y, zr, 0, 6.29); ctx.fill();
  ctx.fillStyle = z.flash > 0 ? '#ffffff' : shade(zt.color, 0.18);
  ctx.beginPath(); ctx.arc(z.x - zr * 0.25, z.y - zr * 0.3, zr * 0.55, 0, 6.29); ctx.fill();

  // gore patch on wounded zombies
  if (z.hp < z.maxHp * 0.55) {
    ctx.fillStyle = 'rgba(120,20,20,0.7)';
    ctx.beginPath(); ctx.arc(z.x + zr * 0.3, z.y + zr * 0.15, zr * 0.35, 0, 6.29); ctx.fill();
  }

  // boss gets a bone-spike ring
  if (z.type === 'boss') {
    ctx.fillStyle = '#d8cfc0';
    for (var k = 0; k < 6; k++) {
      var sa = z.wob * 0.15 + k * 1.047;
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(sa) * zr * 0.85, z.y + Math.sin(sa) * zr * 0.85, 2.4, 0, 6.29);
      ctx.fill();
    }
  }

  // glowing eyes
  ctx.fillStyle = zt.eye;
  var ex = Math.cos(za) * zr * 0.45, ey = Math.sin(za) * zr * 0.45;
  ctx.beginPath();
  ctx.arc(z.x + ex - ey * 0.5, z.y + ey + ex * 0.5, zr * 0.16, 0, 6.29);
  ctx.arc(z.x + ex + ey * 0.5, z.y + ey - ex * 0.5, zr * 0.16, 0, 6.29);
  ctx.fill();

  // hp bar when damaged
  if (z.hp < z.maxHp && z.rise <= 0) {
    var bw = z.hitR * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(z.x - bw / 2, z.y - z.hitR - 8, bw, 3);
    ctx.fillStyle = z.type === 'boss' ? '#ff4040' : '#7ddc8e';
    ctx.fillRect(z.x - bw / 2, z.y - z.hitR - 8, bw * Math.max(0, z.hp / z.maxHp), 3);
  }
};

Game.prototype.drawPlayer = function (ctx) {
  var p = this.player;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.55, p.r, p.r * 0.45, 0, 0, 6.29); ctx.fill();

  // feet stepping
  var step = p.moving ? Math.sin(p.walk * 0.12) * 4.5 : 0;
  var fa = p.moveA;
  var fpx = Math.cos(fa + Math.PI / 2), fpy = Math.sin(fa + Math.PI / 2);
  ctx.fillStyle = '#23282c';
  ctx.beginPath();
  ctx.arc(p.x + fpx * 4.5 + Math.cos(fa) * step, p.y + fpy * 4.5 + Math.sin(fa) * step, 3, 0, 6.29);
  ctx.arc(p.x - fpx * 4.5 - Math.cos(fa) * step, p.y - fpy * 4.5 - Math.sin(fa) * step, 3, 0, 6.29);
  ctx.fill();

  // body (jacket) with rim + highlight
  ctx.fillStyle = p.flash > 0 ? '#a44a3a' : '#274b6d';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 1, 0, 6.29); ctx.fill();
  ctx.fillStyle = p.flash > 0 ? '#ff8d7a' : '#3f7fb5';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 0.5, 0, 6.29); ctx.fill();
  ctx.fillStyle = p.flash > 0 ? '#ffb0a0' : '#5e9bcc';
  ctx.beginPath(); ctx.arc(p.x - 2.5, p.y - 3, p.r * 0.5, 0, 6.29); ctx.fill();

  // shoulders along aim
  ctx.fillStyle = '#1f3d59';
  var spx = Math.cos(p.aim + Math.PI / 2), spy = Math.sin(p.aim + Math.PI / 2);
  ctx.beginPath();
  ctx.arc(p.x + spx * (p.r - 2), p.y + spy * (p.r - 2), 3.2, 0, 6.29);
  ctx.arc(p.x - spx * (p.r - 2), p.y - spy * (p.r - 2), 3.2, 0, 6.29);
  ctx.fill();

  // gun
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  ctx.fillStyle = '#1d2125';
  ctx.fillRect(p.r * 0.3, -1.8, p.r + 8, 3.6);
  ctx.fillStyle = '#3a4046';
  ctx.fillRect(p.r * 0.3, -1.8, 5, 3.6);
  if (p.muzzle > 0) {
    ctx.fillStyle = 'rgba(255,238,170,0.9)';
    ctx.beginPath();
    ctx.arc(p.r + 9, 0, 4.5 + Math.random() * 2, 0, 6.29);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,200,90,0.4)';
    ctx.beginPath();
    ctx.arc(p.r + 9, 0, 9, 0, 6.29);
    ctx.fill();
  }
  ctx.restore();

  // head
  ctx.fillStyle = '#e3bd93';
  ctx.beginPath(); ctx.arc(p.x, p.y - 1, p.r * 0.5, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#4a3320';
  ctx.beginPath();
  ctx.arc(p.x, p.y - 1, p.r * 0.5, Math.PI * 0.95 + p.aim, Math.PI * 2.05 + p.aim);
  ctx.fill();
};
