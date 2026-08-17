import { loadJSON, saveJSON } from './Save';

export type Quality = 'low' | 'medium' | 'high';

export interface SettingsData {
  quality: Quality;
  sensitivity: number;
  volume: number;
  fov: number;
  bob: number;
  invertY: boolean;
}

/** Per-quality render budget. Consumed by Renderer, Station and Rain. */
export interface QualityProfile {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  /** number of ceiling lamps that actually cast shadows */
  shadowCasters: number;
  bloom: boolean;
  ao: boolean;
  rainCount: number;
  splashCount: number;
  reflections: boolean;
  anisotropy: number;
  textureScale: number;
  grain: boolean;
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    shadowCasters: 0,
    bloom: false,
    ao: false,
    rainCount: 1400,
    splashCount: 0,
    reflections: false,
    anisotropy: 2,
    textureScale: 0.5,
    grain: false,
  },
  medium: {
    pixelRatioCap: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    shadowCasters: 1,
    bloom: true,
    ao: false,
    rainCount: 3200,
    splashCount: 140,
    reflections: true,
    anisotropy: 4,
    textureScale: 0.75,
    grain: true,
  },
  high: {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    shadowCasters: 2,
    bloom: true,
    ao: true,
    rainCount: 6000,
    splashCount: 320,
    reflections: true,
    anisotropy: 8,
    textureScale: 1,
    grain: true,
  },
};

const KEY = 'shuden0013.settings.v1';

export function detectDefaultQuality(): Quality {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (mobile) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

const DEFAULTS = (): SettingsData => ({
  quality: detectDefaultQuality(),
  sensitivity: 1,
  volume: 0.8,
  fov: 75,
  bob: 0.55,
  invertY: false,
});

export class Settings {
  data: SettingsData;
  private listeners = new Set<(d: SettingsData) => void>();

  constructor() {
    this.data = { ...DEFAULTS(), ...(loadJSON<Partial<SettingsData>>(KEY) ?? {}) };
    if (!QUALITY_PROFILES[this.data.quality]) this.data.quality = detectDefaultQuality();
  }

  get profile(): QualityProfile {
    return QUALITY_PROFILES[this.data.quality];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    saveJSON(KEY, this.data);
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (d: SettingsData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
