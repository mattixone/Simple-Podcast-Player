// Game state, player, input and the main loop.
import { CONFIG as C } from './config.js';
import * as G from './geometry.js';
import * as W from './world.js';
import { render, screenToWorld } from './render.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const overlayHelp = document.getElementById('overlay-help');
const playButton = document.getElementById('play');

// Radius you respawn at for each checkpoint (index 0 = the start).
const CHECKPOINT_R = [C.START_R, ...C.RINGS.map((r) => r + 90)];

const state = {
  mode: 'title',         // 'title' | 'play' | 'won'
  tiles: [],
  player: null,
  cam: { x: 0, y: 0, angle: 0, shake: 0 },
  checkpoint: 0,
  best: 0,
  falls: 0,
  time: 0,
  particles: [],
  trail: [],
  trailTimer: 0,
  pulses: [],            // expanding rings when a checkpoint is reached
  message: null,         // { text, t }
  pointer: null,         // last mouse position in screen space (for the aim reticle)
  view: { w: 0, h: 0, dpr: 1 },
};
window.game = state; // handy for poking at from the dev console

// ---- Setup ----

function spawnSafeTile(r) {
  const th = Math.random() * G.TAU;
  const x = Math.cos(th) * r, y = Math.sin(th) * r;
  const tile = W.createTile(x, y, 115);
  state.tiles = state.tiles.filter(
    (t) => Math.hypot(t.x - x, t.y - y) > (t.radius + tile.radius) * 0.8
  );
  state.tiles.push(tile);
  return tile;
}

function putPlayerOn(tile) {
  state.player = { mode: 'tile', tile, lx: 0, ly: 0, x: tile.x, y: tile.y, jump: null, fallT: 0 };
}

function newGame() {
  state.tiles = [];
  W.populate(state.tiles);
  putPlayerOn(spawnSafeTile(C.START_R));
  state.checkpoint = 0;
  state.best = C.START_R;
  state.falls = 0;
  state.time = 0;
  state.particles = [];
  state.trail = [];
  state.pulses = [];
  state.cam.x = state.player.x;
  state.cam.y = state.player.y;
  state.cam.angle = -Math.PI / 2 - Math.atan2(state.player.y, state.player.x);
  state.mode = 'play';
  overlay.hidden = true;
  say('Reach the rim');
}

function say(text) {
  state.message = { text, t: 0 };
}

function burst(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * G.TAU, s = speed * (0.3 + Math.random());
    const life = 0.4 + Math.random() * 0.5;
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

// ---- Player actions ----

function jumpTo(tx, ty) {
  const p = state.player;
  if (p.mode !== 'tile') return;
  let dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) return;
  if (d > C.JUMP_RANGE) {
    dx *= C.JUMP_RANGE / d;
    dy *= C.JUMP_RANGE / d;
  }
  p.mode = 'air';
  p.tile = null;
  p.jump = { sx: p.x, sy: p.y, tx: p.x + dx, ty: p.y + dy, t: 0 };
}

function land() {
  const p = state.player;
  // Smaller tiles are drawn on top, so they win when tiles overlap.
  let best = null;
  for (const t of state.tiles) {
    if (!t.rubble && W.containsPoint(t, p.x, p.y) && (!best || t.area < best.area)) best = t;
  }
  if (!best) return fall();
  const l = W.toLocal(best, p.x, p.y);
  p.mode = 'tile';
  p.tile = best;
  p.lx = l.x;
  p.ly = l.y;
  W.startCrack(best, l.x, l.y);
  burst(p.x, p.y, 8, 'rgba(220,230,255,', 60);
  checkProgress();
}

function fall() {
  const p = state.player;
  p.mode = 'falling';
  p.tile = null;
  p.fallT = 0;
  state.falls++;
  say('Lost to the vortex');
}

function respawn() {
  putPlayerOn(spawnSafeTile(CHECKPOINT_R[state.checkpoint]));
  state.trail.push(null); // break the minimap trail instead of drawing a line across
  say(state.checkpoint ? `Back to checkpoint ${state.checkpoint}` : 'Try again');
}

function checkProgress() {
  const p = state.player;
  const r = Math.hypot(p.x, p.y);
  state.best = Math.max(state.best, r);
  for (let i = state.checkpoint; i < C.RINGS.length; i++) {
    if (r >= C.RINGS[i]) {
      state.checkpoint = i + 1;
      state.pulses.push({ r: C.RINGS[i], t: 0 });
      say(`Checkpoint ${i + 1}`);
    }
  }
  if (r >= C.RIM) win();
}

