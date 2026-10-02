// NPC だけでレースを回して統計を表示する: node games/turbo-kart/analyze.mjs [level] [npcs]
import { buildTrack } from './src/core/track.js';
import { TRACKS } from './src/core/tracks.js';
import { Race, NPC_NAMES } from './src/core/race.js';
import { forwardSpeed } from './src/core/physics.js';

const level = process.argv[2] || 'normal';
const n = Number(process.argv[3] || 11);
const track = buildTrack(TRACKS[0]);
const race = new Race(track, Array.from({ length: n }, (_, i) => ({ name: NPC_NAMES[i], type: 'npc' })), { laps: 3, level, seed: 7 });
const dt = 1 / 60;
let walls = 0, bumps = 0, grassFrames = 0, maxSpeed = 0, frames = 0;
while (race.state !== 'finished' && race.time < 400) {
  race.step(dt);
  frames++;
  for (const e of race.karts) {
    for (const ev of e.events) { if (ev.type === 'wall') walls++; if (ev.type === 'bump') bumps++; }
    if (e.kart.surface === 'grass') grassFrames++;
    maxSpeed = Math.max(maxSpeed, forwardSpeed(e.kart));
  }
}
console.log(`track ${track.length}m level=${level} time=${race.time.toFixed(1)}s state=${race.state}`);
console.log(`walls=${walls} bumps=${bumps} grass%=${(100 * grassFrames / (frames * n)).toFixed(1)} maxSpeed=${(maxSpeed * 3.6).toFixed(0)}km/h`);
for (const e of race.standings()) {
  console.log(`${String(e.position).padStart(2)} ${e.name.padEnd(7)} ${e.finished ? e.finishTime.toFixed(2) : 'DNF lap ' + e.lap} best=${e.bestLap?.toFixed(2)} laps=${e.lapTimes.map((t) => t.toFixed(1)).join('/')}`);
}
