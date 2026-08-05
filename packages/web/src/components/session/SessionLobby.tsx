import type { SessionAccess, SessionParticipant, SessionUiError } from '../../session/types';
import { SessionErrorNotice } from './SessionErrorNotice';

type SessionLobbyProps = {
  access: SessionAccess;
  joinCode: string | null;
  isWorking: boolean;
  error: SessionUiError | null;
  onSetReady: (isReady: boolean) => Promise<void>;
  onSetBotSeat: (seatNumber: number, isBot: boolean) => Promise<void>;
  onCancel: () => Promise<void>;
  onStart: () => Promise<void>;
};

type LobbySeat = {
  seatNumber: number;
  member: SessionParticipant | null;
};

/**
 * Purpose: Project the configured game size into an explicit, stable list of occupied and open seats.
 * Parameters: Maximum player count and the authoritative participant roster.
 * Returns: One entry for every seat the game expects at launch.
 * Side effects: None.
 */
function createLobbySeats(maxPlayers: number, participants: SessionParticipant[]): LobbySeat[] {
  const participantsBySeat = new Map(participants.map((member) => [member.seatNumber, member]));
  return Array.from({ length: maxPlayers }, (_, index) => ({
    seatNumber: index + 1,
    member: participantsBySeat.get(index + 1) ?? null,
  }));
}

/**
 * Purpose: Prevent an accidental host cancellation from closing the lobby for every connected player.
 * Parameters: None.
 * Returns: Whether the host confirmed the destructive lobby transition.
 * Side effects: Opens the browser's confirmation dialog.
 */
function confirmCancellation(): boolean {
  return window.confirm('Cancel this game for everyone and return to mission setup?');
}

/**
 * Purpose: Make the consequence of replacing a connected human with automation explicit.
 * Parameters: Display name of the human currently occupying the selected seat.
 * Returns: Whether the host confirmed replacing that player.
 * Side effects: Opens the browser's confirmation dialog.
 */
function confirmBotReplacement(displayName: string): boolean {
  return window.confirm(`${displayName} will be removed from this lobby and replaced by a bot. Continue?`);
}

export function SessionLobby({
  access,
  joinCode,
  isWorking,
  error,
  onSetReady,
  onSetBotSeat,
  onCancel,
  onStart,
}: SessionLobbyProps) {
  const { participant, session } = access;
  const seats = createLobbySeats(session.maxPlayers, session.participants);
  const openSeatCount = session.maxPlayers - session.participants.length;
  const botCount = session.participants.filter((member) => member.isBot).length;
  const humanCount = session.participants.length - botCount;
  const allReady =
    session.participants.length === session.maxPlayers &&
    session.participants.every((member) => member.isReady);

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#164e63_0,transparent_42%),radial-gradient(circle_at_bottom_left,#312e81_0,transparent_38%)] opacity-60" />
      <section className="relative w-full max-w-4xl rounded-2xl border border-cyan-300/20 bg-slate-900/90 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Mission lobby</p>
            <h1 className="mt-2 font-display text-3xl font-bold">Crew assembly</h1>
            <p data-testid="configured-player-count" className="mt-2 text-sm font-medium text-slate-200">
              {session.maxPlayers}-player game
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {session.participants.length} of {session.maxPlayers} seats occupied
            </p>
          </div>
          {joinCode ? (
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-950/30 px-4 py-3 text-center">
              <p className="text-[0.65rem] uppercase tracking-[0.25em] text-cyan-300">Private code</p>
              <p data-testid="join-code" className="mt-1 font-mono text-xl font-bold tracking-[0.2em] text-white">{joinCode}</p>
            </div>
          ) : null}
        </header>

        <dl className="mt-5 grid grid-cols-3 gap-2 text-center sm:gap-3">
          <div className="rounded-lg border border-white/10 bg-slate-950/45 px-2 py-3">
            <dt className="text-[0.65rem] uppercase tracking-wider text-slate-500">Humans</dt>
            <dd className="mt-1 text-lg font-semibold text-cyan-200">{humanCount}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 px-2 py-3">
            <dt className="text-[0.65rem] uppercase tracking-wider text-slate-500">Bots</dt>
            <dd className="mt-1 text-lg font-semibold text-violet-200">{botCount}</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-950/45 px-2 py-3">
            <dt className="text-[0.65rem] uppercase tracking-wider text-slate-500">Open</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-200">{openSeatCount}</dd>
          </div>
        </dl>

        <SessionErrorNotice error={error} className="mt-5" />

        <ul className="mt-6 space-y-3" aria-label="Session player slots">
          {seats.map(({ seatNumber, member }) => (
            <li
              key={seatNumber}
              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-slate-100">
                  Seat {seatNumber}: {member?.displayName ?? 'Open player slot'}
                  {member?.isHost ? <span className="ml-2 text-xs uppercase tracking-wider text-amber-300">Host</span> : null}
                  {member?.isBot ? <span className="ml-2 text-xs uppercase tracking-wider text-violet-300">Bot</span> : null}
                </p>
                {member?.id === participant.id ? <p className="mt-1 text-xs text-cyan-300">This is you</p> : null}
                {!member ? <p className="mt-1 text-xs text-slate-500">Waiting for a player or host-assigned bot</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                    member?.isBot
                      ? 'bg-violet-500/15 text-violet-300'
                      : member?.isReady
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : member
                          ? 'bg-slate-700/70 text-slate-300'
                          : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {member?.isBot ? 'Automated' : member?.isReady ? 'Ready' : member ? 'Preparing' : 'Open'}
                </span>

                {participant.isHost && seatNumber > 1 ? (
                  member?.isBot ? (
                    <button
                      type="button"
                      aria-label={`Open seat ${seatNumber}`}
                      disabled={isWorking}
                      onClick={() => void onSetBotSeat(seatNumber, false)}
                      className="rounded-md border border-slate-500/50 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Open seat
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={member ? `Replace ${member.displayName} with bot` : `Add bot to seat ${seatNumber}`}
                      disabled={isWorking}
                      onClick={() => {
                        if (member && !confirmBotReplacement(member.displayName)) return;
                        void onSetBotSeat(seatNumber, true);
                      }}
                      className="rounded-md border border-violet-400/50 bg-violet-950/25 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {member ? 'Replace with bot' : 'Add bot'}
                    </button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <div className={`mt-7 grid gap-3 ${participant.isHost ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void onSetReady(!participant.isReady)}
            className="rounded-lg border border-cyan-300/40 bg-cyan-950/35 px-4 py-3 font-semibold text-cyan-100 transition hover:bg-cyan-900/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {participant.isReady ? 'Mark not ready' : 'Ready up'}
          </button>
          {participant.isHost ? (
            <>
              <button
                type="button"
                disabled={isWorking || !allReady}
                onClick={() => void onStart()}
                className="rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 font-display font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {allReady
                  ? 'Launch mission'
                  : openSeatCount > 0
                    ? `Fill ${openSeatCount} player slot${openSeatCount === 1 ? '' : 's'}`
                    : 'Waiting for all humans'}
              </button>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => {
                  if (confirmCancellation()) void onCancel();
                }}
                className="rounded-lg border border-rose-400/50 bg-rose-950/30 px-4 py-3 font-semibold text-rose-200 transition hover:bg-rose-900/45 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel game
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-white/10 bg-slate-950/45 px-4 py-3 text-sm text-slate-400">
              Host launches when every slot is filled and each human is ready
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
