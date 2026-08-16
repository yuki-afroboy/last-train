import type { Settings, Quality } from '../core/Settings';
import type { SaveManager } from '../core/Save';

type Layer = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'result' | 'inspect' | 'touch';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * All DOM overlay handling. The 3D layer never touches the DOM and the DOM
 * never touches three.js — the game talks to this class through callbacks.
 */
export class UI {
  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onQuitToTitle: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onSettingsChanged: ((k: keyof Settings['data'], v: unknown) => void) | null = null;
  onCloseInspect: (() => void) | null = null;

  private subtitleTimer = 0;
  private settingsReturn: Layer = 'title';

  constructor(
    private settings: Settings,
    private save: SaveManager,
  ) {
    this.bind();
    this.syncSettings();
  }

  /* ------------------------------------------------------------ layers */

  show(layer: Layer): void {
    $(layer).classList.remove('hidden');
  }
  hide(layer: Layer): void {
    $(layer).classList.add('hidden');
  }
  hideAll(...layers: Layer[]): void {
    for (const l of layers) this.hide(l);
  }

  setBootProgress(v: number, note?: string): void {
    $('boot-bar-fill').style.width = `${Math.round(v * 100)}%`;
    if (note) $('boot-note').textContent = note;
  }

  showTitle(): void {
    this.hideAll('boot', 'hud', 'pause', 'settings', 'result', 'inspect');
    this.show('title');
    const d = this.save.data;
    const bits: string[] = [];
    if (d.cleared) bits.push(`CLEARED ×${d.clearCount}`);
    if (d.bestProgress > 0) bits.push(`BEST ${d.bestProgress} / 8`);
    if (d.foundAnomalies.length > 0) bits.push(`ANOMALIES ${d.foundAnomalies.length}`);
    $('title-record').textContent = bits.join('   ·   ');
  }

  showGame(touch: boolean): void {
    this.hideAll('title', 'boot', 'pause', 'settings', 'result', 'inspect');
    this.show('hud');
    if (touch) this.show('touch');
  }

  showPause(progress: number, strikes: number, seed: string): void {
    $('pause-stats').textContent = `出口まで ${Math.max(0, 8 - progress)}\n見落とし ${strikes} / 3\nSEED ${seed}`;
    this.show('pause');
  }

  hidePause(): void {
    this.hide('pause');
  }

  openSettings(from: Layer): void {
    this.settingsReturn = from;
    this.syncSettings();
    this.show('settings');
  }

  showResult(kind: 'clear' | 'over', clock: string, title: string, body: string): void {
    $('result-clock').textContent = clock;
    $('result-title').textContent = title;
    $('result-body').textContent = body;
    $<HTMLButtonElement>('btn-retry').textContent = kind === 'clear' ? 'もう一度 乗り遅れる' : 'もう一度';
    this.hideAll('hud', 'pause', 'settings', 'inspect', 'touch');
    this.show('result');
  }

  /* --------------------------------------------------------------- hud */

  setPrompt(text: string | null): void {
    const el = $('prompt');
    const ret = $('reticle');
    if (text) {
      el.innerHTML = text;
      el.classList.remove('hidden');
      ret.classList.add('active');
    } else {
      el.classList.add('hidden');
      ret.classList.remove('active');
    }
  }

  flashProgress(text: string): void {
    const el = $('progress-flash');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  subtitle(text: string, ms = 5000): void {
    const el = $('subtitle');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  clearSubtitle(): void {
    $('subtitle').classList.remove('show');
    clearTimeout(this.subtitleTimer);
  }

  setAlert(on: boolean): void {
    $('vignette-alert').classList.toggle('on', on);
  }

  openInspect(title: string, body: string): void {
    $('inspect-title').textContent = title;
    $('inspect-body').textContent = body;
    this.show('inspect');
  }

  closeInspect(): void {
    this.hide('inspect');
  }

  get inspectOpen(): boolean {
    return !$('inspect').classList.contains('hidden');
  }

  setDebug(text: string | null): void {
    const el = $('debug');
    if (text === null) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = text;
  }

  /* ------------------------------------------------------------ wiring */

  private bind(): void {
    $('btn-start').addEventListener('click', () => this.onStart?.());
    $('btn-settings').addEventListener('click', () => this.openSettings('title'));
    $('btn-settings2').addEventListener('click', () => this.openSettings('pause'));
    $('btn-resume').addEventListener('click', () => this.onResume?.());
    $('btn-quit').addEventListener('click', () => this.onQuitToTitle?.());
    $('btn-retry').addEventListener('click', () => this.onRetry?.());
    $('btn-result-title').addEventListener('click', () => this.onQuitToTitle?.());
    $('btn-settings-back').addEventListener('click', () => {
      this.hide('settings');
      if (this.settingsReturn === 'title') this.showTitle();
    });
    $('inspect').addEventListener('click', () => this.onCloseInspect?.());
    $('tbtn-menu').addEventListener('click', () => this.onResume?.());

    const seg = (id: string, key: keyof Settings['data'], map: (v: string) => unknown): void => {
      $(id).addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        const v = map(btn.dataset.v!);
        this.settings.set(key as never, v as never);
        this.onSettingsChanged?.(key, v);
        this.syncSettings();
      });
    };
    seg('seg-quality', 'quality', (v) => v as Quality);
    seg('seg-invert', 'invertY', (v) => v === 'on');

    const range = (id: string, key: keyof Settings['data'], scale = 1): void => {
      $(id).addEventListener('input', (e) => {
        const v = parseFloat((e.target as HTMLInputElement).value) * scale;
        this.settings.set(key as never, v as never);
        this.onSettingsChanged?.(key, v);
        this.syncSettings();
      });
    };
    range('in-sens', 'sensitivity');
    range('in-vol', 'volume');
    range('in-fov', 'fov');
    range('in-bob', 'bob');
  }

  private syncSettings(): void {
    const d = this.settings.data;
    for (const [segId, value] of [
      ['seg-quality', d.quality],
      ['seg-invert', d.invertY ? 'on' : 'off'],
    ] as const) {
      for (const b of $(segId).querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.v === value);
      }
    }
    $<HTMLInputElement>('in-sens').value = String(d.sensitivity);
    $<HTMLInputElement>('in-vol').value = String(d.volume);
    $<HTMLInputElement>('in-fov').value = String(d.fov);
    $<HTMLInputElement>('in-bob').value = String(d.bob);
    $('v-sens').textContent = d.sensitivity.toFixed(2);
    $('v-vol').textContent = Math.round(d.volume * 100) + '%';
    $('v-fov').textContent = String(Math.round(d.fov));
    $('v-bob').textContent = Math.round(d.bob * 100) + '%';
  }
}
