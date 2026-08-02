import { ClerkFailed, ClerkLoaded, ClerkLoading, Show, SignInButton, UserButton, useAuth, useUser } from '@clerk/react';
import { useMemo } from 'react';

import App from '../../App';
import type { IdentityAccess } from '../../session/auth';

function AuthStatus({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-slate-900/90 p-8 text-center shadow-2xl shadow-black/60">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Sixsmith Games</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-wider">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
      </section>
    </main>
  );
}

function SignedOutSurface() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-slate-900/90 p-8 text-center shadow-2xl shadow-black/60">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Private beta</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-wider">GRAVITY</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Sign in with your Sixsmith Games account to create, join, and resume private missions.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-7 w-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-display font-semibold text-white transition hover:brightness-110"
          >
            Sign in to play
          </button>
        </SignInButton>
        <a className="mt-4 inline-block text-sm text-slate-400 hover:text-slate-200" href="https://www.sixsmithgames.com">
          Back to Sixsmith Games
        </a>
      </section>
    </main>
  );
}

function SignedInApplication() {
  const { getToken } = useAuth();
  const { isLoaded, user } = useUser();
  const identity = useMemo<IdentityAccess>(
    () => ({
      displayName:
        user?.fullName?.trim() ||
        user?.firstName?.trim() ||
        user?.username?.trim() ||
        user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
        '',
      async getToken(): Promise<string> {
        const token = await getToken();
        if (!token) throw new Error('Your sign-in session expired. Sign in again to continue.');
        return token;
      },
    }),
    [getToken, user],
  );

  if (!isLoaded || !user) {
    return <AuthStatus title="GRAVITY" message="Loading your commander profile…" />;
  }

  return (
    <>
      <div className="fixed right-3 top-3 z-[70] rounded-full bg-slate-950/80 p-1 shadow-lg" aria-label="Account menu">
        <UserButton />
      </div>
      <App identity={identity} />
    </>
  );
}

export function AuthBoundary() {
  return (
    <>
      <ClerkLoading>
        <AuthStatus title="GRAVITY" message="Loading your secure mission access…" />
      </ClerkLoading>
      <ClerkFailed>
        <AuthStatus title="Access unavailable" message="Identity services could not load. Check your connection and retry." />
      </ClerkFailed>
      <ClerkLoaded>
        <Show when="signed-in" fallback={<SignedOutSurface />}>
          <SignedInApplication />
        </Show>
      </ClerkLoaded>
    </>
  );
}
