/**
 * Purpose: Define game configuration constants
 * Single source of truth: All game rules and constants defined here
 * Side effects: None (constant definitions)
 */

/**
 * Ship section identifiers
 * Purpose: Enumerate all sections of a ship
 */
export const SHIP_SECTIONS = {
  BRIDGE: 'bridge',
  ENGINEERING: 'engineering',
  DRIVES: 'drives',
  MED_LAB: 'med_lab',
  SCI_LAB: 'sci_lab',
  DEFENSE: 'defense',
} as const;

export type ShipSection = typeof SHIP_SECTIONS[keyof typeof SHIP_SECTIONS];

/**
 * Ship section configuration
 * Purpose: Define hull, power, and benefits for each section
 * Source: From rulebook specifications
 */
export const SECTION_CONFIG = {
  [SHIP_SECTIONS.BRIDGE]: {
    maxHull: 12,
    powerRequired: 6,
    powerStorage: 0,
    crewSlots: 2,
    fullyPoweredBenefits: {
      acceleration: 1,
      lifeSupport: 3,
    },
  },
  [SHIP_SECTIONS.ENGINEERING]: {
    maxHull: 18,
    powerRequired: 12,
    powerStorage: 12,
    crewSlots: 3,
    fullyPoweredBenefits: {
      powerGeneration: 2,
      lifeSupport: 4,
    },
  },
  [SHIP_SECTIONS.DRIVES]: {
    maxHull: 12,
    powerRequired: 0,
    powerStorage: 18,
    crewSlots: 0, // Accessed from Engineering
    fullyPoweredBenefits: {},
  },
  [SHIP_SECTIONS.MED_LAB]: {
    maxHull: 6,
    powerRequired: 6,
    powerStorage: 0,
    crewSlots: 2,
    fullyPoweredBenefits: {
      reviveBonus: 2,
      lifeSupport: 4,
    },
  },
  [SHIP_SECTIONS.SCI_LAB]: {
    maxHull: 6,
    powerRequired: 6,
    powerStorage: 0,
    crewSlots: 2,
    fullyPoweredBenefits: {
      scanRange: 2,
      lifeSupport: 2,
    },
  },
  [SHIP_SECTIONS.DEFENSE]: {
    maxHull: 6,
    powerRequired: 6,
    powerStorage: 12,
    crewSlots: 2,
    fullyPoweredBenefits: {
      shieldGeneration: 2,
      lifeSupport: 1,
    },
  },
} as const;

/**
 * Game board configuration
 * Purpose: Define orbit rings and their properties
 */
export const BOARD_CONFIG = {
  NUM_RINGS: 8,
  RING_COLORS: {
    GREEN: [7, 8], // Outermost rings (indices 7, 8)
    YELLOW: [5, 6],
    ORANGE: [3, 4],
    RED: [1, 2],
  },
  SPACES_PER_RING: [9, 9, 12, 12, 14, 14, 18, 18], // Inner to outer; tuned for pair-based rotation design
} as const;

/**
 * Environment damage by ring color
 * Source: Rulebook specification
 */
export const ENVIRONMENT_DAMAGE = {
  GREEN: { hull: 0, conduits: 0, corridors: 0 },
  YELLOW: { hull: 2, conduits: 0, corridors: 0 },
  ORANGE: { hull: 4, conduits: 1, corridors: 0 },
  RED: { hull: 8, conduits: 2, corridors: 1 },
} as const;

/**
 * Player count limits
 */
export const PLAYER_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 6,
} as const;

/**
 * Turn configuration
 */
export const TURN_CONFIG = {
  EVENT_FREQUENCY: 4, // Event every 4th turn
  CYCLE_LENGTH: 4, // 4 turns per cycle (innermost ring rotation)
  /**
   * Ring rotation per turn in degrees, organized by ring pairs
   * Purpose: Define visual rotation speed for each ring pair
   * Source: User design specification
   *
   * | Ring(s) | Pair | Degrees/turn | Turns for 360° |
   * |---------|------|--------------|----------------|
   * | 1-2     | 1    | 40°          | 9 turns        |
   * | 3-4     | 2    | 30°          | 12 turns       |
   * | 5-6     | 3    | 25°          | ~14 turns      |
   * | 7-8     | 4    | 20°          | 18 turns       |
   */
  RING_ROTATION_DEGREES_BY_PAIR: [40, 40, 30, 30, 25, 25, 20, 20] as const,
} as const;

