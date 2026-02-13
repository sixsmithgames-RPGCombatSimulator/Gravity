import { useGameStore } from '../../store/gameStore';
import { calculateVictoryPoints } from '@gravity/core';

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

  // Calculate scores for each player
  const playerScores = players.map((player) => ({
    id: player.id,
    userId: player.userId,
    isBot: player.isBot,
    status: player.status,
    score: calculateVictoryPoints(player),
    crewSurvived: player.crew.filter((c) => c.status === 'active').length,
    captainSurvived: player.captain.status === 'active',
  }));

  // Sort by score descending
  const rankedPlayers = [...playerScores].sort((a, b) => b.score - a.score);

  const isVictory = game.status === 'completed';
  const escapedCount = players.filter((p) => p.status === 'escaped').length;
  const wreckedCount = players.filter((p) => p.status === 'wrecked').length;

  const handleNewGame = () => {
    // Reset game state - this will trigger the useEffect in App.tsx to create a new mock game
    setGame(null);
    setCurrentPlayer(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="max-w-lg w-full bg-gravity-surface/95 border border-gravity-border shadow-2xl rounded-lg px-8 py-6">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-[11px] tracking-[0.25em] uppercase text-gravity-muted mb-2">
            Game Over
          </div>
          <h2
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
          <div className="space-y-2">
            {rankedPlayers.map((player, index) => (
              <div
                key={player.id}
                className={`flex items-center justify-between p-3 rounded ${
                  index === 0 && player.status === 'escaped'
                    ? 'bg-yellow-900/30 border border-yellow-600/40'
                    : 'bg-slate-800/50'
                }`}
              >
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
                    <div className="text-[10px] text-gravity-muted">
                      {player.status === 'escaped' && '🚀 Escaped'}
                      {player.status === 'wrecked' && '💥 Wrecked'}
                      {player.status === 'active' && '⏳ In Progress'}
                      {' · '}
                      {player.crewSurvived} crew
                      {player.captainSurvived && ' + Captain'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-sky-400">{player.score}</div>
                  <div className="text-[10px] text-gravity-muted">points</div>
                </div>
              </div>
            ))}
          </div>
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
