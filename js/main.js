/* Boot. */
window.addEventListener('load', function () {
  var problems = validateMaps();
  if (problems.length) console.error('Map validation problems:', problems);

  Input.init();
  UI.init();
});
