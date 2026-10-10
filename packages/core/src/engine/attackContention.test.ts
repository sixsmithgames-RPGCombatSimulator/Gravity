import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants';
import type { PlayerAction } from '../models';
import { addPlayerToGame, applyPlayerActions, createInitialShip, createNewGame, startGame } from './index';

/** Build deterministic simultaneous attacks with no unrelated environment processing or global randomness. */
function createAttackFixture() {
  const now = new Date('2026-10-10T12:00:00.000Z');
  let game = createNewGame({ id: 'attack-contention', createdAt: now,
    settings: { maxPlayers: 2, rotationDirection: 'clockwise', expansions: ['core'] },
    boardSpeedByRing: [1, 1, 1, 1, 1, 1, 1, 1] });
  const plans: Record<string, PlayerAction[]> = {};
  for (const id of ['first', 'second']) {
    const ship = createInitialShip({ ring: 8, space: 0 });
    ship.sections[SHIP_SECTIONS.DEFENSE] = { ...ship.sections[SHIP_SECTIONS.DEFENSE], hull: 6, powerDice: [6] };
    const progress = { reviveProgress: 0, assembleProgress: 0, assembleItemType: null };
    game = addPlayerToGame(game, { id, userId: id, isBot: false, ship,
      crew: [{ ...progress, id: `${id}:tactician`, name: 'Tactician', type: 'basic', role: 'tactician', status: 'active', location: SHIP_SECTIONS.DEFENSE }],
      captain: { ...progress, id: `${id}:captain`, name: 'Captain', type: 'captain', captainType: 'merchant', status: 'active', location: SHIP_SECTIONS.BRIDGE } });
    plans[id] = [{ playerId: id, crewId: `${id}:tactician`, type: 'attack', target: { objectId: 'shared-hostile' } }];
  }
  game = startGame(game, { startedAt: now });
  game = { ...game, players: new Map(Array.from(game.players, ([id, player]) =>
    [id, { ...player, ship: { ...player.ship, position: { ring: 8, space: 0 } } }])) };
  game = { ...game, turnPhase: 'action_execution', board: { ...game.board,
    objects: [{ id: 'shared-hostile', type: 'hostile_ship', position: { ring: 8, space: 0 }, hull: 1, hasTorpedo: false }] } };
  return { game, plans };
}

describe('simultaneous hostile attack contention', () => {
  it('spends both assigned attacks but converts a destroyed hostile exactly once without mutating input', () => {
    const { game, plans } = createAttackFixture();
    const before = structuredClone(game);
    const firstOnly = applyPlayerActions(game, { first: plans.first, second: [] });
    const resolved = applyPlayerActions(game, plans);
    expect(resolved.board.objects).toEqual(firstOnly.board.objects);
    expect(resolved.board.objects).toHaveLength(1);
    expect(resolved.board.objects[0]).toMatchObject({ id: 'shared-hostile', type: 'debris' });
    for (const id of ['first', 'second']) {
      expect(resolved.players.get(id)?.ship.sections[SHIP_SECTIONS.DEFENSE].powerDice).toEqual([5]);
      expect(resolved.players.get(id)?.resources).toEqual(game.players.get(id)?.resources);
    }
    expect(applyPlayerActions(game, plans)).toEqual(resolved);
    expect(game).toEqual(before);
  });

  it('still rejects originally non-hostile or missing targets and an out-of-range later attacker', () => {
    const { game, plans } = createAttackFixture();
    expect(() => applyPlayerActions({ ...game, board: { ...game.board, objects: [{ id: 'shared-hostile', type: 'debris', position: { ring: 8, space: 1 } }] } }, plans)).toThrow('target is not hostile');
    expect(() => applyPlayerActions({ ...game, board: { ...game.board, objects: [] } }, plans)).toThrow('unknown board object');
    const second = game.players.get('second');
    if (!second) throw new Error('Second test attacker was not created.');
    const players = new Map(game.players);
    players.set(second.id, { ...second, ship: { ...second.ship, position: { ring: 8, space: 8 } } });
    expect(() => applyPlayerActions({ ...game, players }, plans)).toThrow('target is out of range');
  });

  it('retains hostile destruction history for a later Retaliate without weakening its original-target checks', () => {
    const { game, plans } = createAttackFixture();
    plans.second[0].type = 'retaliate';
    const resolved = applyPlayerActions(game, plans);
    expect(resolved.board.objects).toEqual(applyPlayerActions(game, { first: plans.first, second: [] }).board.objects);
    expect(resolved.players.get('second')?.ship.sections[SHIP_SECTIONS.DEFENSE].powerDice).toEqual([5]);
    expect(() => applyPlayerActions({ ...game, board: { ...game.board, objects: [{ id: 'shared-hostile', type: 'debris', position: { ring: 8, space: 0 } }] } }, plans)).toThrow('target is not hostile');
    const unpowered = structuredClone(game);
    unpowered.players.get('second')!.ship.sections[SHIP_SECTIONS.DEFENSE].powerDice = [];
    expect(() => applyPlayerActions(unpowered, plans)).toThrow('no power');
  });

  it.each(['attack', 'retaliate'] as const)('spends %s on an originally hostile target consumed by earlier Acquire', (actionType) => {
    const { game, plans } = createAttackFixture();
    const first = game.players.get('first')!;
    first.scanDiscoveriesByObjectId = { 'shared-hostile': { objectId: 'shared-hostile', objectType: 'hostile_ship', source: 'scan',
      rollValue: 0, totalRoll: 0, foundResource: false, resourceType: null, foundUpgrade: false, reservedUpgrade: null,
      revealedAtTurn: game.currentTurn, crewId: first.captain.id } };
    plans.first = [{ playerId: first.id, crewId: first.captain.id, type: 'acquire', target: { objectId: 'shared-hostile' } }];
    plans.second[0].type = actionType;
    const before = structuredClone(game);
    const resolved = applyPlayerActions(game, plans);
    expect(resolved.board.objects).toEqual([]);
    expect(resolved.players.get('second')?.ship.sections[SHIP_SECTIONS.DEFENSE].powerDice).toEqual([5]);
    expect(resolved.players.get('second')?.resources).toEqual(game.players.get('second')?.resources);
    expect(applyPlayerActions(game, plans)).toEqual(resolved);
    expect(game).toEqual(before);
    const far = structuredClone(game);
    far.players.get('second')!.ship.position = { ring: 8, space: 8 };
    expect(() => applyPlayerActions(far, plans)).toThrow('out of range');
  });

  it('retains Torpedo destruction before Retaliate, spending ammunition and section power only once', () => {
    const { game, plans } = createAttackFixture();
    const first = game.players.get('first')!;
    first.resources.torpedo = 1;
    plans.first = [{ playerId: first.id, crewId: first.captain.id, type: 'launch', target: { objectId: 'shared-hostile' }, parameters: { launchType: 'torpedo' } }];
    plans.second[0].type = 'retaliate';
    const resolved = applyPlayerActions(game, plans);
    expect(resolved.board.objects).toEqual(applyPlayerActions(game, { first: plans.first, second: [] }).board.objects);
    expect(resolved.players.get('first')?.resources.torpedo).toBe(0);
    expect(resolved.players.get('first')?.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice).toEqual([5]);
    expect(resolved.players.get('second')?.ship.sections[SHIP_SECTIONS.DEFENSE].powerDice).toEqual([5]);
  });
});
