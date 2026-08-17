import * as THREE from 'three';

/**
 * Every sound in the game is synthesised into an AudioBuffer at load time.
 *
 * Nothing is downloaded, so the soundscape can never 404 on a deployed build,
 * and the whole station fits in a few hundred KB of RAM. Positional sources
 * (lamp hum, vending compressor, platform speakers) go through
 * THREE.PositionalAudio so distance and facing are handled for free.
 */

type Fill = (data: Float32Array, sampleRate: number) => void;

function onePoleLP(a: number) {
  let y = 0;
  return (x: number): number => (y += (x - y) * a);
}
function onePoleHP(a: number) {
  const lp = onePoleLP(a);
  return (x: number): number => x - lp(x);
}
/** simple state-variable band-pass, q ~ 0.02..0.4 */
function svf(freq: number, sr: number, q: number) {
  const f = 2 * Math.sin((Math.PI * freq) / sr);
  let low = 0;
  let band = 0;
  return (x: number): number => {
    const high = x - low - q * band;
    band += f * high;
    low += f * band;
    return band;
  };
}

export class AudioSystem {
  ctx: AudioContext | null = null;
  listener: THREE.AudioListener | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private ambient: THREE.Audio[] = [];
  private positional: THREE.PositionalAudio[] = [];
  private master = 0.8;
  private ready = false;
  private lastFootstep = 0;

  onSubtitle: ((text: string, ms: number) => void) | null = null;

  /** Must be called from a user gesture. */
  async init(camera: THREE.Camera): Promise<void> {
    if (this.ready) {
      await this.ctx?.resume();
      return;
    }
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context as AudioContext;
    await this.ctx.resume();
    this.generateAll();
    this.ready = true;
    this.setVolume(this.master);
  }

  get isReady(): boolean {
    return this.ready;
  }

  setVolume(v: number): void {
    this.master = v;
    this.listener?.setMasterVolume(v);
  }

  /* --------------------------------------------------------- generation */

