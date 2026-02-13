/**
 * Purpose: Define crew member models and related types
 * Single source of truth: Crew state and abilities
 * Side effects: None (type definitions and interfaces)
 */

import { ShipSection, BasicCrewType } from '../constants/GameConfig';

/**
 * Officer types
 * Purpose: Enumerate advanced crew with special abilities
 */
export type OfficerType =
  | 'ace_pilot'
  | 'chief_engineer'
  | 'doctor'
  | 'senior_scientist'
  | 'master_tactician'
  | 'android'
  | 'mission_specialist'
  | 'first_officer';

/**
 * Captain types
 * Purpose: Enumerate captain variants with unique abilities
 */
export type CaptainType =
  | 'merchant'
  | 'imperialist'
  | 'space_pirate'
  | 'technologist'
  | 'emissary'
  | 'explorer';

/**
 * Crew status
 * Purpose: Track crew member activity state
 */
export type CrewStatus = 'active' | 'unconscious' | 'dead';

/**
 * Crew member base interface
 * Purpose: Common properties for all crew
 *
 * Fields:
 * - id: Unique identifier
 * - name: Display name
 * - status: Current status (active/unconscious/dead)
 * - location: Current ship section (null if unconscious/dead)
 * - reviveProgress: Points toward revival (0-5, resets at 6)
 */
export interface CrewMember {
  id: string;
  name: string;
  status: CrewStatus;
  location: ShipSection | null;
  reviveProgress: number;
  assembleProgress: number;
  assembleItemType: string | null;
  assembleProgressByItemType?: Partial<Record<string, number>>;
}

/**
 * Basic crew member
 * Purpose: Standard crew with basic skill bonuses
 *
 * Skill bonuses (from rulebook):
 * - Pilot: +1 acceleration on Maneuver, evasion tactics
 * - Engineer: +2 on Generate, 2X repairs
 * - Medic: +1 on Revive, +1 on assemble Med-Kit
 * - Scientist: +1 range Scan/Acquire, +1 on assemble Probe
 * - Tactician: +1 damage on Attack, +1 Shield on Generate
 */
export interface BasicCrew extends CrewMember {
  type: 'basic';
  role: BasicCrewType;
}

/**
 * Officer crew member
 * Purpose: Advanced crew with enhanced abilities
 */
export interface Officer extends CrewMember {
  type: 'officer';
  role: OfficerType;
  stimPacksUsed: number; // For Doctor ability tracking
}

/**
 * Captain crew member
 * Purpose: Leader with special ship-wide abilities
 */
export interface Captain extends CrewMember {
  type: 'captain';
  captainType: CaptainType;
}

/**
 * Union type for any crew member
 */
export type AnyCrew = BasicCrew | Officer | Captain;

/**
 * Crew bonuses interface
 * Purpose: Define skill bonuses for actions
 */
export interface CrewBonuses {
  // Maneuver action bonuses
  acceleration?: number;
  evasion?: boolean;
  fullEvasion?: boolean;

  // Generate action bonuses
  powerGeneration?: number;
  shieldGeneration?: number;

  // Repair action bonuses
  repairMultiplier?: number;

  // Revive action bonuses
  reviveBonus?: number;

  // Scan/Acquire action bonuses
  rangeBonus?: number;

  // Attack action bonuses
  damageBonus?: number;

  // Assemble action bonuses
  assembleBonus?: number;
}

/**
 * Crew utility functions
 * Purpose: Calculate crew bonuses and abilities
 */
