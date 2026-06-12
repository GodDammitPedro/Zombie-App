/* Synthesized audio (WebAudio): filtered-noise gunshots, growls, a generated
   impulse-response reverb for a sense of space, and a low ambient drone that
   runs while in a building. iOS unlocks audio on the first touch. */
var SFX = (function () {
  var ctx = null, master = null, verb = null;
  var ambientNodes = null;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(ctx.destination);
        // small generated impulse response = cheap room reverb
        verb = ctx.createConvolver();
        var len = Math.floor(ctx.sampleRate * 1.4);
        var imp = ctx.createBuffer(2, len, ctx.sampleRate);
        for (var c = 0; c < 2; c++) {
          var d = imp.getChannelData(c);
          for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
        }
        verb.buffer = imp;
        var vg = ctx.createGain();
        vg.gain.value = 0.5;
        verb.connect(vg);
        vg.connect(master);
      } catch (e) { ctx = null; return false; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function ok() { return ctx && ctx.state === 'running'; }

  function route(node, wet) {
    node.connect(master);
    if (verb && wet) {
      var g = ctx.createGain();
      g.gain.value = wet;
      node.connect(g);
      g.connect(verb);
    }
  }

  /* pitched tone with exponential decay */
  function tone(type, f0, f1, dur, vol, wet, delay) {
    if (!ok()) return;
    try {
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      route(g, wet);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch (e) {}
  }

  /* shaped noise through a swept filter — gunshots, impacts, creaks */
  function blast(dur, vol, type, fStart, fEnd, Q, wet, delay) {
    if (!ok()) return;
    try {
      var t = ctx.currentTime + (delay || 0);
      var len = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = Q || 0.8;
      f.frequency.setValueAtTime(Math.max(40, fStart), t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
      var g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g);
      route(g, wet);
      src.start(t);
    } catch (e) {}
  }

  return {
    unlock: function () { ensure(); },

    // weapons
    shoot: function () {
      blast(0.09, 0.20, 'lowpass', 2600, 320, 0.8, 0.12);
      tone('triangle', 170, 55, 0.09, 0.10, 0.05);
    },
    shotgun: function () {
      blast(0.22, 0.30, 'lowpass', 1400, 140, 0.7, 0.22);
      tone('sine', 110, 35, 0.22, 0.18, 0.15);
    },
    rail: function () {
      tone('sawtooth', 1400, 90, 0.28, 0.11, 0.3);
      blast(0.14, 0.10, 'highpass', 700, 2800, 1.2, 0.3);
      tone('sine', 90, 40, 0.3, 0.12, 0.2);
    },

    // zombies
    zdie: function () {
      tone('sawtooth', 95 + Math.random() * 45, 38, 0.5, 0.15, 0.3);
      blast(0.25, 0.09, 'lowpass', 700, 150, 0.8, 0.2);
    },
    growl: function (v) {
      tone('sawtooth', 60 + Math.random() * 30, 42, 0.9 + Math.random() * 0.4, 0.10 * v, 0.5);
    },
    roar: function () {
      tone('sawtooth', 45, 170, 0.7, 0.22, 0.5);
      blast(0.55, 0.18, 'lowpass', 420, 80, 1, 0.5);
    },
    ghost: function () {
      blast(1.1, 0.06, 'bandpass', 280, 1600, 3, 0.7);
      tone('sine', 660, 220, 1.0, 0.03, 0.7);
    },

    // player / economy
    dash: function () {
      blast(0.18, 0.10, 'highpass', 260, 1500, 1, 0.2);
      tone('sine', 220, 480, 0.15, 0.05, 0.15);
    },
    hurt: function () {
      tone('square', 110, 55, 0.2, 0.15, 0.1);
      blast(0.1, 0.08, 'lowpass', 900, 200, 0.8, 0.1);
    },
    buy: function () { tone('sine', 620, 930, 0.14, 0.10, 0.2); },
    upgrade: function () {
      tone('sine', 420, 430, 0.12, 0.09, 0.25, 0);
      tone('sine', 630, 645, 0.12, 0.09, 0.25, 0.09);
      tone('sine', 940, 960, 0.2, 0.10, 0.3, 0.18);
      blast(0.3, 0.05, 'highpass', 1500, 4000, 1, 0.3, 0.18);
    },
    deny: function () { tone('square', 130, 85, 0.18, 0.09, 0.05); },
    door: function () {
      blast(0.45, 0.13, 'lowpass', 480, 90, 1, 0.4);
      tone('sawtooth', 70, 40, 0.45, 0.07, 0.4);
    },

    // flow
    wave: function () {
      tone('triangle', 58, 92, 1.1, 0.14, 0.6);
      tone('triangle', 87, 138, 1.1, 0.06, 0.6, 0.05);
    },
    skill: function () { tone('sine', 520, 1040, 0.3, 0.12, 0.3); },
    gameover: function () {
      tone('sawtooth', 200, 30, 1.5, 0.15, 0.5);
      blast(0.8, 0.1, 'lowpass', 500, 60, 1, 0.5, 0.1);
    },

    /* low detuned drone while a run is active */
    ambient: function (on) {
      if (!on) {
        if (ambientNodes && ctx) {
          try {
            ambientNodes.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
            ambientNodes.o1.stop(ctx.currentTime + 2.5);
            ambientNodes.o2.stop(ctx.currentTime + 2.5);
          } catch (e) {}
        }
        ambientNodes = null;
        return;
      }
      if (!ensure() || !ok() || ambientNodes) return;
      try {
        var g = ctx.createGain();
        g.gain.value = 0.0001;
        g.gain.setTargetAtTime(0.045, ctx.currentTime, 2);
        g.connect(master);
        var o1 = ctx.createOscillator();
        o1.type = 'sine'; o1.frequency.value = 46;
        var o2 = ctx.createOscillator();
        o2.type = 'sine'; o2.frequency.value = 46.7;
        o1.connect(g); o2.connect(g);
        o1.start(); o2.start();
        ambientNodes = { o1: o1, o2: o2, g: g };
      } catch (e) { ambientNodes = null; }
    }
  };
})();
