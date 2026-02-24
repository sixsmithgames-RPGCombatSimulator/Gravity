/**
 * Purpose: Define game board model and object types
 * Single source of truth: Board state and object positions
 * Side effects: None (type definitions and interfaces)
 */

import { ShipPosition } from './Ship';
import type { ResourceType, UpgradeCard } from './Game';

/**
 * Object types on the board
 * Purpose: Enumerate all possible objects in orbit
 */
export type ObjectType =
  | 'hazard'
  | 'asteroid_cluster'
  | 'debris'
  | 'hostile_ship'
  | 'wrecked_ship'
  | 'functional_station';

/**
 * Space object base interface
 * Purpose: Common properties for all objects on board
 *
 * Fields:
 * - id: Unique identifier
 * - type: Object type
 * - position: Location on board
 */
export interface SpaceObject {
  id: string;
  type: ObjectType;
  position: ShipPosition;

  lootResourceType?: ResourceType | null;
  lootUpgrade?: UpgradeCard | null;
  lootRollValue?: number | null;
  lootGeneratedAtTurn?: number;
}

/**
 * Hazard object
 * Purpose: Spatial rift causing radiation damage
 *
 * Effects (from rulebook):
 * - 3 damage to ships within 2 spaces
 * - Unstable spatial fluctuation
 */
export interface Hazard extends SpaceObject {
  type: 'hazard';
}

/**
 * Asteroid cluster
 * Purpose: Dense group of space rocks
 *
 * Effects (from rulebook):
 * - 12 damage on collision
 * - Can be scanned for resources (6+ on d6)
 * - 18 damage to destroy
 */
export interface AsteroidCluster extends SpaceObject {
  type: 'asteroid_cluster';
}

/**
 * Debris field
 * Purpose: Scattered wreckage and scrap
 *
 * Effects (from rulebook):
 * - 6 damage on collision
 * - Can be scanned for resources (4+ on d6)
 * - 6 damage to destroy
 */
export interface Debris extends SpaceObject {
  type: 'debris';
}

/**
 * Hostile ship
 * Purpose: Aggressive vessel
 *
 * Properties:
 * - hull: Current hull points (starts at 8)
 * - hasTorpedo: Whether ship still has torpedo (starts true)
 *
 * Effects (from rulebook):
 * - Moves up to 3 spaces toward nearest player
 * - 6 damage when adjacent
 * - Launches torpedo if 2-3 spaces away
 * - Becomes debris when destroyed
 */
export interface HostileShip extends SpaceObject {
  type: 'hostile_ship';
  hull: number;
  hasTorpedo: boolean;
}

/**
 * Wrecked ship or station
 * Purpose: Damaged derelict
 *
 * Effects (from rulebook):
 * - 9 damage on collision
 * - Can be scanned for resources (2+ on d6) and upgrades (5+ on d6)
 * - 18 damage to become debris
 */
export interface WreckedShip extends SpaceObject {
  type: 'wrecked_ship';
}

/**
 * Functional space station
 * Purpose: Intact station offering trades
 *
 * Effects (from rulebook):
 * - 12 damage on collision
 * - Automatically gain resource when scanned
 * - Upgrade on 4+ when scanned
 * - 18 damage retaliation if attacked
 * - 24 hull + 12 shields to destroy
 */
export interface FunctionalStation extends SpaceObject {
  type: 'functional_station';
  hull: number;
  shields: number;
}

/**
 * Union type for any space object
 */
export type AnySpaceObject =
  | Hazard
  | AsteroidCluster
  | Debris
  | HostileShip
  | WreckedShip
  | FunctionalStation;

/**
 * Orbit ring state
 * Purpose: Track ring rotation and contents
 *
 * Fields:
 * - index: Ring number (1 = innermost, 8 = outermost)
 * - rotation: Current rotation offset (0 to numSpaces-1)
 * - numSpaces: Total spaces on this ring
 * - speedRequirement: Minimum speed to maintain orbit
 * - color: Ring color category (green/yellow/orange/red)
 */
export interface OrbitRing {
  index: number;
  rotation: number;
  numSpaces: number;
  speedRequirement: number;
  color: 'green' | 'yellow' | 'orange' | 'red';
}

