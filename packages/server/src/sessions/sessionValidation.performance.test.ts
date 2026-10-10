import { performance } from 'node:perf_hooks';

import { applyPlayerActions, deserializeGameStateSnapshot, SECTION_CONFIG, SHIP_SECTIONS, type PlayerAction } from '@gravity/core';
import { describe, expect, it } from 'vitest';

import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { validateSessionPlan } from './sessionValidation';
import type { SessionParticipant } from './types';

/** Create six active human plans spanning seven canonical stages, with deterministic separate targets. */
function createSixPlayerFixture() {
  const now = new Date('2026-10-10T12:00:00.000Z');
  const participants: SessionParticipant[] = Array.from({ length: 6 }, (_, index) => ({
    id: `participant-${index}`, sessionId: 'preflight-performance', userId: `human-${index}`, playerId: `player-${index}`,
    displayName: `Human ${index + 1}`, seatNumber: index + 1, isReady: true, isBot: false, isHost: index === 0, joinedAt: now, updatedAt: now,
  }));
  const snapshot = gravitySessionGameFactory.create({ sessionId: participants[0].sessionId, participants, maxPlayers: 6, now });
  snapshot.game.board.objects = [];
  const plans: Record<string, PlayerAction[]> = {};
  for (const player of snapshot.game.players) {
    player.ship.position = { ring: 8, space: 0 };
    player.ship.speed = 0;
    player.ship.lifeSupportPower = 18;
    for (const section of Object.values(SHIP_SECTIONS)) {
      player.ship.sections[section].hull = SECTION_CONFIG[section].maxHull;
      player.ship.sections[section].powerDice = [6];
    }
    player.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice = [3];
    player.ship.sections[SHIP_SECTIONS.ENGINEERING].hull -= 2;
    player.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice = [2];
    const locations = { pilot: SHIP_SECTIONS.BRIDGE, engineer: SHIP_SECTIONS.ENGINEERING, medic: SHIP_SECTIONS.MED_LAB,
      scientist: SHIP_SECTIONS.SCI_LAB, tactician: SHIP_SECTIONS.DEFENSE, first_officer: SHIP_SECTIONS.SCI_LAB, chief_engineer: SHIP_SECTIONS.ENGINEERING };
    for (const crew of player.crew) {
      crew.status = crew.type === 'basic' && crew.role === 'pilot' ? 'unconscious' : 'active';
      const location = crew.type === 'captain' ? SHIP_SECTIONS.BRIDGE : locations[crew.role as keyof typeof locations];
      if (!location) throw new Error('Performance fixture contains an unsupported crew role.');
      crew.location = location;
    }
    const debrisId = `${player.id}:debris`;
    const hostileId = `${player.id}:hostile`;
    snapshot.game.board.objects.push(
      { id: debrisId, type: 'debris', position: { ring: 8, space: 1 }, lootResourceType: 'fuel_cell', lootRollValue: 6 },
      { id: hostileId, type: 'hostile_ship', position: { ring: 8, space: 1 }, hull: 100, hasTorpedo: false },
    );
    plans[player.id] = [
      { playerId: player.id, crewId: `${player.id}:chief-engineer`, type: 'restore' },
      { playerId: player.id, crewId: `${player.id}:engineer`, type: 'repair', target: { section: SHIP_SECTIONS.ENGINEERING }, parameters: { repairType: 'hull' } },
      { playerId: player.id, crewId: `${player.id}:medic`, type: 'revive', parameters: { targetCrewId: `${player.id}:pilot` } },
      { playerId: player.id, crewId: player.captain.id, type: 'maneuver', parameters: { direction: 'forward', powerSpent: 1 } },
      { playerId: player.id, crewId: `${player.id}:first-officer`, type: 'scan', target: { objectId: debrisId } },
      { playerId: player.id, crewId: `${player.id}:scientist`, type: 'acquire', target: { objectId: debrisId } },
      { playerId: player.id, crewId: `${player.id}:tactician`, type: 'attack', target: { objectId: hostileId } },
    ];
  }
  return { snapshot, plans };
}

/** Report a nearest-rank percentile without imposing machine-specific timing assertions on unit CI. */
function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return Number(ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)].toFixed(3));
}

describe('canonical plan preflight performance evidence', () => {
  it('measures detached preflight for six diverse legal plans and preserves the committed state', () => {
    const { snapshot, plans } = createSixPlayerFixture();
    const before = structuredClone(snapshot);
    const game = deserializeGameStateSnapshot(snapshot).game;
    // Independent and combined resolution must both accept the measured fixture.
    expect(() => applyPlayerActions({ ...game, turnPhase: 'action_execution' }, plans)).not.toThrow();
    const perPlan: number[] = [];
    const perSixPlayerBatch: number[] = [];
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const batchStart = performance.now();
      for (const player of snapshot.game.players) {
        const start = performance.now();
        validateSessionPlan(snapshot, player.id, plans[player.id]);
        if (iteration >= 10) perPlan.push(performance.now() - start);
      }
      if (iteration >= 10) perSixPlayerBatch.push(performance.now() - batchStart);
    }
    expect(snapshot).toEqual(before);
    expect(perPlan).toHaveLength(240);
    expect(perPlan.every(Number.isFinite)).toBe(true);
    console.info('GRAVITY_PREFLIGHT_PERFORMANCE', JSON.stringify({ node: process.version, players: 6, actionsPerPlayer: 7,
      samples: perPlan.length, planMs: { p50: percentile(perPlan, 0.5), p95: percentile(perPlan, 0.95), max: percentile(perPlan, 1) },
      sixPlanBatchMs: { p50: percentile(perSixPlayerBatch, 0.5), p95: percentile(perSixPlayerBatch, 0.95), max: percentile(perSixPlayerBatch, 1) },
      scope: 'local CPU preflight only; excludes database lock waits, HTTP, bot generation and network latency' }));
  });

  it('does not resolve unrelated empty-player life support, wrecks or unconscious crew', () => {
    const { snapshot } = createSixPlayerFixture();
    const player = snapshot.game.players[0];
    for (const idle of snapshot.game.players.slice(1)) {
      idle.ship.lifeSupportPower = 0;
      for (const section of Object.values(SHIP_SECTIONS)) {
        idle.ship.sections[section].hull = 0;
        idle.ship.sections[section].powerDice = [];
      }
      idle.captain.status = 'unconscious';
      idle.captain.location = null;
      for (const crew of idle.crew) { crew.status = 'unconscious'; crew.location = null; }
    }
    const before = structuredClone(snapshot);
    expect(() => validateSessionPlan(snapshot, player.id, [{ playerId: player.id, crewId: `${player.id}:chief-engineer`, type: 'restore' }])).not.toThrow();
    expect(snapshot).toEqual(before);
  });
});
