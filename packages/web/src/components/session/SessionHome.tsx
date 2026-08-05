import { useState, type FormEvent } from 'react';
import type { SessionUiError } from '../../session/types';
import { SessionErrorNotice } from './SessionErrorNotice';

type SessionHomeProps = {
  initialDisplayName: string;
  isWorking: boolean;
  error: SessionUiError | null;
  onCreate: (displayName: string, maxPlayers: number) => Promise<void>;
  onJoin: (displayName: string, joinCode: string) => Promise<void>;
};

const fieldClass =
  'w-full rounded-lg border border-cyan-400/30 bg-slate-950/85 px-3 py-2.5 text-slate-100 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';
const buttonClass =
  'w-full rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 font-display font-semibold tracking-wide text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';

export function SessionHome({ initialDisplayName, isWorking, error, onCreate, onJoin }: SessionHomeProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState('');

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    void onCreate(displayName, maxPlayers);
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    void onJoin(displayName, joinCode);
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#164e63_0,transparent_42%),radial-gradient(circle_at_bottom_right,#1e3a8a_0,transparent_38%)] opacity-60" />
      <section className="relative w-full max-w-5xl rounded-2xl border border-cyan-300/20 bg-slate-900/85 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
        <header className="mb-8 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Private beta</p>
          <h1 className="font-display text-4xl font-bold tracking-wider sm:text-5xl">GRAVITY</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Assemble a crew, survive the gravity well, and resume from any signed-in device.
          </p>
        </header>

        <SessionErrorNotice error={error} className="mb-6" />

        <div className="grid gap-5 md:grid-cols-2">
          <form onSubmit={submitCreate} className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
            <h2 className="font-display text-xl text-cyan-200">Create mission</h2>
            <p className="mt-2 text-sm text-slate-400">You become host and receive a private eight-character code.</p>
            <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="create-display-name">
              Commander name
            </label>
            <input
              id="create-display-name"
              className={`${fieldClass} mt-2`}
              value={displayName}
              maxLength={50}
              required
              autoComplete="nickname"
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <label className="mt-4 block text-sm font-medium text-slate-200" htmlFor="max-players">
              Maximum players
            </label>
            <select
              id="max-players"
              className={`${fieldClass} mt-2`}
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(Number(event.target.value))}
            >
              {[2, 3, 4, 5, 6].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
            <button className={`${buttonClass} mt-6`} disabled={isWorking} type="submit">
              {isWorking ? 'Creating…' : 'Create private session'}
            </button>
          </form>

          <form onSubmit={submitJoin} className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
            <h2 className="font-display text-xl text-cyan-200">Join mission</h2>
            <p className="mt-2 text-sm text-slate-400">Enter the private code shared by your host.</p>
            <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="join-display-name">
              Commander name
            </label>
            <input
              id="join-display-name"
              className={`${fieldClass} mt-2`}
              value={displayName}
              maxLength={50}
              required
              autoComplete="nickname"
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <label className="mt-4 block text-sm font-medium text-slate-200" htmlFor="join-code">
              Join code
            </label>
            <input
              id="join-code"
              className={`${fieldClass} mt-2 uppercase tracking-[0.25em]`}
              value={joinCode}
              minLength={8}
              maxLength={9}
              required
              autoCapitalize="characters"
              autoComplete="one-time-code"
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            <button className={`${buttonClass} mt-6`} disabled={isWorking} type="submit">
              {isWorking ? 'Joining…' : 'Join private session'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
