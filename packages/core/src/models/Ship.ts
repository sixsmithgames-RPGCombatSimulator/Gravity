/**
 * Purpose: Define ship state model and related types
 * Single source of truth: Ship configuration and state
 * Side effects: None (type definitions and interfaces)
 */

import { SHIP_SECTIONS, ShipSection, SECTION_CONFIG } from '../constants/GameConfig';

/**
 * Ship section state
 * Purpose: Track hull, power, and damage for a single section
 *
 * Fields:
 * - hull: Current hull points (0 = damaged)
 * - powerDice: Array of d6 values representing power in section (each at 1-6)
 * - isFullyPowered: Computed - all power dice at 6
 * - isFunctional: Computed - hull > 0 and power > 0
 * - isDamaged: Computed - hull === 0
 * - isDisabled: Computed - all conduits overloaded
 */
export interface ShipSectionState {
  hull: number;
  powerDice: number[]; // Array of dice values (1-6)
  corridors: Record<ShipSection, number>; // Corridors to other sections (0 = damaged, 1 = intact) - crew movement
  conduitConnections: Record<ShipSection, number>; // Conduit paths to other sections - count of conduits on connection (0 = none/damaged)
}

/**
 * Ship position on game board
 * Purpose: Track location in orbit system
 *
 * Fields:
 * - ring: Ring index (1 = innermost, 8 = outermost)
 * - space: Space index on ring (0-based)
 */
export interface ShipPosition {
  ring: number;
  space: number;
}

/**
 * Complete ship state
 * Purpose: Single source of truth for all ship data
 *
 * Fields:
 * - sections: State of all 6 sections
 * - speed: Current forward speed
 * - shields: Current shield level
 * - position: Location on game board
 *
 * Single source of truth: All ship data stored here, no duplication
 * Life support is computed from powered sections, not stored
 * Functional/damaged status computed from hull/power, not stored
 */
export interface Ship {
  sections: Record<ShipSection, ShipSectionState>;
  speed: number;
  shields: number;
  lifeSupportPower?: number;
  position: ShipPosition;
}

/**
 * Ship utility functions
 * Purpose: Compute derived ship properties
 */
export class ShipUtils {
  /**
   * Calculate total life support from powered sections
   * Purpose: Compute life support capacity
   * Parameters:
   *   - ship: Current ship state
   * Returns: Total life support points available
   * Side effects: None (pure function)
   *
   * Root cause of implementation: Life support is derived from section states,
   * not stored separately (single source of truth principle)
   */
  static calculateLifeSupport(ship: Ship): number {
    const contributions = this.getLifeSupportContributions(ship);

    return Object.values(contributions).reduce((sum, value) => sum + value, 0);
  }

  /**
   * Get life support contributions by section
   * Purpose: Provide a breakdown of how much life support each fully powered section contributes
   * Parameters:
   *   - ship: Current ship state
   * Returns: Record mapping ShipSection -> life support points contributed
   * Side effects: None (pure function)
   *
   * Root cause of implementation: UI and engine consumers need a detailed view
   * of life support sources without duplicating configuration values.
   */
  static getLifeSupportContributions(ship: Ship): Record<ShipSection, number> {
    const contributions: Record<ShipSection, number> = {} as Record<ShipSection, number>;

    // Bridge provides life support when fully powered
    contributions[SHIP_SECTIONS.BRIDGE as ShipSection] = this.isFullyPowered(
      ship,
      SHIP_SECTIONS.BRIDGE,
    )
      ? 3
      : 0;

    // Engineering provides life support when fully powered
    contributions[SHIP_SECTIONS.ENGINEERING as ShipSection] = this.isFullyPowered(
      ship,
      SHIP_SECTIONS.ENGINEERING,
    )
      ? 4
      : 0;

    // Med Lab provides life support when fully powered
    contributions[SHIP_SECTIONS.MED_LAB as ShipSection] = this.isFullyPowered(
      ship,
      SHIP_SECTIONS.MED_LAB,
    )
      ? 4
      : 0;

    // Sci Lab provides life support when fully powered
    contributions[SHIP_SECTIONS.SCI_LAB as ShipSection] = this.isFullyPowered(
      ship,
      SHIP_SECTIONS.SCI_LAB,
    )
      ? 2
      : 0;

    // Defense provides life support when fully powered
    contributions[SHIP_SECTIONS.DEFENSE as ShipSection] = this.isFullyPowered(
      ship,
      SHIP_SECTIONS.DEFENSE,
    )
      ? 1
      : 0;

    return contributions;
  }