/**
 * Power routing limits
 * Purpose: Define conduit overload threshold
 */
export const POWER_CONFIG = {
  MAX_POWER_PER_CONDUIT: 3,
} as const;

export const LIFE_SUPPORT_CONFIG = {
  INITIAL_POOL: 6,
  POWER_PER_CREW: 2,
} as const;

export const DEFAULT_POWER_ROUTING_HUB_SECTION: ShipSection = SHIP_SECTIONS.ENGINEERING;

/**
 * Ship connection layout
 * Purpose: Define corridors and conduit connections between ship sections
 */
export const SHIP_CONNECTION_LAYOUT = {
  [SHIP_SECTIONS.BRIDGE]: {
    corridors: { [SHIP_SECTIONS.MED_LAB]: 1, [SHIP_SECTIONS.SCI_LAB]: 1, [SHIP_SECTIONS.ENGINEERING]: 1 },
    conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 2, [SHIP_SECTIONS.SCI_LAB]: 2, [SHIP_SECTIONS.ENGINEERING]: 3 },
  },
  [SHIP_SECTIONS.ENGINEERING]: {
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DEFENSE]: 1 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 3, [SHIP_SECTIONS.DRIVES]: 3, [SHIP_SECTIONS.DEFENSE]: 2 },
  },
  [SHIP_SECTIONS.MED_LAB]: {
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 2, [SHIP_SECTIONS.DRIVES]: 2 },
  },
  [SHIP_SECTIONS.DRIVES]: {
    corridors: {},
    conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 2, [SHIP_SECTIONS.ENGINEERING]: 3 },
  },
  [SHIP_SECTIONS.SCI_LAB]: {
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DEFENSE]: 1 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 2, [SHIP_SECTIONS.DEFENSE]: 2 },
  },
  [SHIP_SECTIONS.DEFENSE]: {
    corridors: { [SHIP_SECTIONS.SCI_LAB]: 1, [SHIP_SECTIONS.ENGINEERING]: 1 },
    conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 2, [SHIP_SECTIONS.ENGINEERING]: 2 },
  },
} as const;

/**
 * Initial ship configuration
 * Source: Rulebook game setup section
 */
/**
 * Initial ship state matching the playmat layout
 * Corridors: Yellow cross connectors for crew movement (0 = damaged, 1 = intact)
 * ConduitConnections: Blue electrical lines for power routing (count of conduits on connection)
 *
 * Layout from playmat (corridors only connect to Bridge):
 *   MED_LAB === BRIDGE === SCI_LAB
 *      ‖          ‖          ‖
 *   DRIVES  -- ENGINEERING -- DEFENSE
 *
 * === means corridor + conduit, ‖ means conduit only, -- means conduit only
 *
 * Corridors (crew movement) - all connect to Bridge only:
 * - MED_LAB ↔ BRIDGE: 1 corridor
 * - BRIDGE ↔ SCI_LAB: 1 corridor
 * - BRIDGE ↔ ENGINEERING: 1 corridor
 *
 * Conduits (power routing):
 * - MED_LAB ↔ BRIDGE: 2 conduits
 * - BRIDGE ↔ SCI_LAB: 2 conduits
 * - BRIDGE ↔ ENGINEERING: 2 conduits
 * - MED_LAB ↔ DRIVES: 2 conduits
 * - SCI_LAB ↔ DEFENSE: 2 conduits
 * - DRIVES ↔ ENGINEERING: 3 conduits
 * - ENGINEERING ↔ DEFENSE: 3 conduits
 */
