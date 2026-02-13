import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { SHIP_SECTIONS, type AnyCrew, type AnySpaceObject, type Captain, type GameState, type PlayerState, type Ship, type ShipSection } from '@gravity/core';

type ScenarioPlayer = {
  id: string;
  ship?: Partial<Ship> & {
    sections?: Ship['sections'];
  };
  crew?: AnyCrew[];
  captain?: Captain;
};

type Scenario = {
  board?: {
    objects?: AnySpaceObject[];
  };
  players?: ScenarioPlayer[];
};

const DEV_SCENARIO_STORAGE_KEY = 'gravity.dev.scenario.v1';

function serializeScenarioFromGame(game: GameState): Scenario {
  const players: ScenarioPlayer[] = Array.from(game.players.values()).map((player) => ({
    id: player.id,
    ship: player.ship,
    crew: player.crew as AnyCrew[],
    captain: player.captain as Captain,
  }));

  return {
    board: {
      objects: game.board.objects,
    },
    players,
  };
}

function requireScenarioString(value: unknown, label: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Cannot apply scenario because ${label} is missing or invalid. ` +
        `Root cause: ${context}.${label} is "${String(value)}". ` +
        'Fix: Provide a non-empty string value.'
    );
  }
  return value;
}

function requireScenarioNumber(value: unknown, label: string, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Cannot apply scenario because ${label} is missing or invalid. ` +
        `Root cause: ${context}.${label} is "${String(value)}". ` +
        'Fix: Provide a finite numeric value.'
    );
  }
  return value;
}

function requireScenarioCrewStatus(value: unknown, context: string): 'active' | 'unconscious' | 'dead' {
  if (value !== 'active' && value !== 'unconscious' && value !== 'dead') {
    throw new Error(
      'Cannot apply scenario because crew.status is missing or invalid. ' +
        `Root cause: ${context}.status is "${String(value)}". ` +
        'Fix: Use one of: active, unconscious, dead.'
    );
  }
  return value;
}

function requireScenarioLocation(value: unknown, context: string): ShipSection | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(
      'Cannot apply scenario because crew.location is missing or invalid. ' +
        `Root cause: ${context}.location is "${String(value)}". ` +
        'Fix: Use null or a valid ShipSection string.'
    );
  }

  const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
  if (!validSections.has(value as ShipSection)) {
    throw new Error(
      'Cannot apply scenario because crew.location is not a valid ShipSection. ' +
        `Root cause: ${context}.location is "${value}". ` +
        'Fix: Use one of the SHIP_SECTIONS values.'
    );
  }

  return value as ShipSection;
}

