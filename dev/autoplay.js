/**
 * Dev-only autoplay harness.
 *
 * Loaded manually from the console (`import('/dev/autoplay.js')`) to smoke-test the
 * game without a visible browser pane — `requestAnimationFrame` is paused while the
 * document is hidden, so the run is hand-stepped through `game.debugFrame`.
 *
 * Not part of the build: it lives outside `src/` and `public/`.
 */

function makeInput(canvas) {
  const held = new Set();
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

  return {
    setKeys(codes) {
      for (const k of [...held]) if (!codes.includes(k)) { held.delete(k); key('keyup', k); }
      for (const k of codes) if (!held.has(k)) { held.add(k); key('keydown', k); }
    },
    tap(code, game) {
      key('keydown', code);
      game.debugFrame(16);
      key('keyup', code);
    },
    click(x, y, game) {
      const mouse = (type) =>
        canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      mouse('mousemove');
      mouse('mousedown');
      game.debugFrame(16);
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    },
    release() {
      for (const k of [...held]) { held.delete(k); key('keyup', k); }
    },
  };
}

/**
 * Play the game automatically.
 *
 * The bot chases the nearest human, stops inside `chaseDistance` to let the
 * auto-attack fire, dashes when hurt, and always takes the first offered card.
 */
export function autoplay({ ticks = 20000, chaseDistance = 170, dash = true } = {}) {
  const game = window.samarkand;
  if (!game) throw new Error('window.samarkand missing — is this a dev build?');

  const canvas = document.getElementById('stage');
  const input = makeInput(canvas);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  if (game.debugSnapshot().state === 'menu') input.click(640, 300, game);

  const events = [];
  const roomTimes = [];
  let lastRoom = -1;
  let lastCleared = false;
  let lastState = '';
  let roomStart = 0;

  // Stall detection: when position stops changing, sidestep for a few frames so
  // the bot can round a building instead of grinding into it.
  let stuck = 0;
  let lastX = -1;
  let lastY = -1;
  let detour = 0;
  let dashCooldown = 0;

  const steer = (s, tx, ty) => {
    let dx = tx - s.x;
    let dy = ty - s.y;

    if (Math.hypot(s.x - lastX, s.y - lastY) < 0.8) stuck++;
    else stuck = 0;
    lastX = s.x;
    lastY = s.y;

    if (stuck > 10) { detour = 35; stuck = 0; }
    if (detour > 0) { detour--; const swap = dx; dx = -dy; dy = swap; }

    const codes = [];
    if (dx > 18) codes.push('KeyD');
    else if (dx < -18) codes.push('KeyA');
    if (dy > 18) codes.push('KeyS');
    else if (dy < -18) codes.push('KeyW');
    input.setKeys(codes);
  };

  for (let tick = 0; tick < ticks; tick++) {
    const s = game.debugSnapshot();

    if (s.state !== lastState) {
      events.push({ tick, state: s.state, room: s.room, elapsed: Number(s.elapsed.toFixed(1)) });
      lastState = s.state;
    }

    if (s.state === 'cards' || s.state === 'mutation') {
      input.setKeys([]);
      input.tap('Digit1', game);
      continue;
    }
    if (s.state === 'results' || s.state === 'menu') break;
    if (s.state === 'pause') { input.tap('Escape', game); continue; }

    // Skill cards now come from levels, spent whenever the player chooses.
    if (s.pendingLevels > 0) {
      input.setKeys([]);
      input.tap('Enter', game);
      continue;
    }

    if (s.room !== lastRoom) {
      if (lastRoom >= 0) roomTimes.push({ room: lastRoom, seconds: Number((s.elapsed - roomStart).toFixed(1)) });
      roomStart = s.elapsed;
      lastRoom = s.room;
    }
    if (s.cleared && !lastCleared) {
      events.push({ tick, cleared: s.room, elapsed: Number(s.elapsed.toFixed(1)), kills: s.kills, hp: s.hp });
    }
    lastCleared = s.cleared;

    if (dashCooldown > 0) dashCooldown--;

    if (s.cleared) {
      steer(s, s.exit.x, s.exit.y);
    } else if (s.nearestEnemy) {
      const d = Math.hypot(s.nearestEnemy.x - s.x, s.nearestEnemy.y - s.y);
      // Panic dash away when badly hurt and something is on top of us.
      if (dash && dashCooldown === 0 && s.hp < s.maxHp * 0.35 && d < 90) {
        steer(s, s.x - (s.nearestEnemy.x - s.x), s.y - (s.nearestEnemy.y - s.y));
        input.tap('Space', game);
        dashCooldown = 180;
        continue;
      }
      if (d > chaseDistance) steer(s, s.nearestEnemy.x, s.nearestEnemy.y);
      else input.setKeys([]);
    } else {
      input.setKeys([]);
    }

    game.debugFrame(16);
  }

  input.release();
  return { final: game.debugSnapshot(), events, roomTimes, errors };
}

/**
 * Send the current frame to the dev server, which writes it to `dev/shots/<name>`.
 * Scales down by default — full-resolution PNGs are slow to move and rarely needed.
 */
export async function shot(name = 'frame', { scale = 1, png = false } = {}) {
  const source = document.getElementById('stage');
  const target = document.createElement('canvas');
  target.width = Math.round(source.width * scale);
  target.height = Math.round(source.height * scale);
  target.getContext('2d').drawImage(source, 0, 0, target.width, target.height);

  const url = png ? target.toDataURL('image/png') : target.toDataURL('image/jpeg', 0.85);
  const response = await fetch(`/__shot/${name}`, { method: 'POST', body: url });
  return response.text();
}

/**
 * Play forward from the menu and capture one frame.
 *
 * `until` decides when to stop: 'combat' freezes mid-fight, 'cards' on the draft
 * screen, 'cleared' once the settlement falls, 'death' on the results screen.
 */
export async function scene(name, { until = 'combat', ticks = 4000, stopAt = 170 } = {}) {
  const game = window.samarkand;
  const canvas = document.getElementById('stage');
  const input = makeInput(canvas);

  if (game.debugSnapshot().state === 'menu') input.click(640, 300, game);

  for (let tick = 0; tick < ticks; tick++) {
    const s = game.debugSnapshot();

    if (s.state === 'cards' || s.state === 'mutation') {
      if (until === 'cards' || until === 'mutation') break;
      input.setKeys([]);
      input.tap('Digit1', game);
      continue;
    }
    if (s.state === 'results') break;
    if (s.state !== 'playing') { game.debugFrame(16); continue; }

    if (s.cleared && until === 'cleared') break;
    if (until === 'combat' && s.kills >= 2 && s.nearestEnemy) {
      const d = Math.hypot(s.nearestEnemy.x - s.x, s.nearestEnemy.y - s.y);
      if (d < stopAt + 40) break;
    }

    const target = s.cleared ? s.exit : s.nearestEnemy;
    const codes = [];
    if (target) {
      const threshold = s.cleared ? 20 : stopAt;
      if (Math.hypot(target.x - s.x, target.y - s.y) > threshold) {
        if (target.x - s.x > 18) codes.push('KeyD');
        else if (target.x - s.x < -18) codes.push('KeyA');
        if (target.y - s.y > 18) codes.push('KeyS');
        else if (target.y - s.y < -18) codes.push('KeyW');
      }
    }
    input.setKeys(codes);
    game.debugFrame(16);
  }

  input.release();
  for (let i = 0; i < 4; i++) game.debugFrame(16);
  return { snapshot: game.debugSnapshot(), file: await shot(name) };
}

window.autoplay = autoplay;
window.shot = shot;
window.scene = scene;
