// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeGameStateSnapshot } from '@gravity/core';
import { createMockGame } from '../utils/mockGame';
import { createSessionApi } from './api';

/** Build a real canonical snapshot inside a usable access envelope for boundary-success checks. */
function validAccess() {
  const id = 'mission-a';
  const participant = { id: 'member', sessionId: id, userId: 'host', playerId: 'player-1', displayName: 'Host',
    seatNumber: 1, isReady: true, isBot: false, isHost: true,
    joinedAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z' };
  return { participant, session: { id, status: 'active', maxPlayers: 2, createdBy: 'host', stateVersion: 1,
    participants: [participant], pendingPlayerIds: [], latestSnapshot: serializeGameStateSnapshot({ ...createMockGame('hard'), id }, 1),
    createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:01:00.000Z', startedAt: '2026-10-10T12:01:00.000Z' } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('session API usable-result boundary', () => {
  it('rejects consecutive empty successful envelopes without resetting the failure boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const api = createSessionApi(async () => 'token');
    await expect(api.ready('mission-a', true)).rejects.toMatchObject({ occurrence: 1, code: 'INVALID_RESPONSE' });
    await expect(api.ready('mission-a', true)).rejects.toMatchObject({ occurrence: 2,
      playerError: { message: expect.stringContaining('info@sixsmithgames.com') } });
  });

  it('preserves the mutation failure chain through a valid recovery read, but resets after a real mutation success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchDouble = vi.fn().mockRejectedValueOnce(new Error('private lost reply'))
      .mockResolvedValueOnce(new Response(JSON.stringify(validAccess()), { status: 200 }))
      .mockRejectedValueOnce(new Error('private lost reply'))
      .mockResolvedValueOnce(new Response(JSON.stringify(validAccess()), { status: 200 }))
      .mockRejectedValueOnce(new Error('private lost reply'));
    vi.stubGlobal('fetch', fetchDouble);
    const api = createSessionApi(async () => 'token');
    await expect(api.ready('mission-a', true)).rejects.toMatchObject({ occurrence: 1 });
    await expect(api.get('mission-a', true)).resolves.toMatchObject({ session: { id: 'mission-a' } });
    await expect(api.ready('mission-a', true)).rejects.toMatchObject({ occurrence: 2 });
    await api.ready('mission-a', true);
    await expect(api.ready('mission-a', true)).rejects.toMatchObject({ occurrence: 1 });
  });

  it('rejects unusable creation and turn JSON as uncertain outcomes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const api = createSessionApi(async () => 'token');
    await expect(api.create('Host', 4)).rejects.toMatchObject({ isUnconfirmed: true,
      playerError: { message: expect.stringContaining('do not create another game yet'), supportCode: expect.stringMatching(/^GRV-/) } });
    await expect(api.submitTurn('mission-a', { submissionId: 'original-id', expectedStateVersion: 1, actions: [] }))
      .rejects.toMatchObject({ isUnconfirmed: true, playerError: { message: expect.stringContaining('Keep this screen open') } });
  });
});
