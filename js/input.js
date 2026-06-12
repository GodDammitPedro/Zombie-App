/* Touch joystick (left side of screen) + WASD/arrow keys for desktop testing.
   Exposes Input.vec() -> {x, y} movement vector, magnitude 0..1. */

var Input = (function () {
  var joyActive = false;
  var joyId = null;
  var baseX = 0, baseY = 0;
  var vx = 0, vy = 0;
  var RADIUS = 52;

  var keys = {};

  var elJoy, elBase, elNub;

  function showJoy(x, y) {
    elJoy.classList.remove('hidden');
    elBase.style.left = x + 'px'; elBase.style.top = y + 'px';
    moveNub(x, y);
  }
  function moveNub(x, y) {
    elNub.style.left = x + 'px'; elNub.style.top = y + 'px';
  }
  function hideJoy() {
    elJoy.classList.add('hidden');
    vx = 0; vy = 0;
  }

  function onTouchStart(e) {
    SFX.unlock();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      // ignore touches that begin on buttons
      if (t.target.closest && t.target.closest('.btn')) continue;
      if (joyActive) continue;
      joyActive = true;
      joyId = t.identifier;
      baseX = t.clientX; baseY = t.clientY;
      showJoy(baseX, baseY);
    }
    if (e.target === document.getElementById('game-canvas')) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!joyActive) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier !== joyId) continue;
      var dx = t.clientX - baseX, dy = t.clientY - baseY;
      var len = Math.hypot(dx, dy);
      var cl = Math.min(len, RADIUS);
      if (len > 0) {
        vx = (dx / len) * (cl / RADIUS);
        vy = (dy / len) * (cl / RADIUS);
        moveNub(baseX + (dx / len) * cl, baseY + (dy / len) * cl);
      }
    }
    e.preventDefault();
  }

  function onTouchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyId) {
        joyActive = false; joyId = null;
        hideJoy();
      }
    }
  }

  function init() {
    elJoy = document.getElementById('joystick');
    elBase = document.getElementById('joystick-base');
    elNub = document.getElementById('joystick-nub');

    var game = document.getElementById('screen-game');
    game.addEventListener('touchstart', onTouchStart, { passive: false });
    game.addEventListener('touchmove', onTouchMove, { passive: false });
    game.addEventListener('touchend', onTouchEnd);
    game.addEventListener('touchcancel', onTouchEnd);

    // stop iOS rubber-banding everywhere except scrollable lists
    document.body.addEventListener('touchmove', function (e) {
      if (!e.target.closest('.map-list') && !e.target.closest('.skill-list')) {
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      keys[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === 'e' && window.UI) UI.pressInteract();
      if (e.key === ' ' && window.UI) UI.pressDash();
    });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  }

  function vec() {
    var x = vx, y = vy;
    if (keys['w'] || keys['arrowup']) y = -1;
    if (keys['s'] || keys['arrowdown']) y = 1;
    if (keys['a'] || keys['arrowleft']) x = -1;
    if (keys['d'] || keys['arrowright']) x = 1;
    var len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x: x, y: y };
  }

  return { init: init, vec: vec };
})();
