import type { Game } from '../game';
import type { Insets } from '../core/safe-area';
import { formatClock, ReelRecorder, saveFile } from './recorder';

/**
 * Reels mode: a studio for shooting promo clips of the game (`?reels` on the URL).
 *
 * The canvas is pinned to a fixed logical frame (so every take is framed the same no
 * matter whose monitor it was shot on), shown scaled down beside a control panel,
 * and recorded straight off the canvas with the game's own audio mixed in. The panel
 * and the safe-zone guides are DOM, not canvas — so they are on screen for whoever
 * is filming and never in the file.
 *
 * Lazily imported by `main.ts`: a normal player's bundle never loads any of this.
 */

export interface ReelFormat {
  id: string;
  label: string;
  /** Logical frame — what the game lays itself out in. */
  width: number;
  height: number;
  /** Export widths offered for this format, largest first. */
  pixelWidths: readonly number[];
  /** Whether short-video apps put their own UI over the edges of this format. */
  vertical: boolean;
}

/**
 * 432×768 is a large phone's logical size: narrow enough for every compact layout the
 * game already has (single-column HUD and card lists), and at 2.5× it is exactly
 * 1080×1920 — the size Reels, TikTok and Shorts all want.
 */
export const REEL_FORMATS: readonly ReelFormat[] = [
  { id: '9x16', label: '9:16 — Reels / TikTok / Shorts', width: 432, height: 768, pixelWidths: [1080, 720], vertical: true },
  { id: '1x1', label: '1:1 — лента', width: 720, height: 720, pixelWidths: [1080, 720], vertical: false },
  { id: '16x9', label: '16:9 — YouTube / трейлер', width: 1280, height: 720, pixelWidths: [1920, 1280], vertical: false },
];

/**
 * Where short-video apps draw over a 9:16 video, as fractions of the frame: the
 * account/tab header at the top, caption and music at the bottom, the like/comment
 * column on the right. Rounded up from Instagram's and TikTok's own templates, which
 * differ by a few percent — the stricter of the two wins.
 */
export const PLATFORM_OVERLAY = { top: 0.11, bottom: 0.22, left: 0.04, right: 0.14 } as const;

/** Insets that keep the HUD clear of the platform's UI, or a small margin without it. */
export function reelInsets(format: ReelFormat, platformSafe: boolean): Insets {
  if (!format.vertical || !platformSafe) return { top: 8, right: 8, bottom: 8, left: 8 };
  return {
    top: Math.round(format.height * PLATFORM_OVERLAY.top),
    bottom: Math.round(format.height * PLATFORM_OVERLAY.bottom),
    left: Math.round(format.width * PLATFORM_OVERLAY.left),
    right: Math.round(format.width * PLATFORM_OVERLAY.right),
  };
}

interface Scene {
  label: string;
  start: (game: Game) => void;
}

const LAST = 11;

const SCENES: readonly Scene[] = [
  { label: 'Деревня', start: (g) => g.startReelsScene(1, 0) },
  { label: 'Деревня, глубже', start: (g) => g.startReelsScene(1, 6) },
  { label: 'Босс деревни', start: (g) => g.startReelsScene(1, LAST) },
  { label: 'Военный лагерь', start: (g) => g.startReelsScene(2, 5) },
  { label: 'Собор', start: (g) => g.startReelsScene(3, 5) },
  { label: 'Финальный босс', start: (g) => g.startReelsScene(3, LAST) },
  { label: 'Орда', start: (g) => g.startReelsHorde(3) },
];

const SPEEDS = [1, 0.5, 0.25] as const;
const DURATIONS = [15, 30, 60, 90] as const;
const PANEL_WIDTH = 280;

const STYLE = `
  body.reels #app { right: ${PANEL_WIDTH}px; display: grid; place-items: center; background: #030305; }
  body.reels #stage { outline: 1px solid #2a2530; }
  #reels-guides { position: fixed; pointer-events: none; z-index: 5; display: none; }
  #reels-guides div { position: absolute; background: rgba(192, 52, 60, 0.18); border: 1px dashed rgba(216, 161, 58, 0.55); box-sizing: border-box; }
  #reels-panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: ${PANEL_WIDTH}px; overflow-y: auto;
    background: #0d0c10; border-left: 1px solid #2a2530; color: #e8e2d4; z-index: 20;
    font: 13px/1.35 system-ui, sans-serif; padding: 14px 14px 24px; box-sizing: border-box;
  }
  #reels-panel h1 { font: 600 15px Georgia, serif; letter-spacing: 0.2em; color: #c0343c; margin: 0 0 2px; }
  #reels-panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #8b8578; margin: 16px 0 6px; }
  #reels-panel p { color: #8b8578; margin: 0 0 4px; font-size: 12px; }
  #reels-panel .row { display: flex; flex-wrap: wrap; gap: 6px; }
  #reels-panel button, #reels-panel select {
    background: #1b1920; color: #e8e2d4; border: 1px solid #36303d; border-radius: 6px;
    padding: 6px 9px; font: inherit; cursor: pointer;
  }
  #reels-panel select { width: 100%; }
  #reels-panel button:hover { border-color: #d8a13a; }
  #reels-panel button.on { background: #3a2a14; border-color: #d8a13a; color: #f3d9a4; }
  #reels-panel label { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }
  #reels-panel input[type=range] { width: 100%; }
  #reels-panel kbd { font: 11px ui-monospace, monospace; color: #d8a13a; }
  #reels-record { width: 100%; font-size: 15px !important; padding: 10px !important; margin-top: 4px; }
  #reels-record.live { background: #5a1418 !important; border-color: #c0343c !important; }
  #reels-status { margin-top: 8px; min-height: 1.3em; color: #d8a13a; font-variant-numeric: tabular-nums; }
`;

