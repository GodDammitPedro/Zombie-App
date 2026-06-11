/* Persistent save data (localStorage). Everything in a run resets on death
   EXCEPT what's stored here: banked XP and purchased skill-tree nodes. */
var Save = (function () {
  var KEY = 'deadlight_save_v1';

  var data = {
    xpBank: 0,        // spendable XP
    xpLifetime: 0,    // total XP ever earned
    skills: {},       // skillId -> true
    bestWave: {},     // mapId -> best wave reached
    totalKills: 0,
    runs: 0
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var k in data) if (parsed[k] !== undefined) data[k] = parsed[k];
      }
    } catch (e) { /* corrupted save — start fresh */ }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  load();

  return {
    get: function () { return data; },

    addXp: function (n) {
      n = Math.round(n);
      if (n <= 0) return;
      data.xpBank += n;
      data.xpLifetime += n;
      write();
    },

    spendXp: function (n) {
      if (data.xpBank < n) return false;
      data.xpBank -= n;
      write();
      return true;
    },

    hasSkill: function (id) { return !!data.skills[id]; },

    unlockSkill: function (id) {
      data.skills[id] = true;
      write();
    },

    addKills: function (n) { data.totalKills += n; write(); },

    recordRun: function (mapId, wave) {
      data.runs += 1;
      if (!data.bestWave[mapId] || wave > data.bestWave[mapId]) {
        data.bestWave[mapId] = wave;
      }
      write();
    }
  };
})();
