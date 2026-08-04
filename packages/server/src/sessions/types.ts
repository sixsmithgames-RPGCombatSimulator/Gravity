import type { GameStateSnapshotV1, PlayerAction, TurnActions } from '@gravity/core';

import type { AuthenticatedIdentity } from '../auth/identity';

export type SessionStatus = 'lobby' | 'active' | 'ended' | 'abandoned';

export type SessionParticipant = {
  id: string;
  sessionId: string;
  userId: string | null;
  playerId: string;
  displayName: string;
  seatNumber: number;
  isReady: boolean;
  isBot: boolean;
  isHost: boolean;
  joinedAt: Date;
  updatedAt: Date;
};

export type SessionRecord = {
  id: string;
  status: SessionStatus;
  joinCodeHash: string;
  maxPlayers: number;
  createdBy: string;
  stateVersion: number;
  participants: SessionParticipant[];
  pendingPlayerIds: string[];
  latestSnapshot: GameStateSnapshotV1 | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
};

export type SessionSummary = Omit<SessionRecord, 'joinCodeHash'>;

export type SessionAccess = {
  session: SessionSummary;
  participant: SessionParticipant;
};

export type CreatedSessionAccess = SessionAccess & {
  joinCode: string;
};

export interface SessionRepository {
  createLobby(params: {
    identity: AuthenticatedIdentity;
    displayName: string;
    maxPlayers: number;
    joinCodeHash: string;
    now: Date;
  }): Promise<SessionRecord>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  findByJoinCodeHash(joinCodeHash: string): Promise<SessionRecord | null>;
  addParticipant(params: {
    sessionId: string;
    identity: AuthenticatedIdentity;
    displayName: string;
    now: Date;
  }): Promise<SessionRecord>;
  setParticipantReady(params: {
    sessionId: string;
    userId: string;
    isReady: boolean;
    now: Date;
  }): Promise<SessionRecord>;
  setBotSeat(params: {
    sessionId: string;
    seatNumber: number;
    isBot: boolean;
    displayName: string;
    now: Date;
  }): Promise<SessionRecord>;
  cancelLobby(params: {
    sessionId: string;
    now: Date;
  }): Promise<SessionRecord>;
  commitStart(params: {
    sessionId: string;
    snapshot: GameStateSnapshotV1;
    expectedUpdatedAt: Date;
    now: Date;
  }): Promise<SessionRecord>;
  submitTurn(params: {
    sessionId: string;
    participantId: string;
    submissionId: string;
    expectedStateVersion: number;
    actions: PlayerAction[];
    requiredPlayerIds: string[];
    process: (snapshot: GameStateSnapshotV1, actions: TurnActions) => GameStateSnapshotV1;
    now: Date;
  }): Promise<TurnSubmissionResult>;
}

export interface SessionGameFactory {
  create(params: {
    sessionId: string;
    participants: SessionParticipant[];
    maxPlayers: number;
    now: Date;
  }): GameStateSnapshotV1;
}

export type SessionEvent =
  | { type: 'session_updated'; session: SessionSummary }
  | { type: 'game_started'; session: SessionSummary; snapshot: GameStateSnapshotV1 }
  | { type: 'state_snapshot'; session: SessionSummary; snapshot: GameStateSnapshotV1 };

export type TurnSubmissionResult = {
  status: 'pending' | 'committed' | 'duplicate';
  stateVersion: number;
  submittedPlayerIds: string[];
  snapshot: GameStateSnapshotV1 | null;
};

export interface SessionEventPublisher {
  publish(event: SessionEvent): void;
}
