/**
 * Station geometry constants. One source of truth so colliders, props, lights
 * and the anomaly definitions can never drift apart.
 *
 * Axes: +X runs along the platform (north = +X = "forward"),
 *       +Y is up, +Z crosses the platform toward the track.
 */
export const L = {
  /** platform deck spans x in [-HALF_LEN, HALF_LEN] */
  HALF_LEN: 19,
  /** deck spans z in [WALL_Z, EDGE_Z] */
  WALL_Z: -4.0,
  EDGE_Z: 4.0,
  DECK_Y: 1.1,

  ROOF_Y: 4.3,
  ROOF_X: 16,
  ROOF_Z_FAR: 5.4,

  /** tactile paving strip centre */
  TACTILE_Z: 3.05,

  /**
   * Track bed. Rail centreline sits 1.5 m from the platform edge and the gauge
   * is 1.067 m (JR narrow gauge) so a 2.86 m-wide train leaves a realistic
   * ~8 cm gap at the platform edge.
   */
  TRACK_Y: 0,
  TRACK_Z_NEAR: 4.05,
  TRACK_Z_FAR: 8.2,
  RAIL_Z_A: 4.98,
  RAIL_Z_B: 6.05,
  RAIL_Y: 0.28,

  /** opposite (down-line) platform */
  OPP_Z_NEAR: 9.4,
  OPP_Z_FAR: 15.4,
  OPP_WALL_Z: 15.8,

  /** stairwells */
  STAIR_MOUTH: 19.0,
  STAIR_END: 23.2,
  STAIR_HALF_W: 2.0,
  STAIR_RISE: 2.6,
  /** crossing this |x| commits the player's judgement */
  TRIGGER_X: 22.4,

  /** player spawn */
  SPAWN_X: -15.0,
  SPAWN_Z: 0.4,
  EYE_HEIGHT: 1.66,

  PLAYER_RADIUS: 0.33,
} as const;

export const PILLAR_XS = [-15, -10, -5, 0, 5, 10, 15] as const;

/** Ceiling lamp positions along the platform (two rows). */
export const LAMP_XS = [-15, -11.25, -7.5, -3.75, 0, 3.75, 7.5, 11.25, 15] as const;

export const TARGET_PROGRESS = 8;
export const MAX_STRIKES = 3;
