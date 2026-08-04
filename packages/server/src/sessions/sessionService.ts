import { createHmac, randomBytes } from 'node:crypto';

import {
  deserializeGameStateSnapshot,
  generateAllBotActions,
  processTurn,
  serializeGameStateSnapshot,
  type GameStateSnapshotV1,
  type PlayerAction,
  type TurnActions,
} from '@gravity/core';

import type { AuthenticatedIdentity } from '../auth/identity';
import { SessionError } from './errors';
import type {
  CreatedSessionAccess,
  SessionAccess,
  SessionEventPublisher,
  SessionGameFactory,
  SessionParticipant,
  SessionRecord,
  SessionRepository,
  SessionSummary,
} from './types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type SessionServiceOptions = {
  repository: SessionRepository;
  gameFactory: SessionGameFactory;
  events: SessionEventPublisher;
  joinCodePepper: string;
  now?: () => Date;
  createJoinCode?: () => string;
};

function sanitizeDisplayName(raw: string | null | undefined): string {
  const displayName = raw?.trim().replace(/\s+/g, ' ');
  if (!displayName || displayName.length > 50) {
    throw new SessionError(
      'INVALID_REQUEST',
      'Display name must contain 1-50 characters after trimming.',
      400,
    );
  }
  return displayName;
}

function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, '');
}

function generateJoinCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]).join('');
}

/**
 * Purpose: Give each automated roster slot a stable, human-readable lobby label.
 * Parameters: The one-based seat number selected by the host.
 * Returns: The display name persisted for the bot participant.
 * Side effects: None.
 */
function createBotDisplayName(seatNumber: number): string {
  return `Bot Commander ${seatNumber}`;
}

function toSummary(session: SessionRecord): SessionSummary {
  const { joinCodeHash: _joinCodeHash, ...summary } = session;
  return summary;
}

function requireParticipant(session: SessionRecord, userId: string): SessionParticipant {
  const participant = session.participants.find((candidate) => candidate.userId === userId);
  if (!participant) {
    throw new SessionError(
      'NOT_A_MEMBER',
      'You are not a member of this session. Join with its private code before requesting it.',
      403,
    );
  }
  return participant;
}

export class SessionService {
  private readonly repository: SessionRepository;
  private readonly gameFactory: SessionGameFactory;
  private readonly events: SessionEventPublisher;
  private readonly joinCodePepper: string;
  private readonly now: () => Date;
  private readonly createJoinCode: () => string;

  constructor(options: SessionServiceOptions) {
    if (options.joinCodePepper.length < 16) {
      throw new Error(
        'Cannot configure session join codes because JOIN_CODE_PEPPER is too short. ' +
          `Root cause: received ${options.joinCodePepper.length} characters. ` +
          'Fix: Set JOIN_CODE_PEPPER to a secret value of at least 16 characters.',
      );
    }
    this.repository = options.repository;
    this.gameFactory = options.gameFactory;
    this.events = options.events;
    this.joinCodePepper = options.joinCodePepper;
    this.now = options.now ?? (() => new Date());
    this.createJoinCode = options.createJoinCode ?? generateJoinCode;
  }

  private hashJoinCode(joinCode: string): string {
    return createHmac('sha256', this.joinCodePepper).update(normalizeJoinCode(joinCode)).digest('hex');
  }

  async createSession(params: {
    identity: AuthenticatedIdentity;
    displayName?: string;
    maxPlayers: number;
  }): Promise<CreatedSessionAccess> {
    if (!Number.isInteger(params.maxPlayers) || params.maxPlayers < MIN_PLAYERS || params.maxPlayers > MAX_PLAYERS) {
      throw new SessionError(
        'INVALID_REQUEST',
        `maxPlayers must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`,
        400,
      );
    }

    const displayName = sanitizeDisplayName(params.displayName ?? params.identity.displayName);
    const joinCode = normalizeJoinCode(this.createJoinCode());
    if (joinCode.length !== 8) {
      throw new Error('Session join-code generator must return exactly 8 normalized characters.');
    }

    const session = await this.repository.createLobby({
      identity: params.identity,
      displayName,
      maxPlayers: params.maxPlayers,
      joinCodeHash: this.hashJoinCode(joinCode),
      now: this.now(),
    });
    const participant = requireParticipant(session, params.identity.subject);
    const summary = toSummary(session);
    this.events.publish({ type: 'session_updated', session: summary });

    return { session: summary, participant, joinCode };
  }

