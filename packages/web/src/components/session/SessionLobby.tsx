import type { SessionAccess } from '../../session/types';

type SessionLobbyProps = {
  access: SessionAccess;
  joinCode: string | null;
  isWorking: boolean;
  error: string | null;
  onSetReady: (isReady: boolean) => Promise<void>;
  onStart: () => Promise<void>;
};

export function SessionLobby({
  access,
  joinCode,
  isWorking,
  error,
  onSetReady,
  onStart,
}: SessionLobbyProps) {
  const { participant, session } = access;
  const allReady = session.participants.length >= 2 && session.participants.every((member) => member.isReady);

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#164e63_0,transparent_42%),radial-gradient(circle_at_bottom_left,#312e81_0,transparent_38%)] opacity-60" />
      <section className="relative w-full max-w-3xl rounded-2xl border border-cyan-300/20 bg-slate-900/90 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Mission lobby</p>
            <h1 className="mt-2 font-display text-3xl font-bold">Crew assembly</h1>
            <p className="mt-2 text-sm text-slate-400">
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

        {error ? (
          <div role="alert" className="mt-5 rounded-lg border border-rose-400/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <ul className="mt-6 space-y-3" aria-label="Session participants">
          {session.participants.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/55 px-4 py-3"
            >
              <div>
                <p className="font-medium text-slate-100">
                  Seat {member.seatNumber}: {member.displayName}
                  {member.isHost ? <span className="ml-2 text-xs uppercase tracking-wider text-amber-300">Host</span> : null}
                </p>
                {member.id === participant.id ? <p className="mt-1 text-xs text-cyan-300">This is you</p> : null}
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                  member.isReady ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/70 text-slate-300'
                }`}
              >
                {member.isReady ? 'Ready' : 'Preparing'}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void onSetReady(!participant.isReady)}
            className="rounded-lg border border-cyan-300/40 bg-cyan-950/35 px-4 py-3 font-semibold text-cyan-100 transition hover:bg-cyan-900/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {participant.isReady ? 'Mark not ready' : 'Ready up'}
          </button>
          {participant.isHost ? (
            <button
              type="button"
              disabled={isWorking || !allReady}
              onClick={() => void onStart()}
              className="rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 font-display font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allReady ? 'Launch mission' : 'Waiting for all players'}
            </button>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-white/10 bg-slate-950/45 px-4 py-3 text-sm text-slate-400">
              Host launches when everyone is ready
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
