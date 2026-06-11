/* Dev-time map checker: run `node tools/check-maps.js`.
   Runs validateMaps() plus reachability checks:
   - with all doors OPEN, every floor/spawner/door tile must be reachable from P
   - with all doors CLOSED, at least one spawner must be reachable (wave 1 needs spawns)
   - with all doors CLOSED, at least one spawner must be UNreachable (locked rooms exist) */

global.window = {};
const fs = require('fs');
const path = require('path');
const load = f => (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
load('maps.js');

const problems = validateMaps();

for (const m of MAPS) {
  const rows = m.layout, H = rows.length, W = rows[0].length;
  const isOpenTile = (c, doorsOpen) =>
    c === '.' || c === 'P' || c === 'Z' || (doorsOpen && c >= 'A' && c <= 'J');

  let px = -1, py = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (rows[y][x] === 'P') { px = x; py = y; }

  function flood(doorsOpen) {
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const q = [[px, py]];
    seen[py][px] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny][nx]) continue;
        if (!isOpenTile(rows[ny][nx], doorsOpen)) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  const open = flood(true), closed = flood(false);
  let closedSpawn = 0, openSpawn = 0, totalSpawn = 0;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = rows[y][x];
    if (isOpenTile(c, true) && !open[y][x])
      problems.push(`${m.id}: tile "${c}" at ${x},${y} unreachable even with all doors open`);
    if (c === 'Z') {
      totalSpawn++;
      if (closed[y][x]) closedSpawn++;
      if (open[y][x]) openSpawn++;
    }
    // every gun station must touch a floor tile reachable with doors open
    if (c >= '1' && c <= '9') {
      const adj = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const nx = x+dx, ny = y+dy;
        return nx>=0 && ny>=0 && nx<W && ny<H && open[ny][nx];
      });
      if (!adj) problems.push(`${m.id}: gun ${c} at ${x},${y} has no reachable adjacent floor`);
    }
  }

  if (closedSpawn === 0) problems.push(`${m.id}: no spawner reachable at start (wave 1 would be empty)`);
  if (closedSpawn === totalSpawn) problems.push(`${m.id}: ALL spawners reachable at start (no locked rooms?)`);
  console.log(`${m.id}: ${W}x${H}, spawners ${closedSpawn}/${totalSpawn} active at start, doors ${Object.keys(m.doors).length}, guns ${Object.keys(m.guns).length}`);
}

if (problems.length) {
  console.error('\nPROBLEMS:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log('\nAll maps valid.');
