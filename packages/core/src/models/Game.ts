/**
 * Purpose: Define complete game state model
 * Single source of truth: Top-level game state combining all models
 * Side effects: None (type definitions)
 */

import type { Ship } from './Ship';
import { Board, ObjectType } from './Board';
import { AnyCrew, Captain, CaptainType, OfficerType } from './Crew';
import type { ShipSection } from '../constants/GameConfig';

/**
 * Game status enumeration
 */
export type GameStatus = 'setup' | 'in_progress' | 'completed' | 'abandoned';

/**
 * Turn phase enumeration
 * Purpose: Track current phase of turn execution
 */
export type TurnPhase =
  | 'event'
  | 'action_planning'
  | 'action_execution'
  | 'environment'
  | 'resolution';

/**
 * Player status enumeration
 */
export type PlayerStatus = 'active' | 'eliminated' | 'escaped' | 'wrecked';

/**
 * Resource types
 * Purpose: Enumerate collectible resources
 */
export type ResourceType =
  | 'fuel_cell'
  | 'antimatter'
  | 'power_cell'
  | 'medical_kit'
  | 'spare_parts'
  | 'energy_weapon'
  | 'particle_weapon'
  | 'phased_weapon'
  | 'phased_shielding'
  | 'torpedo'
  | 'probe';

/**
 * Player resources
 * Purpose: Track consumable resources
 */
export type PlayerResources = {
  [key in ResourceType]?: number;
};

export type ProbeScanSource = 'probe';

export type ProbeScanRevealedItem =
  | { kind: 'resource'; resourceType: ResourceType }
  | { kind: 'upgrade'; upgrade: UpgradeCard };

export interface ScanDiscoveryRecord {
  objectId: string;
  objectType: ObjectType;
  source: 'scan' | 'probe';
  rollValue: number;
  totalRoll: number;
  foundResource: boolean;
  resourceType: keyof PlayerResources | null;
  foundUpgrade: boolean;
  reservedUpgrade: UpgradeCard | null;
  revealedAtTurn: number;
  crewId: string;
}

/**
 * Explorer captain special repair kit state
 */
export interface SpecialRepairKit {
  section: ShipSection | null;
  used: boolean;
}

export interface ProbeScanLogEntry {
  id: string;
  turn: number;
  source: ProbeScanSource;
  crewId: string;
  objectId: string;
  objectType: ObjectType;
  rollValue: number;
  revealed: ProbeScanRevealedItem[];
  createdAt: string;
}

/**
 * Mission card interface
 * Purpose: Define mission objectives and victory points
 */
export interface MissionCard {
  id: string;
  name: string;
  description: string;
  objectives: {
    primary: { description: string; points: number; completed: boolean };
    secondary?: { description: string; points: number; completed: boolean };
  };
}

/**
 * Upgrade card interface
 * Purpose: Define ship upgrades
 */
export interface UpgradeCard {
  id: string;
  name: string;
  description: string;
  powerRequired?: number;
  storedPower?: number;
  section?: string;
  effects: Record<string, any>;
}

/**
 * Event card interface
 * Purpose: Define random events
 */
export interface EventCard {
  id: string;
  name: string;
  description: string;
  effects: Record<string, any>;
}

export type ActionType =
  | 'generate_assemble'
  | 'repair'
  | 'revive_assemble'
  | 'scan_assemble'
  | 'attack_assemble'
  | 'acquire_integrate'
  | 'maneuver'
  | 'launch';

export interface ActionCard {
  id: string;
  name: string;
  description: string;
  actionType: ActionType;
  section?: string;
  effects: Record<string, any>;
}

export interface CaptainCard {
  id: string;
  name: string;
  description: string;
  captainType: CaptainType;
  effects: Record<string, any>;
}

export interface OfficerCard {
  id: string;
  name: string;
  description: string;
  role: OfficerType;
  effects: Record<string, any>;
}

/**
 * Runtime state for event effects
 * Purpose: Track transient state needed by event cards (e.g. pending rewards)
 */
export interface EventRuntimeState {
  /** Distress Call: station awaiting first scan for free upgrade */
  distressCall?: {
    stationId: string;
    claimedByPlayerId?: string | null;
  };
}

export type PlayerActionType =
  | 'restore'
  | 'route'
  | 'repair'
  | 'revive'
  | 'scan'
  | 'acquire'
  | 'attack'
  | 'launch'
  | 'maneuver'
  | 'retaliate'
  | 'assemble'
  | 'integrate';

export interface PlayerActionTarget {
  playerId?: string;
  objectId?: string;
  position?: Ship['position'];
  section?: string;
}

export interface PlayerAction {
  playerId: string;
  crewId: string;
  type: PlayerActionType;
  target?: PlayerActionTarget | null;
  parameters?: Record<string, unknown>;
}

export type TurnActions = Record<string, PlayerAction[]>;

/**
 * Player state interface
 * Purpose: Complete state for a single player
 *
 * Single source of truth: All player-specific state here
 * Crew location stored in crew objects, not duplicated
 * Life support computed from ship sections, not stored
 */
export interface PlayerState {
  id: string;
  userId: string | null; // null for bots
  isBot: boolean;
  botStrategy?: string;
  playerOrder: number;
  status: PlayerStatus;

  // Ship state (single source of truth)
  ship: Ship;

  // Crew state (single source of truth)
  crew: AnyCrew[];
  captain: Captain;

  // Cards
  missions: MissionCard[];
  actionDeck: string[]; // Array of action card IDs
  pendingUpgrades: UpgradeCard[]; // Not yet integrated
  installedUpgrades: UpgradeCard[];

  // Resources (single source of truth)
  resources: PlayerResources;

  scannedHostiles?: Record<string, number>;

  hostilesScannedPlayerByObjectId?: Record<string, number>;

