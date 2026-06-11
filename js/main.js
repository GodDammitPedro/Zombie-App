/* Boot. */
var GAME_BUILD = 3; // bump together with the ?v= query strings in index.html

window.addEventListener('load', function () {
  var problems = validateMaps();
  if (problems.length) console.error('Map validation problems:', problems);

  var tag = document.getElementById('build-tag');
  if (tag) tag.textContent = 'build ' + GAME_BUILD;

  Input.init();
  UI.init();
});