  private make(name: string, dur: number, fill: Fill): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(dur * sr));
    const buf = ctx.createBuffer(1, len, sr);
    fill(buf.getChannelData(0), sr);
    this.buffers.set(name, buf);
  }

  /** Cross-fade the tail into the head so a looped buffer has no seam. */
  private seamless(data: Float32Array, fadeSeconds: number, sr: number): void {
    const n = Math.min(Math.floor(fadeSeconds * sr), Math.floor(data.length / 3));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const tail = data[data.length - n + i];
      data[i] = data[i] * t + tail * (1 - t);
    }
  }

  private generateAll(): void {
    // ---- rain: broadband hiss with a slow, uneven intensity drift
    this.make('rain', 7, (d, sr) => {
      const lp = onePoleLP(0.28);
      const hp = onePoleHP(0.006);
      const lp2 = onePoleLP(0.5);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const drift = 0.78 + 0.22 * Math.sin(t * 0.31) * Math.sin(t * 0.13 + 1.2);
        let s = hp(lp(Math.random() * 2 - 1)) * drift;
        s += lp2(Math.random() * 2 - 1) * 0.16 * drift;
        d[i] = s * 0.5;
      }
      this.seamless(d, 0.5, sr);
    });

    // ---- rain hitting the platform roof: sharper, with individual pats
    this.make('rainRoof', 6, (d, sr) => {
      const bp = svf(2600, sr, 0.5);
      for (let i = 0; i < d.length; i++) {
        let s = bp(Math.random() * 2 - 1) * 0.28;
        if (Math.random() < 0.0016) {
          const dec = Math.exp(-((i % 64) / 24));
          s += (Math.random() * 2 - 1) * dec * 0.5;
        }
        d[i] = s;
      }
      this.seamless(d, 0.4, sr);
    });

    // ---- fluorescent ballast hum: mains harmonics + a little grit
    this.make('hum', 3, (d, sr) => {
      const bp = svf(4200, sr, 0.9);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s =
          Math.sin(2 * Math.PI * 100 * t) * 0.5 +
          Math.sin(2 * Math.PI * 200 * t) * 0.24 +
          Math.sin(2 * Math.PI * 300 * t) * 0.1 +
          Math.sin(2 * Math.PI * 50 * t) * 0.16;
        s += bp(Math.random() * 2 - 1) * 0.06;
        d[i] = s * 0.12;
      }
      this.seamless(d, 0.2, sr);
    });

    // ---- vending machine compressor
    this.make('vending', 4, (d, sr) => {
      const lp = onePoleLP(0.05);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = Math.sin(2 * Math.PI * 58 * t) * 0.42 + Math.sin(2 * Math.PI * 117 * t) * 0.2;
        s += lp(Math.random() * 2 - 1) * 0.9;
        s *= 1 + 0.04 * Math.sin(t * 2.1);
        d[i] = s * 0.16;
      }
      this.seamless(d, 0.3, sr);
    });

    // ---- wind moving through the cutting behind the station
    this.make('wind', 9, (d, sr) => {
      const lp = onePoleLP(0.012);
      const bp = svf(320, sr, 1.1);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.17 + Math.sin(t * 0.061) * 2));
        d[i] = (lp(Math.random() * 2 - 1) * 2.2 + bp(Math.random() * 2 - 1) * 0.35) * env * 0.22;
      }
      this.seamless(d, 0.8, sr);
    });

    // ---- footsteps on wet concrete (four takes so they never repeat audibly)
    for (let v = 0; v < 4; v++) {
      this.make(`step${v}`, 0.32, (d, sr) => {
        const bp = svf(900 + v * 190, sr, 0.75);
        const bp2 = svf(3200 + v * 400, sr, 0.5);
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const env = Math.exp(-t * 34);
          const tail = Math.exp(-t * 12) * 0.28;
          const n = Math.random() * 2 - 1;
          d[i] = (bp(n) * env + bp2(n) * tail * 0.5 + Math.sin(2 * Math.PI * 78 * t) * env * 0.5) * 0.5;
        }
      });
      this.make(`stepMetal${v}`, 0.4, (d, sr) => {
        const bp = svf(1500 + v * 260, sr, 0.18);
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const env = Math.exp(-t * 20);
          d[i] = bp(Math.random() * 2 - 1) * env * 0.55;
        }
      });
    }

    // ---- distant train passing on another line
    this.make('trainFar', 7, (d, sr) => {
      const lp = onePoleLP(0.05);
      const bp = svf(180, sr, 1.4);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.exp(-Math.pow((t - 3.2) / 2.0, 2) * 1.6);
        const clack = Math.sin(2 * Math.PI * 2.6 * t) > 0.86 ? Math.random() * 0.7 : 0;
        d[i] = (lp(Math.random() * 2 - 1) * 2.4 + bp(Math.random() * 2 - 1) * 0.8 + clack * 0.25) * env * 0.3;
      }
    });

    // ---- a train passing right in front of you
    this.make('trainNear', 8, (d, sr) => {
      const lp = onePoleLP(0.14);
      const bp = svf(420, sr, 0.9);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.exp(-Math.pow((t - 3.6) / 2.4, 2) * 1.2);
        const rail = Math.sin(2 * Math.PI * 5.2 * t) > 0.72 ? (Math.random() * 2 - 1) * 0.85 : 0;
        d[i] =
          (lp(Math.random() * 2 - 1) * 2.6 + bp(Math.random() * 2 - 1) * 1.1 + rail * 0.5) * env * 0.34;
      }
    });

    // ---- distant thunder
    this.make('thunder', 5, (d, sr) => {
      const lp = onePoleLP(0.008);
      const lp2 = onePoleLP(0.05);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t * 6) * Math.exp(-t * 0.85);
        const crack = t < 0.35 ? Math.exp(-t * 14) * 0.5 : 0;
        d[i] = (lp(Math.random() * 2 - 1) * 5.5 + lp2(Math.random() * 2 - 1) * 0.9 * crack) * env * 0.55;
      }
    });

    // ---- station chime (the familiar two-note announcement bell)
    this.make('chime', 3.2, (d, sr) => {
      const notes = [
        { f: 987.77, t: 0.0 }, // B5
        { f: 659.25, t: 0.42 }, // E5
        { f: 783.99, t: 0.84 }, // G5
      ];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = 0;
        for (const n of notes) {
          const dt = t - n.t;
          if (dt < 0) continue;
          const env = Math.exp(-dt * 2.4);
          s +=
            (Math.sin(2 * Math.PI * n.f * dt) * 0.6 +
              Math.sin(2 * Math.PI * n.f * 2.01 * dt) * 0.2 +
              Math.sin(2 * Math.PI * n.f * 2.98 * dt) * 0.08) *
            env;
        }
        d[i] = s * 0.16;
      }
    });

    // ---- a muffled PA voice: syllable-shaped band-passed noise
    this.make('voice', 4.2, (d, sr) => {
      const bp = svf(760, sr, 0.35);
      const bp2 = svf(1750, sr, 0.4);
      const lp = onePoleLP(0.4);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.4 * t + Math.sin(t * 1.7) * 2.2);
        const phrase = t < 3.6 ? 1 : Math.max(0, 1 - (t - 3.6) * 3);
        const carrier =
          Math.sin(2 * Math.PI * 118 * t) * 0.4 + Math.sin(2 * Math.PI * 236 * t) * 0.18;
        const n = Math.random() * 2 - 1;
        d[i] = lp((bp(n) * 0.9 + bp2(n) * 0.5 + carrier) * Math.pow(syl, 2.2) * phrase) * 0.2;
      }
    });

    // ---- structural metal creak
    this.make('creak', 2.2, (d, sr) => {
      let f = 260;
      let phase = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        f += (Math.random() - 0.48) * 2.2;
        f = Math.max(120, Math.min(520, f));
        phase += (2 * Math.PI * f) / sr;
        const env = Math.min(1, t * 3) * Math.exp(-t * 1.5);
        const grain = Math.random() < 0.4 ? 1 : 0.2;
        d[i] = Math.sin(phase) * env * grain * 0.12;
      }
    });

    // ---- rail expansion tick, far down the line
    this.make('railTick', 1.1, (d, sr) => {
      const bp = svf(2100, sr, 0.09);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = bp(i < 40 ? Math.random() * 2 - 1 : 0) * Math.exp(-t * 5) * 0.5;
      }
    });

    // ---- UI
    this.make('uiClick', 0.14, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 55) * 0.08;
      }
    });
    this.make('correct', 2.4, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const e = Math.exp(-t * 1.4);
        d[i] =
          (Math.sin(2 * Math.PI * 196 * t) * 0.5 + Math.sin(2 * Math.PI * 293.66 * t) * 0.3) * e * 0.1;
      }
    });
    this.make('wrong', 3.4, (d, sr) => {
      const lp = onePoleLP(0.02);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const e = Math.min(1, t * 8) * Math.exp(-t * 0.9);
        d[i] =
          (Math.sin(2 * Math.PI * 62 * t) * 0.6 + lp(Math.random() * 2 - 1) * 1.6) * e * 0.16;
      }
    });
    this.make('drone', 6, (d, sr) => {
      // sub-audible unease bed used only at high tension
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const s =
          Math.sin(2 * Math.PI * 41 * t) * 0.5 +
          Math.sin(2 * Math.PI * 41.6 * t) * 0.4 +
          Math.sin(2 * Math.PI * 82.3 * t) * 0.12;
        d[i] = s * 0.05;
      }
      this.seamless(d, 0.5, sr);
    });
  }

  /* ------------------------------------------------------------ playback */

  private loop(name: string, volume: number): THREE.Audio | null {
    if (!this.listener) return null;
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setLoop(true);
    a.setVolume(volume);
    a.play();
    this.ambient.push(a);
    return a;
  }

  private attach(
    obj: THREE.Object3D,
    name: string,
    volume: number,
    refDistance: number,
    maxDistance = 26,
  ): THREE.PositionalAudio | null {
    if (!this.listener) return null;
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const a = new THREE.PositionalAudio(this.listener);
    a.setBuffer(buf);
    a.setLoop(true);
    a.setRefDistance(refDistance);
    a.setMaxDistance(maxDistance);
    a.setDistanceModel('exponential');
    a.setRolloffFactor(1.6);
    a.setVolume(volume);
    // stagger loop phase so identical fittings do not comb-filter each other
    a.offset = Math.random() * buf.duration;
    a.play();
    obj.add(a);
    this.positional.push(a);
    return a;
  }

  private rainAudio: THREE.Audio | null = null;
  private roofAudio: THREE.Audio | null = null;
  private droneAudio: THREE.Audio | null = null;

  /** Wire the persistent soundscape to the built station. */
  startAmbience(sources: {
    lamps: THREE.Object3D[];
    vending: THREE.Object3D[];
    speakers: THREE.Object3D[];
  }): void {
    if (!this.listener) return;
    this.stopAmbience();
    this.rainAudio = this.loop('rain', 0.5);
    this.roofAudio = this.loop('rainRoof', 0.22);
    this.loop('wind', 0.3);
    this.droneAudio = this.loop('drone', 0.0);

    for (const l of sources.lamps) this.attach(l, 'hum', 0.5, 2.4, 14);
    for (const v of sources.vending) this.attach(v, 'vending', 0.85, 2.2, 16);
  }

  stopAmbience(): void {
    for (const a of this.ambient) {
      a.stop();
      a.disconnect();
    }
    this.ambient.length = 0;
    for (const p of this.positional) {
      p.stop();
      p.disconnect();
      p.parent?.remove(p);
    }
    this.positional.length = 0;
    this.rainAudio = this.roofAudio = this.droneAudio = null;
  }

  /** One-shot, optionally positioned in the world. */
  play(name: string, volume = 1, at?: THREE.Vector3, parent?: THREE.Object3D): void {
    if (!this.listener) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    if (at && parent) {
      const holder = new THREE.Object3D();
      holder.position.copy(at);
      parent.add(holder);
      const a = new THREE.PositionalAudio(this.listener);
      a.setBuffer(buf);
      a.setRefDistance(4);
      a.setMaxDistance(60);
      a.setDistanceModel('exponential');
      a.setVolume(volume);
      holder.add(a);
      a.play();
      a.onEnded = () => {
        a.disconnect();
        parent.remove(holder);
      };
    } else {
      const a = new THREE.Audio(this.listener);
      a.setBuffer(buf);
      a.setVolume(volume);
      a.play();
      a.onEnded = () => a.disconnect();
    }
  }

  footstep(running: boolean, onStairs: boolean): void {
    const now = performance.now();
    if (now - this.lastFootstep < 130) return;
    this.lastFootstep = now;
    const v = Math.floor(Math.random() * 4);
    this.play(onStairs ? `stepMetal${v}` : `step${v}`, (running ? 0.5 : 0.34) * (0.85 + Math.random() * 0.3));
  }

  /** Chime + muffled voice + subtitle. */
  announce(text: string, opts: { chime?: boolean; voice?: boolean; at?: THREE.Object3D } = {}): void {
    const { chime = true, voice = true } = opts;
    if (chime) this.play('chime', 0.55);
    if (voice) {
      setTimeout(() => this.play('voice', 0.5), chime ? 1500 : 0);
    }
    this.onSubtitle?.(text, 6200);
  }

  /** Raise the sub-bass bed and thin the rain as the world degrades. */
  setTension(t: number): void {
    const k = Math.min(1, t / 8);
    this.droneAudio?.setVolume(k * k * 0.85);
    this.rainAudio?.setVolume(0.5 + k * 0.12);
    this.roofAudio?.setVolume(0.22 + k * 0.08);
  }

  suspend(): void {
    this.ctx?.suspend();
  }
  resume(): void {
    this.ctx?.resume();
  }
}
