import { useGameStore } from '../../store/gameStore';
import { ActionBar } from '../actions/ActionBar';

/**
 * Header component
 * Purpose: Display game status, turn info, and global controls
 *
 * Shows:
 * - Game logo/title
 * - Current turn number
 * - Current phase
 * - Active player indicator
 * - Settings button
 */
export function Header() {
  const { game, toggleRoster, toggleSettings, toggleHelp, newGame, difficulty, setDifficulty } = useGameStore();

  if (!game) {
    return null;
  }

  // Map phase to display text
  const phaseDisplay: Record<string, string> = {
    event: 'Event Phase',
    action_planning: 'Plan Actions',
    action_execution: 'Executing...',
    environment: 'Environment',
    resolution: 'Resolution',
  };

  const phaseColorMap: Record<string, string> = {
    event: 'from-amber-500/20 to-amber-600/10 border-amber-500/40 text-amber-300',
    action_planning: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-300',
    action_execution: 'from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-300',
    environment: 'from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-300',
    resolution: 'from-slate-500/20 to-slate-600/10 border-slate-400/40 text-slate-300',
  };

  const phaseColors = phaseColorMap[game.turnPhase] ?? phaseColorMap.resolution;

  const statusDotColor = game.status === 'in_progress' ? 'bg-emerald-400' : 'bg-amber-400';

  return (
    <header className="relative bg-slate-950/60 backdrop-blur-sm border-b border-gravity-border/20">
      {/* Bottom border glow */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />

      <div className="h-11 px-4 flex items-center justify-between">
        {/* Logo and title */}
        <div className="flex items-center gap-3">
          {/* Mini gravity well icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" className="text-blue-400">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
            <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.8" />
          </svg>
          <h1 className="font-display text-xl font-bold tracking-[0.2em] bg-gradient-to-r from-blue-300 via-slate-100 to-blue-300 bg-clip-text text-transparent">
            GRAVITY
          </h1>
        </div>

        {/* Turn and phase info */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gravity-muted">Turn</span>
            <span className="font-display text-lg font-bold tabular-nums text-slate-100">{game.currentTurn}</span>
          </div>

          <div className={`px-3 py-1 rounded-md bg-gradient-to-r ${phaseColors} border backdrop-blur-sm`}>
            <span className="text-xs font-semibold tracking-wide">
              {phaseDisplay[game.turnPhase] ?? game.turnPhase}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${statusDotColor} animate-pulse`} />
            <span className="text-xs text-gravity-muted">
              {game.status === 'in_progress' ? 'Active' : game.status}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-widest text-gravity-muted flex items-center gap-1.5 mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
              className="text-xs bg-transparent border border-gravity-border/50 rounded-md px-2 py-1 focus:outline-none focus:border-gravity-accent cursor-pointer hover:border-gravity-muted transition-colors"
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <button
            onClick={newGame}
            className="px-3 py-1.5 rounded-md border border-gravity-border/50 text-xs text-gravity-muted hover:text-slate-100 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all duration-200"
            title="Start a new game"
          >
            New Game
          </button>
          <button
            onClick={toggleRoster}
            className="px-3 py-1.5 rounded-md border border-gravity-border/50 text-xs text-gravity-muted hover:text-slate-100 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all duration-200"
            title="Edit captain and officers"
          >
            Roster
          </button>
          <button
            onClick={toggleHelp}
            className="w-8 h-8 rounded-md flex items-center justify-center text-gravity-muted hover:text-slate-100 hover:bg-slate-700/50 transition-all duration-200"
            title="Help (H)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
          <button
            onClick={toggleSettings}
            className="w-8 h-8 rounded-md flex items-center justify-center text-gravity-muted hover:text-slate-100 hover:bg-slate-700/50 transition-all duration-200"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
        </div>
      </div>
      <ActionBar />
    </header>
  );
}
