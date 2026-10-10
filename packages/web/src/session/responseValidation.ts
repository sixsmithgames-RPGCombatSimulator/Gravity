import { deserializeGameStateSnapshot } from '@gravity/core';

type ResponseRecord = Record<string, unknown>;

/**
 * Purpose: Reject missing or non-object envelopes before controller property access.
 * Parameters: Untrusted value and developer-only field label.
 * Returns: The checked record; throws a diagnostic on unusable data.
 * Side effects: None.
 */
function record(value: unknown, field: string): ResponseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as ResponseRecord;
}

/**
 * Purpose: Require real wire identities instead of guessed/default strings.
 * Parameters: Untrusted value and developer-only field label.
 * Returns: Nothing; narrows a valid value or throws a diagnostic.
 * Side effects: None.
 */
function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a nonempty string.`);
}

/**
 * Purpose: Prevent unusable versions or roster bounds from entering monotonic acceptance.
 * Parameters: Untrusted number, diagnostic field label and supported bounds.
 * Returns: Nothing; narrows a valid integer or throws a diagnostic.
 * Side effects: None.
 */
function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} is outside its supported integer range.`);
  }
}

/**
 * Purpose: Require a usable server revision rather than manufacturing a timestamp.
 * Parameters: Untrusted timestamp and developer-only field label.
 * Returns: Nothing for a parseable date; throws a diagnostic otherwise.
 * Side effects: None.
 */
function date(value: unknown, field: string): void {
  text(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a usable timestamp.`);
}

/**
 * Purpose: Validate membership fields consumed by roster rendering and authorization binding.
 * Parameters: Untrusted participant value.
 * Returns: A checked record or throws a developer-only diagnostic.
 * Side effects: None.
 */
function participant(value: unknown): ResponseRecord {
  const member = record(value, 'participant');
  for (const field of ['id', 'sessionId', 'playerId', 'displayName']) text(member[field], `participant.${field}`);
  if (member.userId !== null) text(member.userId, 'participant.userId');
  integer(member.seatNumber, 'participant.seatNumber', 1, 6);
  for (const field of ['isReady', 'isBot', 'isHost']) {
    if (typeof member[field] !== 'boolean') throw new Error(`participant.${field} must be a boolean.`);
  }
  date(member.joinedAt, 'participant.joinedAt'); date(member.updatedAt, 'participant.updatedAt');
  return member;
}

/**
 * Purpose: Validate the consumed SessionAccess envelope and reuse canonical snapshot deserialization.
 * Parameters: Untrusted decoded API value.
 * Returns: Nothing on usable data; throws developer-only diagnostics otherwise.
 * Side effects: None; it never hydrates or changes the committed game.
 */
export function validateSessionAccessResponse(value: unknown): void {
  const access = record(value, 'access');
  const session = record(access.session, 'session');
  const member = participant(access.participant);
  text(session.id, 'session.id'); text(session.createdBy, 'session.createdBy');
  integer(session.stateVersion, 'session.stateVersion', 0);
  integer(session.maxPlayers, 'session.maxPlayers', 2, 6);
  const maxPlayers = session.maxPlayers;
  if (!['lobby', 'active', 'ended', 'abandoned'].includes(String(session.status))) throw new Error('session.status is unsupported.');
  date(session.createdAt, 'session.createdAt'); date(session.updatedAt, 'session.updatedAt');
  if (session.startedAt !== null) date(session.startedAt, 'session.startedAt');
  if (!Array.isArray(session.participants) || !Array.isArray(session.pendingPlayerIds)) throw new Error('session roster and pending seats must be arrays.');
  const members = session.participants.map(participant);
  if (member.sessionId !== session.id || !members.some((candidate) => candidate.id === member.id && candidate.playerId === member.playerId)) {
    throw new Error('Access participant does not match the session roster.');
  }
  const playerIds = new Set(members.map((candidate) => candidate.playerId));
  const seats = new Set(members.map((candidate) => candidate.seatNumber));
  if (playerIds.size !== members.length || seats.size !== members.length || members.length > maxPlayers ||
      members.some((candidate) => candidate.sessionId !== session.id || Number(candidate.seatNumber) > maxPlayers)) {
    throw new Error('Session roster identities or seats are inconsistent.');
  }
  for (const id of session.pendingPlayerIds) {
    text(id, 'pending player');
    if (!playerIds.has(id)) throw new Error('Pending seat does not belong to this session.');
  }
  if (session.latestSnapshot !== null) {
    const snapshot = deserializeGameStateSnapshot(session.latestSnapshot);
    if (snapshot.game.id !== session.id || snapshot.stateVersion !== session.stateVersion || !snapshot.game.players.has(String(member.playerId))) {
      throw new Error('Snapshot identity/version does not match the session access.');
    }
  } else if (session.status === 'active' || session.status === 'ended') {
    throw new Error('An active or completed mission requires a committed snapshot.');
  }
}

/**
 * Purpose: Confirm creation only when its session and recoverable private code are usable.
 * Parameters: Untrusted decoded creation result.
 * Returns: Nothing on usable data; throws a developer-only diagnostic otherwise.
 * Side effects: None.
 */
export function validateCreatedSessionResponse(value: unknown): void {
  validateSessionAccessResponse(value);
  const access = record(value, 'created access');
  text(access.joinCode, 'joinCode');
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(access.joinCode)) throw new Error('Created session code is unusable.');
}

/**
 * Purpose: Reject unusable turn replies before clearing their uncertain retry identity.
 * Parameters: Untrusted decoded turn result.
 * Returns: Nothing when status/version/seats and canonical snapshot agree; throws otherwise.
 * Side effects: None.
 */
export function validateTurnSubmissionResponse(value: unknown): void {
  const result = record(value, 'turn result');
  if (!['pending', 'committed', 'duplicate'].includes(String(result.status))) throw new Error('Turn result status is unsupported.');
  integer(result.stateVersion, 'turn result.stateVersion', 0);
  if (!Array.isArray(result.submittedPlayerIds)) throw new Error('Turn submitted players must be an array.');
  result.submittedPlayerIds.forEach((id) => text(id, 'submitted player'));
  if (result.snapshot !== null) {
    const snapshot = deserializeGameStateSnapshot(result.snapshot);
    if (snapshot.stateVersion !== result.stateVersion) throw new Error('Turn result snapshot version does not match.');
  } else if (result.status === 'committed') throw new Error('Committed turn result has no snapshot.');
}
