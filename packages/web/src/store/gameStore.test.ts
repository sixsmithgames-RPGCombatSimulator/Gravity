import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeGameStateSnapshot, SHIP_SECTIONS, type PlayerAction } from '@gravity/core';
import { createMockGame } from '../utils/mockGame';
import { useGameStore } from './gameStore';

/** Create a server-shaped snapshot with a fixed session identity and representative real game state. */
function snapshot(id: string, version: number) {
  return serializeGameStateSnapshot({ ...createMockGame('hard'), id, currentTurn: version }, version);
}

beforeEach(() => {
  useGameStore.getState().leaveNetworkSession();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('explicit shared-mission authority', () => {
  it('atomically hydrates game, player, version and cleared draft', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    const observations: Array<{ gameId: string | undefined; player: string | null; version: number; plans: number }> = [];
    const unsubscribe = useGameStore.subscribe((state) => observations.push({
      gameId: state.game?.id, player: state.currentPlayerId, version: state.networkStateVersion, plans: state.ui.plannedActions.length,
    }));
    expect(store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 5))).toBe(true);
    unsubscribe();
    expect(observations).toEqual([{ gameId: 'mission-a', player: 'player-1', version: 5, plans: 0 }]);
  });

  it('retains current draft for stale, duplicate and foreign snapshots', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 5));
    const action: PlayerAction = { playerId: 'player-1', crewId: 'captain-1', type: 'restore' };
    store.addPlannedAction(action);
    const before = useGameStore.getState();
    expect(store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 5))).toBe(false);
    expect(store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 4))).toBe(false);
    expect(store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-b', 6))).toBe(false);
    expect(store.hydrateNetworkSnapshot('mission-b', 'player-1', snapshot('mission-b', 6))).toBe(false);
    expect(useGameStore.getState().game).toBe(before.game);
    expect(useGameStore.getState().ui.plannedActions).toBe(before.ui.plannedActions);
  });

  it('replaces session A at version 5 with session B at version 1 without stale player/draft', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 5));
    store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    store.bindNetworkSession('mission-b', 'bot-1');
    expect(store.hydrateNetworkSnapshot('mission-b', 'bot-1', snapshot('mission-b', 1))).toBe(true);
    expect(useGameStore.getState()).toMatchObject({ networkSessionId: 'mission-b', networkStateVersion: 1,
      currentPlayerId: 'bot-1', game: { id: 'mission-b', currentTurn: 1 }, ui: { plannedActions: [] } });
  });

  it('rejects every local durable mutation while allowing presentation/draft changes', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    const before = useGameStore.getState();
    store.setGame(createMockGame('easy')); store.updateGameState(createMockGame('easy')); store.newGame();
    store.setCurrentPlayer('player-2'); store.setDifficulty('easy'); store.setBotPlayerEnabled(false);
    expect(store.moveCrew('captain-1', SHIP_SECTIONS.ENGINEERING)).toBe(false);
    store.assignExplorerRepairKit(SHIP_SECTIONS.ENGINEERING); store.chooseSpacePirateStartingUpgrade('upgrade');
    expect(useGameStore.getState().game).toBe(before.game);
    expect(useGameStore.getState().currentPlayerId).toBe('player-1');
    expect(useGameStore.getState().difficulty).toBe(before.difficulty);
    expect(useGameStore.getState().botPlayerEnabled).toBe(before.botPlayerEnabled);
    store.setBoardZoom(1.2); store.setBoardOffset({ x: 20, y: 40 });
    store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    expect(useGameStore.getState().ui.plannedActions).toHaveLength(1);
    expect(useGameStore.getState().ui.boardZoom).toBe(1.2);
  });

  it('never falls through to local simulation when the network callback is cleared', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    store.setNetworkTurnSubmitter(null);
    store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    const before = useGameStore.getState().game;
    const draft = useGameStore.getState().ui.plannedActions;
    store.playTurn();
    expect(useGameStore.getState().game).toBe(before);
    expect(useGameStore.getState().networkSessionId).toBe('mission-a');
    expect(useGameStore.getState().ui.lastError).toContain('Keep this screen open');
    expect(useGameStore.getState().ui.lastError).toContain('choose Lock Plans again');
    expect(useGameStore.getState().ui.lastError).not.toContain('Reload');
    expect(useGameStore.getState().ui.plannedActions).toBe(draft);
    expect(useGameStore.getState().ui.lastError).not.toMatch(/JSON|stateVersion|callback|\/sessions|Error:/);
    store.playTurn();
    expect(useGameStore.getState().ui.lastError).toContain('same snag twice');
    expect(useGameStore.getState().ui.lastError).toContain('info@sixsmithgames.com');
    expect(useGameStore.getState().ui.lastErrorSupportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(useGameStore.getState().isNetworkSubmissionBlocked).toBe(true);
  });

  it('leaves this device clean without retaining a local alternate mission', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    store.toggleRoster(); store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    store.leaveNetworkSession();
    expect(useGameStore.getState()).toMatchObject({ networkSessionId: null, networkStateVersion: -1,
      game: null, currentPlayerId: null, networkTurnSubmitter: null, ui: { rosterOpen: false, plannedActions: [] } });
  });

  it('retains the last usable turn and draft when hydration fails, with bounded safe recovery', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    const before = useGameStore.getState();
    const invalid = snapshot('mission-a', 2);
    invalid.game.createdAt = 'internal invalid date details';
    expect(store.hydrateNetworkSnapshot('mission-a', 'player-1', invalid)).toBe(false);
    expect(useGameStore.getState().game).toBe(before.game);
    expect(useGameStore.getState().ui.plannedActions).toBe(before.ui.plannedActions);
    expect(useGameStore.getState().ui.lastError).toContain('restore your latest completed turn');
    expect(useGameStore.getState().ui.lastError).toContain('Reload Gravity once');
    expect(useGameStore.getState().ui.lastError).toContain('reloading clears the plan on this device');
    expect(useGameStore.getState().ui.lastError).not.toMatch(/createdAt|date details|deserialize|JSON|schema/);
    store.hydrateNetworkSnapshot('mission-a', 'player-1', invalid);
    expect(useGameStore.getState().ui.lastError).toContain('info@sixsmithgames.com');
    expect(useGameStore.getState().ui.lastErrorSupportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 2));
    expect(useGameStore.getState().ui.lastError).toBeNull();
    expect(useGameStore.getState().ui.lastErrorSupportCode).toBeNull();
  });

  it('fences submission completion across leaving and rejoining the same mission/version', async () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    let finishOld!: () => void;
    store.setNetworkTurnSubmitter(() => new Promise<void>((resolve) => { finishOld = resolve; }));
    store.playTurn();
    store.leaveNetworkSession();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    let finishNew!: () => void;
    store.setNetworkTurnSubmitter(() => new Promise<void>((resolve) => { finishNew = resolve; }));
    store.playTurn();
    finishOld(); await Promise.resolve(); await Promise.resolve();
    expect(useGameStore.getState().isNetworkSubmitting).toBe(true);
    finishNew();
    await vi.waitFor(() => expect(useGameStore.getState().isNetworkSubmitting).toBe(false));
  });

  it('preserves draft for an unknown callback outcome and bounds the recovery without reloading', async () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 1));
    store.addPlannedAction({ playerId: 'player-1', crewId: 'captain-1', type: 'restore' });
    const draft = useGameStore.getState().ui.plannedActions;
    const submit = vi.fn().mockRejectedValue(new Error('private callback diagnostic'));
    store.setNetworkTurnSubmitter(submit);
    store.playTurn();
    await vi.waitFor(() => expect(useGameStore.getState().isNetworkSubmitting).toBe(false));
    expect(useGameStore.getState().ui.lastError).toContain('could not confirm whether your original plan was locked');
    expect(useGameStore.getState().ui.lastError).toContain('Keep this screen open');
    expect(useGameStore.getState().ui.lastError).not.toMatch(/Reload|not committed|private callback/);
    expect(useGameStore.getState().ui.plannedActions).toBe(draft);
    store.playTurn();
    await vi.waitFor(() => expect(useGameStore.getState().isNetworkSubmitting).toBe(false));
    expect(useGameStore.getState().ui.lastError).toContain('same snag twice');
    expect(useGameStore.getState().ui.lastError).toContain('info@sixsmithgames.com');
    expect(useGameStore.getState().ui.lastErrorSupportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(useGameStore.getState().ui.plannedActions).toBe(draft);
    expect(useGameStore.getState().isNetworkSubmissionBlocked).toBe(true);
    store.playTurn();
    expect(submit).toHaveBeenCalledTimes(2);
    store.hydrateNetworkSnapshot('mission-a', 'player-1', snapshot('mission-a', 2));
    expect(useGameStore.getState().isNetworkSubmissionBlocked).toBe(false);
    submit.mockResolvedValueOnce(undefined);
    store.playTurn();
    await vi.waitFor(() => expect(useGameStore.getState().isNetworkSubmitting).toBe(false));
    store.playTurn();
    await vi.waitFor(() => expect(useGameStore.getState().isNetworkSubmitting).toBe(false));
    expect(useGameStore.getState().ui.lastErrorSupportCode).toBeNull();
  });
});
