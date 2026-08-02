import type { GameStateSnapshotV1, PlayerAction } from '@gravity/core';

export type SessionParticipant = {
  id: string;
  sessionId: string;
  userId: string;
  playerId: string;
  displayName: string;
  seatNumber: number;
  isReady: boolean;
  isHost: boolean;
  joinedAt: string;
  updatedAt: string;
};

export type SessionSummary = {
  id: string;
  status: 'lobby' | 'active' | 'ended' | 'abandoned';
  maxPlayers: number;
  createdBy: string;
  stateVersion: number;
  participants: SessionParticipant[];
  pendingPlayerIds: string[];
  latestSnapshot: GameStateSnapshotV1 | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
};

export type SessionAccess = {
  session: SessionSummary;
  participant: SessionParticipant;
};

export type CreatedSessionAccess = SessionAccess & { joinCode: string };

export type SessionApiError = Error & { code: string; status: number };

export type TurnSubmissionResult = {
  status: 'pending' | 'committed' | 'duplicate';
  stateVersion: number;
  submittedPlayerIds: string[];
  snapshot: GameStateSnapshotV1 | null;
};

export type TurnSubmissionPayload = {
  submissionId: string;
  expectedStateVersion: number;
  actions: PlayerAction[];
};