  async joinSession(params: {
    identity: AuthenticatedIdentity;
    joinCode: string;
    displayName?: string;
  }): Promise<SessionAccess> {
    const normalizedCode = normalizeJoinCode(params.joinCode);
    if (normalizedCode.length !== 8) {
      throw new SessionError('INVALID_REQUEST', 'Join code must contain exactly 8 characters.', 400);
    }

    const existing = await this.repository.findByJoinCodeHash(this.hashJoinCode(normalizedCode));
    if (!existing) {
      throw new SessionError('NOT_FOUND', 'No private session matches that join code.', 404);
    }

    const existingParticipant = existing.participants.find(
      (participant) => participant.userId === params.identity.subject,
    );
    if (existingParticipant) {
      return { session: toSummary(existing), participant: existingParticipant };
    }
    if (existing.status !== 'lobby') {
      throw new SessionError('CONFLICT', 'This session has already started and no longer accepts new players.', 409);
    }
    if (existing.participants.length >= existing.maxPlayers) {
      throw new SessionError('SESSION_FULL', 'This private session has no open seats.', 409);
    }

    const session = await this.repository.addParticipant({
      sessionId: existing.id,
      identity: params.identity,
      displayName: sanitizeDisplayName(params.displayName ?? params.identity.displayName),
      now: this.now(),
    });
    const participant = requireParticipant(session, params.identity.subject);
    const summary = toSummary(session);
    this.events.publish({ type: 'session_updated', session: summary });
    return { session: summary, participant };
  }

  async getSession(identity: AuthenticatedIdentity, sessionId: string): Promise<SessionAccess> {
    const session = await this.repository.findById(sessionId);
    if (!session) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    return {
      session: toSummary(session),
      participant: requireParticipant(session, identity.subject),
    };
  }

  async setReady(params: {
    identity: AuthenticatedIdentity;
    sessionId: string;
    isReady: boolean;
  }): Promise<SessionAccess> {
    const current = await this.repository.findById(params.sessionId);
    if (!current) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    requireParticipant(current, params.identity.subject);
    if (current.status !== 'lobby') {
      throw new SessionError('CONFLICT', 'Readiness can only change while the session is in the lobby.', 409);
    }

    const session = await this.repository.setParticipantReady({
      sessionId: params.sessionId,
      userId: params.identity.subject,
      isReady: params.isReady,
      now: this.now(),
    });
    const participant = requireParticipant(session, params.identity.subject);
    const summary = toSummary(session);
    this.events.publish({ type: 'session_updated', session: summary });
    return { session: summary, participant };
  }

  /**
   * Purpose: Let the host switch a non-host roster slot between human/open and bot control.
   * Parameters: Authenticated identity, session id, one-based seat number, and desired bot state.
   * Returns: Updated host access containing the authoritative roster.
   * Side effects: May remove the current non-host occupant from the lobby and broadcasts the new roster.
   */
  async setBotSeat(params: {
    identity: AuthenticatedIdentity;
    sessionId: string;
    seatNumber: number;
    isBot: boolean;
  }): Promise<SessionAccess> {
    const current = await this.repository.findById(params.sessionId);
    if (!current) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const participant = requireParticipant(current, params.identity.subject);
    if (!participant.isHost) {
      throw new SessionError('NOT_HOST', 'Only the session host can configure bot seats.', 403);
    }
    if (current.status !== 'lobby') {
      throw new SessionError('CONFLICT', 'Bot seats can only change while the session is in the lobby.', 409);
    }
    if (!Number.isInteger(params.seatNumber) || params.seatNumber <= 1 || params.seatNumber > current.maxPlayers) {
      throw new SessionError(
        'INVALID_REQUEST',
        `seatNumber must identify a non-host seat between 2 and ${current.maxPlayers}.`,
        400,
      );
    }
    const existing = current.participants.find((member) => member.seatNumber === params.seatNumber);
    if (existing?.isHost) {
      throw new SessionError('CONFLICT', 'The host seat cannot be replaced by a bot.', 409);
    }
    if (!params.isBot && existing && !existing.isBot) {
      throw new SessionError('CONFLICT', 'Only a bot-controlled seat can be returned to the open roster.', 409);
    }

    const session = await this.repository.setBotSeat({
      sessionId: params.sessionId,
      seatNumber: params.seatNumber,
      isBot: params.isBot,
      displayName: createBotDisplayName(params.seatNumber),
      now: this.now(),
    });
    const summary = toSummary(session);
    this.events.publish({ type: 'session_updated', session: summary });
    return { session: summary, participant: requireParticipant(session, params.identity.subject) };
  }

  /**
   * Purpose: Allow the host to cancel a game before it launches.
   * Parameters: Authenticated identity and lobby session id.
   * Returns: Host access containing the abandoned session status.
   * Side effects: Closes the lobby and broadcasts the cancellation to all connected members.
   */
  async cancelSession(identity: AuthenticatedIdentity, sessionId: string): Promise<SessionAccess> {
    const current = await this.repository.findById(sessionId);
    if (!current) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const participant = requireParticipant(current, identity.subject);
    if (!participant.isHost) {
      throw new SessionError('NOT_HOST', 'Only the session host can cancel the game.', 403);
    }
    if (current.status !== 'lobby') {
      throw new SessionError('CONFLICT', 'Only a waiting lobby can be canceled.', 409);
    }

    const session = await this.repository.cancelLobby({ sessionId, now: this.now() });
    const summary = toSummary(session);
    this.events.publish({ type: 'session_updated', session: summary });
    return { session: summary, participant: requireParticipant(session, identity.subject) };
  }

