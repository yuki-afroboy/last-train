import type { Settings } from './Settings';

export interface LookDelta {
  x: number;
  y: number;
}

/**
 * Keyboard + pointer-lock + touch input, normalised into a single shape the
 * player controller can read. Owns no game logic — it only reports intent.
 */
export class Input {
  readonly keys = new Set<string>();
  move = { x: 0, y: 0 }; // -1..1, y = forward
  look: LookDelta = { x: 0, y: 0 };
  run = false;
  /** rising-edge interact, cleared by the consumer via consumeInteract() */
  private interactQueued = false;
  pointerLocked = false;
  isTouch = false;

  onEscape: (() => void) | null = null;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  private touchLookId: number | null = null;
  private touchLookLast = { x: 0, y: 0 };
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickKnob: HTMLElement | null = null;
  private enabled = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.keys.clear();
      this.move.x = this.move.y = 0;
      this.look.x = this.look.y = 0;
      this.run = false;
    }
  }

  requestPointerLock(): void {
    if (this.isTouch) return;
    const el = this.canvas as HTMLCanvasElement & {
      requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    // Chromium returns a promise and rejects when the document is not eligible
    // (embedded frames, headless runs). Swallow it — the game stays playable
    // without pointer lock, it just needs a click to re-enter.
    const plain = (): void => {
      try {
        const p = el.requestPointerLock();
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(plain);
      }
    } catch {
      plain();
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  queueInteract(): void {
    this.interactQueued = true;
  }

  /** Consume accumulated look delta (radians already scaled by sensitivity). */
  consumeLook(): LookDelta {
    const out = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return out;
  }

  private bindKeyboard(): void {
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        this.onEscape?.();
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'KeyE') this.interactQueued = true;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      this.updateMoveFromKeys();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.updateMoveFromKeys();
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.updateMoveFromKeys();
    });
  }

  private updateMoveFromKeys(): void {
    if (this.stickId !== null) return; // touch stick owns movement
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.move.y = fwd;
    this.move.x = str;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight');
  }

  private bindMouse(): void {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.onPointerLockChange?.(this.pointerLocked);
    });
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      const s = this.settings.data.sensitivity * 0.0021;
      this.look.x -= e.movementX * s;
      this.look.y -= e.movementY * s * (this.settings.data.invertY ? -1 : 1);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0 && this.pointerLocked) this.interactQueued = true;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindTouch(): void {
    const stick = document.getElementById('stick');
    this.stickKnob = stick?.querySelector('i') ?? null;

    stick?.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        if (this.stickId !== null) return;
        this.stickId = e.pointerId;
        const r = (stick as HTMLElement).getBoundingClientRect();
        this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        stick.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      { passive: false },
    );

    const endStick = (e: PointerEvent) => {
      if (this.stickId !== e.pointerId) return;
      this.stickId = null;
      this.move.x = this.move.y = 0;
      if (this.stickKnob) this.stickKnob.style.transform = '';
      this.updateMoveFromKeys();
    };

    stick?.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.stickId !== e.pointerId) return;
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const max = 52;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, max);
      const nx = (dx / len) * (clamped / max);
      const ny = (dy / len) * (clamped / max);
      this.move.x = nx;
      this.move.y = -ny;
      if (this.stickKnob) {
        this.stickKnob.style.transform = `translate(${(dx / len) * clamped}px, ${(dy / len) * clamped}px)`;
      }
    });
    stick?.addEventListener('pointerup', endStick);
    stick?.addEventListener('pointercancel', endStick);

    // Right half of the screen = look. Uses the canvas so UI buttons keep working.
    this.canvas.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        if (e.pointerType !== 'touch' || !this.enabled) return;
        if (this.touchLookId !== null) return;
        if (e.clientX < innerWidth * 0.4) return;
        this.touchLookId = e.pointerId;
        this.touchLookLast = { x: e.clientX, y: e.clientY };
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        if (e.pointerId !== this.touchLookId || !this.enabled) return;
        const s = this.settings.data.sensitivity * 0.0042;
        this.look.x -= (e.clientX - this.touchLookLast.x) * s;
        this.look.y -= (e.clientY - this.touchLookLast.y) * s * (this.settings.data.invertY ? -1 : 1);
        this.touchLookLast = { x: e.clientX, y: e.clientY };
      },
      { passive: true },
    );
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.touchLookId) this.touchLookId = null;
    };
    this.canvas.addEventListener('pointerup', endLook);
    this.canvas.addEventListener('pointercancel', endLook);

    document.getElementById('tbtn-interact')?.addEventListener('click', () => {
      if (this.enabled) this.interactQueued = true;
    });
    const runBtn = document.getElementById('tbtn-run');
    runBtn?.addEventListener('click', () => {
      this.run = !this.run;
      runBtn.classList.toggle('on', this.run);
      runBtn.textContent = this.run ? '歩く' : '走る';
    });
  }
}