  /**
   * Check if section is fully powered
   * Purpose: Determine if section provides full benefits
   * Parameters:
   *   - ship: Current ship state
   *   - section: Section to check
   * Returns: True if section has hull, conduits, and total power >= required
   * Side effects: None (pure function)
   */
  static isFullyPowered(ship: Ship, section: ShipSection): boolean {
    const sectionState = ship.sections[section];
    if (!sectionState) {
      return false;
    }

    const hasConduitConnection = Object.values(sectionState.conduitConnections ?? {}).some(
      (count) => (count ?? 0) > 0,
    );

    // Section must be structurally intact and able to route power
    if (sectionState.hull <= 0 || !hasConduitConnection) {
      return false;
    }

    const totalPower = sectionState.powerDice.reduce((sum, die) => sum + die, 0);
    const config = SECTION_CONFIG[section];

    // Fallback: if no config is found (should not happen), treat as not fully powered
    if (!config) {
      return false;
    }

    const requiredPower = config.powerRequired ?? 0;

    if (requiredPower <= 0) {
      return false;
    }

    return totalPower >= requiredPower;
  }

  /**
   * Check if section is functional
   * Purpose: Determine if section can be used
   * Parameters:
   *   - ship: Current ship state
   *   - section: Section to check
   * Returns: True if hull > 0 and has at least 1 power
   * Side effects: None (pure function)
   */
  static isFunctional(ship: Ship, section: ShipSection): boolean {
    const sectionState = ship.sections[section];
    if (!sectionState) {
      return false;
    }

    const hasHull = sectionState.hull > 0;
    const hasPower = sectionState.powerDice.length > 0 &&
                     sectionState.powerDice.some(die => die > 0);

    return hasHull && hasPower;
  }

  /**
   * Check if section is damaged
   * Purpose: Determine if section needs repair
   * Parameters:
   *   - ship: Current ship state
   *   - section: Section to check
   * Returns: True if hull === 0
   * Side effects: None (pure function)
   */
  static isDamaged(ship: Ship, section: ShipSection): boolean {
    return ship.sections[section]?.hull === 0;
  }

  /**
   * Check if section is disabled
   * Purpose: Determine if section has no power due to overloaded conduits
   * Parameters:
   *   - ship: Current ship state
   *   - section: Section to check
   * Returns: True if all conduits overloaded
   * Side effects: None (pure function)
   */
  static isDisabled(ship: Ship, section: ShipSection): boolean {
    const sectionState = ship.sections[section];
    if (!sectionState) {
      return true;
    }

    return !Object.values(sectionState.conduitConnections ?? {}).some(
      (count) => (count ?? 0) > 0,
    );
  }

  /**
   * Calculate total power in a section
   * Purpose: Sum all power dice values
   * Parameters:
   *   - ship: Current ship state
   *   - section: Section to calculate
   * Returns: Total power points in section
   * Side effects: None (pure function)
   */
  static getTotalPower(ship: Ship, section: ShipSection): number {
    const powerDice = ship.sections[section]?.powerDice || [];
    return powerDice.reduce((sum, die) => sum + die, 0);
  }

  /**
   * Check if ship is wrecked
   * Purpose: Determine if ship has suffered catastrophic damage
   * Parameters:
   *   - ship: Current ship state
   * Returns: True if ship meets wrecked criteria
   * Side effects: None (pure function)
   *
   * Wrecked criteria (per current rules):
   * - Total hull across all sections is 0 (ship has no remaining structure)
   * - Total life support is 0 (ship can no longer support crew)
   */
  static isWrecked(ship: Ship): boolean {
    const sections = Object.values(ship.sections);

    const functionalSections = sections.filter((section) => section.hull > 0).length;

    if (functionalSections < 2) {
      return true;
    }

    const hasAnyConduit = sections.some((section) =>
      Object.values(section.conduitConnections ?? {}).some((count) => (count ?? 0) > 0),
    );

    if (!hasAnyConduit) {
      return true;
    }

    const hasAnyCorridor = sections.some((section) =>
      Object.values(section.corridors ?? {}).some((state) => state === 1),
    );

    if (!hasAnyCorridor) {
      return true;
    }

    return false;
  }
}
