import { Game } from './game';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #stage not found');
}

const game = new Game(canvas);
game.start();

// Dev-only handle so the game can be inspected and hand-stepped from the console
// (requestAnimationFrame is paused whenever the document is hidden).
if (import.meta.env.DEV) {
  (window as unknown as { samarkand: Game }).samarkand = game;
}

// Fade out the boot splash once the first frame is on screen.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById('boot')?.classList.add('gone');
  });
});
