/**
 * Purpose: Unit tests for Ship model and utility functions
 * Tests: Ship state calculations and validations
 */

import { describe, it, expect } from 'vitest';
import { Ship, ShipUtils } from './Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';

describe('ShipUtils', () => {
  describe('calculateLifeSupport', () => {
    it('should return 0 when the stored life-support pool is empty', () => {
      /**
       * Test case: Ship with no life-support power
       * Expected: 0 life support
       * Root cause of test: Verify life support calculation from the independent pool
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
        lifeSupportPower: 0,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(0);
    });

    it('should support one crew slot for every 2 stored power', () => {
      /**
       * Test case: Initial pool of 6 stored power
       * Expected: 3 supported crew slots
       * Root cause of test: Verify the canonical power-to-crew conversion
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
        lifeSupportPower: 6,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(3);
    });

    it('should round down partial capacity and ignore powered ship sections', () => {
      /**
       * Test case: All sections fully powered with 7 power in the life-support pool
       * Expected: 3 supported crew slots
       * Root cause of test: Verify sections no longer generate life support
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
        lifeSupportPower: 7,
        position: { ring: 7, space: 0 },
      };

      const lifeSupport = ShipUtils.calculateLifeSupport(ship);
      expect(lifeSupport).toBe(3);
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
        lifeSupportPower: 6,
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
        lifeSupportPower: 6,
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
        lifeSupportPower: 6,
        position: { ring: 7, space: 0 },
      };

      expect(ShipUtils.isDamaged(ship, SHIP_SECTIONS.BRIDGE)).toBe(false);
      expect(ShipUtils.isDamaged(ship, SHIP_SECTIONS.ENGINEERING)).toBe(true);
    });
  });
});
