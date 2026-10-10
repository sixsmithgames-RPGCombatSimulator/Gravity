/**
 * Purpose: Order durable session mutations without a wire/schema change.
 * Parameters: The locked session's previous revision and requested mutation clock time.
 * Returns: A new timestamp strictly later than the previous revision, even with equal/backward clocks.
 * Side effects: None. Call inside the repository's session mutation guard.
 * Root cause: Millisecond-equal broadcasts let older summaries overwrite newer roster/readiness state.
 */
export function nextSessionRevision(previous: Date, requested: Date): Date {
  const previousTime = previous.getTime();
  const requestedTime = requested.getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(requestedTime)) {
    throw new Error('Session revision requires valid previous and mutation timestamps.');
  }
  return new Date(Math.max(requestedTime, previousTime + 1));
}