/**
 * Game board state
 * Purpose: Complete board configuration
 *
 * Fields:
 * - rings: Array of orbit ring states
 * - objects: All space objects currently on board
 * - rotationDirection: Clockwise or counter-clockwise
 *
 * Single source of truth: Board state stored once
 * Ship positions stored in player state, not duplicated here
 */
export interface Board {
  rings: OrbitRing[];
  objects: AnySpaceObject[];
  rotationDirection: 'clockwise' | 'counter-clockwise';
}

/**
 * Board utility functions
 * Purpose: Board calculations and validations
 */
export class BoardUtils {
  private static getAdjacentPositions(pos: ShipPosition, board: Board): ShipPosition[] {
    const ringDef = board.rings[pos.ring - 1];
    if (!ringDef || ringDef.numSpaces <= 0) {
      return [];
    }

    const nextCandidates: ShipPosition[] = [];

    nextCandidates.push({
      ring: pos.ring,
      space: (pos.space + 1) % ringDef.numSpaces,
    });

    nextCandidates.push({
      ring: pos.ring,
      space: (pos.space - 1 + ringDef.numSpaces) % ringDef.numSpaces,
    });

    if (pos.ring > 1) {
      const inwardRing = board.rings[pos.ring - 2];
      if (inwardRing && inwardRing.numSpaces > 0) {
        const candidates = this.getAdjacentSpacesAcrossRings({
          space: pos.space,
          fromSpaces: ringDef.numSpaces,
          toSpaces: inwardRing.numSpaces,
        });
        for (const candidate of candidates) {
          nextCandidates.push({ ring: pos.ring - 1, space: candidate });
        }
      }
    }

    if (pos.ring < board.rings.length) {
      const outwardRing = board.rings[pos.ring];
      if (outwardRing && outwardRing.numSpaces > 0) {
        const candidates = this.getAdjacentSpacesAcrossRings({
          space: pos.space,
          fromSpaces: ringDef.numSpaces,
          toSpaces: outwardRing.numSpaces,
        });
        for (const candidate of candidates) {
          nextCandidates.push({ ring: pos.ring + 1, space: candidate });
        }
      }
    }

    const unique = new Map<string, ShipPosition>();
    for (const candidate of nextCandidates) {
      unique.set(`${candidate.ring}:${candidate.space}`, candidate);
    }
    return Array.from(unique.values());
  }

  static getPositionsWithinRange(origin: ShipPosition, range: number, board: Board): ShipPosition[] {
    if (!Number.isFinite(range) || range < 0) {
      return [];
    }

    const maxRange = Math.floor(range);
    const encode = (pos: ShipPosition): string => `${pos.ring}:${pos.space}`;

    const visited = new Set<string>();
    const queue: Array<{ pos: ShipPosition; dist: number }> = [];
    const result: ShipPosition[] = [];

    queue.push({ pos: origin, dist: 0 });
    visited.add(encode(origin));

    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const current = queue[queueIndex];
      queueIndex += 1;

      result.push(current.pos);

      if (current.dist >= maxRange) {
        continue;
      }

      const neighbors = this.getAdjacentPositions(current.pos, board);
      for (const next of neighbors) {
        const key = encode(next);
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        queue.push({ pos: next, dist: current.dist + 1 });
      }
    }

