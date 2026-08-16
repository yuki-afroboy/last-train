/**
 * Development-only tools.
 *
 * Enabled by `npm run dev`, or by appending ?debug=1 to the URL of a build.
 * A production visitor sees nothing and the key handlers are never installed.
 */
export interface DebugHooks {
  forceAnomaly: (id: string | null) => void;
  cycleAnomaly: (dir: number) => void;
  setProgress: (n: number) => void;
  reloadLoop: () => void;
  anomalyIds: () => string[];
}

export class Debug {
  readonly enabled: boolean;
  overlay = false;

  constructor(private hooks: DebugHooks) {
    const q = new URLSearchParams(location.search);
    this.enabled = import.meta.env.DEV || q.get('debug') === '1';
    if (!this.enabled) return;
    this.overlay = true;
    addEventListener('keydown', (e) => this.onKey(e));
    // eslint-disable-next-line no-console
    console.info(
      '[終電0:13 debug] F1 overlay · F2/F3 anomaly prev/next · F4 force normal · ' +
        'F6/F7 progress -/+ · F8 reroll loop',
    );
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.code) {
      case 'F1':
        e.preventDefault();
        this.overlay = !this.overlay;
        break;
      case 'F2':
        e.preventDefault();
        this.hooks.cycleAnomaly(-1);
        break;
      case 'F3':
        e.preventDefault();
        this.hooks.cycleAnomaly(1);
        break;
      case 'F4':
        e.preventDefault();
        this.hooks.forceAnomaly('none');
        break;
      case 'F6':
        e.preventDefault();
        this.hooks.setProgress(-1);
        break;
      case 'F7':
        e.preventDefault();
        this.hooks.setProgress(1);
        break;
      case 'F8':
        e.preventDefault();
        this.hooks.reloadLoop();
        break;
      default:
        break;
    }
  }
}
