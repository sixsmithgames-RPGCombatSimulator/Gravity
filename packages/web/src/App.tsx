import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { GameBoard } from './components/board/GameBoard';
import { EventOverlay } from './components/events/EventOverlay';
import { GameEndOverlay } from './components/game/GameEndOverlay';
import { RosterOverlay } from './components/game/RosterOverlay';
import { SettingsOverlay } from './components/game/SettingsOverlay';
import { ShipDashboard } from './components/ship/ShipDashboard';
import { Header } from './components/layout/Header';
import { createMockGame } from './utils/mockGame';

/**
 * Main application component
 * Purpose: Root component that assembles the game interface layout
 *
 * Layout structure:
 * - Header: Turn info, phase indicator, settings
 * - Main: Board (left/center) + Ship Dashboard (right)
 * - Footer: Action bar for turn planning
 */
function App() {
  const { game, setGame, setCurrentPlayer, difficulty } = useGameStore();

  // Initialize with mock game for development
  useEffect(() => {
    if (!game) {
      const mockGame = createMockGame(difficulty);
      setGame(mockGame);
      // Set first player as current player
      const firstPlayerId = Array.from(mockGame.players.keys())[0];
      if (firstPlayerId) {
        setCurrentPlayer(firstPlayerId);
      }
    }
  }, [game, setGame, setCurrentPlayer, difficulty]);

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-4xl mb-4">GRAVITY</h1>
          <p className="text-gravity-muted">Loading game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 relative">
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

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Game board - takes most of the space */}
        <div className="flex-1 relative overflow-hidden">
          <GameBoard />
          <EventOverlay />
          <RosterOverlay />
          <SettingsOverlay />
          <GameEndOverlay />
        </div>

        {/* Ship dashboard - larger width for better visibility */}
        <aside
          className="w-[clamp(620px,48vw,880px)] min-w-[620px] border-l border-gravity-border/30 overflow-y-auto bg-slate-950/80 backdrop-blur-sm"
        >
          <div className="h-full px-4 py-4 flex flex-col">
            <ShipDashboard />
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