    return result;
  }

  private static getAdjacentSpacesAcrossRings(params: {
    space: number;
    fromSpaces: number;
    toSpaces: number;
  }): number[] {
    const { space, fromSpaces, toSpaces } = params;

    if (fromSpaces <= 0 || toSpaces <= 0) {
      return [];
    }

    const normalizedSpace = ((space % fromSpaces) + fromSpaces) % fromSpaces;
    const startFraction = normalizedSpace / fromSpaces;
    const endFraction = (normalizedSpace + 1) / fromSpaces;

    const mappedStart = startFraction * toSpaces;
    const mappedEnd = endFraction * toSpaces;

    let first = Math.floor(mappedStart);
    let last = Math.ceil(mappedEnd) - 1;

    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      return [];
    }

    if (last < first) {
      last = first;
    }

    const result: number[] = [];
    for (let candidate = first; candidate <= last; candidate += 1) {
      const normalized = ((candidate % toSpaces) + toSpaces) % toSpaces;
      if (!result.includes(normalized)) {
        result.push(normalized);
      }
    }

    return result;
  }

  /**
   * Calculate distance between two positions
   * Purpose: Determine spaces between positions for range checks
   * Parameters:
   *   - pos1: First position
   *   - pos2: Second position
   *   - board: Current board state
   * Returns: Number of spaces between positions
   * Side effects: None (pure function)
   *
   * Note: Distance calculation considers both ring and space differences
   */
  static calculateDistance(
    pos1: ShipPosition,
    pos2: ShipPosition,
    board: Board
  ): number {
    // If on same ring, calculate space difference
    if (pos1.ring === pos2.ring) {
      const ring = board.rings[pos1.ring - 1];
      if (!ring) {
        throw new Error(
          'Cannot calculate distance because the ring is missing from board state. ' +
            `Root cause: pos1.ring=${pos1.ring} but board has ${board.rings.length} rings. ` +
            'Fix: Ensure all positions are validated against the board before calculating distance.'
        );
      }
      const spaceDiff = Math.abs(pos1.space - pos2.space);
      // Shortest path around ring
      return Math.min(spaceDiff, ring.numSpaces - spaceDiff);
    }

    const startRing = board.rings[pos1.ring - 1];
    const targetRing = board.rings[pos2.ring - 1];

    if (!startRing || !targetRing) {
      throw new Error(
        'Cannot calculate distance because one or both positions are on a non-existent ring. ' +
          `Root cause: pos1.ring=${pos1.ring}, pos2.ring=${pos2.ring}, board has ${board.rings.length} rings. ` +
          'Fix: Ensure all positions are validated against the board before calculating distance.'
      );
    }

    const encode = (pos: ShipPosition): string => `${pos.ring}:${pos.space}`;
    const targetKey = encode(pos2);

    const visited = new Set<string>();
    const queue: Array<{ pos: ShipPosition; dist: number }> = [];

    queue.push({ pos: pos1, dist: 0 });
    visited.add(encode(pos1));

    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const current = queue[queueIndex];
      queueIndex += 1;

      const currentKey = encode(current.pos);
      if (currentKey === targetKey) {
        return current.dist;
      }

      const ringDef = board.rings[current.pos.ring - 1];
      if (!ringDef || ringDef.numSpaces <= 0) {
        continue;
      }

      const nextCandidates = this.getAdjacentPositions(current.pos, board);

      for (const next of nextCandidates) {
        const key = encode(next);
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        queue.push({ pos: next, dist: current.dist + 1 });
      }
    }

    throw new Error(
      'Cannot calculate distance because no path exists between the two positions. ' +
        `Root cause: start=${encode(pos1)}, target=${encode(pos2)}. ` +
        'Fix: Ensure the board ring/space graph is connected and positions are valid.'
    );
  }

  /**
   * Check if position is valid on board
   * Purpose: Validate position coordinates
   * Parameters:
   *   - position: Position to validate
   *   - board: Current board state
   * Returns: True if position is valid
   * Side effects: None (pure function)
   */
  static isValidPosition(position: ShipPosition, board: Board): boolean {
    if (position.ring < 1 || position.ring > board.rings.length) {
      return false;
    }

    const ring = board.rings[position.ring - 1];
    if (position.space < 0 || position.space >= ring.numSpaces) {
      return false;
    }

    return true;
  }

  /**
   * Get ring color category
   * Purpose: Determine damage zone for position
   * Parameters:
   *   - ring: Ring index (1-8)
   * Returns: Color category
   * Side effects: None (pure function)
   */
  static getRingColor(ring: number): 'green' | 'yellow' | 'orange' | 'red' {
    if (ring >= 7) return 'green';
    if (ring >= 5) return 'yellow';
    if (ring >= 3) return 'orange';
    return 'red';
  }

  /**
   * Find objects at position
   * Purpose: Get all objects at specific coordinates
   * Parameters:
   *   - position: Position to check
   *   - board: Current board state
   * Returns: Array of objects at position
   * Side effects: None (pure function)
   */
  static getObjectsAtPosition(
    position: ShipPosition,
    board: Board
  ): AnySpaceObject[] {
    return board.objects.filter(
      obj => obj.position.ring === position.ring &&
             obj.position.space === position.space
    );
  }
}