export const INITIAL_SHIP_STATE = {
  [SHIP_SECTIONS.BRIDGE]: {
    hull: 12,
    powerDice: [6, 0],  
    corridors: { [SHIP_SECTIONS.MED_LAB]: 1, [SHIP_SECTIONS.SCI_LAB]: 1, [SHIP_SECTIONS.ENGINEERING]: 1 },
    conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1, [SHIP_SECTIONS.SCI_LAB]: 1, [SHIP_SECTIONS.ENGINEERING]: 1 },
  },
  [SHIP_SECTIONS.ENGINEERING]: {
    hull: 18,
    powerDice: [1, 1],
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DEFENSE]: 0 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DRIVES]: 0, [SHIP_SECTIONS.DEFENSE]: 0 },
  },
  [SHIP_SECTIONS.MED_LAB]: {
    hull: 6,
    powerDice: [],
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DRIVES]: 0 },
  },
  [SHIP_SECTIONS.DRIVES]: {
    hull: 12, // Damaged at start
    powerDice: [],
    corridors: {}, // No corridors - crew cannot access Drives directly
    conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 0, [SHIP_SECTIONS.ENGINEERING]: 0 },
  },
  [SHIP_SECTIONS.SCI_LAB]: {
    hull: 6, // Damaged at start
    powerDice: [],
    corridors: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DEFENSE]: 0 },
    conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1, [SHIP_SECTIONS.DEFENSE]: 0 },
  },
  [SHIP_SECTIONS.DEFENSE]: {
    hull: 6, // Damaged at start
    powerDice: [],
    corridors: { [SHIP_SECTIONS.SCI_LAB]: 0, [SHIP_SECTIONS.ENGINEERING]: 0 },
    conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 0, [SHIP_SECTIONS.ENGINEERING]: 0 },
  },
  speed: 0,
  shields: 0,
} as const;

/**
 * Collision damage by object type
 * Purpose: Define damage taken when player ship collides with objects
 * Source: Rulebook specification (pages describing each object type)
 *
 * Note: Hazard uses radiation damage within range, not collision damage.
 * Hostile ships have both collision damage and attack damage (2d6+4).
 */
export const COLLISION_DAMAGE = {
  /** Asteroid cluster: 12 hull damage on collision */
  asteroid_cluster: 12,
  /** Debris: 6 hull damage on collision */
  debris: 6,
  /** Hostile ship: 4 hull damage on collision (adjacent attack is separate: 2d6+4) */
  hostile_ship: 8,
  /** Wrecked ship: 9 hull damage on collision */
  wrecked_ship: 9,
  /** Functional station: 12 hull damage on collision */
  functional_station: 12,
} as const;

/**
 * Hazard configuration
 * Purpose: Define radiation damage from hazards (not collision-based)
 * Source: Rulebook - "3 damage to ships within 2 spaces"
 */
export const HAZARD_CONFIG = {
  /** Hull damage dealt to ships within range */
  damage: 3,
  /** Range in spaces for hazard radiation damage */
  range: 2,
  /** Life support reduction for ships within range */
  lifeSupportReduction: 2,
} as const;

/**
 * Collision check results (when collision occurs)
 * Purpose: Define random collision damage roll outcomes
 * Source: Rulebook - "Roll d6: 1-2=2 damage, 3-4=4 damage, 5-6=6 damage"
 */
export const COLLISION_CHECK_DAMAGE = {
  /** Damage on roll of 1-2 */
  LOW: 2,
  /** Damage on roll of 3-4 */
  MEDIUM: 4,
  /** Damage on roll of 5-6 */
  HIGH: 6,
} as const;

/**
 * Hostile ship combat configuration
 * Purpose: Define hostile ship attack parameters
 * Source: Rulebook - hostile ships section
 */
export const HOSTILE_CONFIG = {
  /** Base damage added to attack roll */
  attackBaseDamage: 4,
  /** Number of dice rolled for attack (2d6) */
  attackDiceCount: 2,
  /** Damage from single torpedo */
  torpedoDamage: 6,
  /** Range at which hostile fires torpedo (2-3 spaces away) */
  torpedoMinRange: 2,
  torpedoMaxRange: 3,
  /** Damage to destroy hostile (becomes debris) */
  hitPointsToDestroy: 8,
} as const;

/**
 * Crew configuration
 */
export const CREW_CONFIG = {
  MAX_CREW_TOKENS: 8,
  BASIC_CREW_TYPES: ['pilot', 'engineer', 'medic', 'scientist', 'tactician'] as const,
  REVIVE_THRESHOLD: 12, // Points needed to revive
  ASSEMBLE_THRESHOLD: 6, // Points needed to assemble resource
} as const;

export type BasicCrewType = typeof CREW_CONFIG.BASIC_CREW_TYPES[number];
