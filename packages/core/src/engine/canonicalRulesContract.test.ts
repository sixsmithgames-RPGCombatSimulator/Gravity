import { describe, expect, it } from 'vitest';

import {
  CORE_OFFICER_CARDS,
  INFALL_CONFIG,
  LIFE_SUPPORT_CONFIG,
  SHIP_SECTIONS,
} from '../constants';
import { createInitialShip } from './index';

describe('canonical rules contract', () => {
  it('creates the documented standard starting ship on hard difficulty', () => {
    const ship = createInitialShip({ ring: 8, space: 0 }, 'hard');

    expect(ship.sections[SHIP_SECTIONS.BRIDGE]).toMatchObject({ hull: 6, powerDice: [6, 0] });
    expect(ship.sections[SHIP_SECTIONS.ENGINEERING]).toMatchObject({ hull: 9, powerDice: [1, 1] });
    expect(ship.sections[SHIP_SECTIONS.DRIVES]).toMatchObject({ hull: 0, powerDice: [] });
    expect(ship.sections[SHIP_SECTIONS.MED_LAB]).toMatchObject({ hull: 2, powerDice: [] });
    expect(ship.sections[SHIP_SECTIONS.SCI_LAB]).toMatchObject({ hull: 0, powerDice: [] });
    expect(ship.sections[SHIP_SECTIONS.DEFENSE]).toMatchObject({ hull: 0, powerDice: [] });
    expect(ship.speed).toBe(0);
    expect(ship.shields).toBe(0);
  });

  it('uses the independent six-power life-support pool', () => {
    const ship = createInitialShip({ ring: 8, space: 0 }, 'hard');

    expect(LIFE_SUPPORT_CONFIG).toEqual({
      INITIAL_POOL: 6,
      POWER_PER_CREW: 2,
    });
    expect(ship.lifeSupportPower).toBe(6);
  });

  it('defines Event infall as players plus three with one required hazard', () => {
    expect(INFALL_CONFIG).toEqual({
      SPAWN_COUNT_BONUS: 3,
      REQUIRED_HAZARD_COUNT: 1,
      OBJECT_TYPE_WEIGHTS: [
        { type: 'asteroid_cluster', weight: 0.35 },
        { type: 'debris', weight: 0.4 },
        { type: 'wrecked_ship', weight: 0.25 },
      ],
    });
  });

  it('keeps First Officer player-facing copy aligned with implemented bonuses', () => {
    const firstOfficer = CORE_OFFICER_CARDS.find((card) => card.role === 'first_officer');

    expect(firstOfficer?.effects.rulesText).toBe(
      'Competence: stands in for any basic role (as long as they are in the correct section).\n' +
        'Maneuver: +1 acceleration.\n' +
        'Repair: 2× repairs.\n' +
        'Restore: +2 power; +1 shield when restoring in Defense.\n' +
        'Scan/Acquire: +1 range when scanning from the Sci-Lab.\n' +
        'Revive: +1.\n' +
        'Attack: +1 damage.\n' +
        'Assemble: +1 on Medical Kit / Probe.',
    );
  });
});
