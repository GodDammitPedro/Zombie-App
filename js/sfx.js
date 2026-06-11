/* Tiny synthesized sound effects (WebAudio). iOS unlocks audio on first touch. */
var SFX = (function () {
  var ctx = null;
  var enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return false; }
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // generic blip: type, startFreq, endFreq, duration, volume
  function blip(type, f0, f1, dur, vol) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    try {
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }

  function noise(dur, vol) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    try {
      var t = ctx.currentTime;
      var len = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g); g.connect(ctx.destination);
      src.start(t);
    } catch (e) {}
  }

  return {
    unlock: function () { ensure(); },
    shoot:    function () { noise(0.06, 0.10); blip('square', 380, 90, 0.07, 0.05); },
    shotgun:  function () { noise(0.14, 0.22); blip('square', 200, 50, 0.14, 0.08); },
    zdie:     function () { blip('sawtooth', 160, 40, 0.25, 0.12); },
    hurt:     function () { blip('square', 110, 55, 0.2, 0.15); },
    buy:      function () { blip('sine', 660, 990, 0.12, 0.12); },
    deny:     function () { blip('square', 140, 90, 0.18, 0.1); },
    door:     function () { noise(0.2, 0.12); blip('sine', 90, 50, 0.3, 0.12); },
    wave:     function () { blip('sawtooth', 70, 180, 0.6, 0.1); },
    skill:    function () { blip('sine', 520, 1040, 0.25, 0.14); },
    gameover: function () { blip('sawtooth', 220, 35, 1.1, 0.15); }
  };
})();
