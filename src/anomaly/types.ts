import type * as THREE from 'three';
import type { Station } from '../world/Station';
import type { AudioSystem } from '../audio/AudioSystem';
import type { RendererSystem } from '../gfx/Renderer';
import type { Player } from '../player/Player';
import type { RNG } from '../core/RNG';

export type AnomalyTier = 'subtle' | 'medium' | 'strong' | 'special';

export interface AnomalyContext {
  station: Station;
  audio: AudioSystem;
  gfx: RendererSystem;
  player: Player;
  camera: THREE.PerspectiveCamera;
  rng: RNG;
  /** loops completed so far, 0..TARGET_PROGRESS */
  progress: number;
  /** seconds since this loop started */
  elapsed: number;
  announce: (text: string) => void;
}

export interface AnomalyDefinition {
  id: string;
  /** shown in the debug overlay and in the "what you missed" line after a mistake */
  name: string;
  tier: AnomalyTier;
  /** relative selection weight before tier/recency shaping */
  weight: number;
  /** anomaly is only eligible from this progress onward */
  minProgress?: number;
  /** one-line description of what was wrong, shown after a wrong judgement */
  reveal: string;
  apply: (ctx: AnomalyContext) => void;
  update?: (dt: number, ctx: AnomalyContext) => void;
  /** extra teardown beyond Station.resetToNormal() */
  cleanup?: (ctx: AnomalyContext) => void;
}
