# Gravity rules parity matrix

Updated: 2026-08-01  
Authority: [`docs/Gravity_Rules_Current.md`](./Gravity_Rules_Current.md)

This matrix turns beta-critical rules into a reviewable contract across the rulebook, engine configuration, engine behavior, tests, and player-facing copy. A rule is beta-ready only when every applicable column agrees.

| Rule area | Canonical rule | Engine/config authority | Automated contract | Player-facing surface | Status |
| --- | --- | --- | --- | --- | --- |
| Standard ship setup | Bridge 6; Engineering 9; Drives 0; Med-Lab 2; Sci-Lab 0; Defense 0 | `INITIAL_SHIP_STATE`, `createInitialShip(..., 'hard')` | `canonicalRulesContract.test.ts` | Ship dashboard | Aligned |
| Starting power | Bridge die 6 plus empty slot; Engineering dice 1 and 1; all other sections empty | `INITIAL_SHIP_STATE` | `canonicalRulesContract.test.ts` | Ship dashboard | Aligned |
| Life support | Independent pool of 6; 2 power per supported crew; Android exempt | `LIFE_SUPPORT_CONFIG`, `Ship.lifeSupportPower` | `lifeSupport.test.ts`, `canonicalRulesContract.test.ts` | Ship dashboard | Aligned |
| Event cadence | Event every fourth turn | `TURN_CONFIG.EVENT_FREQUENCY` | `eventInfallSpawns.test.ts` | Turn/event UI | Aligned |
| Event infall count | Number of players + 3 | `INFALL_CONFIG.SPAWN_COUNT_BONUS`, `applyInfallObjectSpawns` | `eventInfallSpawns.test.ts` | Board/event UI | Aligned |
| Event infall mix | Exactly 1 Hazard; remaining objects 35% Asteroid Cluster, 40% Debris, 25% Wrecked Ship | `INFALL_CONFIG`, `applyInfallObjectSpawns` | `eventInfallSpawns.test.ts`, `canonicalRulesContract.test.ts` | Board/event UI | Aligned |
| Standard Functional Stations | None at standard setup; scenario or event only | Mock board seeding | Browser verification | Board | Aligned |
| Starting ship placement | Support 2–6 players; distribute outer-ring gaps evenly, differing by at most one space | `startGame` | `eventInfallSpawns.test.ts` | Board | Aligned |
| First Officer bonuses | +1 maneuver, 2× repair, +2 power, +1 shield, +1 revive, +1 Sci-Lab scan/acquire, +1 attack, +1 Medical Kit/Probe assembly | Engine role bonus helpers | Existing action tests plus `canonicalRulesContract.test.ts` for copy | Officer card/help | Copy aligned; direct role coverage incomplete |
| End-game scoring | Escape, mission, section, upgrade, crew, hull, shield, and stored-power components with deterministic tiebreakers | Victory scoring helpers | `victoryScoring.test.ts` | End-game breakdown | Aligned for covered cases |

## Beta acceptance rule

Any change to a Tier-1 rule must update the canonical rulebook first, then the engine/config authority, automated contract, and player-facing copy in the same change. A status of “Aligned” means the known values match; it does not replace playtesting for balance or usability.

## Remaining contract gaps

- Add direct action-resolution coverage for every First Officer bonus rather than relying on shared role helpers and copy assertions.
- Add scenario setup contracts once scenario selection is exposed in the product.
- Add browser-level assertions for visible setup values and event composition after the multiplayer session UI exists.
- Extend this matrix to every captain, officer, upgrade, event, and mission before release candidate.
