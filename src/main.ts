import './ui/styles.css';
import { Game } from './core/Game';
import { Settings } from './core/Settings';
import { SaveManager } from './core/Save';
import { UI } from './ui/UI';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const settings = new Settings();
const save = new SaveManager();
const ui = new UI(settings, save);
const game = new Game(canvas, settings, save);

function fatal(message: string): void {
  ui.setBootProgress(1, 'ERROR');
  const note = document.getElementById('boot-note');
  if (note) {
    note.textContent = message;
    note.style.color = '#c86a6a';
    note.style.letterSpacing = '0.1em';
  }
}

// WebGL is the one hard requirement; fail with a readable message rather than
// a blank screen if the visitor's browser or GPU blocklist says no.
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  fatal('WebGL を利用できません。別のブラウザでお試しください。');
} else {
  game.load(ui).catch((err: unknown) => {
    console.error(err);
    fatal('読み込みに失敗しました。ページを再読み込みしてください。');
  });
}

// Pause cleanly when the tab goes away — otherwise the audio keeps running and
// the first frame back has a multi-second delta.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
});
