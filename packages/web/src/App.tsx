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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <Header />

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Game board - takes most of the space */}
        <div className="flex-1 relative">
          <GameBoard />
          <EventOverlay />
          <RosterOverlay />
          <SettingsOverlay />
          <GameEndOverlay />
        </div>

        {/* Ship dashboard - fixed width sidebar (playmat temporarily hidden) */}
        <aside
          className="w-[clamp(400px,34vw,700px)] min-w-[400px] border-l border-gravity-border overflow-y-auto bg-slate-900"
        >
          {/* Inner overlay panel to keep text readable while aligning to mat */}
          <div className="h-full bg-slate-900/70 px-4 py-4 flex flex-col">
            <ShipDashboard />
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
