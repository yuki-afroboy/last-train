/**
 * localStorage helpers + persistent progress record.
 *
 * Everything degrades gracefully: private-mode Safari throws on setItem, and a
 * game that crashes because it cannot save is worse than one that forgets.
 */

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}

export interface RecordData {
  bestProgress: number;
  cleared: boolean;
  clearCount: number;
  runs: number;
  seenIntro: boolean;
  /** anomaly ids the player has correctly identified at least once */
  foundAnomalies: string[];
}

const KEY = 'shuden0013.record.v1';

const DEFAULTS: RecordData = {
  bestProgress: 0,
  cleared: false,
  clearCount: 0,
  runs: 0,
  seenIntro: false,
  foundAnomalies: [],
};

export class SaveManager {
  data: RecordData;

  constructor() {
    this.data = { ...DEFAULTS, ...(loadJSON<Partial<RecordData>>(KEY) ?? {}) };
    if (!Array.isArray(this.data.foundAnomalies)) this.data.foundAnomalies = [];
  }

  private flush(): void {
    saveJSON(KEY, this.data);
  }

  noteRunStart(): void {
    this.data.runs++;
    this.flush();
  }

  noteProgress(progress: number): void {
    if (progress > this.data.bestProgress) {
      this.data.bestProgress = progress;
      this.flush();
    }
  }

  noteAnomalyFound(id: string): void {
    if (!this.data.foundAnomalies.includes(id)) {
      this.data.foundAnomalies.push(id);
      this.flush();
    }
  }

  noteClear(): void {
    this.data.cleared = true;
    this.data.clearCount++;
    this.flush();
  }

  noteIntroSeen(): void {
    if (!this.data.seenIntro) {
      this.data.seenIntro = true;
      this.flush();
    }
  }
}
