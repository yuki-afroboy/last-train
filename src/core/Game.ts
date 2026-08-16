import * as THREE from 'three';
import { RendererSystem } from '../gfx/Renderer';
import { MaterialLibrary } from '../gfx/Materials';
import { buildNightEnvironment } from '../gfx/Environment';
import { Station, STATION } from '../world/Station';
import { L, MAX_STRIKES, TARGET_PROGRESS } from '../world/Layout';
import { setTrainDoors } from '../world/Actors';
import { applyClockTime } from '../world/Props';
import { Player } from '../player/Player';
import { AudioSystem } from '../audio/AudioSystem';
import { AnomalyManager } from '../anomaly/AnomalyManager';
import type { AnomalyContext } from '../anomaly/types';
import { UI } from '../ui/UI';
import { Input } from './Input';
import { Settings } from './Settings';
import { SaveManager } from './Save';
import { RNG } from './RNG';
import { Debug } from './Debug';

type Phase = 'boot' | 'title' | 'playing' | 'paused' | 'transition' | 'ending' | 'gameover' | 'result';

const NORMAL_ANNOUNCEMENTS = [
  '本日の運転は、終了いたしました。\nご利用ありがとうございました。',
  'ホームは滑りやすくなっております。\n足元にご注意ください。',
  '白線の内側まで、お下がりください。',
];

/**
 * Game orchestration: phases, the loop/judgement rules, scripted sequences and
 * the per-frame wiring between input, player, station, anomalies and audio.
 */
export class Game {
  private gfx!: RendererSystem;
  private mats = new MaterialLibrary();
  private station!: Station;
  private player!: Player;
  private audio = new AudioSystem();
  private anomalies!: AnomalyManager;
  private input!: Input;
  private ui!: UI;
  private debug!: Debug;
  private rng = new RNG();

  private phase: Phase = 'boot';
  private progress = 0;
  private strikes = 0;
  private loopElapsed = 0;
  private judged = false;

  private fade = 1;
  private fadeTarget = 1;
  private fadeSpeed = 1;
  private distort = 0;
  private distortTarget = 0;

  private timers: { t: number; resolve: () => void }[] = [];
  private sequenceToken = 0;

  private nextTrainAt = 30;
  private nextThunderAt = 55;
  private nextCreakAt = 22;
  private ambientClock = 0;

