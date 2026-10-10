import { memo, useEffect, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
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
import { AccessibleDialog } from './AccessibleDialog';

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

/** Shared missions inspect committed crew; only unbound fixtures expose the setup editor. */
export const RosterOverlay = memo(function RosterOverlay() {
  const { game, rosterOpen, currentPlayerId, toggleRoster, setGame, networkSessionId } = useGameStore((state) => ({
    game: state.game,
    rosterOpen: state.ui.rosterOpen,
    currentPlayerId: state.currentPlayerId,
    toggleRoster: state.toggleRoster,
    setGame: state.setGame,
    networkSessionId: state.networkSessionId,
  }), shallow);
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
    if (!rosterOpen || !player) {
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
  }, [rosterOpen, player]);

  if (!rosterOpen || !game) {
    return null;
  }

  if (networkSessionId !== null && player) {
    const captainCard = captainCardByType.get(player.captain.captainType);
    const committedCrew = [player.captain, ...player.crew];
    return (
      <AccessibleDialog
        open={rosterOpen}
        onClose={toggleRoster}
        eyebrow="Roster"
        title="Your mission crew"
        description="Inspect your crew and abilities from the last completed turn."
      >
        <p className="mb-4 rounded-md border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-sm leading-6 text-blue-100">
          This is your confirmed mission roster. Crew abilities, condition, and location are shared with the other players.
        </p>
        <div className="space-y-3">
          {committedCrew.map((member) => {
            const card = 'captainType' in member
              ? captainCard
              : member.type === 'officer' ? officerCardByRole.get(member.role) : undefined;
            const rulesText = (card?.effects as { rulesText?: unknown } | undefined)?.rulesText;
            const role = 'captainType' in member ? 'Captain' : member.role.replace(/_/g, ' ');
            return (
              <section key={member.id} className="rounded-lg border border-gravity-border bg-slate-950/35 p-3">
                <h3 className="text-sm font-semibold text-slate-100">{member.name}</h3>
                <p className="mt-1 text-xs capitalize text-blue-200">{role} · {member.status} · {member.location?.replace(/_/g, ' ') ?? 'No section assigned'}</p>
                {card && <p className="mt-2 text-sm leading-6 text-gravity-muted">{card.description}</p>}
                {typeof rulesText === 'string' && rulesText.trim().length > 0 && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-200">{rulesText}</p>
                )}
              </section>
            );
          })}
        </div>
      </AccessibleDialog>
    );
  }

  const handleClose = () => {
    toggleRoster();
  };

  const handleApply = () => {
    // The explicit binding is independent of connection/submission callback availability.
    if (networkSessionId !== null) return;
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
    <AccessibleDialog
      open={rosterOpen}
      onClose={handleClose}
      eyebrow="Roster"
      title="Build your command crew"
      description="Select your Captain and two advanced crew members."
    >
        {error && (
          <div role="alert" className="mb-3 rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="roster-captain" className="block text-xs text-gravity-muted mb-1">Captain</label>
            <select
              id="roster-captain"
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
              {officers.map((officer, officerIndex) => (
                <div
                  key={officer.id}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-3 items-start"
                >
                  <div className="flex flex-col gap-1">
                    <input
                      aria-label={`Advanced crew ${officerIndex + 1} name`}
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
                    aria-label={`Advanced crew ${officerIndex + 1} role`}
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
    </AccessibleDialog>
  );
});
