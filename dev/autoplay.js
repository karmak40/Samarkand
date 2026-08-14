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
  /** Which stop kinds the bot chose, for checking the map is actually branching. */
  const mapChoices = [];
  /** One purchase per shop visit, keyed by screen and depth. */
  const visitedScreens = new Set();
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

    // Run map: walk the route. Prefer an elite when healthy, a market when hurt —
    // enough of a policy to exercise every branch across a few runs.
    if (s.state === 'map') {
      input.setKeys([]);
      const options = s.options || [];
      if (options.length === 0) break;
      const hurt = s.hp < s.maxHp * 0.5;
      const wanted = hurt
        ? options.find((o) => o.kind === 'market') ?? options[0]
        : options.find((o) => o.kind === 'elite') ?? options[0];
      const ordered = [...options].sort((a, b) => a.lane - b.lane);
      const slot = ordered.indexOf(wanted) + 1;
      input.tap('Digit' + Math.min(3, Math.max(1, slot)), game);
      mapChoices.push(wanted.kind);
      continue;
    }

    // Shops and altars: take the first thing on offer, then leave.
    if (s.state === 'market' || s.state === 'cursed') {
      input.setKeys([]);
      if (visitedScreens.has(s.state + ':' + s.room)) {
        input.tap('Escape', game);
      } else {
        visitedScreens.add(s.state + ':' + s.room);
        input.tap('Digit1', game);
      }
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

    // Detour for a relic when one is closer than the fight, so regression runs
    // actually exercise the temporary-form path.
    const relic = s.relics?.[0];
    const relicDistance = relic ? Math.hypot(relic.x - s.x, relic.y - s.y) : Infinity;
    const enemyDistance = s.nearestEnemy
      ? Math.hypot(s.nearestEnemy.x - s.x, s.nearestEnemy.y - s.y)
      : Infinity;

    if (s.cleared) {
      steer(s, s.exit.x, s.exit.y);
    } else if (relic && relicDistance < Math.max(320, enemyDistance)) {
      steer(s, relic.x, relic.y);
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
  return { final: game.debugSnapshot(), events, roomTimes, mapChoices, errors };
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

    if (s.state === 'map' || s.state === 'market' || s.state === 'cursed') {
      if (until === s.state) break;
      input.setKeys([]);
      // Always take the first option; leaving the market/altar needs its own click,
      // so a purchased-out den falls through to Digit1 doing nothing and we bail.
      input.tap('Digit1', game);
      continue;
    }
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

/**
 * Get into a live run from wherever the game currently is.
 *
 * Hit points are derived from the canvas rect rather than hardcoded, because the
 * embedded pane does not always hand out a 1280x720 viewport, and the backing store
 * may still be 1x1 on the first frames after a reload.
 */
export async function startRun() {
  const game = window.samarkand;
  const canvas = document.getElementById('stage');

  for (let i = 0; i < 40 && canvas.width < 100; i++) {
    game.debugFrame(16);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const rect = canvas.getBoundingClientRect();
  const click = (x, y) => {
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    game.debugFrame(16);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  };

  // Overlay screens (lair, chronicle) sit on top of the menu; back out first.
  for (let i = 0; i < 4; i++) {
    const state = game.debugSnapshot().state;
    if (state !== 'lair' && state !== 'lifetime') break;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    game.debugFrame(16);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', bubbles: true }));
  }

  const state = game.debugSnapshot().state;
  if (state === 'results') click(rect.width / 2 - 110, rect.height - 62);
  else if (state === 'menu') click(rect.width / 2, rect.height * 0.38 + 26);

  for (let i = 0; i < 6; i++) game.debugFrame(16);
  return { canvas: Math.round(rect.width) + 'x' + Math.round(rect.height), state: game.debugSnapshot().state };
}

window.autoplay = autoplay;
window.shot = shot;
window.scene = scene;
window.startRun = startRun;
