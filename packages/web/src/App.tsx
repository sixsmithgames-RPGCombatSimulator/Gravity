import { useEffect, useRef } from 'react';
import { deserializeGameStateSnapshot } from '@gravity/core';
import { useGameStore } from './store/gameStore';
import { GameBoard } from './components/board/GameBoard';
import { EventOverlay } from './components/events/EventOverlay';
import { GameEndOverlay } from './components/game/GameEndOverlay';
import { HelpOverlay } from './components/game/HelpOverlay';
import { RosterOverlay } from './components/game/RosterOverlay';
import { SettingsOverlay } from './components/game/SettingsOverlay';
import { ShipDashboard } from './components/ship/ShipDashboard';
import { Header } from './components/layout/Header';
import { SessionHome } from './components/session/SessionHome';
import { SessionLobby } from './components/session/SessionLobby';
import { useSessionController } from './session/useSessionController';
import type { IdentityAccess } from './session/auth';

/**
 * Main application component
 * Purpose: Root component that assembles the game interface layout
 *
 * Layout structure:
 * - Header: Turn info, phase indicator, settings
 * - Main: Board (left/center) + Ship Dashboard (right)
 * - Footer: Action bar for turn planning
 */
function App({ identity }: { identity: IdentityAccess }) {
  const { game, setGame, setCurrentPlayer, clearPlannedActions, setNetworkTurnSubmitter } = useGameStore();
  const session = useSessionController(identity.getToken);
  const appliedStateVersion = useRef(-1);

  useEffect(() => {
    const snapshot = session.access?.session.latestSnapshot;
    if (!snapshot || snapshot.stateVersion <= appliedStateVersion.current) return;

    const hydrated = deserializeGameStateSnapshot(snapshot).game;
    appliedStateVersion.current = snapshot.stateVersion;
    setGame(hydrated);
    clearPlannedActions();
    if (session.access) {
      setCurrentPlayer(session.access.participant.playerId);
    }
  }, [clearPlannedActions, game?.id, session.access, setCurrentPlayer, setGame]);

  useEffect(() => {
    setNetworkTurnSubmitter(session.submitTurn);
    return () => setNetworkTurnSubmitter(null);
  }, [session.submitTurn, setNetworkTurnSubmitter]);

  if (session.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-slate-100 flex items-center justify-center">
        <div role="status" className="text-center">
          <h1 className="font-display text-4xl mb-4">GRAVITY</h1>
          <p className="text-gravity-muted">Restoring your mission…</p>
        </div>
      </div>
    );
  }

  if (!session.access) {
    return (
      <SessionHome
        initialDisplayName={identity.displayName}
        isWorking={session.isWorking}
        error={session.error}
        onCreate={session.createSession}
        onJoin={session.joinSession}
      />
    );
  }

  if (session.access.session.status === 'lobby') {
    return (
      <SessionLobby
        access={session.access}
        joinCode={session.joinCode}
        isWorking={session.isWorking}
        error={session.error}
        onSetReady={session.setReady}
        onSetBotSeat={session.setBotSeat}
        onCancel={session.cancelSession}
        onStart={session.startSession}
      />
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-4xl mb-4">GRAVITY</h1>
          <p className="text-gravity-muted">Synchronizing authoritative game state…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-slate-950 relative">
      {/* Starry space background for entire app */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `radial-gradient(2px 2px at 20% 30%, white, transparent),
                          radial-gradient(2px 2px at 60% 70%, white, transparent),
                          radial-gradient(1px 1px at 50% 50%, white, transparent),
                          radial-gradient(1px 1px at 80% 10%, white, transparent),
                          radial-gradient(2px 2px at 90% 60%, white, transparent),
                          radial-gradient(1px 1px at 33% 80%, white, transparent),
                          radial-gradient(1px 1px at 15% 60%, white, transparent)`,
        backgroundSize: '200px 200px, 300px 300px, 250px 250px, 400px 400px, 350px 350px, 280px 280px, 320px 320px',
        backgroundPosition: '0 0, 40px 60px, 130px 270px, 70px 100px, 200px 150px, 160px 50px, 90px 180px',
        opacity: 0.4
      }} />
      {/* Header */}
      <Header />

      {session.turnStatus ? (
        <div role="status" className="relative z-20 border-b border-cyan-400/20 bg-cyan-950/85 px-4 py-2 text-center text-xs text-cyan-100">
          {session.turnStatus}
        </div>
      ) : null}

      {/* Main content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Game board - takes most of the space */}
        <div className="relative min-h-[56dvh] lg:min-h-0 lg:flex-1 overflow-hidden">
          <GameBoard />
          <EventOverlay />
          <RosterOverlay />
          <HelpOverlay />
          <SettingsOverlay />
          <GameEndOverlay />
        </div>

        {/* Ship dashboard - larger width for better visibility */}
        <aside
          className="w-full lg:w-[clamp(620px,48vw,880px)] lg:min-w-[620px] border-t lg:border-t-0 lg:border-l border-gravity-border/30 overflow-visible lg:overflow-y-auto bg-slate-950/80 backdrop-blur-sm"
        >
          <div className="min-h-full px-3 py-4 sm:px-4 flex flex-col">
            <ShipDashboard />
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
