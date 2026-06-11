/* Core game engine: one Game instance per run. Everything here resets when
   the run ends — only Save/Skills persist. */

function Game(mapDef, canvas, callbacks) {
  this.map = mapDef;
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.cb = callbacks; // { onHud, onWaveBanner, onToast, onInteract, onGameOver }

  this.perks = Skills.perks();

  // --- parse layout ---
  var rows = mapDef.layout;
  this.H = rows.length;
  this.W = rows[0].length;
  this.grid = [];           // chars
  this.doors = {};          // letter -> {letter, cost, tiles:[], open}
  this.guns = [];           // {x, y, weapon, price}
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
    speed: 150 * this.perks.speedMul,
    weapon: WEAPONS[this.perks.startWeapon],
    aim: 0,
    fireCd: 0,
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
  this.resize();
}

// ---------------------------------------------------------------- helpers

Game.prototype.isSolidTile = function (tx, ty) {
  if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
  var c = this.grid[ty][tx];
  if (c === '#') return true;
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
  var active = this.spawners.filter(function (s) { return s.active; });
  if (!active.length) return;
  // bias toward spawners closer to the player so action stays nearby
  var p = this.player;
  active.sort(function (a, b) {
    var da = Math.hypot((a.x + .5) * TILE - p.x, (a.y + .5) * TILE - p.y);
    var db = Math.hypot((b.x + .5) * TILE - p.x, (b.y + .5) * TILE - p.y);
    return da - db;
  });
  var pick = active[Math.floor(Math.random() * Math.min(active.length, 3))];
  var typeKey = this.spawnQueue.shift();
  var t = ZOMBIE_TYPES[typeKey];
  var hpScale = waveHpScale(this.wave, this.map.difficulty);
  this.zombies.push({
    id: this.nextZombieId++,
    type: typeKey,
    x: (pick.x + 0.5) * TILE + (Math.random() * 10 - 5),
    y: (pick.y + 0.5) * TILE + (Math.random() * 10 - 5),
    r: t.radius,
    hp: t.hp * hpScale,
    maxHp: t.hp * hpScale,
    speed: t.speed * (0.9 + Math.random() * 0.2),
    dmg: t.dmg,
    atkCd: 0,
    rise: 0.7,           // spawn-in animation, invulnerable-ish window
    wob: Math.random() * 6.28,
    flash: 0
  });
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

  this.addFloat(z.x, z.y - z.r - 4, '+$' + money, '#f5c84c');
  this.splatter(z.x, z.y, t.color, z.type === 'boss' ? 26 : 12);
  SFX.zdie();
  if (z.type === 'boss') this.shake = Math.max(this.shake, 0.5);
};

// ---------------------------------------------------------------- update

