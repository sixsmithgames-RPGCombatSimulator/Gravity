/**
 * Purpose: Lock the canonical mission values and end-game tie-break ordering.
 * Root cause: Scoring had multiple implementations and the UI previously sorted only by total points.
 */
import { describe, expect, it } from 'vitest';

import { CORE_MISSION_CARDS } from '../constants/CardConfig';
import type { VictoryPointBreakdown } from './index';
import { compareVictoryPointBreakdowns } from './index';

/** Create a complete score breakdown while allowing one test to vary only the relevant fields. */
function createBreakdown(overrides: Partial<VictoryPointBreakdown> = {}): VictoryPointBreakdown {
  return {
    escape: 0,
    missions: 0,
    missionBase: 0,
    missionMultiplier: 1,
    functionalSections: 0,
    fullyPoweredSections: 0,
    upgrades: 0,
    crew: 0,
    hull: 0,
    shields: 0,
    storedPower: 0,
    installedUpgradeCount: 0,
    fullyPoweredSectionCount: 0,
    activeCrewCount: 0,
    total: 100,
    ...overrides,
  };
}

describe('victory scoring configuration', () => {
  it('awards 25 points for first-tier missions and 10 additional points for second-tier missions', () => {
    for (const mission of CORE_MISSION_CARDS) {
      expect(mission.objectives.primary.points).toBe(25);
      expect(mission.objectives.secondary.points).toBe(10);
    }
  });

  it('sorts by total, then mission, upgrades, powered sections, crew, and stored power', () => {
    expect(compareVictoryPointBreakdowns(createBreakdown({ total: 101 }), createBreakdown())).toBeLessThan(0);
    expect(compareVictoryPointBreakdowns(createBreakdown({ missions: 20 }), createBreakdown({ missions: 10 }))).toBeLessThan(0);
    expect(
      compareVictoryPointBreakdowns(
        createBreakdown({ missions: 10, installedUpgradeCount: 2 }),
        createBreakdown({ missions: 10, installedUpgradeCount: 1 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareVictoryPointBreakdowns(
        createBreakdown({ fullyPoweredSectionCount: 3 }),
        createBreakdown({ fullyPoweredSectionCount: 2 }),
      ),
    ).toBeLessThan(0);
    expect(compareVictoryPointBreakdowns(createBreakdown({ activeCrewCount: 4 }), createBreakdown({ activeCrewCount: 3 }))).toBeLessThan(0);
    expect(compareVictoryPointBreakdowns(createBreakdown({ storedPower: 8 }), createBreakdown({ storedPower: 7 }))).toBeLessThan(0);
    expect(compareVictoryPointBreakdowns(createBreakdown(), createBreakdown())).toBe(0);
  });
});