export function startReels(game: Game): void {
  document.body.classList.add('reels');
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  let format = REEL_FORMATS[0]!;
  let pixelWidth = format.pixelWidths[0]!;
  let platformSafe = true;
  let showGuides = true;
  let maxSeconds: number = DURATIONS[1];

  game.cinema.active = true;
  const canvas = game.canvas;
  const app = document.getElementById('app')!;

  const guides = document.createElement('div');
  guides.id = 'reels-guides';
  const guideEdges = ['top', 'bottom', 'right', 'left'].map(() => document.createElement('div'));
  guides.append(...guideEdges);
  document.body.appendChild(guides);

  /** Size the canvas element to fit beside the panel, keeping the format's ratio. */
  const layout = (): void => {
    const room = app.getBoundingClientRect();
    const margin = 24;
    const scale = Math.min((room.width - margin * 2) / format.width, (room.height - margin * 2) / format.height);
    const w = Math.max(1, Math.floor(format.width * scale));
    const h = Math.max(1, Math.floor(format.height * scale));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Guides sit over the canvas in page space, sized from the same fractions the
    // HUD insets come from, so what they mark is exactly what the HUD avoids.
    const on = showGuides && format.vertical;
    guides.style.display = on ? 'block' : 'none';
    if (!on) return;
    const box = canvas.getBoundingClientRect();
    Object.assign(guides.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${w}px`, height: `${h}px` });
    const [top, bottom, right, left] = guideEdges as [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement];
    const o = PLATFORM_OVERLAY;
    Object.assign(top.style, { left: '0', top: '0', width: '100%', height: `${o.top * 100}%` });
    Object.assign(bottom.style, { left: '0', bottom: '0', width: '100%', height: `${o.bottom * 100}%` });
    Object.assign(right.style, { right: '0', top: `${o.top * 100}%`, width: `${o.right * 100}%`, height: `${(1 - o.top - o.bottom) * 100}%` });
    Object.assign(left.style, { left: '0', top: `${o.top * 100}%`, width: `${o.left * 100}%`, height: `${(1 - o.top - o.bottom) * 100}%` });
  };

  const applyViewport = (): void => {
    game.setFixedViewport({
      width: format.width,
      height: format.height,
      pixelWidth,
      safe: reelInsets(format, platformSafe),
    });
    layout();
  };

  window.addEventListener('resize', layout);

  // ---- panel -----------------------------------------------------------------

  const panel = document.createElement('div');
  panel.id = 'reels-panel';
  document.body.appendChild(panel);

  const section = (title: string): HTMLDivElement => {
    const h = document.createElement('h2');
    h.textContent = title;
    panel.appendChild(h);
    const row = document.createElement('div');
    row.className = 'row';
    panel.appendChild(row);
    return row;
  };

  /**
   * Buttons never take focus. A focused button would also receive the Space the
   * player presses to dash, and fire itself again mid-take.
   */
  const button = (parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.textContent = text;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  const toggle = (parent: HTMLElement, text: string, initial: boolean, onChange: (on: boolean) => void): (() => void) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.tabIndex = -1;
    box.checked = initial;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('change', () => onChange(box.checked));
    label.append(box, text);
    parent.appendChild(label);
    return () => {
      box.checked = !box.checked;
      onChange(box.checked);
    };
  };

  const select = <T>(parent: HTMLElement, options: ReadonlyArray<{ label: string; value: T }>, initial: number, onChange: (value: T) => void): HTMLSelectElement => {
    const s = document.createElement('select');
    s.tabIndex = -1;
    options.forEach((o, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = o.label;
      s.appendChild(opt);
    });
    s.selectedIndex = initial;
    s.addEventListener('change', () => {
      onChange(options[s.selectedIndex]!.value);
      s.blur();
    });
    parent.appendChild(s);
    return s;
  };

  const title = document.createElement('h1');
  title.textContent = 'SAMARKAND · СЪЁМКА';
  panel.appendChild(title);
  const intro = document.createElement('p');
  intro.textContent = 'Играй как обычно (WASD, пробел). Панель и красные зоны в запись не попадают.';
  panel.appendChild(intro);

  // Frame.
  const frameRow = section('Кадр');
  let qualitySelect: HTMLSelectElement | null = null;
  const qualityOptions = (): Array<{ label: string; value: number }> =>
    format.pixelWidths.map((w) => ({ label: `${w}×${Math.round((w * format.height) / format.width)}`, value: w }));
  select(frameRow, REEL_FORMATS.map((f) => ({ label: f.label, value: f })), 0, (f) => {
    if (recorder.recording) return;
    format = f;
    pixelWidth = f.pixelWidths[0]!;
    rebuildQuality();
    applyViewport();
  });
  const qualityHolder = document.createElement('div');
  qualityHolder.style.width = '100%';
  frameRow.appendChild(qualityHolder);
  const rebuildQuality = (): void => {
    qualitySelect?.remove();
    qualitySelect = select(qualityHolder, qualityOptions(), 0, (w) => {
      if (recorder.recording) return;
      pixelWidth = w;
      applyViewport();
    });
  };
  rebuildQuality();

  const toggleHud = toggle(panel, 'Скрыть интерфейс игры (H)', false, (on) => {
    game.cinema.hideHud = on;
  });
  toggle(panel, 'HUD вне зоны кнопок соцсетей', platformSafe, (on) => {
    platformSafe = on;
    applyViewport();
  });
  toggle(panel, 'Показывать зоны соцсетей', showGuides, (on) => {
    showGuides = on;
    layout();
  });

  const zoomLabel = document.createElement('p');
  zoomLabel.textContent = 'Приближение: 1.0×';
  panel.appendChild(zoomLabel);
  const zoom = document.createElement('input');
  zoom.type = 'range';
  zoom.min = '0.6';
  zoom.max = '1.8';
  zoom.step = '0.05';
  zoom.value = '1';
  zoom.tabIndex = -1;
  zoom.addEventListener('input', () => {
    game.setZoomScale(Number(zoom.value));
    zoomLabel.textContent = `Приближение: ${Number(zoom.value).toFixed(2)}×`;
  });
  zoom.addEventListener('change', () => zoom.blur());
  panel.appendChild(zoom);

  const speedRow = section('Скорость (T)');
  const speedButtons = SPEEDS.map((speed) =>
    button(speedRow, speed === 1 ? '1×' : `${speed}× замедл.`, () => setSpeed(speed)),
  );
  const setSpeed = (speed: number): void => {
    game.cinema.timeScale = speed;
    SPEEDS.forEach((s, i) => speedButtons[i]!.classList.toggle('on', s === speed));
  };
  setSpeed(1);

  // Scene.
  const sceneRow = section('Сцена — сразу в бой');
  for (const scene of SCENES) button(sceneRow, scene.label, () => scene.start(game));

  // Monster.
  const monsterRow = section('Монстр');
  button(monsterRow, 'Эволюция: +3 карты, +2 мутации', () => game.reelsEvolve(3, 2));
  button(monsterRow, 'Усилить ×12', () => game.reelsEmpower());
  toggle(panel, 'Бессмертие', false, (on) => {
    game.cinema.immortal = on;
  });

  // Recording.
  const recordRow = section('Запись');
  select(
    recordRow,
    DURATIONS.map((d) => ({ label: `Автостоп через ${d} с`, value: d })),
    DURATIONS.indexOf(maxSeconds as (typeof DURATIONS)[number]),
    (d) => {
      maxSeconds = d;
    },
  );
  const recordButton = button(panel, '● Начать запись (R)', () => toggleRecording());
  recordButton.id = 'reels-record';
  const status = document.createElement('div');
  status.id = 'reels-status';
  panel.appendChild(status);

  const keys = document.createElement('p');
  keys.innerHTML = '<kbd>R</kbd> запись · <kbd>H</kbd> интерфейс · <kbd>T</kbd> скорость';
  keys.style.marginTop = '14px';
  panel.appendChild(keys);

  const recorder = new ReelRecorder(canvas, { fps: 60, videoBitsPerSecond: 16_000_000 }, (file, name) => {
    saveFile(file, name);
    status.textContent = `Сохранено: ${name} (${(file.size / 1_048_576).toFixed(1)} МБ)`;
  });

  if (!ReelRecorder.supported) {
    recordButton.disabled = true;
    status.textContent = 'Этот браузер не умеет записывать видео — нужен Chrome, Edge или Firefox.';
  }

  const toggleRecording = (): void => {
    if (!ReelRecorder.supported) return;
    if (recorder.recording) {
      recorder.stop();
      recordButton.textContent = '● Начать запись (R)';
      recordButton.classList.remove('live');
      return;
    }
    try {
      recorder.start(game.captureAudio());
    } catch (error) {
      status.textContent = String(error);
      return;
    }
    recordButton.textContent = '■ Остановить (R)';
    recordButton.classList.add('live');
  };

  // Timer and auto-stop. setInterval rather than the game loop: it has to keep
  // counting even while the game is paused or sitting on a menu.
  setInterval(() => {
    if (!recorder.recording) return;
    const t = recorder.elapsed;
    status.textContent = `● ${formatClock(t)} / ${formatClock(maxSeconds)}`;
    if (t >= maxSeconds) toggleRecording();
  }, 200);

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyR') toggleRecording();
    else if (e.code === 'KeyH') toggleHud();
    else if (e.code === 'KeyT') {
      const next = SPEEDS[(SPEEDS.indexOf(game.cinema.timeScale as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
      setSpeed(next);
    }
  });

  applyViewport();
}