  async startSession(identity: AuthenticatedIdentity, sessionId: string): Promise<SessionAccess> {
    const current = await this.repository.findById(sessionId);
    if (!current) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const participant = requireParticipant(current, identity.subject);
    if (!participant.isHost) {
      throw new SessionError('NOT_HOST', 'Only the session host can start the game.', 403);
    }
    if (current.status !== 'lobby') {
      throw new SessionError('CONFLICT', 'This session has already left the lobby.', 409);
    }
    if (
      current.participants.length !== current.maxPlayers ||
      current.participants.some((member) => !member.isReady)
    ) {
      throw new SessionError(
        'NOT_READY',
        `All ${current.maxPlayers} configured player seats must be filled and every human player must be ready before the host starts.`,
        409,
      );
    }

    const now = this.now();
    const snapshot = this.gameFactory.create({
      sessionId: current.id,
      participants: current.participants,
      maxPlayers: current.maxPlayers,
      now,
    });
    const session = await this.repository.commitStart({
      sessionId,
      snapshot,
      expectedUpdatedAt: current.updatedAt,
      now,
    });
    const summary = toSummary(session);
    this.events.publish({ type: 'game_started', session: summary, snapshot });
    return { session: summary, participant: requireParticipant(session, identity.subject) };
  }

  async submitTurn(params: {
    identity: AuthenticatedIdentity;
    sessionId: string;
    submissionId: string;
    expectedStateVersion: number;
    actions: PlayerAction[];
  }) {
    const current = await this.repository.findById(params.sessionId);
    if (!current) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const participant = requireParticipant(current, params.identity.subject);
    if (current.status !== 'active' || !current.latestSnapshot) {
      throw new SessionError('CONFLICT', 'Turns can only be submitted to an active session.', 409);
    }

    const hydrated = deserializeGameStateSnapshot(current.latestSnapshot).game;
    if (hydrated.turnPhase !== 'action_planning') {
      throw new SessionError(
        'CONFLICT',
        `The server is resolving phase "${hydrated.turnPhase}" and is not accepting plans.`,
        409,
      );
    }
    const submittingPlayer = hydrated.players.get(participant.playerId);
    if (!submittingPlayer || submittingPlayer.status !== 'active') {
      throw new SessionError('INVALID_ACTION', 'This player is not active and cannot submit actions.', 400);
    }
    if (params.actions.some((action) => action.playerId !== participant.playerId)) {
      throw new SessionError(
        'INVALID_ACTION',
        'Every submitted action must belong to the authenticated participant player id.',
        400,
      );
    }

    const requiredPlayerIds = current.participants
      .filter((member) => !member.isBot && hydrated.players.get(member.playerId)?.status === 'active')
      .map((member) => member.playerId);

    const result = await this.repository.submitTurn({
      sessionId: current.id,
      participantId: participant.id,
      submissionId: params.submissionId,
      expectedStateVersion: params.expectedStateVersion,
      actions: params.actions,
      requiredPlayerIds,
      now: this.now(),
      process: (snapshot, actionsByPlayer) => {
        try {
          return this.processCompleteTurn(snapshot, actionsByPlayer);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown rules-engine rejection.';
          throw new SessionError('INVALID_ACTION', message, 400);
        }
      },
    });

    if (result.status === 'committed' && result.snapshot) {
      const committed = await this.repository.findById(current.id);
      if (!committed) throw new SessionError('NOT_FOUND', 'Committed session could not be reloaded.', 404);
      this.events.publish({
        type: 'state_snapshot',
        session: toSummary(committed),
        snapshot: result.snapshot,
      });
    } else if (result.status === 'pending' || (result.status === 'duplicate' && !result.snapshot)) {
      const pending = await this.repository.findById(current.id);
      if (pending) this.events.publish({ type: 'session_updated', session: toSummary(pending) });
    }
    return result;
  }

  private processCompleteTurn(snapshot: GameStateSnapshotV1, actionsByPlayer: TurnActions) {
    const decoded = deserializeGameStateSnapshot(snapshot);
    let game = decoded.game;
    if (game.turnPhase !== 'action_planning') {
      throw new Error(`Expected action_planning but received ${game.turnPhase}.`);
    }

    const completeActions: TurnActions = {
      ...generateAllBotActions(game),
      ...actionsByPlayer,
    };
    game = processTurn(game, completeActions);
    if (game.turnPhase !== 'action_execution') {
      throw new Error(`Expected action_execution but received ${game.turnPhase}.`);
    }
    game = processTurn(game, completeActions);

    let automaticPhaseCount = 0;
    while (game.status === 'in_progress' && game.turnPhase !== 'action_planning') {
      if (automaticPhaseCount >= 5) {
        throw new Error('The rules engine did not return to action planning within five automatic phases.');
      }
      game = processTurn(game, {});
      automaticPhaseCount += 1;
    }

    return serializeGameStateSnapshot(game, decoded.stateVersion + 1);
  }
}
