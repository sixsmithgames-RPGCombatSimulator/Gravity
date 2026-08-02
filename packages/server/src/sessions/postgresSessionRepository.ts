import { createHash } from 'node:crypto';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../database/client';
import {
  session_participants,
  sessions,
  state_snapshots,
  turn_submissions,
  users,
} from '../database/schema';
import { SessionError } from './errors';
import type { SessionParticipant, SessionRecord, SessionRepository, TurnSubmissionResult } from './types';

type DbExecutor = Pick<Database, 'select' | 'insert' | 'update'>;

function buildInternalUsername(subject: string): string {
  return `gravity_${createHash('sha256').update(subject).digest('hex').slice(0, 20)}`;
}

async function ensureUser(
  executor: DbExecutor,
  identity: Parameters<SessionRepository['createLobby']>[0]['identity'],
): Promise<string> {
  const [user] = await executor
    .insert(users)
    .values({
      auth_subject: identity.subject,
      username: buildInternalUsername(identity.subject),
      is_guest: false,
      last_active: new Date(),
    })
    .onConflictDoUpdate({
      target: users.auth_subject,
      set: { last_active: new Date() },
    })
    .returning({ id: users.id });

  if (!user) throw new Error('Failed to resolve the authenticated user record.');
  return user.id;
}

