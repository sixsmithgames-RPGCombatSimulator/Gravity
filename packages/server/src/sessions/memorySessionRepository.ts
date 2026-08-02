import { randomUUID } from 'node:crypto';

import { SessionError } from './errors';
import type { SessionRecord, SessionRepository, TurnSubmissionResult } from './types';

function cloneSession(session: SessionRecord): SessionRecord {
  return structuredClone(session);
}

/** Deterministic repository used by service and HTTP integration tests without external infrastructure. */
export class MemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly submissions = new Map<
    string,
    Array<{
      participantId: string;
      playerId: string;
      submissionId: string;
      expectedStateVersion: number;
      actions: Parameters<SessionRepository['submitTurn']>[0]['actions'];
      resultStateVersion: number | null;
    }>
  >();

  async createLobby(params: Parameters<SessionRepository['createLobby']>[0]): Promise<SessionRecord> {
    if (Array.from(this.sessions.values()).some((session) => session.joinCodeHash === params.joinCodeHash)) {
      throw new SessionError('CONFLICT', 'Generated join code collided with an existing session.', 409);
    }
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const session: SessionRecord = {
      id: sessionId,
      status: 'lobby',
      joinCodeHash: params.joinCodeHash,
      maxPlayers: params.maxPlayers,
      createdBy: params.identity.subject,
      stateVersion: 0,
      latestSnapshot: null,
      pendingPlayerIds: [],
      createdAt: params.now,
      updatedAt: params.now,
      startedAt: null,
      participants: [
        {
          id: participantId,
          sessionId,
          userId: params.identity.subject,
          playerId: randomUUID(),
          displayName: params.displayName,
          seatNumber: 1,
          isReady: false,
          isHost: true,
          joinedAt: params.now,
          updatedAt: params.now,
        },
      ],
    };
    this.sessions.set(session.id, session);
    return cloneSession(session);
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  async findByJoinCodeHash(joinCodeHash: string): Promise<SessionRecord | null> {
    const session = Array.from(this.sessions.values()).find(
      (candidate) => candidate.joinCodeHash === joinCodeHash,
    );
    return session ? cloneSession(session) : null;
  }

  async addParticipant(params: Parameters<SessionRepository['addParticipant']>[0]): Promise<SessionRecord> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const existing = session.participants.find((participant) => participant.userId === params.identity.subject);
    if (existing) return cloneSession(session);
    if (session.status !== 'lobby') throw new SessionError('CONFLICT', 'Session has already started.', 409);
    if (session.participants.length >= session.maxPlayers) {
      throw new SessionError('SESSION_FULL', 'This private session has no open seats.', 409);
    }
    const occupiedSeats = new Set(session.participants.map((member) => member.seatNumber));
    let seatNumber = 1;
    while (occupiedSeats.has(seatNumber)) seatNumber += 1;

    session.participants.push({
      id: randomUUID(),
      sessionId: session.id,
      userId: params.identity.subject,
      playerId: randomUUID(),
      displayName: params.displayName,
      seatNumber,
      isReady: false,
      isHost: false,
      joinedAt: params.now,
      updatedAt: params.now,
    });
    session.participants.sort((left, right) => left.seatNumber - right.seatNumber);
    session.updatedAt = params.now;
    return cloneSession(session);
  }

  async setParticipantReady(
    params: Parameters<SessionRepository['setParticipantReady']>[0],
  ): Promise<SessionRecord> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    const participant = session.participants.find((candidate) => candidate.userId === params.userId);
    if (!participant) throw new SessionError('NOT_A_MEMBER', 'You are not a member of this session.', 403);
    participant.isReady = params.isReady;
    participant.updatedAt = params.now;
    session.updatedAt = params.now;
    return cloneSession(session);
  }

  async commitStart(params: Parameters<SessionRepository['commitStart']>[0]): Promise<SessionRecord> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
    if (session.status !== 'lobby' || session.latestSnapshot) {
      throw new SessionError('CONFLICT', 'This session has already started.', 409);
    }
    session.status = 'active';
    session.stateVersion = params.snapshot.stateVersion;
    session.latestSnapshot = structuredClone(params.snapshot);
    session.startedAt = params.now;
    session.updatedAt = params.now;
    return cloneSession(session);
  }

  async submitTurn(
    params: Parameters<SessionRepository['submitTurn']>[0],
  ): Promise<TurnSubmissionResult> {
    const session = this.sessions.get(params.sessionId);
    if (!session?.latestSnapshot) throw new SessionError('NOT_FOUND', 'Active session snapshot not found.', 404);
    const participant = session.participants.find((member) => member.id === params.participantId);
    if (!participant) throw new SessionError('NOT_A_MEMBER', 'You are not a member of this session.', 403);

    const submissions = this.submissions.get(params.sessionId) ?? [];
    this.submissions.set(params.sessionId, submissions);
    const duplicate = submissions.find((submission) => submission.submissionId === params.submissionId);
    if (duplicate) {
      if (duplicate.participantId !== params.participantId) {
        throw new SessionError('DUPLICATE_SUBMISSION', 'That submission id is already in use.', 409);
      }
      const snapshot =
        duplicate.resultStateVersion === session.latestSnapshot.stateVersion ? session.latestSnapshot : null;
      return {
        status: 'duplicate',
        stateVersion: duplicate.resultStateVersion ?? session.stateVersion,
        submittedPlayerIds: submissions
          .filter((item) => item.expectedStateVersion === duplicate.expectedStateVersion)
          .map((item) => item.playerId),
        snapshot: snapshot ? structuredClone(snapshot) : null,
      };
    }
    if (session.stateVersion !== params.expectedStateVersion) {
      throw new SessionError(
        'STALE_STATE',
        `Your state version ${params.expectedStateVersion} is stale; the server is at ${session.stateVersion}.`,
        409,
      );
    }
    if (
      submissions.some(
        (submission) =>
          submission.participantId === params.participantId &&
          submission.expectedStateVersion === params.expectedStateVersion,
      )
    ) {
      throw new SessionError(
        'DUPLICATE_SUBMISSION',
        'This player already submitted actions for the current state version.',
        409,
      );
    }

    submissions.push({
      participantId: params.participantId,
      playerId: participant.playerId,
      submissionId: params.submissionId,
      expectedStateVersion: params.expectedStateVersion,
      actions: structuredClone(params.actions),
      resultStateVersion: null,
    });
    const currentSubmissions = submissions.filter(
      (submission) => submission.expectedStateVersion === params.expectedStateVersion,
    );
    const submittedPlayerIds = currentSubmissions.map((submission) => submission.playerId);
    if (!params.requiredPlayerIds.every((playerId) => submittedPlayerIds.includes(playerId))) {
      session.pendingPlayerIds = submittedPlayerIds;
      return {
        status: 'pending',
        stateVersion: session.stateVersion,
        submittedPlayerIds,
        snapshot: null,
      };
    }

    const actions = Object.fromEntries(
      currentSubmissions.map((submission) => [submission.playerId, submission.actions]),
    );
    const snapshot = params.process(structuredClone(session.latestSnapshot), actions);
    session.latestSnapshot = structuredClone(snapshot);
    session.stateVersion = snapshot.stateVersion;
    session.pendingPlayerIds = [];
    if (snapshot.game.status === 'completed') session.status = 'ended';
    session.updatedAt = params.now;
    for (const submission of currentSubmissions) submission.resultStateVersion = snapshot.stateVersion;
    return {
      status: 'committed',
      stateVersion: snapshot.stateVersion,
      submittedPlayerIds,
      snapshot: structuredClone(snapshot),
    };
  }
}
