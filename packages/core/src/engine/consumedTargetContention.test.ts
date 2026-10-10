import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants';
import type { PlayerAction } from '../models';
import { addPlayerToGame, applyPlayerActions, createInitialShip, createNewGame, startGame } from './index';

/** Create explicit target contention without environment movement so causal resolution is directly observable. */
function createFixture(type: 'hazard' | 'debris') {
  const now = new Date('2026-10-10T12:00:00.000Z');
  let game = createNewGame({ id: 'consumed-target-contention', createdAt: now,
    settings: { maxPlayers: 2, rotationDirection: 'clockwise', expansions: ['core'] }, boardSpeedByRing: [1, 1, 1, 1, 1, 1, 1, 1] });
  for (const id of ['first', 'second']) {
    const ship = createInitialShip({ ring: 8, space: 0 });
    ship.sections[SHIP_SECTIONS.SCI_LAB] = { ...ship.sections[SHIP_SECTIONS.SCI_LAB], hull: 6, powerDice: [6] };
    ship.sections[SHIP_SECTIONS.BRIDGE].powerDice = [6];
    const progress = { reviveProgress: 0, assembleProgress: 0, assembleItemType: null };
    game = addPlayerToGame(game, { id, userId: id, isBot: false, ship,
      crew: [{ ...progress, id: `${id}:scientist`, name: 'Scientist', type: 'basic', role: 'scientist', status: 'active', location: SHIP_SECTIONS.SCI_LAB }],
      captain: { ...progress, id: `${id}:captain`, name: 'Captain', type: 'captain', captainType: 'merchant', status: 'active', location: SHIP_SECTIONS.BRIDGE } });
  }
  game = startGame(game, { startedAt: now });
  game = { ...game, turnPhase: 'action_execution', board: { ...game.board,
    objects: [{ id: 'shared', type, position: { ring: 8, space: 0 }, lootResourceType: 'fuel_cell' }] },
    players: new Map(Array.from(game.players, ([id, player]) => [id, { ...player,
      ship: { ...player.ship, position: { ring: 8, space: 0 } }, resources: { ...player.resources, probe: 1, torpedo: 1 },
      installedUpgrades: [{ id: 'tachyon_beam', name: 'Tachyon Beam', description: 'Test', powerRequired: 6, storedPower: 6, section: SHIP_SECTIONS.SCI_LAB, effects: {} }],
      scanDiscoveriesByObjectId: { shared: { objectId: 'shared', objectType: type, source: 'scan', rollValue: 6, totalRoll: 6,
        foundResource: true, resourceType: 'fuel_cell', foundUpgrade: false, reservedUpgrade: null, revealedAtTurn: game.currentTurn, crewId: player.captain.id } },
    }])) };
  return game;
}

/** Build normal canonical assignments; target removal is never a client-provided flag. */
function scan(id: string): PlayerAction { return { playerId: id, crewId: `${id}:scientist`, type: 'scan', target: { objectId: 'shared' } }; }
function acquire(id: string): PlayerAction { return { playerId: id, crewId: `${id}:captain`, type: 'acquire', target: { objectId: 'shared' } }; }
function launch(id: string, launchType: 'probe' | 'torpedo'): PlayerAction {
  return { playerId: id, crewId: `${id}:captain`, type: 'launch', target: { objectId: 'shared' }, parameters: { launchType } };
}

describe('turn-scoped consumed-target contention', () => {
  it.each([true, false])('handles a shared hazard in either player order (reverse=%s) without duplicate effects', (reverse) => {
    const game = createFixture('hazard');
    if (reverse) for (const player of game.players.values()) player.playerOrder = 1 - player.playerOrder;
    const before = structuredClone(game);
    const plans = { first: [scan('first')], second: [scan('second')] };
    const resolved = applyPlayerActions(game, plans);
    expect(resolved.board.objects).toEqual([]);
    for (const player of resolved.players.values()) {
      expect(player.ship.sections[SHIP_SECTIONS.SCI_LAB].powerDice).toEqual([5]);
      expect(player.resources).toEqual(game.players.get(player.id)?.resources);
    }
    expect(applyPlayerActions(game, plans)).toEqual(resolved);
    expect(game).toEqual(before);
  });

  it.each(['probe', 'torpedo'] as const)('spends a %s when Acquire consumes its target first, for either player order', (launchType) => {
    for (const acquirerId of ['first', 'second']) {
      const launcherId = acquirerId === 'first' ? 'second' : 'first';
      const game = createFixture('debris');
      const before = structuredClone(game);
      const plans = { [acquirerId]: [acquire(acquirerId)], [launcherId]: [launch(launcherId, launchType)] };
      const resolved = applyPlayerActions(game, plans);
      expect(resolved.board.objects).toEqual([]);
      const launcher = resolved.players.get(launcherId);
      expect(launcher?.resources).toEqual({ ...game.players.get(launcherId)?.resources, [launchType]: 0 });
      expect(launcher?.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice).toEqual([5]);
      expect(launcher?.scanDiscoveriesByObjectId).toEqual({});
      expect(applyPlayerActions(game, plans)).toEqual(resolved);
      expect(game).toEqual(before);
    }
  });

  it('spends a normal later Scan without revealing a hazard already cleared by a Tachyon Beam', () => {
    const game = createFixture('hazard');
    game.players.get('second')!.installedUpgrades = [];
    game.players.get('second')!.scanDiscoveriesByObjectId = {};
    const resolved = applyPlayerActions(game, { first: [scan('first')], second: [scan('second')] });
    expect(resolved.board.objects).toEqual([]);
    expect(resolved.players.get('second')?.ship.sections[SHIP_SECTIONS.SCI_LAB].powerDice).toEqual([5]);
    expect(resolved.players.get('second')?.scanDiscoveriesByObjectId).toEqual({});
  });

  it('does not hide invalid actor, location, power, range, ammunition or originally missing target failures', () => {
    const check = (kind: 'scan' | 'probe' | 'torpedo', mutate: (game: ReturnType<typeof createFixture>, plans: Record<string, PlayerAction[]>) => void, expected: string) => {
      const game = createFixture(kind === 'scan' ? 'hazard' : 'debris');
      const plans = { first: [kind === 'scan' ? scan('first') : acquire('first')], second: [kind === 'scan' ? scan('second') : launch('second', kind)] };
      mutate(game, plans);
      const before = structuredClone(game);
      expect(() => applyPlayerActions(game, plans)).toThrow(expected);
      expect(game).toEqual(before);
    };
    check('scan', (_, plans) => { plans.second[0].crewId = 'missing'; }, 'crewId');
    check('probe', game => { game.players.get('second')!.captain.location = SHIP_SECTIONS.SCI_LAB; }, 'not in Bridge');
    check('scan', game => { game.players.get('second')!.ship.sections[SHIP_SECTIONS.SCI_LAB].powerDice = []; }, 'no power');
    check('scan', game => { game.players.get('second')!.ship.position = { ring: 8, space: 8 }; }, 'out of range');
    check('probe', game => { game.players.get('second')!.resources.probe = 0; }, 'no probes');
    check('torpedo', game => { game.players.get('second')!.resources.torpedo = 0; }, 'no torpedoes');
    check('probe', game => { game.board.objects = []; }, 'unknown board object');
  });
});
