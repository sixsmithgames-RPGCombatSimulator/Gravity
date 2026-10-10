// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeGameStateSnapshot } from '@gravity/core';
import { SessionHome } from './SessionHome';
import { SessionLobby } from './SessionLobby';
import { ActionBar } from '../actions/ActionBar';
import { useGameStore } from '../../store/gameStore';
import { createMockGame } from '../../utils/mockGame';
import type { SessionAccess } from '../../session/types';

afterEach(() => { cleanup(); useGameStore.getState().leaveNetworkSession(); });

/** Use a real authoritative-shaped lobby without introducing a browser-owned game simulation. */
function lobby(): SessionAccess {
  const participant = { id: 'member', sessionId: 'mission-a', userId: 'host', playerId: 'player-1', displayName: 'Host',
    seatNumber: 1, isReady: false, isBot: false, isHost: true,
    joinedAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z' };
  return { participant, session: { id: 'mission-a', status: 'lobby', maxPlayers: 2, createdBy: 'host', stateVersion: 0,
    participants: [participant], pendingPlayerIds: [], latestSnapshot: null,
    createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:01:00.000Z', startedAt: null } };
}

describe('player-visible recovery controls', () => {
  it('disables uncertain creation while keeping the immediate support path copyable', () => {
    const create = vi.fn();
    render(<SessionHome initialDisplayName="Host" isWorking={false} error={null}
      creationError={{ message: 'Gravity could not confirm whether the game was created. Email info@sixsmithgames.com.', supportCode: 'GRV-12345678' }}
      onCreate={create} onJoin={vi.fn()} />);
    const paused = screen.getByRole('button', { name: 'Creation paused — contact support' }) as HTMLButtonElement;
    expect(paused.disabled).toBe(true);
    fireEvent.submit(paused.closest('form')!);
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'info@sixsmithgames.com' }).getAttribute('href')).toBe('mailto:info@sixsmithgames.com');
    expect(screen.getByText('GRV-12345678')).toBeDefined();
  });

  it('offers only a read while an uncertain roster mutation is paused', () => {
    const refresh = vi.fn(); const ready = vi.fn(); const bot = vi.fn();
    render(<SessionLobby access={lobby()} joinCode="ABCD-1234" isWorking={false} isRefreshRequired
      error={{ message: 'Gravity could not confirm whether your ready status changed. Choose Refresh lobby.', supportCode: null }}
      onSetReady={ready} onSetBotSeat={bot} onCancel={vi.fn()} onStart={vi.fn()} onRefresh={refresh} />);
    expect((screen.getByRole('button', { name: 'Ready up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add bot to seat 2' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lobby' }));
    expect(refresh).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled(); expect(bot).not.toHaveBeenCalled();
  });

  it('visibly disables plan submission at the support boundary', () => {
    const store = useGameStore.getState();
    store.bindNetworkSession('mission-a', 'player-1');
    store.hydrateNetworkSnapshot('mission-a', 'player-1', serializeGameStateSnapshot({ ...createMockGame('hard'), id: 'mission-a' }, 1));
    store.setNetworkSubmissionBlocked(true);
    render(<ActionBar />);
    expect((screen.getByRole('button', { name: 'Plan paused — contact support' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