Game.prototype.update = function (dt) {
  if (this.over || this.paused) return;
  var p = this.player;

  // --- player movement ---
  var v = Input.vec();
  this.moveCircle(p, v.x * p.speed * dt, v.y * p.speed * dt);

  // --- regen ---
  p.sinceHurt += dt;
  if (this.perks.regen > 0 && p.sinceHurt > 5 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + this.perks.regen * dt);
  }
  if (p.flash > 0) p.flash -= dt;

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

  // --- zombies ---
  for (var i = this.zombies.length - 1; i >= 0; i--) {
    var z = this.zombies[i];
    if (z.flash > 0) z.flash -= dt;
    if (z.rise > 0) { z.rise -= dt; continue; }
    z.wob += dt * 6;

    var distP = Math.hypot(p.x - z.x, p.y - z.y);
    var reach = p.r + z.r + 3;

    if (distP <= reach + 2) {
      // attack
      z.atkCd -= dt;
      if (z.atkCd <= 0) {
        z.atkCd = 0.85;
        var dmg = z.dmg * this.perks.dmgTakenMul;
        p.hp -= dmg;
        p.sinceHurt = 0;
        p.flash = 0.3;
        this.shake = Math.max(this.shake, 0.25);
        SFX.hurt();
        if (p.hp <= 0) {
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
            return;
          }
        }
      }
    } else {
      // steering: straight line if close & visible, otherwise follow flow field
      var dirX = 0, dirY = 0;
      if (distP < 200 && this.hasLOS(z.x, z.y, p.x, p.y)) {
        dirX = (p.x - z.x) / distP;
        dirY = (p.y - z.y) / distP;
      } else if (this.flow) {
        var tx = Math.floor(z.x / TILE), ty = Math.floor(z.y / TILE);
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
      }

      // separation from other zombies
      var sx = 0, sy = 0;
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
      var wobble = Math.sin(z.wob) * 0.15;
      var mx = dirX + sx * 0.8 - dirY * wobble;
      var my = dirY + sy * 0.8 + dirX * wobble;
      var ml = Math.hypot(mx, my);
      if (ml > 0.01) this.moveCircle(z, (mx / ml) * z.speed * dt, (my / ml) * z.speed * dt);
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
      p.fireCd = 1 / (w.rof * this.perks.rofMul);
      var dmgMul = this.perks.dmgMul * (w === WEAPONS.pistol ? this.perks.pistolDmgMul : 1);
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
      this.particles.push({ x: p.x + Math.cos(p.aim) * (p.r + 8), y: p.y + Math.sin(p.aim) * (p.r + 8), vx: 0, vy: 0, life: 0.05, maxLife: 0.05, size: 7, color: '#fff2b0', type: 'flash' });
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
      this.splatter(bl.x, bl.y, '#aaa49a', 3);
    }
    if (!dead) {
      for (var zi = 0; zi < this.zombies.length; zi++) {
        var zb = this.zombies[zi];
        if (zb.rise > 0 || bl.hit[zb.id]) continue;
        var bdx = zb.x - bl.x, bdy = zb.y - bl.y;
        if (bdx * bdx + bdy * bdy <= (zb.r + 3) * (zb.r + 3)) {
          var crit = Math.random() < this.perks.critChance;
          var dealt = bl.dmg * (crit ? 2 : 1);
          zb.hp -= dealt;
          zb.flash = 0.08;
          bl.hit[zb.id] = true;
          this.addFloat(zb.x, zb.y - zb.r - 6, Math.round(dealt) + (crit ? '!' : ''), crit ? '#ff6a4d' : '#ffffff');
          this.splatter(zb.x, zb.y, ZOMBIE_TYPES[zb.type].color, 3);
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
  this.interactTarget = best;
  this.cb.onInteract(best);
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
    SFX.door();
    this.cb.onToast('Area unlocked');
  } else if (t.kind === 'gun') {
    if (this.money < t.gun.price) { SFX.deny(); this.cb.onToast('Not enough money'); return; }
    this.money -= t.gun.price;
    this.player.weapon = WEAPONS[t.gun.weapon];
    SFX.buy();
    this.cb.onToast(WEAPONS[t.gun.weapon].name + ' equipped');
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
  if (this.decals.length < 130 && n >= 6) {
    this.decals.push({ x: x, y: y, r: 6 + Math.random() * 8, color: color });
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

  // --- tiles ---
  for (var ty = y0; ty <= y1; ty++) {
    for (var tx = x0; tx <= x1; tx++) {
      var c = this.grid[ty][tx];
      var X = tx * TILE, Y = ty * TILE;
      if (c === '#' || (c >= '1' && c <= '9')) {
        ctx.fillStyle = '#1c2526';
        ctx.fillRect(X, Y, TILE, TILE);
        ctx.fillStyle = '#27292e';
        ctx.fillRect(X, Y, TILE, 5);
      } else if (c >= 'A' && c <= 'J') {
        var door = this.doors[c];
        if (door.open) {
          ctx.fillStyle = ((tx + ty) & 1) ? '#11181a' : '#121a1c';
          ctx.fillRect(X, Y, TILE, TILE);
          ctx.fillStyle = '#3a2c1c';
          ctx.fillRect(X, Y, 4, TILE);
          ctx.fillRect(X + TILE - 4, Y, 4, TILE);
        } else {
          ctx.fillStyle = '#4a3520';
          ctx.fillRect(X, Y, TILE, TILE);
          ctx.fillStyle = '#5d4429';
          for (var pl = 0; pl < 3; pl++) ctx.fillRect(X + 3 + pl * 10, Y + 2, 7, TILE - 4);
          ctx.fillStyle = '#c9a04c';
          ctx.fillRect(X + TILE / 2 - 2, Y + TILE / 2 - 2, 4, 4);
        }
      } else {
        ctx.fillStyle = ((tx + ty) & 1) ? '#11181a' : '#121a1c';
        ctx.fillRect(X, Y, TILE, TILE);
      }
    }
  }

  // --- spawner windows ---
  for (var s = 0; s < this.spawners.length; s++) {
    var sp = this.spawners[s];
    if (sp.x < x0 - 1 || sp.x > x1 + 1 || sp.y < y0 - 1 || sp.y > y1 + 1) continue;
    var SX = sp.x * TILE, SY = sp.y * TILE;
    ctx.fillStyle = sp.active ? '#241114' : '#15181b';
    ctx.fillRect(SX + 3, SY + 3, TILE - 6, TILE - 6);
    ctx.strokeStyle = sp.active ? '#5e2630' : '#2a3034';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SX + 4, SY + 4); ctx.lineTo(SX + TILE - 4, SY + TILE - 4);
    ctx.moveTo(SX + TILE - 4, SY + 4); ctx.lineTo(SX + 4, SY + TILE - 4);
    ctx.stroke();
  }

  // --- decals ---
  for (var dc = 0; dc < this.decals.length; dc++) {
    var de = this.decals[dc];
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = de.color;
    ctx.beginPath();
    ctx.arc(de.x, de.y, de.r, 0, 6.29);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- door price tags + gun stations ---
  ctx.textAlign = 'center';
  ctx.font = 'bold 9px sans-serif';
  var shownDoor = {};
  for (var L in this.doors) {
    var dr = this.doors[L];
    if (dr.open || shownDoor[L]) continue;
    var t0 = dr.tiles[0];
    if (t0.x >= x0 - 1 && t0.x <= x1 + 1 && t0.y >= y0 - 1 && t0.y <= y1 + 1) {
      ctx.fillStyle = '#f5c84c';
      ctx.fillText('$' + dr.cost, (t0.x + 0.5) * TILE, t0.y * TILE - 3);
      shownDoor[L] = true;
    }
  }
  for (var gi = 0; gi < this.guns.length; gi++) {
    var gn = this.guns[gi];
    if (gn.x < x0 - 1 || gn.x > x1 + 1 || gn.y < y0 - 1 || gn.y > y1 + 1) continue;
    var GX = gn.x * TILE, GY = gn.y * TILE;
    var wdef = WEAPONS[gn.weapon];
    ctx.fillStyle = '#10161a';
    ctx.fillRect(GX + 3, GY + 6, TILE - 6, TILE - 12);
    // simple gun glyph
    ctx.fillStyle = wdef.color;
    ctx.fillRect(GX + 7, GY + TILE / 2 - 2, 18, 4);
    ctx.fillRect(GX + 9, GY + TILE / 2 + 2, 4, 6);
    ctx.fillStyle = this.money >= gn.price ? '#7ddc8e' : '#e0a08a';
    ctx.fillText('$' + gn.price, GX + TILE / 2, GY - 3);
  }

  // --- zombies ---
  for (var zi2 = 0; zi2 < this.zombies.length; zi2++) {
    var z = this.zombies[zi2];
    var zt = ZOMBIE_TYPES[z.type];
    var riseScale = z.rise > 0 ? Math.max(0.15, 1 - z.rise / 0.7) : 1;
    var zr = z.r * riseScale;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(z.x, z.y + zr * 0.6, zr, zr * 0.45, 0, 0, 6.29); ctx.fill();

    ctx.fillStyle = z.flash > 0 ? '#ffffff' : zt.color;
    ctx.beginPath(); ctx.arc(z.x, z.y, zr, 0, 6.29); ctx.fill();

    // arms reaching forward
    var za = Math.atan2(p.y - z.y, p.x - z.x);
    ctx.strokeStyle = zt.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(z.x + Math.cos(za + 0.5) * zr * 0.6, z.y + Math.sin(za + 0.5) * zr * 0.6);
    ctx.lineTo(z.x + Math.cos(za + 0.35) * (zr + 6), z.y + Math.sin(za + 0.35) * (zr + 6));
    ctx.moveTo(z.x + Math.cos(za - 0.5) * zr * 0.6, z.y + Math.sin(za - 0.5) * zr * 0.6);
    ctx.lineTo(z.x + Math.cos(za - 0.35) * (zr + 6), z.y + Math.sin(za - 0.35) * (zr + 6));
    ctx.stroke();

    // eyes
    ctx.fillStyle = zt.eye;
    var ex = Math.cos(za) * zr * 0.45, ey = Math.sin(za) * zr * 0.45;
    ctx.beginPath();
    ctx.arc(z.x + ex - ey * 0.5, z.y + ey + ex * 0.5, zr * 0.16, 0, 6.29);
    ctx.arc(z.x + ex + ey * 0.5, z.y + ey - ex * 0.5, zr * 0.16, 0, 6.29);
    ctx.fill();

    // hp bar when damaged
    if (z.hp < z.maxHp && z.rise <= 0) {
      var bw = z.r * 2;
      ctx.fillStyle = '#000000aa';
      ctx.fillRect(z.x - bw / 2, z.y - z.r - 7, bw, 3);
      ctx.fillStyle = z.type === 'boss' ? '#ff4040' : '#7ddc8e';
      ctx.fillRect(z.x - bw / 2, z.y - z.r - 7, bw * Math.max(0, z.hp / z.maxHp), 3);
    }
  }

  // --- player ---
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.6, p.r, p.r * 0.45, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = p.flash > 0 ? '#ff8d7a' : '#3f7fb5';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#c8dff0';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, 6.29); ctx.fill();
  // gun
  ctx.strokeStyle = '#2b2f33';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(p.aim) * p.r * 0.4, p.y + Math.sin(p.aim) * p.r * 0.4);
  ctx.lineTo(p.x + Math.cos(p.aim) * (p.r + 9), p.y + Math.sin(p.aim) * (p.r + 9));
  ctx.stroke();

  // --- bullets ---
  ctx.lineWidth = 2;
  for (var bi = 0; bi < this.bullets.length; bi++) {
    var bu = this.bullets[bi];
    ctx.strokeStyle = bu.color;
    ctx.beginPath();
    ctx.moveTo(bu.x, bu.y);
    ctx.lineTo(bu.x - bu.vx * 0.016, bu.y - bu.vy * 0.016);
    ctx.stroke();
  }

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
  ctx.font = 'bold 10px sans-serif';
  for (var fi2 = 0; fi2 < this.floats.length; fi2++) {
    var fl = this.floats[fi2];
    ctx.globalAlpha = Math.min(1, fl.life * 2.5);
    ctx.fillStyle = fl.color;
    ctx.fillText(fl.text, fl.x, fl.y);
  }
  ctx.globalAlpha = 1;

  // --- hurt vignette ---
  if (p.flash > 0 || p.hp < p.maxHp * 0.3) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var alpha = p.flash > 0 ? 0.35 : 0.12 + 0.1 * Math.sin(Date.now() / 200);
    var grad = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    grad.addColorStop(0, 'rgba(160,20,20,0)');
    grad.addColorStop(1, 'rgba(160,20,20,' + alpha + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }
};