  private titleT = 0;
  private hoveredId: string | null = null;
  private qualityWatchdog = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: Settings,
    private save: SaveManager,
  ) {}

  /* ================================================================ load */

  async load(ui: UI): Promise<void> {
    this.ui = ui;
    const step = async (v: number, note: string): Promise<void> => {
      ui.setBootProgress(v, note);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    };

    await step(0.05, 'RENDERER');
    this.gfx = new RendererSystem(this.canvas, this.settings.profile, this.settings.data.fov);

    await step(0.18, 'ENVIRONMENT');
    const env = buildNightEnvironment(this.gfx.renderer);
    this.mats.applyEnv(env.envMap);
    this.gfx.scene.environment = env.envMap;
    this.gfx.scene.environmentIntensity = 0.65;

    await step(0.3, 'MATERIALS');
    // touch every material once so all canvas textures are generated up front
    void [
      this.mats.concrete,
      this.mats.concreteWet,
      this.mats.tactile,
      this.mats.wall,
      this.mats.ballast,
      this.mats.wetGround,
      this.mats.steel,
      this.mats.railSteel,
      this.mats.darkSteel,
      this.mats.roofMetal,
      this.mats.wood,
      this.mats.glass,
      this.mats.rubber,
    ];

    await step(0.55, 'STATION');
    this.station = new Station(this.mats, this.settings.profile, this.gfx.scene);
    this.station.build();

    this.gfx.onResize = (_w, h) => this.station.rain.onResize(h);

    await step(0.85, 'SYSTEMS');
    this.input = new Input(this.canvas, this.settings);
    this.player = new Player(this.gfx.camera, this.input, this.settings, this.station);
    this.anomalies = new AnomalyManager(this.rng);
    this.player.onFootstep = (running) => {
      const onStairs = Math.abs(this.player.position.x / this.station.stretch) > 19.6;
      this.audio.footstep(running, onStairs);
    };
    this.audio.onSubtitle = (t, ms) => this.ui.subtitle(t, ms);

    this.wireUI();
    this.installDebug();

    await step(1, 'READY');
    this.phase = 'title';
    this.player.reset();
    ui.showTitle();
    this.fade = 0;
    this.fadeTarget = 0;
    requestAnimationFrame(this.frame);
  }

  private wireUI(): void {
    this.ui.onStart = () => void this.startRun();
    this.ui.onResume = () => this.setPaused(false);
    this.ui.onRetry = () => void this.startRun();
    this.ui.onQuitToTitle = () => this.quitToTitle();
    this.ui.onCloseInspect = () => this.closeInspect();

    this.ui.onSettingsChanged = (key, v) => {
      if (key === 'quality') {
        this.gfx.applyProfile(this.settings.profile);
        this.ui.subtitle('グラフィック設定は次回のリロードで完全に反映されます', 3200);
      }
      if (key === 'fov') this.gfx.setFov(v as number);
      if (key === 'volume') this.audio.setVolume(v as number);
    };

    this.input.onEscape = () => {
      if (this.ui.inspectOpen) {
        this.closeInspect();
        return;
      }
      // Settings sits above everything; ESC must back out of it rather than
      // resume the game underneath it.
      if (this.ui.settingsOpen) {
        this.ui.dismissSettings();
        return;
      }
      if (this.phase === 'playing') this.setPaused(true);
      else if (this.phase === 'paused') this.setPaused(false);
    };

    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.phase === 'playing' && !this.input.isTouch) this.setPaused(true);
    };

    this.audio.setVolume(this.settings.data.volume);
  }

  private installDebug(): void {
    let index = -1;
    this.debug = new Debug({
      anomalyIds: () => this.anomalies.registry.map((a) => a.id),
      forceAnomaly: (id) => {
        this.anomalies.forcedId = id;
        void this.beginLoop(false);
      },
      cycleAnomaly: (dir) => {
        const ids = this.anomalies.registry.map((a) => a.id);
        index = (index + dir + ids.length) % ids.length;
        this.anomalies.forcedId = ids[index];
        void this.beginLoop(false);
      },
      setProgress: (d) => {
        this.progress = THREE.MathUtils.clamp(this.progress + d, 0, TARGET_PROGRESS - 1);
        void this.beginLoop(false);
      },
      reloadLoop: () => void this.beginLoop(false),
    });

    if (this.debug.enabled) {
      // handle for manual QA and the headless smoke test
      (window as unknown as Record<string, unknown>).__shuden = {
        game: this,
        gfx: this.gfx,
        station: this.station,
        player: this.player,
        anomalies: this.anomalies,
        scene: this.gfx.scene,
      };
    }
  }

  /* ============================================================== phases */

  private async startRun(): Promise<void> {
    this.sequenceToken++;
    await this.audio.init(this.gfx.camera);
    this.audio.setVolume(this.settings.data.volume);
    this.audio.startAmbience({
      lamps: this.station.lamps.slice(0, 9).filter((_, i) => i % 3 === 0).map((l) => l.group),
      vending: this.station.vending.map((v) => v.group),
      speakers: this.station.speakers,
    });

    this.progress = 0;
    this.strikes = 0;
    this.anomalies.reset();
    this.save.noteRunStart();

    this.ui.showGame(this.input.isTouch);
    this.input.setEnabled(true);
    this.input.requestPointerLock();
    this.phase = 'playing';
    await this.beginLoop(false, true);
  }

  private quitToTitle(): void {
    this.sequenceToken++;
    this.phase = 'title';
    this.titleT = 0;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.audio.stopAmbience();
    this.anomalies.cleanup();
    this.station.resetToNormal();
    this.station.setTension(0);
    this.station.setExitNumber(0);
    this.distortTarget = 0;
    this.gfx.setDesaturation(0);
    this.ui.setAlert(false);
    this.ui.clearSubtitle();
    this.ui.hideAll('touch');
    this.ui.showTitle();
    this.fadeTarget = 0;
  }

  private setPaused(paused: boolean): void {
    if (paused) {
      if (this.phase !== 'playing') return;
      this.phase = 'paused';
      this.input.setEnabled(false);
      this.input.exitPointerLock();
      this.audio.suspend();
      this.ui.showPause(this.progress, this.strikes, this.rng.seed.toString(16).slice(0, 6));
    } else {
      if (this.phase !== 'paused') return;
      this.ui.hidePause();
      this.ui.hide('settings');
      this.phase = 'playing';
      this.input.setEnabled(true);
      this.audio.resume();
      this.input.requestPointerLock();
    }
  }

  /* =============================================================== loop */

  /** Reset the platform, roll the next anomaly, drop the player back at the start. */
  private async beginLoop(fadeOut = true, first = false): Promise<void> {
    const token = ++this.sequenceToken;

    if (fadeOut) {
      await this.fadeTo(1, 0.75);
      if (token !== this.sequenceToken) return;
    } else {
      this.fade = 1;
      this.fadeTarget = 1;
    }

    this.anomalies.cleanup();
    this.station.resetToNormal();
    this.station.setTension(this.progress);
    this.station.setExitNumber(this.progress);
    this.audio.setTension(this.progress);
    this.gfx.setBloomStrength(0.42 + Math.min(1, this.progress / 8) * 0.16);
    this.distortTarget = Math.min(1, this.progress / 8) * 0.16;
    this.ui.setAlert(false);

    this.anomalies.roll(this.progress);
    this.anomalies.apply(this.context());

    this.player.reset();
    this.player.frozen = false;
    this.loopElapsed = 0;
    this.judged = false;
    this.phase = 'playing';

    this.ui.flashProgress(`出口  ${this.progress}  /  ${TARGET_PROGRESS}`);
    if (first) {
      await this.wait(1.2);
      if (token !== this.sequenceToken) return;
      this.ui.subtitle(
        this.input.isTouch
          ? '左スティック 移動   ·   画面右側 ドラッグで視点   ·   調べる'
          : 'WASD 移動   ·   マウス 視点   ·   E 調べる   ·   ESC メニュー',
        7000,
      );
    }

    await this.fadeTo(0, 1.25);
    if (token !== this.sequenceToken) return;

    // occasional perfectly ordinary announcement — makes the anomalous one land
    if (!first && this.rng.bool(0.22)) {
      await this.wait(this.rng.range(3, 8));
      if (token !== this.sequenceToken || this.phase !== 'playing') return;
      this.audio.announce(this.rng.pick(NORMAL_ANNOUNCEMENTS));
    }
  }

  /** The player committed: they walked out of one end of the platform. */
  private judge(direction: 'forward' | 'back'): void {
    if (this.judged) return;
    this.judged = true;
    this.player.frozen = true;

    const hasAnomaly = this.anomalies.current !== null;
    const correct = direction === 'back' ? hasAnomaly : !hasAnomaly;

    if (correct) {
      if (hasAnomaly && this.anomalies.current) {
        this.save.noteAnomalyFound(this.anomalies.current.id);
      }
      this.progress++;
      this.save.noteProgress(this.progress);
      this.audio.play('correct', 0.7);
      if (this.progress >= TARGET_PROGRESS) {
        void this.runEnding();
        return;
      }
      void this.beginLoop(true);
    } else {
      this.strikes++;
      this.audio.play('wrong', 0.85);
      this.ui.setAlert(true);
      const reveal = hasAnomaly
        ? this.anomalies.current!.reveal
        : 'このホームに、異変はなかった。';
      this.ui.subtitle(reveal, 5200);
      this.progress = 0;
      if (this.strikes >= MAX_STRIKES) {
        void this.runGameOver();
        return;
      }
      void this.beginLoop(true);
    }
  }

  private context(): AnomalyContext {
    return {
      station: this.station,
      audio: this.audio,
      gfx: this.gfx,
      player: this.player,
      camera: this.gfx.camera,
      rng: this.rng,
      progress: this.progress,
      elapsed: this.loopElapsed,
      announce: (t) => this.audio.announce(t),
    };
  }

  /* ========================================================== sequences */

  private async runEnding(): Promise<void> {
    const token = ++this.sequenceToken;
    this.phase = 'ending';
    this.anomalies.cleanup();
    this.station.resetToNormal();
    this.station.setTension(TARGET_PROGRESS);
    this.station.setExitNumber(TARGET_PROGRESS);
    this.player.reset();
    this.player.frozen = false;
    this.ui.setAlert(false);

    await this.fadeTo(0, 1.6);
    if (token !== this.sequenceToken) return;

    await this.wait(1.6);
    if (token !== this.sequenceToken) return;
    this.audio.announce('まもなく、１番線に、電車がまいります。\n白線の内側まで、お下がりください。');

    await this.wait(3.2);
    if (token !== this.sequenceToken) return;

    const train = this.station.spawnTrain(3);
    const railZ = (L.RAIL_Z_A + L.RAIL_Z_B) / 2;
    // stop so that a doorway lines up with the player's spawn point
    const stopX = this.player.position.x - 15.5;
    const startX = stopX - 190;
    train.group.position.set(startX, 0, railZ);
    train.headlights.intensity = 26;
    this.audio.play('trainNear', 0.9);

    // decelerating approach
    const dur = 9.5;
    let t = 0;
    while (t < dur) {
      t += await this.nextFrame();
      if (token !== this.sequenceToken) return;
      const ease = 1 - Math.pow(1 - Math.min(1, t / dur), 3);
      train.group.position.x = startX + (stopX - startX) * ease;
      train.headlights.intensity = 26 * (1 - ease * 0.86);
    }
    train.group.position.x = stopX;

    await this.wait(1.0);
    if (token !== this.sequenceToken) return;
    this.audio.play('chime', 0.5);

    let d = 0;
    while (d < 1.8) {
      d += await this.nextFrame();
      if (token !== this.sequenceToken) return;
      setTrainDoors(train, Math.min(1, d / 1.8));
    }

    this.ui.subtitle('乗車してください。', 8000);

    // wait for the player to step up to the open door and press E
    for (;;) {
      await this.nextFrame();
      if (token !== this.sequenceToken) return;
      const near =
        Math.abs(this.player.position.x - (stopX + 15.5)) < 2.2 &&
        this.player.position.z > L.EDGE_Z - 2.6;
      this.ui.setPrompt(near ? '<b>E</b> 乗車する' : null);
      if (near && this.input.consumeInteract()) break;
    }

    this.ui.setPrompt(null);
    this.player.frozen = true;
    this.input.setEnabled(false);
    this.audio.play('chime', 0.45);

    await this.fadeTo(1, 2.6);
    if (token !== this.sequenceToken) return;

    // the clock finally moves
    this.station.clock.time = 14 * 60;
    applyClockTime(this.station.clock);
    this.save.noteClear();
    await this.wait(1.4);
    if (token !== this.sequenceToken) return;

    this.phase = 'result';
    this.audio.stopAmbience();
    this.ui.setPrompt(null);
    this.ui.clearSubtitle();
    this.ui.showResult(
      'clear',
      '0:14',
      'ESCAPED',
      `${STATION.name}駅、０時１４分。\n\nドアが閉まる。\n窓の外を、誰もいないホームが流れていく。\n\nベンチの傘は、まだそこにある。`,
    );
  }

  private async runGameOver(): Promise<void> {
    const token = ++this.sequenceToken;
    this.phase = 'gameover';
    this.player.frozen = true;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.ui.setPrompt(null);
    this.ui.setAlert(true);

    // the lights give up, one fitting at a time
    const order = this.rng.shuffle(this.station.lamps.slice(0, 9).map((_, i) => i));
    for (const i of order) {
      await this.wait(0.28);
      if (token !== this.sequenceToken) return;
      const l = this.station.lamps[i];
      l.on = false;
      l.material.emissiveIntensity = 0;
      if (l.light) l.light.intensity = 0;
      this.audio.play('railTick', 0.4);
      this.distortTarget = Math.min(1, this.distortTarget + 0.09);
    }

    this.audio.play('wrong', 1);
    await this.wait(0.9);
    if (token !== this.sequenceToken) return;
    await this.fadeTo(1, 2.4);
    if (token !== this.sequenceToken) return;
    await this.wait(1.0);
    if (token !== this.sequenceToken) return;

    this.phase = 'result';
    this.audio.stopAmbience();
    this.ui.setAlert(false);
    this.ui.clearSubtitle();
    this.ui.showResult(
      'over',
      '0:13',
      'GAME OVER',
      '時計は、０時１３分のまま。\n\nもう一度、同じホームで目を覚ます。\n\n何度目かは、思い出せない。',
    );
    this.distortTarget = 0;
  }

  /* ============================================================== frame */

  private frame = (): void => {
    const dt = this.gfx.render();
    this.tickTimers(dt);
    this.tickFade(dt);

    switch (this.phase) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'playing':
      case 'ending':
        this.updatePlaying(dt);
        break;
      case 'gameover':
        this.station.update(dt, this.gfx.camera);
        break;
      default:
        break;
    }

    this.updateAmbientEvents(dt);
    this.updateDebugOverlay();
    this.updateAdaptiveQuality(dt);
    for (const r of this.frameWaiters.splice(0)) r(dt);
    requestAnimationFrame(this.frame);
  };

  private updateTitle(dt: number): void {
    this.titleT += dt;
    const t = this.titleT * 0.055;
    const cam = this.gfx.camera;
    // A slow, almost-still drift down the middle of the platform. The path is
    // kept off the pillar line (z = 2) so nothing ever swings across the title.
    cam.position.set(
      -8 + Math.sin(t) * 3.2,
      L.DECK_Y + 1.62 + Math.sin(t * 0.7) * 0.09,
      -0.7 + Math.cos(t * 0.6) * 0.7,
    );
    cam.lookAt(11 + Math.sin(t * 0.4) * 3, L.DECK_Y + 1.45, 1.2);
    this.station.update(dt, cam);
  }

  private updatePlaying(dt: number): void {
    this.loopElapsed += dt;

    if (!this.ui.inspectOpen) this.player.update(dt);
    this.station.playerPos.copy(this.player.position).setY(this.player.position.y + L.EYE_HEIGHT);
    this.station.playerYaw = this.player.yaw;
    this.station.update(dt, this.gfx.camera);
    this.anomalies.update(dt, this.context());

    if (this.phase === 'playing') {
      this.updateInteraction();
      this.checkJudgement();
    }
  }

  private updateInteraction(): void {
    if (this.ui.inspectOpen) {
      if (this.input.consumeInteract()) this.closeInspect();
      return;
    }
    const eye = this.gfx.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.gfx.camera.quaternion);
    let best: (typeof this.station.interactables)[number] | null = null;
    let bestScore = 0;

    for (const it of this.station.interactables) {
      if (!it.object.visible) continue;
      const world = it.point.clone();
      world.x *= this.station.stretch;
      const d = world.distanceTo(eye);
      if (d > it.radius) continue;
      const dir = world.sub(eye).normalize();
      const facing = dir.dot(fwd);
      if (facing < 0.72) continue;
      const score = facing / Math.max(0.6, d);
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }

    this.hoveredId = best?.id ?? null;
    this.ui.setPrompt(best ? `<b>E</b> ${best.title}` : null);
    if (best && this.input.consumeInteract()) {
      this.ui.openInspect(best.title, best.body());
      this.ui.setPrompt(null);
      this.player.frozen = true;
      this.audio.play('uiClick', 0.6);
    }
  }

  private closeInspect(): void {
    if (!this.ui.inspectOpen) return;
    this.ui.closeInspect();
    if (this.phase === 'playing' || this.phase === 'ending') this.player.frozen = false;
  }

  private checkJudgement(): void {
    if (this.judged) return;
    const x = this.player.position.x / this.station.stretch;
    if (x > L.TRIGGER_X) this.judge('forward');
    else if (x < -L.TRIGGER_X) this.judge('back');
  }

  /* ---------------------------------------------------------- ambience */

  private updateAmbientEvents(dt: number): void {
    if (!this.audio.isReady || this.phase === 'title' || this.phase === 'result') return;
    this.ambientClock += dt;

    if (this.ambientClock > this.nextTrainAt) {
      this.nextTrainAt = this.ambientClock + this.rng.range(38, 78);
      this.audio.play('trainFar', 0.55);
    }
    if (this.ambientClock > this.nextThunderAt) {
      this.nextThunderAt = this.ambientClock + this.rng.range(50, 130);
      this.audio.play('thunder', 0.5 + Math.min(0.4, this.progress * 0.05));
    }
    if (this.ambientClock > this.nextCreakAt) {
      this.nextCreakAt = this.ambientClock + this.rng.range(16, 45);
      const at = new THREE.Vector3(this.rng.range(-16, 16), L.ROOF_Y - 0.4, this.rng.range(-3, 4));
      this.audio.play(this.rng.bool() ? 'creak' : 'railTick', 0.5, at, this.station.group);
    }
  }

  /* -------------------------------------------------------------- misc */

  private updateDebugOverlay(): void {
    if (!this.debug?.enabled || !this.debug.overlay) {
      this.ui.setDebug(null);
      return;
    }
    const a = this.anomalies.current;
    const p = this.player?.position;
    this.ui.setDebug(
      [
        `FPS   ${this.gfx.fps.toFixed(0)}   draws ${this.gfx.drawCalls}`,
        `PHASE ${this.phase}   Q=${this.settings.data.quality}`,
        `PROG  ${this.progress}/${TARGET_PROGRESS}  STRIKE ${this.strikes}/${MAX_STRIKES}`,
        `ANOM  ${a ? `${a.id} [${a.tier}]` : '— none —'}  (${this.anomalies.count} total)`,
        `POS   ${p ? `${p.x.toFixed(1)}, ${p.z.toFixed(1)}` : '-'}  stretch ${this.station.stretch.toFixed(2)}`,
        `HOVER ${this.hoveredId ?? '-'}`,
      ].join('\n'),
    );
  }

  /** Drop a quality level if the machine clearly cannot hold the target. */
  private updateAdaptiveQuality(dt: number): void {
    if (this.phase !== 'playing') return;
    if (this.settings.data.quality === 'low') return;
    this.qualityWatchdog = this.gfx.fps < 34 ? this.qualityWatchdog + dt : 0;
    if (this.qualityWatchdog > 6) {
      this.qualityWatchdog = 0;
      const next = this.settings.data.quality === 'high' ? 'medium' : 'low';
      this.settings.set('quality', next);
      this.gfx.applyProfile(this.settings.profile);
      this.ui.subtitle(`描画設定を ${next.toUpperCase()} に下げました`, 3000);
    }
  }

  private tickFade(dt: number): void {
    if (this.fade !== this.fadeTarget) {
      const d = Math.sign(this.fadeTarget - this.fade) * this.fadeSpeed * dt;
      this.fade =
        Math.abs(this.fadeTarget - this.fade) <= Math.abs(d) ? this.fadeTarget : this.fade + d;
    }
    this.gfx.setFade(this.fade);
    this.distort += (this.distortTarget - this.distort) * Math.min(1, dt * 1.5);
    this.gfx.setDistortion(this.distort);
    this.gfx.setDesaturation(this.distort * 0.35);
  }

  private tickTimers(dt: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].t -= dt;
      if (this.timers[i].t <= 0) {
        this.timers[i].resolve();
        this.timers.splice(i, 1);
      }
    }
  }

  private frameWaiters: ((dt: number) => void)[] = [];

  private nextFrame(): Promise<number> {
    return new Promise((r) => this.frameWaiters.push(r));
  }

  private wait(sec: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ t: sec, resolve }));
  }

  private fadeTo(target: number, seconds: number): Promise<void> {
    this.fadeTarget = target;
    this.fadeSpeed = Math.abs(target - this.fade) / Math.max(0.05, seconds);
    return this.wait(seconds);
  }
}