function validateScenarioCrewList(raw: unknown, context: string): AnyCrew[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      'Cannot apply scenario because crew is missing or invalid. ' +
        `Root cause: ${context}.crew is not an array. ` +
        'Fix: Provide an array of crew objects (basic/officer only; captain is separate).'
    );
  }

  const nextCrew: AnyCrew[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as unknown;
    const entryContext = `${context}.crew[${i}]`;

    if (typeof entry !== 'object' || entry === null) {
      throw new Error(
        'Cannot apply scenario because crew entry is not an object. ' +
          `Root cause: ${entryContext} is "${String(entry)}". ` +
          'Fix: Provide a crew object with required fields (id, name, type, role, status, location, reviveProgress, assembleProgress, assembleItemType).'
      );
    }

    const crew = entry as Record<string, unknown>;
    requireScenarioString(crew.id, 'id', entryContext);
    requireScenarioString(crew.name, 'name', entryContext);
    const type = requireScenarioString(crew.type, 'type', entryContext);

    if (type !== 'basic' && type !== 'officer') {
      throw new Error(
        'Cannot apply scenario because crew.type is invalid for player crew list. ' +
          `Root cause: ${entryContext}.type is "${type}". ` +
          'Fix: Use type "basic" or "officer" for player.crew entries; captain must be provided separately in scenario.players[].captain.'
      );
    }

    requireScenarioString(crew.role, 'role', entryContext);
    requireScenarioCrewStatus(crew.status, entryContext);
    requireScenarioLocation(crew.location, entryContext);

    const reviveProgress = requireScenarioNumber(crew.reviveProgress, 'reviveProgress', entryContext);
    if (reviveProgress < 0) {
      throw new Error(
        'Cannot apply scenario because crew.reviveProgress is out of range. ' +
          `Root cause: ${entryContext}.reviveProgress is ${reviveProgress}. ` +
          'Fix: Use a non-negative number.'
      );
    }

    const assembleProgress = requireScenarioNumber(crew.assembleProgress, 'assembleProgress', entryContext);
    if (assembleProgress < 0) {
      throw new Error(
        'Cannot apply scenario because crew.assembleProgress is out of range. ' +
          `Root cause: ${entryContext}.assembleProgress is ${assembleProgress}. ` +
          'Fix: Use a non-negative number.'
      );
    }

    const assembleItemType = (crew.assembleItemType as unknown);
    if (!(assembleItemType === null || typeof assembleItemType === 'string')) {
      throw new Error(
        'Cannot apply scenario because crew.assembleItemType is missing or invalid. ' +
          `Root cause: ${entryContext}.assembleItemType is "${String(assembleItemType)}". ` +
          'Fix: Use null or a string item type.'
      );
    }

    if (type === 'officer') {
      const stimPacksUsed = requireScenarioNumber(crew.stimPacksUsed, 'stimPacksUsed', entryContext);
      if (stimPacksUsed < 0) {
        throw new Error(
          'Cannot apply scenario because officer.stimPacksUsed is out of range. ' +
            `Root cause: ${entryContext}.stimPacksUsed is ${stimPacksUsed}. ` +
            'Fix: Use a non-negative number.'
        );
      }
    }

    nextCrew.push(entry as AnyCrew);
  }

  return nextCrew;
}

function validateScenarioCaptain(raw: unknown, context: string): Captain {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      'Cannot apply scenario because captain is missing or invalid. ' +
        `Root cause: ${context}.captain is "${String(raw)}". ` +
        'Fix: Provide a captain object with required fields.'
    );
  }

  const captain = raw as Record<string, unknown>;
  requireScenarioString(captain.id, 'id', `${context}.captain`);
  requireScenarioString(captain.name, 'name', `${context}.captain`);
  const type = requireScenarioString(captain.type, 'type', `${context}.captain`);
  if (type !== 'captain') {
    throw new Error(
      'Cannot apply scenario because captain.type is invalid. ' +
        `Root cause: ${context}.captain.type is "${type}". ` +
        'Fix: Set captain.type to "captain".'
    );
  }

  requireScenarioString(captain.captainType, 'captainType', `${context}.captain`);
  requireScenarioCrewStatus(captain.status, `${context}.captain`);
  requireScenarioLocation(captain.location, `${context}.captain`);

  const reviveProgress = requireScenarioNumber(captain.reviveProgress, 'reviveProgress', `${context}.captain`);
  if (reviveProgress < 0) {
    throw new Error(
      'Cannot apply scenario because captain.reviveProgress is out of range. ' +
        `Root cause: ${context}.captain.reviveProgress is ${reviveProgress}. ` +
        'Fix: Use a non-negative number.'
    );
  }

  const assembleProgress = requireScenarioNumber(captain.assembleProgress, 'assembleProgress', `${context}.captain`);
  if (assembleProgress < 0) {
    throw new Error(
      'Cannot apply scenario because captain.assembleProgress is out of range. ' +
        `Root cause: ${context}.captain.assembleProgress is ${assembleProgress}. ` +
        'Fix: Use a non-negative number.'
    );
  }

  const assembleItemType = (captain.assembleItemType as unknown);
  if (!(assembleItemType === null || typeof assembleItemType === 'string')) {
    throw new Error(
      'Cannot apply scenario because captain.assembleItemType is missing or invalid. ' +
        `Root cause: ${context}.captain.assembleItemType is "${String(assembleItemType)}". ` +
        'Fix: Use null or a string item type.'
    );
  }

  return raw as Captain;
}