async function loadSession(
  executor: DbExecutor,
  filter: ReturnType<typeof eq>,
): Promise<SessionRecord | null> {
  const [sessionRow] = await executor
    .select({
      id: sessions.id,
      status: sessions.status,
      joinCodeHash: sessions.join_code_hash,
      maxPlayers: sessions.max_players,
      createdBy: users.auth_subject,
      stateVersion: sessions.state_version,
      createdAt: sessions.created_at,
      updatedAt: sessions.updated_at,
      startedAt: sessions.started_at,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.created_by, users.id))
    .where(filter)
    .limit(1);

  if (!sessionRow?.createdBy) return null;

  const participantRows = await executor
    .select({
      id: session_participants.id,
      sessionId: session_participants.session_id,
      userId: users.auth_subject,
      playerId: session_participants.player_id,
      displayName: session_participants.display_name,
      seatNumber: session_participants.seat_number,
      isReady: session_participants.is_ready,
      joinedAt: session_participants.joined_at,
      updatedAt: session_participants.updated_at,
    })
    .from(session_participants)
    .innerJoin(users, eq(session_participants.user_id, users.id))
    .where(eq(session_participants.session_id, sessionRow.id))
    .orderBy(asc(session_participants.seat_number));

  const participants: SessionParticipant[] = participantRows.flatMap((row) =>
    row.userId
      ? [
          {
            ...row,
            userId: row.userId,
            isHost: row.userId === sessionRow.createdBy,
          },
        ]
      : [],
  );

  const [snapshotRow] = await executor
    .select({ state: state_snapshots.state })
    .from(state_snapshots)
    .where(eq(state_snapshots.session_id, sessionRow.id))
    .orderBy(desc(state_snapshots.state_version))
    .limit(1);

  const pendingRows = await executor
    .select({ playerId: session_participants.player_id })
    .from(turn_submissions)
    .innerJoin(session_participants, eq(turn_submissions.participant_id, session_participants.id))
    .where(
      and(
        eq(turn_submissions.session_id, sessionRow.id),
        eq(turn_submissions.expected_state_version, sessionRow.stateVersion),
        isNull(turn_submissions.result_state_version),
      ),
    );

  return {
    ...sessionRow,
    createdBy: sessionRow.createdBy,
    participants,
    pendingPlayerIds: pendingRows.map((row) => row.playerId),
    latestSnapshot: snapshotRow?.state ?? null,
  };
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  async createLobby(params: Parameters<SessionRepository['createLobby']>[0]): Promise<SessionRecord> {
    return this.database.transaction(async (transaction) => {
      const userId = await ensureUser(transaction, params.identity);
      const [session] = await transaction
        .insert(sessions)
        .values({
          join_code_hash: params.joinCodeHash,
          max_players: params.maxPlayers,
          created_by: userId,
          created_at: params.now,
          updated_at: params.now,
        })
        .returning({ id: sessions.id });
      if (!session) throw new Error('Failed to create multiplayer session.');

      await transaction.insert(session_participants).values({
        session_id: session.id,
        user_id: userId,
        display_name: params.displayName,
        seat_number: 1,
        joined_at: params.now,
        updated_at: params.now,
      });

      const created = await loadSession(transaction, eq(sessions.id, session.id));
      if (!created) throw new Error('Created multiplayer session could not be reloaded.');
      return created;
    });
  }

  findById(sessionId: string): Promise<SessionRecord | null> {
    return loadSession(this.database, eq(sessions.id, sessionId));
  }

  findByJoinCodeHash(joinCodeHash: string): Promise<SessionRecord | null> {
    return loadSession(this.database, eq(sessions.join_code_hash, joinCodeHash));
  }

  async addParticipant(params: Parameters<SessionRepository['addParticipant']>[0]): Promise<SessionRecord> {
    return this.database.transaction(async (transaction) => {
      const [lockedSession] = await transaction
        .select({ id: sessions.id, status: sessions.status, maxPlayers: sessions.max_players })
        .from(sessions)
        .where(eq(sessions.id, params.sessionId))
        .for('update')
        .limit(1);
      if (!lockedSession) throw new SessionError('NOT_FOUND', 'Session not found.', 404);

      const userId = await ensureUser(transaction, params.identity);
      const [existing] = await transaction
        .select({ id: session_participants.id })
        .from(session_participants)
        .where(
          and(
            eq(session_participants.session_id, params.sessionId),
            eq(session_participants.user_id, userId),
          ),
        )
        .limit(1);
      if (!existing) {
        if (lockedSession.status !== 'lobby') {
          throw new SessionError('CONFLICT', 'Session has already started.', 409);
        }
        const members = await transaction
          .select({ id: session_participants.id, seatNumber: session_participants.seat_number })
          .from(session_participants)
          .where(eq(session_participants.session_id, params.sessionId));
        if (members.length >= lockedSession.maxPlayers) {
          throw new SessionError('SESSION_FULL', 'This private session has no open seats.', 409);
        }
        const occupiedSeats = new Set(members.map((member) => member.seatNumber));
        let seatNumber = 1;
        while (occupiedSeats.has(seatNumber)) seatNumber += 1;

        await transaction.insert(session_participants).values({
          session_id: params.sessionId,
          user_id: userId,
          display_name: params.displayName,
          seat_number: seatNumber,
          joined_at: params.now,
          updated_at: params.now,
        });
        await transaction
          .update(sessions)
          .set({ updated_at: params.now })
          .where(eq(sessions.id, params.sessionId));
      }

      const joined = await loadSession(transaction, eq(sessions.id, params.sessionId));
      if (!joined) throw new Error('Joined session could not be reloaded.');
      return joined;
    });
  }

  async setParticipantReady(
    params: Parameters<SessionRepository['setParticipantReady']>[0],
  ): Promise<SessionRecord> {
    return this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.auth_subject, params.userId))
        .limit(1);
      if (!user) throw new SessionError('NOT_A_MEMBER', 'You are not a member of this session.', 403);

      const updated = await transaction
        .update(session_participants)
        .set({ is_ready: params.isReady, updated_at: params.now })
        .where(
          and(
            eq(session_participants.session_id, params.sessionId),
            eq(session_participants.user_id, user.id),
          ),
        )
        .returning({ id: session_participants.id });
      if (updated.length === 0) {
        throw new SessionError('NOT_A_MEMBER', 'You are not a member of this session.', 403);
      }

      await transaction
        .update(sessions)
        .set({ updated_at: params.now })
        .where(eq(sessions.id, params.sessionId));
      const session = await loadSession(transaction, eq(sessions.id, params.sessionId));
      if (!session) throw new SessionError('NOT_FOUND', 'Session not found.', 404);
      return session;
    });
  }

  async commitStart(params: Parameters<SessionRepository['commitStart']>[0]): Promise<SessionRecord> {
    return this.database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(sessions)
        .set({
          status: 'active',
          state_version: params.snapshot.stateVersion,
          started_at: params.now,
          updated_at: params.now,
        })
        .where(and(eq(sessions.id, params.sessionId), eq(sessions.status, 'lobby')))
        .returning({ id: sessions.id });
      if (!updated) throw new SessionError('CONFLICT', 'This session has already started.', 409);

      await transaction.insert(state_snapshots).values({
        session_id: params.sessionId,
        state_version: params.snapshot.stateVersion,
        turn_number: params.snapshot.game.currentTurn,
        schema_version: params.snapshot.schemaVersion,
        state: params.snapshot,
        created_at: params.now,
      });

      const session = await loadSession(transaction, eq(sessions.id, params.sessionId));
      if (!session) throw new Error('Started session could not be reloaded.');
      return session;
    });
  }

  async submitTurn(
    params: Parameters<SessionRepository['submitTurn']>[0],
  ): Promise<TurnSubmissionResult> {
    return this.database.transaction(async (transaction) => {
      const [lockedSession] = await transaction
        .select({ stateVersion: sessions.state_version })
        .from(sessions)
        .where(eq(sessions.id, params.sessionId))
        .for('update')
        .limit(1);
      if (!lockedSession) throw new SessionError('NOT_FOUND', 'Session not found.', 404);

      const [participant] = await transaction
        .select({ id: session_participants.id, playerId: session_participants.player_id })
        .from(session_participants)
        .where(
          and(
            eq(session_participants.session_id, params.sessionId),
            eq(session_participants.id, params.participantId),
          ),
        )
        .limit(1);
      if (!participant) throw new SessionError('NOT_A_MEMBER', 'You are not a member of this session.', 403);

      const [duplicate] = await transaction
        .select({
          participantId: turn_submissions.participant_id,
          expectedStateVersion: turn_submissions.expected_state_version,
          resultStateVersion: turn_submissions.result_state_version,
        })
        .from(turn_submissions)
        .where(
          and(
            eq(turn_submissions.session_id, params.sessionId),
            eq(turn_submissions.submission_id, params.submissionId),
          ),
        )
        .limit(1);

      const getSubmittedPlayerIds = async (expectedStateVersion: number): Promise<string[]> => {
        const rows = await transaction
          .select({ playerId: session_participants.player_id })
          .from(turn_submissions)
          .innerJoin(
            session_participants,
            eq(turn_submissions.participant_id, session_participants.id),
          )
          .where(
            and(
              eq(turn_submissions.session_id, params.sessionId),
              eq(turn_submissions.expected_state_version, expectedStateVersion),
            ),
          );
        return rows.map((row) => row.playerId);
      };

      if (duplicate) {
        if (duplicate.participantId !== params.participantId) {
          throw new SessionError('DUPLICATE_SUBMISSION', 'That submission id is already in use.', 409);
        }
        const [snapshotRow] = duplicate.resultStateVersion === null
          ? []
          : await transaction
              .select({ state: state_snapshots.state })
              .from(state_snapshots)
              .where(
                and(
                  eq(state_snapshots.session_id, params.sessionId),
                  eq(state_snapshots.state_version, duplicate.resultStateVersion),
                ),
              )
              .limit(1);
        return {
          status: 'duplicate',
          stateVersion: duplicate.resultStateVersion ?? lockedSession.stateVersion,
          submittedPlayerIds: await getSubmittedPlayerIds(duplicate.expectedStateVersion),
          snapshot: snapshotRow?.state ?? null,
        };
      }

      if (lockedSession.stateVersion !== params.expectedStateVersion) {
        throw new SessionError(
          'STALE_STATE',
          `Your state version ${params.expectedStateVersion} is stale; the server is at ${lockedSession.stateVersion}.`,
          409,
        );
      }

      const [existingForVersion] = await transaction
        .select({ id: turn_submissions.id })
        .from(turn_submissions)
        .where(
          and(
            eq(turn_submissions.session_id, params.sessionId),
            eq(turn_submissions.participant_id, params.participantId),
            eq(turn_submissions.expected_state_version, params.expectedStateVersion),
          ),
        )
        .limit(1);
      if (existingForVersion) {
        throw new SessionError(
          'DUPLICATE_SUBMISSION',
          'This player already submitted actions for the current state version.',
          409,
        );
      }

      await transaction.insert(turn_submissions).values({
        session_id: params.sessionId,
        participant_id: params.participantId,
        submission_id: params.submissionId,
        expected_state_version: params.expectedStateVersion,
        actions: params.actions,
        created_at: params.now,
      });

      const submissionRows = await transaction
        .select({
          playerId: session_participants.player_id,
          actions: turn_submissions.actions,
        })
        .from(turn_submissions)
        .innerJoin(session_participants, eq(turn_submissions.participant_id, session_participants.id))
        .where(
          and(
            eq(turn_submissions.session_id, params.sessionId),
            eq(turn_submissions.expected_state_version, params.expectedStateVersion),
          ),
        );
      const submittedPlayerIds = submissionRows.map((row) => row.playerId);
      if (!params.requiredPlayerIds.every((playerId) => submittedPlayerIds.includes(playerId))) {
        return {
          status: 'pending',
          stateVersion: lockedSession.stateVersion,
          submittedPlayerIds,
          snapshot: null,
        };
      }

      const [currentSnapshot] = await transaction
        .select({ state: state_snapshots.state })
        .from(state_snapshots)
        .where(
          and(
            eq(state_snapshots.session_id, params.sessionId),
            eq(state_snapshots.state_version, params.expectedStateVersion),
          ),
        )
        .limit(1);
      if (!currentSnapshot) throw new SessionError('NOT_FOUND', 'Authoritative state snapshot not found.', 404);

      const nextSnapshot = params.process(
        currentSnapshot.state,
        Object.fromEntries(submissionRows.map((row) => [row.playerId, row.actions])),
      );
      const updated = await transaction
        .update(sessions)
        .set({
          state_version: nextSnapshot.stateVersion,
          updated_at: params.now,
          ...(nextSnapshot.game.status === 'completed'
            ? { status: 'ended' as const, ended_at: params.now }
            : {}),
        })
        .where(
          and(
            eq(sessions.id, params.sessionId),
            eq(sessions.state_version, params.expectedStateVersion),
          ),
        )
        .returning({ id: sessions.id });
      if (updated.length === 0) {
        throw new SessionError('STALE_STATE', 'The session advanced while this turn was being committed.', 409);
      }
      await transaction.insert(state_snapshots).values({
        session_id: params.sessionId,
        state_version: nextSnapshot.stateVersion,
        turn_number: nextSnapshot.game.currentTurn,
        schema_version: nextSnapshot.schemaVersion,
        state: nextSnapshot,
        created_at: params.now,
      });
      await transaction
        .update(turn_submissions)
        .set({ result_state_version: nextSnapshot.stateVersion, committed_at: params.now })
        .where(
          and(
            eq(turn_submissions.session_id, params.sessionId),
            eq(turn_submissions.expected_state_version, params.expectedStateVersion),
          ),
        );

      return {
        status: 'committed',
        stateVersion: nextSnapshot.stateVersion,
        submittedPlayerIds,
        snapshot: nextSnapshot,
      };
    });
  }
}
