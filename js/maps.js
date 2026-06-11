/* Map definitions.
   Legend:
     #      wall
     .      floor
     P      player start
     Z      zombie spawn window (active once its room is reachable)
     A - J  purchasable doors (price in `doors`, one entry per letter)
     1 - 7  wall gun stations (weapon key in `guns`, price comes from WEAPONS)
   Layouts are validated at load time by validateMaps() below. */

var TILE = 32;

var MAPS = [
  {
    id: 'house',
    name: 'Rotting House',
    desc: 'A boarded-up two-story home. Tight halls, cheap doors. Good place to learn.',
    difficulty: 1.0,
    doors: { A: 300, B: 600, C: 350, D: 750, E: 1000, F: 800, G: 900 },
    guns: { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'shotgun', 5: 'lmg' },
    layout: [
      '##################2#####',
      '#Z.....#.....Z#......Z.#',
      '#......#......B........#',
      '#......A......#........#',
      '#..P...#......#........#',
      '#Z.....#......#####F####',
      '#......1......#........#',
      '###C####......#........#',
      '#......#......#...3...Z#',
      '#......#####D##........#',
      '#..4...#......#........#',
      '#......#......##E#######',
      '#Z.....G......#........#',
      '#......#......#..5.....#',
      '#......#......#........#',
      '#......#......#Z.......#',
      '#......#Z.....#........#',
      '########################'
    ]
  },
  {
    id: 'office',
    name: 'Grayfall Offices',
    desc: 'Three floors of cubicles compressed into one nightmare. Wider halls, faster zombies.',
    difficulty: 1.4,
    doors: { A: 400, B: 750, C: 750, D: 400, E: 650, F: 550, G: 550, H: 900 },
    guns: { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'lmg', 5: 'railgun' },
    layout: [
      '##############2########3####',
      '#Z........#...Z....#......Z#',
      '#.........#........#.......#',
      '#.........B........C.......#',
      '#.........#........#.......#',
      '#.........#........#.......#',
      '#####A#########D#######E####',
      '#Z........................Z#',
      '#............P.............#',
      '#..........................#',
      '####1###F###########G#######',
      '#............#.............#',
      '#............4.............#',
      '#............#.............#',
      '#Z...........H............Z#',
      '#............#.............#',
      '#............#.............#',
      '####################5#######'
    ]
  },
  {
    id: 'motel',
    name: 'Sunset Motel',
    desc: 'A long roadside motel. Every room hides a window — open doors with care.',
    difficulty: 1.8,
    doors: { A: 500, B: 500, C: 650, D: 650, E: 800, F: 800, G: 1100 },
    guns: { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'lmg', 5: 'shotgun', 6: 'railgun' },
    layout: [
      '###1#######2#####3#######4####',
      '#Z.....#..Z...#.....Z#..Z....#',
      '#......#......#......#.......#',
      '#......#......#......#.......#',
      '#......#......#......#.......#',
      '#......#......#......#.......#',
      '####A#####B######C######D#####',
      '#............................#',
      '#Z............P.............Z#',
      '#............................#',
      '########E######5#######F######',
      '#..............#.............#',
      '#Z.............#............Z#',
      '#..............G.............#',
      '#..............#.............#',
      '####################6#########'
    ]
  },
  {
    id: 'warehouse',
    name: 'Kessler Warehouse',
    desc: 'A cavernous distribution hub. Open sightlines for you — and for the horde.',
    difficulty: 2.3,
    doors: { A: 600, B: 600, C: 600, D: 850, E: 850, F: 750, G: 750, H: 1200 },
    guns: { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'lmg', 5: 'railgun' },
    layout: [
      '############2#############',
      '#Z.......#..Z...#.......Z#',
      '#........#......#........#',
      '#........#......#........#',
      '#####A######B#######C#####',
      '#.....#Z...........#.....#',
      '#.....#............#.....#',
      '#.....#............3.....#',
      '#.....D............#.....#',
      '#.....#............#.....#',
      '#Z....#.....P......#.....#',
      '#.....#............#.....#',
      '#.....#............E.....#',
      '#.....#............#.....#',
      '#.....1............#....Z#',
      '#.....#............#.....#',
      '#.....#...........Z#.....#',
      '#########F##4#####G#######',
      '#............#...........#',
      '#Z...........H..........Z#',
      '#............#...........#',
      '######5###################'
    ]
  },
  {
    id: 'hospital',
    name: 'Mercy General',
    desc: 'Where the outbreak began. Long wards, locked wings, and the toughest horde of all.',
    difficulty: 3.0,
    doors: { A: 900, B: 900, C: 800, D: 700, E: 800, F: 750, G: 750, H: 1000, I: 1000, J: 600 },
    guns: { 1: 'smg', 2: 'shotgun', 3: 'rifle', 4: 'lmg', 5: 'railgun', 6: 'lmg', 7: 'smg' },
    layout: [
      '########3############4########',
      '#Z........#...Z....#.......Z.#',
      '#.........#........#.........#',
      '#.........A........B.........#',
      '#.........#........#.........#',
      '#####C########D#########E#####',
      '#.........#........#.........#',
      '#.........1........#.........#',
      '#.........#........2.........#',
      '#.........F........G.........#',
      '###########........###########',
      '#.........#........#.........#',
      '#Z........H........I........Z#',
      '#.........#........#.........#',
      '#.........#........#.........#',
      '#####5########J#########6#####',
      '#............................#',
      '#Z..........................Z#',
      '#..............P.............#',
      '#............................#',
      '#............................#',
      '#############7################'
    ]
  }
];

/* Sanity-check every map at load: rectangular, sealed border, exactly one
   player start, at least one spawner, and door/gun metadata present. */
function validateMaps() {
  var problems = [];
  MAPS.forEach(function (m) {
    var rows = m.layout, w = rows[0].length;
    var pCount = 0, zCount = 0;
    var lettersSeen = {}, gunsSeen = {};

    rows.forEach(function (row, y) {
      if (row.length !== w) problems.push(m.id + ': row ' + y + ' width ' + row.length + ' != ' + w);
      for (var x = 0; x < row.length; x++) {
        var c = row[x];
        var border = (y === 0 || y === rows.length - 1 || x === 0 || x === row.length - 1);
        if (border && c !== '#' && !(c >= '1' && c <= '9')) {
          problems.push(m.id + ': border hole at ' + x + ',' + y + ' ("' + c + '")');
        }
        if (c === 'P') pCount++;
        else if (c === 'Z') zCount++;
        else if (c >= 'A' && c <= 'J') {
          lettersSeen[c] = true;
          if (!m.doors[c]) problems.push(m.id + ': door ' + c + ' has no price');
        }
        else if (c >= '1' && c <= '9') {
          gunsSeen[c] = true;
          if (!m.guns[c]) problems.push(m.id + ': gun slot ' + c + ' has no weapon');
        }
        else if (c !== '#' && c !== '.') {
          problems.push(m.id + ': unknown char "' + c + '" at ' + x + ',' + y);
        }
      }
    });

    if (pCount !== 1) problems.push(m.id + ': expected 1 player start, found ' + pCount);
    if (zCount < 2) problems.push(m.id + ': needs at least 2 spawners');
    Object.keys(m.doors).forEach(function (L) {
      if (!lettersSeen[L]) problems.push(m.id + ': door price ' + L + ' unused in layout');
    });
    Object.keys(m.guns).forEach(function (g) {
      if (!gunsSeen[g]) problems.push(m.id + ': gun meta ' + g + ' unused in layout');
    });
  });
  return problems;
}
