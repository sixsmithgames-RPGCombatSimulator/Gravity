import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  buildCaptainPoolForSettings,
  buildSpecialCrewPoolForSettings,
  SHIP_SECTIONS,
  type CaptainType,
  type CrewStatus,
  type OfficerType,
  type PlayerState,
} from '@gravity/core';

const ADVANCED_CREW_NAMES = [
  'Avery Chen',
  'Morgan Reyes',
  'Quinn Singh',
  'Sloane Patel',
  'Rowan Calder',
  'Dakota Hale',
  'Jules Navarro',
  'Alex Vega',
  'Kendall Ibarra',
  'Parker Idris',
  'Riley Sorenson',
  'Harper Zhou',
  'Skyler Vance',
  'Casey Armand',
  'Emerson Shah',
  'Jordan Kato',
  'Taylor Inoue',
  'Reese Okoro',
  'Phoenix Marek',
  'Cameron Lyra',
] as const;

function getRandomAdvancedCrewName(existing: Set<string>) {
  const available = ADVANCED_CREW_NAMES.filter((name) => !existing.has(name));
  const pool = available.length > 0 ? available : ADVANCED_CREW_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function RosterOverlay() {
  const { game, ui, currentPlayerId, toggleRoster, setGame } = useGameStore();
  const [selectedCaptainType, setSelectedCaptainType] = useState<CaptainType | ''>('');
  const [selectedOfficerRoles, setSelectedOfficerRoles] = useState<Record<string, OfficerType>>({});
  const [officerNames, setOfficerNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const player = useMemo(() => {
    if (!game || !currentPlayerId) {
      return null;
    }
    return game.players.get(currentPlayerId) ?? null;
  }, [game, currentPlayerId]);

  const captainCards = useMemo(() => {
    if (!game) {
      return [];
    }
    return buildCaptainPoolForSettings(game.settings);
  }, [game]);

  const officerCards = useMemo(() => {
    if (!game) {
      return [];
    }
    return buildSpecialCrewPoolForSettings(game.settings);
  }, [game]);

  const captainCardByType = useMemo(() => {
    const map = new Map<CaptainType, (typeof captainCards)[number]>();
    for (const card of captainCards) {
      map.set(card.captainType, card);
    }
    return map;
  }, [captainCards]);

  const officerCardByRole = useMemo(() => {
    const map = new Map<OfficerType, (typeof officerCards)[number]>();
    for (const card of officerCards) {
      map.set(card.role, card);
    }
    return map;
  }, [officerCards]);

  const selectedCaptainCard = useMemo(() => {
    if (!selectedCaptainType) {
      return null;
    }
    return captainCardByType.get(selectedCaptainType) ?? null;
  }, [captainCardByType, selectedCaptainType]);

  const selectedCaptainRulesText = useMemo(() => {
    if (!selectedCaptainCard) {
      return null;
    }

    const raw = (selectedCaptainCard.effects as { rulesText?: unknown } | undefined)?.rulesText;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
  }, [selectedCaptainCard]);

  const officerRoleOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { value: OfficerType; label: string }[] = [];

    for (const card of officerCards) {
      if (seen.has(card.role)) {
        continue;
      }
      seen.add(card.role);
      options.push({ value: card.role, label: card.name });
    }

    return options;
  }, [officerCards]);

  useEffect(() => {
    if (!ui.rosterOpen || !player) {
      return;
    }

    setSelectedCaptainType(player.captain.captainType);

    const nextOfficerRoles: Record<string, OfficerType> = {};
    const nextOfficerNames: Record<string, string> = {};
    for (const crew of player.crew) {
      if (crew.type === 'officer') {
        nextOfficerRoles[crew.id] = crew.role;
        nextOfficerNames[crew.id] = crew.name.replace(/^first officer\s+/i, '').trim() || crew.name;
      }
    }

    setSelectedOfficerRoles(nextOfficerRoles);
    setOfficerNames(nextOfficerNames);
    setError(null);
  }, [ui.rosterOpen, player]);

  if (!ui.rosterOpen || !game) {
    return null;
  }

  const handleClose = () => {
    toggleRoster();
  };

  const handleApply = () => {
    if (!currentPlayerId) {
      setError('Cannot apply roster changes because no current player is selected.');
      return;
    }

    const currentPlayer = game.players.get(currentPlayerId);
    if (!currentPlayer) {
      setError('Cannot apply roster changes because current player state is missing from game.');
      return;
    }

    const captainTypePool = new Set(captainCards.map((card) => card.captainType));
    if (!selectedCaptainType || !captainTypePool.has(selectedCaptainType)) {
      setError('Cannot apply roster changes because selected captain type is invalid for current game settings.');
      return;
    }

    const officers = currentPlayer.crew.filter((crew) => crew.type === 'officer');
    if (officers.length !== 2) {
      setError(
        'Cannot apply roster changes because this roster must include exactly 2 advanced crew members (officers). Fix: ensure exactly two officers exist on the roster.',
      );
      return;
    }

    const officerRolePool = new Set(officerCards.map((card) => card.role));
    for (const officer of officers) {
      const role = selectedOfficerRoles[officer.id];
      if (!role) {
        setError(
          'Cannot apply roster changes because an officer is missing a selected role. Fix: choose a role for both advanced crew members.',
        );
        return;
      }
      if (!officerRolePool.has(role)) {
        setError(
          'Cannot apply roster changes because a selected officer role is invalid for current game settings.',
        );
        return;
      }
    }

    const nextCrew: PlayerState['crew'] = currentPlayer.crew.map((crew) => {
      if (crew.type === 'officer') {
        const nextRole = selectedOfficerRoles[crew.id] ?? crew.role;
        const nextLocation = crew.location ?? SHIP_SECTIONS.BRIDGE;
        return {
          ...crew,
          role: nextRole,
          status: 'active' as CrewStatus,
          location: nextLocation,
          name: (officerNames[crew.id]?.trim() ?? crew.name).trim() || crew.name,
        };
      }

      if (crew.type === 'basic') {
        return {
          ...crew,
          status: 'unconscious' as CrewStatus,
          location: null,
        };
      }

      return crew;
    });

    const nextPlayer: PlayerState = {
      ...currentPlayer,
      captain: {
        ...currentPlayer.captain,
        captainType: selectedCaptainType,
        status: 'active',
        location: currentPlayer.captain.location ?? SHIP_SECTIONS.BRIDGE,
      },
      crew: nextCrew,
    };

    const nextPlayers = new Map(game.players);
    nextPlayers.set(nextPlayer.id, nextPlayer);

    setGame({
      ...game,
      players: nextPlayers,
    });

    setError(null);
    toggleRoster();
  };

  const officers = player?.crew.filter((c) => c.type === 'officer') ?? [];
  const usedNames = new Set(Object.values(officerNames));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="max-w-xl w-full bg-gravity-surface/95 border border-gravity-border shadow-2xl rounded-lg px-6 py-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <div className="text-[11px] tracking-[0.25em] uppercase text-gravity-muted">Roster</div>
            <div className="text-sm text-gravity-muted">Select your Captain and Advanced Crew</div>
          </div>
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleClose}>
            Close
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <div className="text-xs text-gravity-muted mb-1">Captain</div>
            <select
              className="w-full rounded border border-gravity-border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-gravity-accent"
              value={selectedCaptainType}
              onChange={(event) => {
                setSelectedCaptainType(event.target.value as CaptainType);
                setError(null);
              }}
            >
              {captainCards.map((card) => (
                <option key={card.id} value={card.captainType}>
                  {card.name}
                </option>
              ))}
            </select>

            {selectedCaptainCard && (
              <div className="mt-2 rounded border border-gravity-border bg-slate-950/20 px-3 py-2">
                <div className="text-[11px] font-semibold text-slate-100">{selectedCaptainCard.name}</div>
                <div className="mt-1 text-[11px] text-gravity-muted">{selectedCaptainCard.description}</div>
                {selectedCaptainRulesText && (
                  <div className="mt-2 text-[11px] text-slate-200 whitespace-pre-line">{selectedCaptainRulesText}</div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs text-gravity-muted mb-2">Advanced Crew</div>
            <div className="flex flex-col gap-2">
              {officers.length === 0 && (
                <div className="text-sm text-gravity-muted">No advanced crew found on this roster.</div>
              )}
              {officers.map((officer) => (
                <div
                  key={officer.id}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-3 items-start"
                >
                  <div className="flex flex-col gap-1">
                    <input
                      className="w-full rounded border border-gravity-border bg-slate-950/40 px-3 py-1.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-gravity-accent"
                      value={officerNames[officer.id] ?? officer.name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setOfficerNames((prev) => ({
                          ...prev,
                          [officer.id]: value,
                        }));
                      }}
                      placeholder="Enter crew name"
                    />
                    <button
                      type="button"
                      className="text-[11px] text-gravity-muted underline-offset-2 hover:underline self-start"
                      onClick={() => {
                        const newName = getRandomAdvancedCrewName(usedNames);
                        usedNames.add(newName);
                        setOfficerNames((prev) => ({
                          ...prev,
                          [officer.id]: newName,
                        }));
                      }}
                    >
                      Randomize name
                    </button>
                  </div>
                  <select
                    className="w-full rounded border border-gravity-border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-gravity-accent"
                    value={selectedOfficerRoles[officer.id] ?? officer.role}
                    onChange={(event) => {
                      setSelectedOfficerRoles((prev) => ({
                        ...prev,
                        [officer.id]: event.target.value as OfficerType,
                      }));
                      setError(null);
                    }}
                  >
                    {officerRoleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {(() => {
                    const role = (selectedOfficerRoles[officer.id] ?? officer.role) as OfficerType;
                    const card = officerCardByRole.get(role) ?? null;
                    if (!card) {
                      return null;
                    }
                    const rulesText = (card.effects as { rulesText?: unknown } | undefined)?.rulesText;
                    const hasRulesText = typeof rulesText === 'string' && rulesText.trim().length > 0;
                    return (
                      <div className="sm:col-span-2 rounded border border-gravity-border bg-slate-950/20 px-3 py-2">
                        <div className="text-[11px] font-semibold text-slate-100">{card.name}</div>
                        <div className="mt-1 text-[11px] text-gravity-muted">{card.description}</div>
                        {hasRulesText && (
                          <div className="mt-2 text-[11px] text-slate-200 whitespace-pre-line">
                            {rulesText as string}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary px-4 py-1 text-sm" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
