/**
 * Purpose: Unit tests for Ship model and utility functions
 * Tests: Ship state calculations and validations
 */

import { describe, it, expect } from 'vitest';
import { Ship, ShipUtils } from './Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';

describe('ShipUtils', () => {
  describe('calculateLifeSupport', () => {
    it('should return 0 for ship with no powered sections', () => {
      /**
       * Test case: Ship with no power
       * Expected: 0 life support
       * Root cause of test: Verify life support calculation when no sections powered
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 2, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(0);
    });

    it('should return 3 when only Bridge is fully powered', () => {
      /**
       * Test case: Bridge fully powered (power die at 6)
       * Expected: 3 life support
       * Root cause of test: Verify Bridge provides 3 life support per rulebook
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 3, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 2, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(3);
    });

    it('should return 14 when all sections fully powered', () => {
      /**
       * Test case: All sections fully powered
       * Expected: 3 + 4 + 4 + 2 + 1 = 14 life support
       * Root cause of test: Verify total life support from all sections
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 12, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 18, powerDice: [6, 6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 12, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 6, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 6, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 6, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(14);
    });
  });

  describe('isFullyPowered', () => {
    it('should return true when all power dice are at 6', () => {
      /**
       * Test case: Section with power die at 6
       * Expected: true
       * Root cause of test: Verify fully powered detection
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 3, powerDice: [6], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 2, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      expect(ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.BRIDGE)).toBe(true);
      expect(ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.ENGINEERING)).toBe(false);
    });
  });

  describe('isFunctional', () => {
    it('should return true when section has hull and power', () => {
      /**
       * Test case: Section with hull and power
       * Expected: true (functional)
       * Root cause of test: Verify functional status calculation
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 0, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 1, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 2, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      expect(ShipUtils.isFunctional(ship, SHIP_SECTIONS.BRIDGE)).toBe(true);
      expect(ShipUtils.isFunctional(ship, SHIP_SECTIONS.ENGINEERING)).toBe(false); // No hull
      expect(ShipUtils.isFunctional(ship, SHIP_SECTIONS.DRIVES)).toBe(false); // No power
    });
  });

  describe('isDamaged', () => {
    it('should return true when hull is 0', () => {
      /**
       * Test case: Section with 0 hull
       * Expected: true (damaged)
       * Root cause of test: Verify damaged status detection
       */
      const ship: Ship = {
        sections: {
          [SHIP_SECTIONS.BRIDGE]: { hull: 3, powerDice: [1], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.ENGINEERING]: 1 } as any },
          [SHIP_SECTIONS.ENGINEERING]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DRIVES]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.MED_LAB]: 1 } as any },
          [SHIP_SECTIONS.MED_LAB]: { hull: 2, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.SCI_LAB]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.BRIDGE]: 1 } as any },
          [SHIP_SECTIONS.DEFENSE]: { hull: 0, powerDice: [], corridors: {} as any, conduitConnections: { [SHIP_SECTIONS.SCI_LAB]: 1 } as any },
        },
        speed: 0,
        shields: 0,
        position: { ring: 7, space: 0 },
      };

      expect(ShipUtils.isDamaged(ship, SHIP_SECTIONS.BRIDGE)).toBe(false);
      expect(ShipUtils.isDamaged(ship, SHIP_SECTIONS.ENGINEERING)).toBe(true);
    });
  });
});
