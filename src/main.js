import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { DIFF_ORDER } from './core/beatmap.js';
import { SONGS } from './core/songs.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const audio = new AudioEngine();
const game = new Game(renderer, audio);

const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] });
vrButton.addEventListener('click', () => audio.init());
document.body.appendChild(vrButton);

// URL パラメータ（動作確認用）: ?song=1&diff=expert&autoplay=1&autostart=1
const q = new URLSearchParams(location.search);
if (q.has('song')) {
  const i = Number(q.get('song'));
  if (SONGS[i]) game.settings.song = i;
}
if (DIFF_ORDER.includes(q.get('diff'))) game.settings.diff = q.get('diff');
if (q.has('autoplay')) game.settings.autoplay = q.get('autoplay') !== '0';
if (q.has('nofail')) game.settings.noFail = q.get('nofail') !== '0';
game.menu.redraw();
if (q.get('autostart') === '1') game.startSong();

renderer.setAnimationLoop(() => {
  game.update();
  renderer.render(game.scene, game.camera);
});

window.__game = game;
// 自動テスト用: 実時間に依存せず曲の時計を進める
window.__test = {
  start(opts = {}) {
    Object.assign(game.settings, opts);
    let t = 0;
    audio.songTime = () => (audio.lastTime = t);
    audio.advance = (dt) => { t += dt; };
    game.startSong();
  },
  step(sec, fps = 60) {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n && game.state === 'playing'; i++) {
      audio.advance(1 / fps);
      game.update(1 / fps);
    }
    renderer.render(game.scene, game.camera);
    return { state: game.state, t: audio.lastTime, result: game.lastResult || null };
  },
};