export class CrewUtils {
  /**
   * Get skill bonuses for a crew member
   * Purpose: Calculate bonuses based on crew type and role
   * Parameters:
   *   - crew: Crew member to evaluate
   * Returns: Bonuses object with applicable modifiers
   * Side effects: None (pure function)
   *
   * Root cause of implementation: Crew bonuses are derived from role,
   * not stored separately (single source of truth principle)
   */
  static getBonuses(crew: AnyCrew): CrewBonuses {
    const bonuses: CrewBonuses = {};

    // Basic crew bonuses
    if (crew.type === 'basic') {
      switch (crew.role) {
        case 'pilot':
          bonuses.acceleration = 1;
          bonuses.evasion = true;
          break;
        case 'engineer':
          bonuses.powerGeneration = 2;
          bonuses.repairMultiplier = 2;
          break;
        case 'medic':
          bonuses.reviveBonus = 1;
          bonuses.assembleBonus = 1; // For med-kits
          break;
        case 'scientist':
          bonuses.rangeBonus = 1;
          bonuses.assembleBonus = 1; // For probes
          break;
        case 'tactician':
          bonuses.damageBonus = 1;
          bonuses.shieldGeneration = 1;
          break;
      }
    }

    // Officer bonuses (enhanced versions)
    if (crew.type === 'officer') {
      switch (crew.role) {
        case 'ace_pilot':
          bonuses.acceleration = 2;
          bonuses.fullEvasion = true;
          bonuses.evasion = true;
          break;
        case 'chief_engineer':
          bonuses.powerGeneration = 3;
          bonuses.repairMultiplier = 3;
          break;
        case 'doctor':
          bonuses.reviveBonus = 2;
          bonuses.assembleBonus = 2;
          break;
        case 'senior_scientist':
          bonuses.rangeBonus = 2;
          bonuses.assembleBonus = 2; // 2026-01-09: Buffed probe assembly; crew was underpowered.
          break;
        case 'master_tactician':
          bonuses.damageBonus = 2;
          bonuses.shieldGeneration = 2;
          break;
        case 'android':
          bonuses.powerGeneration = 2; // 2026-01-09: Reduced for balance; was overpowering resource loops.
          bonuses.repairMultiplier = 3;
          break;
        case 'first_officer':
          // Competence: performs as any basic crew
          bonuses.acceleration = 1;
          bonuses.evasion = true;
          bonuses.powerGeneration = 2;
          bonuses.repairMultiplier = 2;
          bonuses.reviveBonus = 1;
          bonuses.rangeBonus = 1;
          bonuses.damageBonus = 1;
          bonuses.shieldGeneration = 1;
          break;
      }
    }

    if (crew.type === 'captain') {
      // Captains are expected to stand in for any basic role, mirroring first officer competence bonuses.
      bonuses.acceleration = 1;
      bonuses.evasion = true;
      bonuses.powerGeneration = 2;
      bonuses.repairMultiplier = 2;
      bonuses.reviveBonus = 1;
      bonuses.rangeBonus = 1;
      bonuses.damageBonus = 1;
      bonuses.shieldGeneration = 1;
    }

    return bonuses;
  }

  /**
   * Check if crew can move to section
   * Purpose: Validate crew movement
   * Parameters:
   *   - crew: Crew member attempting to move
   *   - from: Current section
   *   - to: Target section
   *   - corridorState: Corridor integrity (0 = damaged, 1 = intact)
   * Returns: True if movement is valid
   * Side effects: None (pure function)
   *
   * Movement rules:
   * - Crew must be active
   * - Corridor must be intact (except Android)
   * - Target section must not be damaged (except Android)
   */
  static canMoveTo(
    crew: AnyCrew,
    _from: ShipSection | null,
    _to: ShipSection,
    corridorState: number,
    targetSectionHull: number
  ): boolean {
    // Must be active to move
    if (crew.status !== 'active') {
      return false;
    }

    // Android can move through damaged areas
    if (crew.type === 'officer' && crew.role === 'android') {
      return true;
    }

    // Corridor must be intact
    if (corridorState === 0) {
      return false;
    }

    // Target section must not be damaged
    if (targetSectionHull === 0) {
      return false;
    }

    return true;
  }

  /**
   * Check if crew requires life support
   * Purpose: Determine if crew counts toward life support requirement
   * Parameters:
   *   - crew: Crew member to check
   * Returns: True if crew requires life support
   * Side effects: None (pure function)
   *
   * Note: Android does not require life support (per rulebook)
   */
  static requiresLifeSupport(crew: AnyCrew): boolean {
    if (crew.type === 'officer' && crew.role === 'android') {
      return false;
    }
    return crew.status === 'active';
  }
}