function applyScenarioToGame(game: GameState, scenario: Scenario): GameState {
  const nextBoard = scenario.board?.objects
    ? {
        ...game.board,
        objects: scenario.board.objects,
      }
    : game.board;

  const updatedPlayers = new Map<string, PlayerState>(game.players);

  for (const patch of scenario.players ?? []) {
    const player = game.players.get(patch.id);

    if (!player) {
      throw new Error(
        'Cannot apply scenario because player was not found in game. ' +
          `Root cause: scenario references player id "${patch.id}", but game.players has no such id. ` +
          'Fix: Use an existing player id from the current game state.',
      );
    }

    const shipPatch = patch.ship;
    const nextShip = shipPatch
      ? {
          ...player.ship,
          ...shipPatch,
          sections: shipPatch.sections ? shipPatch.sections : player.ship.sections,
        }
      : player.ship;

    const nextPlayer: PlayerState = {
      ...player,
      ship: nextShip,
      crew: patch.crew ? validateScenarioCrewList(patch.crew as unknown, `scenario.players[${patch.id}]`) : player.crew,
      captain: patch.captain ? validateScenarioCaptain(patch.captain as unknown, `scenario.players[${patch.id}]`) : player.captain,
    };

    updatedPlayers.set(player.id, nextPlayer);
  }

  return {
    ...game,
    board: nextBoard,
    players: updatedPlayers,
  };
}

export function SettingsOverlay() {
  const { game, ui, toggleSettings, setGame } = useGameStore();
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const canShow = useMemo(() => {
    return Boolean(import.meta.env.DEV);
  }, []);

  useEffect(() => {
    if (!ui.settingsOpen || !game || !canShow) {
      return;
    }

    const fromStorage = window.localStorage.getItem(DEV_SCENARIO_STORAGE_KEY);
    if (fromStorage) {
      setText(fromStorage);
      setError(null);
      return;
    }

    const scenario = serializeScenarioFromGame(game);
    setText(JSON.stringify(scenario, null, 2));
    setError(null);
  }, [ui.settingsOpen, game, canShow]);

  if (!ui.settingsOpen || !game || !canShow) {
    return null;
  }

  const handleClose = () => {
    toggleSettings();
  };

  const handleSave = () => {
    window.localStorage.setItem(DEV_SCENARIO_STORAGE_KEY, text);
    setError(null);
  };

  const handleLoad = () => {
    const fromStorage = window.localStorage.getItem(DEV_SCENARIO_STORAGE_KEY);
    if (!fromStorage) {
      setError('No saved scenario found in localStorage.');
      return;
    }

    setText(fromStorage);
    setError(null);
  };

  const handleResetFromGame = () => {
    const scenario = serializeScenarioFromGame(game);
    setText(JSON.stringify(scenario, null, 2));
    setError(null);
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text) as Scenario;
      const nextGame = applyScenarioToGame(game, parsed);
      setGame(nextGame);
      setError(null);
      toggleSettings();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
    } catch {
      setError('Failed to copy scenario JSON to clipboard.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="max-w-3xl w-full bg-gravity-surface/95 border border-gravity-border shadow-2xl rounded-lg px-6 py-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <div className="text-[11px] tracking-[0.25em] uppercase text-gravity-muted">Settings</div>
            <div className="text-sm text-gravity-muted">Dev-only scenario editor (JSON import/export)</div>
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

        <textarea
          className="w-full h-[420px] rounded border border-gravity-border bg-slate-950/40 px-3 py-2 font-mono text-[12px] text-slate-100 outline-none focus:ring-2 focus:ring-gravity-accent"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />

        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleResetFromGame}>
            Reset From Game
          </button>
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleLoad}>
            Load Saved
          </button>
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="btn px-3 py-1 text-sm" onClick={handleCopy}>
            Copy
          </button>
          <button type="button" className="btn-primary px-4 py-1 text-sm" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
