import { useGameStore } from '../../store/gameStore';
import { calculateVictoryPointBreakdown, compareVictoryPointBreakdowns } from '@gravity/core';

/**
 * GameEndOverlay component
 * Purpose: Display end-of-game results including victory/defeat status and scores
 *
 * Shows when:
 * - game.status === 'completed' (at least one player escaped)
 * - game.status === 'abandoned' (all players wrecked)
 *
 * Displays:
 * - Game outcome (victory/defeat)
 * - Player rankings with scores
 * - Option to start new game
 */
export function GameEndOverlay() {
  const { game, setGame, setCurrentPlayer } = useGameStore();

  if (!game || (game.status !== 'completed' && game.status !== 'abandoned')) {
    return null;
  }

  const players = Array.from(game.players.values());

  // The same canonical breakdown powers both the displayed total and the documented tie-break order.
  const playerScores = players.map((player) => {
    const breakdown = calculateVictoryPointBreakdown(player, players);
    return {
      id: player.id,
      isBot: player.isBot,
      status: player.status,
      score: breakdown.total,
      breakdown,
    };
  });
  const rankedPlayers = [...playerScores].sort((left, right) =>
    compareVictoryPointBreakdowns(left.breakdown, right.breakdown),
  );

  const isVictory = game.status === 'completed';
  const escapedCount = players.filter((p) => p.status === 'escaped').length;
  const wreckedCount = players.filter((p) => p.status === 'wrecked').length;

  const handleNewGame = () => {
    // Reset game state - this will trigger the useEffect in App.tsx to create a new mock game
    setGame(null);
    setCurrentPlayer(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-results-title"
    >
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-gravity-border bg-gravity-surface/95 px-4 py-6 shadow-2xl sm:px-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-[11px] tracking-[0.25em] uppercase text-gravity-muted mb-2">
            Game Over
          </div>
          <h2
            id="game-results-title"
            className={`text-3xl font-display font-bold tracking-wide ${
              isVictory ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {isVictory ? 'MISSION COMPLETE' : 'ALL SHIPS LOST'}
          </h2>
          <p className="text-sm text-gravity-muted mt-2">
            {isVictory
              ? `${escapedCount} ship${escapedCount !== 1 ? 's' : ''} escaped the gravity well`
              : 'No ships escaped the black hole'}
          </p>
        </div>

        {/* Summary Stats */}
        <div className="flex justify-center gap-8 mb-6 text-center">
          <div>
            <div className="text-2xl font-bold text-green-400">{escapedCount}</div>
            <div className="text-[10px] text-gravity-muted uppercase tracking-wide">Escaped</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-400">{wreckedCount}</div>
            <div className="text-[10px] text-gravity-muted uppercase tracking-wide">Wrecked</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-sky-400">{game.currentTurn}</div>
            <div className="text-[10px] text-gravity-muted uppercase tracking-wide">Turns</div>
          </div>
        </div>

        {/* Player Rankings */}
        <div className="mb-6">
          <div className="text-xs font-bold uppercase tracking-wide text-gravity-muted mb-3 text-center">
            Final Standings
          </div>
          <div className="space-y-3">
            {rankedPlayers.map((player, index) => (
              <div
                key={player.id}
                className={`rounded-lg p-3 ${
                  index === 0
                    ? 'bg-yellow-900/30 border border-yellow-600/40'
                    : 'bg-slate-800/50 border border-slate-700/40'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0
                          ? 'bg-yellow-600 text-yellow-100'
                          : index === 1
                            ? 'bg-slate-400 text-slate-900'
                            : index === 2
                              ? 'bg-amber-700 text-amber-100'
                              : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        {player.isBot ? `Bot ${player.id.slice(-4)}` : `Player ${player.id.slice(-4)}`}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-gravity-muted">
                        {player.status === 'escaped' && 'Escaped'}
                        {player.status === 'wrecked' && 'Wrecked'}
                        {player.status === 'active' && 'Active at game end'}
                        {' / '}
                        {player.breakdown.activeCrewCount} active crew
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-sky-400">{player.score}</div>
                    <div className="text-[10px] text-gravity-muted">victory points</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                  {[
                    ['Escape', player.breakdown.escape],
                    ['Mission', player.breakdown.missions],
                    ['Sections', player.breakdown.functionalSections + player.breakdown.fullyPoweredSections],
                    ['Upgrades', player.breakdown.upgrades],
                    ['Crew', player.breakdown.crew],
                    ['Hull', player.breakdown.hull],
                    ['Shields', player.breakdown.shields],
                    ['Power', player.breakdown.storedPower],
                  ].map(([label, points]) => (
                    <div key={label} className="rounded bg-slate-950/45 px-1.5 py-1 text-center">
                      <div className="text-xs font-semibold text-slate-100">{points}</div>
                      <div className="text-[9px] uppercase tracking-wide text-gravity-muted">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[10px] leading-4 text-gravity-muted">
            Ties: mission points, upgrades installed, fully powered sections, active crew, then total power.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleNewGame}
            className="btn-primary flex-1 text-sm"
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}
