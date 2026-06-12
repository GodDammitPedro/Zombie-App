/* All DOM screens: menu, map select, skill trees, HUD, pause, game over. */

var UI = (function () {
  var game = null;
  var rafId = null;
  var lastT = 0;
  var currentMap = null;
  var activeTree = 0;

  var $ = function (id) { return document.getElementById(id); };

  function show(screenId) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $(screenId).classList.add('active');
  }
  function overlay(id, on) {
    $(id).classList.toggle('active', on);
  }

  // ---------------- menu ----------------
  function renderMenu() {
    var d = Save.get();
    var skillCount = Object.keys(d.skills).length;
    $('menu-stats').innerHTML =
      'XP Bank: <b>' + d.xpBank + '</b> &nbsp;|&nbsp; Skills: <b>' + skillCount + '</b><br>' +
      'Lifetime kills: <b>' + d.totalKills + '</b> &nbsp;|&nbsp; Runs: <b>' + d.runs + '</b>';
  }

  // ---------------- map select ----------------
  function renderMaps() {
    var list = $('map-list');
    list.innerHTML = '';
    MAPS.forEach(function (m) {
      var best = Save.get().bestWave[m.id] || 0;
      var stars = '';
      var lvl = Math.round(m.difficulty * 1.6);
      for (var i = 0; i < 5; i++) stars += i < lvl ? '★' : '☆';
      var card = document.createElement('div');
      card.className = 'map-card';
      card.innerHTML =
        '<div class="map-name">' + m.name + '</div>' +
        '<div class="map-desc">' + m.desc + '</div>' +
        '<div class="map-meta"><span class="diff">' + stars + '</span>' +
        '<span class="best">' + (best ? 'Best: Wave ' + best : 'Not attempted') + '</span></div>';
      card.addEventListener('click', function () { startGame(m); });
      list.appendChild(card);
    });
  }

  // ---------------- skill trees ----------------
  function renderSkills() {
    $('xp-balance').textContent = Save.get().xpBank + ' XP';

    var tabs = $('skill-tabs');
    tabs.innerHTML = '';
    SKILL_TREES.forEach(function (tree, i) {
      var tab = document.createElement('div');
      tab.className = 'skill-tab' + (i === activeTree ? ' active' : '');
      tab.textContent = tree.name;
      if (i === activeTree) tab.style.color = tree.color;
      tab.addEventListener('click', function () { activeTree = i; renderSkills(); });
      tabs.appendChild(tab);
    });

    var list = $('skill-list');
    list.innerHTML = '';
    var tree = SKILL_TREES[activeTree];
    tree.skills.forEach(function (s) {
      var owned = Save.hasSkill(s.id);
      var reqOk = !s.req || Save.hasSkill(s.req);
      var afford = Save.get().xpBank >= s.cost;

      var node = document.createElement('div');
      node.className = 'skill-node' + (owned ? ' owned' : (!reqOk ? ' locked' : ''));

      var reqHtml = '';
      if (s.req && !reqOk) {
        var reqSkill = Skills.find(s.req);
        reqHtml = '<div class="s-req">Requires: ' + reqSkill.name + '</div>';
      }
      node.innerHTML =
        '<div class="skill-info">' +
          '<div class="s-name" style="color:' + (owned ? tree.color : '#e8eee9') + '">' + s.name + '</div>' +
          '<div class="s-desc">' + s.desc + '</div>' + reqHtml +
        '</div>';

      var btn = document.createElement('button');
      btn.className = 'btn skill-buy';
      if (owned) {
        btn.classList.add('owned-tag');
        btn.textContent = 'OWNED';
        btn.disabled = true;
      } else {
        btn.textContent = s.cost + ' XP';
        if (reqOk && afford) btn.classList.add('afford');
        btn.addEventListener('click', function () {
          if (Skills.buy(s.id)) { SFX.skill(); renderSkills(); }
          else SFX.deny();
        });
      }
      node.appendChild(btn);
      list.appendChild(node);
    });
  }

  // ---------------- game ----------------
  var toastTimer = null, bannerTimer = null;

  var callbacks = {
    onHud: function (g) {
      var p = g.player;
      $('hp-fill').style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
      $('hp-text').textContent = Math.max(0, Math.ceil(p.hp)) + ' / ' + p.maxHp;
      $('money-label').textContent = '$' + g.money;
      $('xp-label').textContent = g.runXp + ' XP';
      $('wave-label').textContent = g.waveActive
        ? 'WAVE ' + g.wave + ' — ' + (g.zombies.length + g.spawnQueue.length)
        : 'WAVE ' + (g.wave + 1) + ' IN ' + Math.ceil(g.intermission);
      var lvl = p.upgrades[p.weaponKey] || 0;
      $('weapon-label').textContent = p.weapon.name + (lvl ? '  Lv.' + lvl : '');
      if (g.perks.canDash) {
        var db = $('btn-dash');
        var cooling = p.dashCdT > 0;
        db.classList.toggle('cooling', cooling);
        db.textContent = cooling ? Math.ceil(p.dashCdT) + 's' : 'DASH';
      }
    },
    onWaveBanner: function (text) {
      var b = $('wave-banner');
      b.textContent = text;
      b.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () { b.classList.add('hidden'); }, 1800);
    },
    onToast: function (text) {
      var t = $('toast');
      t.textContent = text;
      t.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1600);
    },
    onInteract: function (target) {
      var btn = $('btn-interact');
      if (!target) { btn.classList.add('hidden'); return; }
      btn.classList.remove('hidden');
      btn.textContent = target.label;
      btn.classList.toggle('cant', !target.afford && target.kind !== 'owned');
    },
    onGameOver: function (stats) {
      stopLoop();
      SFX.ambient(false);
      $('go-stats').innerHTML =
        'Survived to <b>Wave ' + stats.wave + '</b><br>' +
        'Kills: <b>' + stats.kills + '</b> &nbsp; Money earned: <b>$' + stats.moneyEarned + '</b><br>' +
        '<span class="xpb">+' + stats.xp + ' XP banked</span>';
      // a desynced solo retry makes no sense mid-co-op
      $('btn-retry').classList.toggle('hidden', !!(game && game.net));
      overlay('screen-gameover', true);
    }
  };

  function startGame(mapDef, useNet) {
    currentMap = mapDef;
    var canvas = $('game-canvas');
    game = new Game(mapDef, canvas, callbacks, useNet ? Net : null);
    $('btn-dash').classList.toggle('hidden', !game.perks.canDash);
    show('screen-game');
    overlay('screen-pause', false);
    overlay('screen-gameover', false);
    SFX.ambient(true);
    startLoop();
  }

  // ---------------- LAN lobby ----------------
  function renderLobby(message) {
    var body = $('lan-body');
    body.innerHTML = '';

    if (message) {
      var st = document.createElement('div');
      st.className = 'lan-status';
      st.textContent = message;
      body.appendChild(st);
      return;
    }
    if (!Net.active()) {
      var st2 = document.createElement('div');
      st2.className = 'lan-status';
      st2.textContent = 'Connecting…';
      body.appendChild(st2);
      return;
    }

    var roster = document.createElement('div');
    roster.className = 'lan-roster';
    var me = document.createElement('div');
    me.className = 'lan-player';
    me.innerHTML = 'You' + (Net.isHost() ? '<span class="role">HOST</span>' : '');
    roster.appendChild(me);
    var peers = Net.peers();
    for (var id in peers) {
      var row = document.createElement('div');
      row.className = 'lan-player';
      row.textContent = peers[id];
      roster.appendChild(row);
    }
    body.appendChild(roster);

    var hint = document.createElement('div');
    hint.className = 'lan-hint';
    if (Net.isHost()) {
      hint.textContent = Net.peerCount()
        ? 'Pick a map to start the run for everyone. Money and XP are earned individually.'
        : 'Waiting for other phones to open this address… you can also start solo.';
      body.appendChild(hint);
      var list = document.createElement('div');
      list.className = 'lan-maps';
      MAPS.forEach(function (m) {
        var b = document.createElement('button');
        b.className = 'btn';
        b.textContent = m.name;
        b.addEventListener('click', function () {
          Net.send({ t: 'start', map: m.id });
          startGame(m, true);
        });
        list.appendChild(b);
      });
      body.appendChild(list);
    } else {
      hint.textContent = 'Connected. Waiting for the host to pick a map…';
      body.appendChild(hint);
    }
  }

  function openLan() {
    show('screen-lan');
    renderLobby();
    Net.onLobby(function () { renderLobby(); });
    Net.connect('Player ' + (1 + Math.floor(Math.random() * 98)), function (err) {
      if (err) { renderLobby(err); return; }
      Net.on('start', function (d) {
        var m = null;
        MAPS.forEach(function (mm) { if (mm.id === d.map) m = mm; });
        if (m && !Net.isHost()) startGame(m, true);
      });
      renderLobby();
    });
  }

  function loop(t) {
    rafId = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (game) {
      game.update(dt);
      game.render();
    }
  }
  function startLoop() {
    stopLoop();
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function quitToMenu() {
    if (game && !game.over) {
      Save.recordRun(game.map.id, game.wave);
      Save.addKills(game.kills);
    }
    SFX.ambient(false);
    stopLoop();
    game = null;
    Net.disconnect();
    overlay('screen-pause', false);
    overlay('screen-gameover', false);
    renderMenu();
    show('screen-menu');
  }

  // ---------------- wire up ----------------
  function init() {
    $('btn-play').addEventListener('click', function () { renderMaps(); show('screen-maps'); });
    $('btn-skills').addEventListener('click', function () { renderSkills(); show('screen-skills'); });
    $('btn-lan').addEventListener('click', openLan);
    $('btn-lan-back').addEventListener('click', function () {
      Net.disconnect();
      renderMenu();
      show('screen-menu');
    });

    document.querySelectorAll('.btn-back').forEach(function (b) {
      b.addEventListener('click', function () {
        renderMenu();
        show(b.getAttribute('data-back'));
      });
    });

    $('btn-pause').addEventListener('click', function () {
      if (!game || game.over) return;
      game.paused = true;
      overlay('screen-pause', true);
    });
    $('btn-resume').addEventListener('click', function () {
      if (game) game.paused = false;
      overlay('screen-pause', false);
    });
    $('btn-quit').addEventListener('click', quitToMenu);

    $('btn-retry').addEventListener('click', function () {
      overlay('screen-gameover', false);
      if (currentMap) startGame(currentMap);
    });
    $('btn-go-menu').addEventListener('click', quitToMenu);
    $('btn-go-skills').addEventListener('click', function () {
      stopLoop();
      game = null;
      overlay('screen-gameover', false);
      renderSkills();
      show('screen-skills');
    });

    var interactBtn = $('btn-interact');
    var press = function (e) {
      e.preventDefault();
      if (game) game.doInteract();
    };
    interactBtn.addEventListener('touchstart', press, { passive: false });
    interactBtn.addEventListener('mousedown', press);

    var dashBtn = $('btn-dash');
    var pressDash = function (e) {
      e.preventDefault();
      if (game) game.tryDash();
    };
    dashBtn.addEventListener('touchstart', pressDash, { passive: false });
    dashBtn.addEventListener('mousedown', pressDash);

    window.addEventListener('resize', function () { if (game) game.resize(); });

    renderMenu();
  }

  return {
    init: init,
    pressInteract: function () { if (game) game.doInteract(); },
    pressDash: function () { if (game) game.tryDash(); }
  };
})();