  decoysLastUsedTurn?: number;

  powerCoilsLastUsedTurn?: number;

  probeScanLogsByObjectId?: Record<string, ProbeScanLogEntry[]>;

  // Mirrors authoritative scan/probe discovery results keyed by space object id.
  // IMPORTANT: When adding new UI surfaces for scan/probe data, read from this map instead of
  // legacy probeScanLogsByObjectId to ensure deterministic per-object roll histories.
  scanDiscoveriesByObjectId?: Record<string, ScanDiscoveryRecord>;

  /**
   * Explorer captain only: tracks placement and usage of the special repair kit
   * - section: Ship section where the kit is installed (null until player chooses)
   * - used: Whether the kit has already been consumed
   */
  explorerRepairKit?: SpecialRepairKit | null;

  spacePirateStartingUpgradeOptions?: UpgradeCard[] | null;
}

/**
 * Complete game state
 * Purpose: Single source of truth for entire game
 *
 * Fields:
 * - id: Unique game identifier
 * - status: Current game status
 * - currentTurn: Current turn number (1-based)
 * - turnPhase: Current phase of turn
 * - board: Board state
 * - players: Map of player states (keyed by player ID)
 * - eventDeck: Remaining event cards
 * - upgradeDeck: Remaining upgrade cards
 * - createdAt: Game creation timestamp
 * - startedAt: Game start timestamp
 * - settings: Game configuration
 *
 * Single source of truth principle:
 * - Player positions stored in player.ship.position only
 * - Life support computed from ship sections, not stored
 * - Functional/damaged status computed from hull/power, not stored
 * - All derived values calculated on-demand, never cached
 */
export interface GameState {
  id: string;
  status: GameStatus;
  currentTurn: number;
  turnPhase: TurnPhase;

  // Board state (single source of truth)
  board: Board;

  // Player states (single source of truth)
  players: Map<string, PlayerState>;

  // Deck states
  eventDeck: EventCard[];
  upgradeDeck: UpgradeCard[];

  // Timestamps
  createdAt: Date;
  startedAt: Date | null;

  // Configuration
  settings: GameSettings;

  lastResolvedEvent?: EventCard | null;

  // Event runtime state (optional; used by specific event cards)
  eventState?: EventRuntimeState;
}

/**
 * Game settings interface
 * Purpose: Define configurable game options
 */
export type ExpansionId = 'core';

export interface GameSettings {
  maxPlayers: number;
  rotationDirection: 'clockwise' | 'counter-clockwise';
  expansions: ExpansionId[];
  variantRules?: {
    decayingOrbits?: boolean;
    gravityAssist?: boolean;
    escalatingDamage?: boolean;
  };
}

/**
 * Game utility functions
 * Purpose: High-level game state calculations
 */
export class GameUtils {
  /**
   * Check if all players have submitted actions
   * Purpose: Determine if turn can be processed
   * Parameters:
   *   - game: Current game state
   *   - submittedPlayerIds: Set of player IDs who submitted
   * Returns: True if all active players submitted
   * Side effects: None (pure function)
   */
  static allPlayersSubmitted(
    game: GameState,
    submittedPlayerIds: Set<string>
  ): boolean {
    const activePlayers = Array.from(game.players.values()).filter(
      player => player.status === 'active'
    );

    return activePlayers.every(player => submittedPlayerIds.has(player.id));
  }

  /**
   * Check if game should end
   * Purpose: Determine if game completion criteria met
   * Parameters:
   *   - game: Current game state
   * Returns: True if game should end
   * Side effects: None (pure function)
   *
   * End conditions (from rulebook):
   * - Half or more players escaped
   * - All players eliminated/wrecked
   */
  static shouldEndGame(game: GameState): boolean {
    const players = Array.from(game.players.values());
    const escapedCount = players.filter(p => p.status === 'escaped').length;
    const activeCount = players.filter(p => p.status === 'active').length;

    // Half or more escaped
    if (escapedCount >= players.length / 2) {
      return true;
    }

    // No active players
    if (activeCount === 0) {
      return true;
    }

    return false;
  }

  /**
   * Calculate victory points for a player
   * Purpose: Determine final score
   * Parameters:
   *   - player: Player state
   *   - escaped: Whether player escaped
   *   - firstToEscape: Whether player was first to escape
   * Returns: Total victory points
   * Side effects: None (pure function)
   *
   * Victory points (from rulebook):
   * - First to escape: 50 points
   * - Escaped: 25 points
   * - Mission completion: 25 + 10 per tier
   * - Functioning sections: 5 points each
   * - Fully powered sections: +5 points each
   * - Upgrades installed: 5 points each
   * - Fully powered upgrades: +5 points each
   * - Active crew: 5 points (basic), 10 points (captain/officers)
   * - Hull, shields, power: 1 point each
   */
  static calculateVictoryPoints(
    player: PlayerState,
    escaped: boolean,
    firstToEscape: boolean
  ): number {
    let points = 0;

    // Escape points
    if (firstToEscape) {
      points += 50;
    } else if (escaped) {
      points += 25;
    }

    // Mission points
    for (const mission of player.missions) {
      if (mission.objectives.primary.completed) {
        points += mission.objectives.primary.points;
      }
      if (mission.objectives.secondary?.completed) {
        points += mission.objectives.secondary.points;
      }
    }

    // Ship section points
    // (Implementation would iterate sections and calculate)

    // Crew points
    const activeCrew = player.crew.filter(c => c.status === 'active');
    for (const crew of activeCrew) {
      points += crew.type === 'basic' ? 5 : 10;
    }
    if (player.captain.status === 'active') {
      points += 10;
    }

    // Hull, shields, power (1 point each)
    // (Implementation would sum these)

    return points;
  }
}
