import { ANOMALIES, ANOMALY_BY_ID } from './definitions';
import type { AnomalyContext, AnomalyDefinition, AnomalyTier } from './types';
import type { RNG } from '../core/RNG';

/**
 * Chooses what (if anything) is wrong with each loop.
 *
 * Two jobs beyond "pick one at random":
 *  - keep a *normal* loop genuinely possible, so the player can never assume
 *    something is always there. That uncertainty is the whole game.
 *  - shape the distribution over the run: early loops lean on small, learnable
 *    differences; later loops open up to the strong and experiential ones.
 */

const TIER_CURVE: Record<AnomalyTier, (p: number) => number> = {
  // p = progress 0..8
  subtle: (p) => 1.5 - p * 0.09,
  medium: (p) => 0.55 + p * 0.09,
  strong: (p) => 0.15 + p * 0.16,
  special: (p) => 0.35 + p * 0.11,
};

/** How likely a loop contains an anomaly at all. */
function anomalyChance(progress: number): number {
  if (progress === 0) return 0.45; // first loop is gentle
  return Math.min(0.68, 0.5 + progress * 0.025);
}

const HISTORY_BLOCK = 5;

export class AnomalyManager {
  current: AnomalyDefinition | null = null;
  /** the anomaly the previous loop had, for the post-mistake reveal */
  previous: AnomalyDefinition | null = null;
  private history: string[] = [];
  private ctx: AnomalyContext | null = null;
  /** debug: force this id (or 'none') on the next roll */
  forcedId: string | null = null;

  constructor(private rng: RNG) {}

  get registry(): AnomalyDefinition[] {
    return ANOMALIES;
  }

  /** Roll the next loop. Returns the chosen anomaly, or null for a clean loop. */
  roll(progress: number): AnomalyDefinition | null {
    this.previous = this.current;
    this.current = null;

    if (this.forcedId) {
      const forced = this.forcedId;
      this.forcedId = null;
      if (forced === 'none') return null;
      this.current = ANOMALY_BY_ID.get(forced) ?? null;
      if (this.current) this.remember(this.current.id);
      return this.current;
    }

    if (!this.rng.bool(anomalyChance(progress))) return null;

    const eligible = ANOMALIES.filter(
      (a) => (a.minProgress ?? 0) <= progress && !this.history.includes(a.id),
    );
    const pool = eligible.length > 0 ? eligible : ANOMALIES.filter((a) => (a.minProgress ?? 0) <= progress);

    this.current = this.rng.weighted(pool, (a) => a.weight * TIER_CURVE[a.tier](progress));
    if (this.current) this.remember(this.current.id);
    return this.current;
  }

  private remember(id: string): void {
    this.history.push(id);
    if (this.history.length > HISTORY_BLOCK) this.history.shift();
  }

  apply(ctx: AnomalyContext): void {
    this.ctx = ctx;
    this.current?.apply(ctx);
  }

  update(dt: number, ctx: AnomalyContext): void {
    this.ctx = ctx;
    this.current?.update?.(dt, ctx);
  }

  /** Called just before Station.resetToNormal(). */
  cleanup(): void {
    if (this.ctx) this.current?.cleanup?.(this.ctx);
  }

  reset(): void {
    this.history.length = 0;
    this.current = null;
    this.previous = null;
  }

  get count(): number {
    return ANOMALIES.length;
  }
}