function win() {
  state.mode = 'won';
  const secs = Math.round(state.time);
  overlayTitle.textContent = 'You escaped the vortex!';
  overlayText.textContent = `${Math.floor(secs / 60)}m ${secs % 60}s · ${state.falls} fall${state.falls === 1 ? '' : 's'}`;
  overlayHelp.hidden = true;
  playButton.textContent = 'Play again';
  overlay.hidden = false;
}

// ---- Update ----

function updateTiles(dt) {
  const p = state.player;
  const next = [];
  for (const t of state.tiles) {
    W.updateTile(t, dt);

    if (t.crack && t.crack.t >= t.crack.duration) {
      const frags = W.shatter(t);
      const w = W.toWorld(t, t.crack.ix, t.crack.iy);
      burst(w.x, w.y, 14, 'rgba(255,200,140,', 90);
      if (p.tile === t) {
        const home = frags.find((f) => G.pointInPolygon(p.lx, p.ly, f.srcCell));
        if (home && !home.rubble) {
          p.tile = home;
          p.lx -= home.srcCenter.x;
          p.ly -= home.srcCenter.y;
        } else {
          fall();
        }
        state.cam.shake = 8;
      }
      for (const f of frags) { delete f.srcCell; next.push(f); }
      continue;
    }

    const swallowed = Math.hypot(t.x, t.y) < C.CORE_R;
    if (swallowed || (t.rubble && t.fade <= 0)) {
      if (p.tile === t) fall();
      continue;
    }
    next.push(t);
  }
  state.tiles = next;
  W.feedRim(state.tiles);
}

function updatePlayer(dt) {
  const p = state.player;
  if (p.mode === 'tile') {
    const w = W.toWorld(p.tile, p.lx, p.ly);
    p.x = w.x;
    p.y = w.y;
  } else if (p.mode === 'air') {
    const j = p.jump;
    j.t += dt;
    const k = Math.min(1, j.t / C.AIR_TIME);
    p.x = G.lerp(j.sx, j.tx, k);
    p.y = G.lerp(j.sy, j.ty, k);
    if (k >= 1) land();
  } else if (p.mode === 'falling') {
    p.fallT += dt;
    W.driftPoint(p, C.MIN_AREA, dt * 3); // sucked in fast, like the tiniest shard
    if (p.fallT >= C.FALL_TIME) respawn();
  }

  state.trailTimer -= dt;
  if (state.trailTimer <= 0 && p.mode !== 'falling') {
    state.trailTimer = 0.25;
    state.trail.push({ x: p.x, y: p.y });
    if (state.trail.length > 200) state.trail.shift();
  }
}

function updateCamera(dt) {
  const p = state.player, cam = state.cam;
  const follow = 1 - Math.exp(-8 * dt);
  cam.x += (p.x - cam.x) * follow;
  cam.y += (p.y - cam.y) * follow;
  // Rotate the view so "outward" always points up the screen.
  const target = -Math.PI / 2 - Math.atan2(cam.y, cam.x);
  cam.angle += G.wrapAngle(target - cam.angle) * (1 - Math.exp(-4 * dt));
  cam.shake *= Math.exp(-10 * dt);
}

function updateEffects(dt) {
  for (const q of state.particles) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.life -= dt;
  }
  state.particles = state.particles.filter((q) => q.life > 0);
  for (const pulse of state.pulses) pulse.t += dt;
  state.pulses = state.pulses.filter((pulse) => pulse.t < 1.5);
  if (state.message) {
    state.message.t += dt;
    if (state.message.t > 2.5) state.message = null;
  }
}

// ---- Loop ----

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === 'play') {
    state.time += dt;
    updateTiles(dt);
    updatePlayer(dt);
    updateCamera(dt);
    updateEffects(dt);
  } else if (state.mode === 'title') {
    updateTiles(dt);
    updatePlayer(dt);
    updateCamera(dt);
  }
  if (state.player) render(canvas, state);
  requestAnimationFrame(frame);
}

// ---- Input & sizing ----

function resize() {
  const dpr = window.devicePixelRatio || 1;
  state.view = { w: window.innerWidth, h: window.innerHeight, dpr };
  canvas.width = Math.round(state.view.w * dpr);
  canvas.height = Math.round(state.view.h * dpr);
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'play') return;
  const w = screenToWorld(state, e.clientX, e.clientY);
  jumpTo(w.x, w.y);
});
canvas.addEventListener('pointermove', (e) => {
  state.pointer = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
});
canvas.addEventListener('pointerleave', () => { state.pointer = null; });
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') newGame();
});
window.addEventListener('resize', resize);
playButton.addEventListener('click', newGame);

resize();
// Show a live vortex behind the title card.
state.tiles = [];
W.populate(state.tiles);
putPlayerOn(spawnSafeTile(C.START_R));
state.cam.x = state.player.x;
state.cam.y = state.player.y;
requestAnimationFrame(frame);
