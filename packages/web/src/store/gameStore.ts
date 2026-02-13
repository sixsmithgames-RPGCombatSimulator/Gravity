import { create } from 'zustand';
import {
  processTurn,
  generateAllBotActions as generateAllBotActionsFromEngine,
  CrewUtils,
  SHIP_SECTIONS,
  LIFE_SUPPORT_CONFIG,
  assignExplorerRepairKit as assignExplorerRepairKitFromEngine,
  chooseSpacePirateStartingUpgrade as chooseSpacePirateStartingUpgradeFromEngine,
} from '@gravity/core';
import type {
  AnyCrew,
  Board,
  GameState,
  PlayerAction,
  PlayerState,
  ResourceType,
  ShipSection,
  TurnPhase,
  TurnActions,
  UpgradeCard,
  Captain,
} from '@gravity/core';
import { createMockGame, type Difficulty } from '../utils/mockGame';
import { getUpgradePowerStatus } from '../utils/upgradePower';

/**
 * Compute the total life support capacity for a player.
 * Purpose: Mirror the engine's life support accounting (pool + captain + powered upgrades) on the client
 * so that UI guardrails stay in sync with authoritative turn processing.
 * Parameters:
 *   - player: Player whose ship + upgrades determine life support.
 * Returns: Total life support points available this turn.
 * Side effects: None (pure function). Throws when ship state is invalid so calling code can surface actionable errors.
 */
export function computeLifeSupportCapacity(player: PlayerState): number {
  if (!player) {
    throw new Error(
      'Cannot compute life support capacity because player state is missing. ' +
        'Root cause: computeLifeSupportCapacity received null/undefined player. ' +
        'Fix: Ensure a valid PlayerState is provided before evaluating life support.',
    );
  }

  const ship = player.ship;
  if (!ship) {
    throw new Error(
      'Cannot compute life support capacity because player.ship is missing. ' +
        `Root cause: player "${player.id}" has no ship on state. ` +
        'Fix: Ensure PlayerState includes an initialized ship before planning actions.',
    );
  }

  const baseLifeSupportPowerRaw = ship.lifeSupportPower;
  const baseLifeSupportPower = (() => {
    if (typeof baseLifeSupportPowerRaw === 'undefined') {
      return 0;
    }
    if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
      throw new Error(
        'Cannot compute life support capacity because ship.lifeSupportPower is invalid. ' +
          `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}" for player "${player.id}". ` +
          'Fix: Ensure ship.lifeSupportPower is always a finite number.',
      );
    }
    if (baseLifeSupportPowerRaw < 0) {
      throw new Error(
        'Cannot compute life support capacity because ship.lifeSupportPower is negative. ' +
          `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw} for player "${player.id}". ` +
          'Fix: Avoid setting life support below zero (routing/restore logic must clamp at 0).',
      );
    }
    return baseLifeSupportPowerRaw;
  })();

  let totalLifeSupportPower = baseLifeSupportPower;

  if (player.captain?.captainType === 'explorer') {
    totalLifeSupportPower += 5;
  }

  const addUpgradeBonus = (upgradeId: string, bonus: number) => {
    const upgrade = player.installedUpgrades?.find((entry) => entry.id === upgradeId);
    if (!upgrade) {
      return;
    }
    const status = getUpgradePowerStatus(upgrade, ship);
    if (status.isPowered) {
      totalLifeSupportPower += bonus;
    }
  };

  addUpgradeBonus('bio_filters', 3);
  addUpgradeBonus('bio_engine', 1);

  const powerPerCrew = LIFE_SUPPORT_CONFIG.POWER_PER_CREW;
  if (typeof powerPerCrew !== 'number' || !Number.isFinite(powerPerCrew) || powerPerCrew <= 0) {
    throw new Error(
      'Cannot compute life support capacity because LIFE_SUPPORT_CONFIG.POWER_PER_CREW is invalid. ' +
        `Root cause: LIFE_SUPPORT_CONFIG.POWER_PER_CREW is "${String(powerPerCrew)}". ` +
        'Fix: Configure a positive finite power-per-crew ratio.',
    );
  }

  return Math.floor(totalLifeSupportPower / powerPerCrew);
}

/**
 * Count all crew who will consume life support after planned revives resolve.
 * Purpose: Provide the UI/store with the same projected load the engine will evaluate so we can block
 * impossible revive queues before they leave the planning phase.
 * Parameters:
 *   - player: Player whose crew list + captain state we inspect.
 *   - plannedActions: Planned actions for the player (used to find all revive targets).
 * Returns: Number of crew (including captain) that will require life support if the revives succeed.
 * Side effects: None; throws if revive targets reference missing crew to keep errors actionable.
 */
export function countLifeSupportConsumersWithRevives(
  player: PlayerState,
  plannedActions: PlayerAction[],
): number {
  if (!player) {
    throw new Error(
      'Cannot count life support consumers because player state is missing. ' +
        'Root cause: countLifeSupportConsumersWithRevives received null/undefined player. ' +
        'Fix: Provide a valid PlayerState before evaluating planned actions.',
    );
  }

  const baseCrew = player.crew ?? [];
  const currentlySupportedCrew = baseCrew.filter((crew) => CrewUtils.requiresLifeSupport(crew));
  const captainRequiresLifeSupport = player.captain?.status === 'active' ? 1 : 0;
  let total = currentlySupportedCrew.length + captainRequiresLifeSupport;

  const reviveTargetIds = new Set<string>();

  for (const action of plannedActions) {
    if (action.type !== 'revive') {
      continue;
    }

    const parameters = action.parameters as { targetCrewId?: unknown } | undefined;
    const targetCrewId = parameters?.targetCrewId;
    if (typeof targetCrewId !== 'string' || targetCrewId.length <= 0) {
      continue; // No target selected yet; guardrail will re-run once UI captures the target.
    }
    if (reviveTargetIds.has(targetCrewId)) {
      continue;
    }

    const isCaptainTarget = player.captain?.id === targetCrewId;
    const targetCrew = isCaptainTarget
      ? player.captain
      : baseCrew.find((crewMember) => crewMember.id === targetCrewId);

    if (!targetCrew) {
      throw new Error(
        'Cannot count life support consumers because a revive target was not found. ' +
          `Root cause: planned revive references crew id "${targetCrewId}" that does not belong to player "${player.id}". ` +
          'Fix: Remove the invalid revive action or select a valid crew member through the revive dialog.',
      );
    }

    const isAlreadyConsuming = isCaptainTarget
      ? targetCrew.status === 'active'
      : CrewUtils.requiresLifeSupport(targetCrew);
    if (isAlreadyConsuming) {
      continue;
    }

    if (!crewWillRequireLifeSupportAfterRevive(targetCrew)) {
      continue;
    }

    reviveTargetIds.add(targetCrewId);
    total += 1;
  }

  return total;
}

/**
 * Determine whether a given crew/captain will need life support once revived.
 * Purpose: Treat Android officers as life support independent while counting every other role.
 * Parameters:
 *   - crew: Crew member or captain being revived.
 * Returns: True if they increase life support load after revival.
 * Side effects: None.
 */
function crewWillRequireLifeSupportAfterRevive(crew: AnyCrew | Captain): boolean {
  if ('role' in crew && crew.role === 'android') {
    return false;
  }
  return true;
}

/**
 * UI-specific state that doesn't belong in game state
 */
interface UIState {
  /** Currently selected crew member for action assignment */
  selectedCrewId: string | null;
  /** Currently selected target (object or section) */
  selectedTargetId: string | null;
  /** Actions being planned for current turn */
  plannedActions: PlayerAction[];
  selectedActionSlot: 'primary' | 'bonus';
  /** Whether the player has confirmed they are finished with execution-phase UI adjustments */
  executionConfirmed: boolean;
  /** Last user-visible error message from turn execution / validation */
  lastError: string | null;
  /** Zoom level for board view (1 = 100%) */
  boardZoom: number;
  /** Board pan offset */
  boardOffset: { x: number; y: number };
  /** Whether action resolution animation is playing */
  isAnimating: boolean;
  /** Current animation step index */
  animationStep: number;
  /** Settings panel open */
  settingsOpen: boolean;
  /** Crew roster editor overlay open */
  rosterOpen: boolean;
  /** Help overlay visible */
  helpOpen: boolean;
  /** Event card overlay visible */
  eventOverlayVisible: boolean;
  /**
   * Ring rotation animation state
   * Purpose: Track animation progress for environment phase ring rotation
   * - 'none': No animation in progress
   * - 'environment': Animating ring rotation during environment phase
   */
  ringAnimationPhase: 'none' | 'environment';
  /** Board state before environment phase (used as animation start point) */
  ringAnimationFromBoard: Board | null;
  /** Animation progress from 0 to 1 */
  ringAnimationProgress: number;

  /** Most recent player-visible delta between last processed game state and the current one */
  lastPlayerDiff: PlayerDiff | null;
}

export type SectionDiff = {
  hullDelta: number;
  powerDelta: number;
  conduitsDelta: number;
  corridorsDelta: number;
};

export type PlayerDiff = {
  fromTurn: number;
  fromPhase: TurnPhase;
  toTurn: number;
  toPhase: TurnPhase;
  shieldsDelta: number;
  speedDelta: number;
  sectionDiffs: Record<ShipSection, SectionDiff>;
  resourceDiffs: Partial<Record<ResourceType, number>>;
  pendingUpgradesGained: UpgradeCard[];
  installedUpgradesGained: UpgradeCard[];
};

function computePlayerDiff(params: {
  prevGame: GameState;
  nextGame: GameState;
  playerId: string;
}): PlayerDiff | null {
  const prevPlayer = params.prevGame.players.get(params.playerId);
  const nextPlayer = params.nextGame.players.get(params.playerId);

  if (!prevPlayer || !nextPlayer) {
    return null;
  }

  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
  const sectionDiffs: Record<ShipSection, SectionDiff> = {} as Record<ShipSection, SectionDiff>;

  for (const key of sectionKeys) {
    const prev = prevPlayer.ship.sections[key];
    const next = nextPlayer.ship.sections[key];

    const prevHull = prev?.hull ?? 0;
    const nextHull = next?.hull ?? 0;

    const prevPower = (prev?.powerDice ?? []).reduce((sum, die) => sum + die, 0);
    const nextPower = (next?.powerDice ?? []).reduce((sum, die) => sum + die, 0);

    const prevConduits = Object.values(prev?.conduitConnections ?? {}).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    );
    const nextConduits = Object.values(next?.conduitConnections ?? {}).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    );

    const prevCorridors = Object.values(prev?.corridors ?? {}).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    );
    const nextCorridors = Object.values(next?.corridors ?? {}).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    );

    sectionDiffs[key] = {
      hullDelta: nextHull - prevHull,
      powerDelta: nextPower - prevPower,
      conduitsDelta: nextConduits - prevConduits,
      corridorsDelta: nextCorridors - prevCorridors,
    };
  }

  const resourceKeys: ResourceType[] = [
    'fuel_cell',
    'antimatter',
    'power_cell',
    'medical_kit',
    'spare_parts',
    'energy_weapon',
    'particle_weapon',
    'phased_weapon',
    'phased_shielding',
    'torpedo',
    'probe',
  ];

  const resourceDiffs: Partial<Record<ResourceType, number>> = {};
  for (const key of resourceKeys) {
    const prevValue = prevPlayer.resources[key] ?? 0;
    const nextValue = nextPlayer.resources[key] ?? 0;
    const delta = nextValue - prevValue;
    if (delta !== 0) {
      resourceDiffs[key] = delta;
    }
  }

  const prevPendingUpgradeIds = new Set((prevPlayer.pendingUpgrades ?? []).map((u) => u.id));
  const pendingUpgradesGained = (nextPlayer.pendingUpgrades ?? []).filter((u) => !prevPendingUpgradeIds.has(u.id));

  const prevInstalledUpgradeIds = new Set((prevPlayer.installedUpgrades ?? []).map((u) => u.id));
  const installedUpgradesGained = (nextPlayer.installedUpgrades ?? []).filter((u) => !prevInstalledUpgradeIds.has(u.id));

  return {
    fromTurn: params.prevGame.currentTurn,
    fromPhase: params.prevGame.turnPhase,
    toTurn: params.nextGame.currentTurn,
    toPhase: params.nextGame.turnPhase,
    shieldsDelta: nextPlayer.ship.shields - prevPlayer.ship.shields,
    speedDelta: nextPlayer.ship.speed - prevPlayer.ship.speed,
    sectionDiffs,
    resourceDiffs,
    pendingUpgradesGained,
    installedUpgradesGained,
  };
}

/**
 * Complete store state combining game and UI state
 */
interface GravityStore {
  // === Game State ===
  /** Current game state from engine (null if no game loaded) */
  game: GameState | null;
  /** Current player's ID */
  currentPlayerId: string | null;
  /** Selected difficulty for new games */
  difficulty: Difficulty;

  // === UI State ===
  ui: UIState;

  // === Actions: Game ===
  /** Load a game state */
  setGame: (game: GameState | null) => void;
  /** Set current player */
  setCurrentPlayer: (playerId: string | null) => void;
  /** Set desired difficulty */
  setDifficulty: (difficulty: Difficulty) => void;
  /** Update game state after turn processing */
  updateGameState: (game: GameState) => void;
  /** Start a brand new game using engine-driven mock setup */
  newGame: () => void;
  /** Move an active crew member between ship sections (worker placement) */
  moveCrew: (crewId: string, toSection: ShipSection) => boolean;

  // === Actions: Turn Planning ===
  /** Add action to planned actions */
  addPlannedAction: (action: PlayerAction) => void;
  /** Remove action from planned actions */
  removePlannedAction: (crewId: string, slot?: 'primary' | 'bonus') => void;
  /** Clear all planned actions */
  clearPlannedActions: () => void;
  /** Update parameters for a specific crew's planned action */
  updatePlannedActionParameters: (
    crewId: string,
    parameters: Record<string, unknown>,
    slot?: 'primary' | 'bonus',
  ) => void;
  /** Update target for a specific crew's planned action */
  updatePlannedActionTarget: (
    crewId: string,
    target: PlayerAction['target'],
    slot?: 'primary' | 'bonus',
  ) => void;
  /** Get planned actions as TurnActions format */
  getPlannedTurnActions: () => TurnActions;

  // === Actions: Selection ===
  /** Select a crew member */
  selectCrew: (crewId: string | null) => void;
  /** Select which planned action slot is active for the currently-selected crew */
  selectActionSlot: (slot: 'primary' | 'bonus') => void;
  /** Select a target */
  selectTarget: (targetId: string | null) => void;
  /** Clear all selections */
  clearSelection: () => void;

  // === Actions: Execution Confirmation ===
  /** Set whether execution phase is confirmed complete by the player */
  setExecutionConfirmed: (confirmed: boolean) => void;

  // === Actions: UI Errors ===
  /** Set/clear the last user-visible error message */
  setLastError: (message: string | null) => void;

  // === Actions: Board View ===
  /** Set board zoom level */
  setBoardZoom: (zoom: number) => void;
  /** Set board pan offset */
  setBoardOffset: (offset: { x: number; y: number }) => void;
  /** Reset board view to default */
  resetBoardView: () => void;

  // === Actions: Animation ===
  /** Start animation playback */
  startAnimation: () => void;
  /** Stop animation playback */
  stopAnimation: () => void;
  /** Advance to next animation step */
  nextAnimationStep: () => void;
  /**
   * Start ring rotation animation for environment phase
   * Purpose: Begin animated transition showing rings rotating with objects
   * Parameters:
   *   - fromBoard: Board state before environment phase processing
   */
  startRingAnimation: (fromBoard: Board) => void;
  /**
   * Update ring animation progress
   * Purpose: Advance animation interpolation during environment phase
   * Parameters:
   *   - progress: Value from 0 to 1 representing animation completion
   */
  setRingAnimationProgress: (progress: number) => void;
  /**
   * Stop ring rotation animation
   * Purpose: End animation and clear animation state
   */
  stopRingAnimation: () => void;

  // === Actions: UI Panels ===
  /** Toggle settings panel */
  toggleSettings: () => void;
  /** Toggle crew roster overlay */
  toggleRoster: () => void;
  /** Toggle help overlay */
  toggleHelp: () => void;
  /** Set event overlay visibility */
  setEventOverlayVisible: (visible: boolean) => void;

  // === Derived State Helpers ===
  /** Get current player state */
  getCurrentPlayer: () => PlayerState | null;
  /** Check if it's current player's turn */
  isMyTurn: () => boolean;

  // === High-level game flow helpers ===
  /** Execute a full turn using current planned actions (plus bot actions) */
  playTurn: () => void;

  /** Assign Explorer captain special repair kit to a damaged section */
  assignExplorerRepairKit: (section: ShipSection) => void;

  /** Space Pirate: choose the extra starting upgrade */
  chooseSpacePirateStartingUpgrade: (upgradeId: string) => void;
}

/**
 * Initial UI state
 */
const initialUIState: UIState = {
  selectedCrewId: null,
  selectedTargetId: null,
  plannedActions: [],
  selectedActionSlot: 'primary',
  executionConfirmed: false,
  lastError: null,
  boardZoom: 1,
  boardOffset: { x: 0, y: 0 },
  isAnimating: false,
  animationStep: 0,
  settingsOpen: false,
  rosterOpen: false,
  helpOpen: false,
  eventOverlayVisible: false,
  ringAnimationPhase: 'none',
  ringAnimationFromBoard: null,
  ringAnimationProgress: 0,
  lastPlayerDiff: null,
};

/**
 * Gravity game store
 * Purpose: Central state management for game and UI state
 *
 * Design decisions:
 * - Game state is immutable, updated only via setGame/updateGameState
 * - UI state is mutable for responsiveness
 * - Planned actions stored separately until submitted
 * - Derived state computed via helper methods
 */
export const useGameStore = create<GravityStore>((set, get) => ({
  // === Initial State ===
  game: null,
  currentPlayerId: null,
  difficulty: 'hard',
  ui: initialUIState,

  // === Game Actions ===
  setGame: (game) => set((state) => ({
    game,
    ui: {
      ...state.ui,
      lastPlayerDiff: null,
    },
  })),

  setCurrentPlayer: (playerId) => set({ currentPlayerId: playerId }),

  setDifficulty: (difficulty) => set({ difficulty }),

  updateGameState: (game) => set((state) => ({
    game,
    ui: {
      ...state.ui,
      lastPlayerDiff: null,
    },
  })),

  newGame: () => {
    const { difficulty } = get();
    const game = createMockGame(difficulty);
    const firstPlayerId = Array.from(game.players.keys())[0] ?? null;

    set({
      game,
      currentPlayerId: firstPlayerId,
      ui: initialUIState,
    });
  },

  moveCrew: (crewId, toSection) => {
    const { game, currentPlayerId } = get();

    if (!game || !currentPlayerId) {
      throw new Error(
        'Cannot move crew because no game or current player is selected. ' +
        'Root cause: game or currentPlayerId is null in Gravity store. ' +
        'Fix: Ensure a game is loaded and currentPlayerId is set before calling moveCrew.'
      );
    }

    const player = game.players.get(currentPlayerId);

    if (!player) {
      throw new Error(
        'Cannot move crew because current player state is missing from game. ' +
        `Root cause: no PlayerState found for id "${currentPlayerId}" in game.players. ` +
        'Fix: Ensure currentPlayerId matches an existing player in game.players.'
      );
    }

    const isCaptain = player.captain.id === crewId;
    const crew: AnyCrew | undefined = isCaptain
      ? (player.captain as AnyCrew)
      : (player.crew.find((c) => c.id === crewId) as AnyCrew | undefined);

    if (!crew) {
      throw new Error(
        'Cannot move crew because crew member was not found. ' +
        `Root cause: crewId "${crewId}" does not match any crew or captain for player "${player.id}". ` +
        'Fix: Call moveCrew with a valid crewId from player.crew or player.captain.id.'
      );
    }

    const from = crew.location as ShipSection | null;
    const to = toSection as ShipSection;

    const targetSection = player.ship.sections[to];

    if (!targetSection) {
      throw new Error(
        'Cannot move crew because target section does not exist on ship. ' +
        `Root cause: no ShipSectionState found for section "${to}" in player.ship.sections. ` +
        'Fix: Use a valid ShipSection key from SHIP_SECTIONS when moving crew.'
      );
    }

    const fromSection = from ? player.ship.sections[from] : undefined;
    const corridorState = fromSection
      ? fromSection.corridors[to] ?? 0
      : 1; // Allow initial placement when no from section (should be rare for active crew)

    const targetSectionHull = targetSection.hull;

    const canMove = CrewUtils.canMoveTo(
      crew,
      from,
      to,
      corridorState,
      targetSectionHull,
    );

    if (!canMove) {
      // Movement not allowed under current rules; do not mutate state.
      return false;
    }

    const updatedPlayers = new Map<string, PlayerState>(game.players);

    const updatedPlayer: PlayerState = {
      ...player,
      captain: isCaptain
        ? { ...player.captain, location: to }
        : player.captain,
      crew: isCaptain
        ? player.crew
        : player.crew.map((c) =>
            c.id === crewId
              ? { ...c, location: to }
              : c,
          ),
    };

    updatedPlayers.set(updatedPlayer.id, updatedPlayer);

    set({
      game: {
        ...game,
        players: updatedPlayers,
      },
    });

    return true;
  },

  // === Turn Planning Actions ===
  addPlannedAction: (action) => {
    const { game, currentPlayerId, ui } = get();

    const slotRaw = (action.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
    const slot = slotRaw === 'bonus' ? 'bonus' : 'primary';

    if (action.type === 'revive' && game && currentPlayerId) {
      const player = game.players.get(currentPlayerId);
      if (player) {
        const previewActions = [
          ...ui.plannedActions.filter((planned) => {
            if (planned.crewId !== action.crewId) {
              return true;
            }
            const plannedSlotRaw = (planned.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
            const plannedSlot = plannedSlotRaw === 'bonus' ? 'bonus' : 'primary';
            return plannedSlot !== slot;
          }),
          action,
        ];
        const capacity = computeLifeSupportCapacity(player);
        const projectedLoad = countLifeSupportConsumersWithRevives(player, previewActions);

        if (projectedLoad > capacity) {
          // Guardrail: surface actionable message instead of allowing revive that would immediately fail.
          set((state) => ({
            ui: {
              ...state.ui,
              lastError:
                `Cannot add Revive because life support capacity ${capacity} would be exceeded (${projectedLoad} crew).
Fix: restore more life support (repair/power Med Lab, Engineering, Sci Lab, Defense, or Bio upgrades) or clear another Revive action.`,
            },
          }));

          return;
        }
      }
    }

    set((state) => ({
      ui: {
        ...state.ui,
        plannedActions: [
          ...state.ui.plannedActions.filter((a) => {
            const existingSlotRaw = (a.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
            const existingSlot = existingSlotRaw === 'bonus' ? 'bonus' : 'primary';

            if (slot === 'bonus' && existingSlot === 'bonus') {
              return false;
            }

            if (a.crewId !== action.crewId) {
              return true;
            }

            return existingSlot !== slot;
          }),
          action,
        ],
        lastError: null,
      },
    }));
  },

  removePlannedAction: (crewId, slot) => set((state) => ({
    ui: {
      ...state.ui,
      plannedActions: state.ui.plannedActions.filter((a) => {
        if (a.crewId !== crewId) {
          return true;
        }

        if (!slot) {
          return false;
        }

        const existingSlotRaw = (a.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
        const existingSlot = existingSlotRaw === 'bonus' ? 'bonus' : 'primary';
        return existingSlot !== slot;
      }),
      lastError: null,
    },
  })),

  clearPlannedActions: () => set((state) => ({
    ui: {
      ...state.ui,
      plannedActions: [],
      selectedCrewId: null,
      selectedTargetId: null,
      selectedActionSlot: 'primary',
      executionConfirmed: false,
      lastError: null,
    },
  })),

  updatePlannedActionParameters: (crewId, parameters, slot = 'primary') => set((state) => ({
    ui: {
      ...state.ui,
      plannedActions: state.ui.plannedActions.map((action) =>
        action.crewId === crewId &&
        (((action.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown) === 'bonus' ? 'bonus' : 'primary') === slot
          ? {
              ...action,
              parameters: {
                ...(action.parameters ?? {}),
                ...parameters,
              },
            }
          : action,
      ),
      lastError: null,
    },
  })),

  updatePlannedActionTarget: (crewId, target, slot = 'primary') => set((state) => ({
    ui: {
      ...state.ui,
      plannedActions: state.ui.plannedActions.map((action) =>
        action.crewId === crewId &&
        (((action.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown) === 'bonus' ? 'bonus' : 'primary') === slot
          ? {
              ...action,
              target,
            }
          : action,
      ),
      lastError: null,
    },
  })),

  getPlannedTurnActions: () => {
    const { currentPlayerId, ui } = get();
    if (!currentPlayerId) {
      return {};
    }
    return {
      [currentPlayerId]: ui.plannedActions,
    };
  },

  // === Selection Actions ===
  selectCrew: (crewId) => set((state) => ({
    ui: {
      ...state.ui,
      selectedCrewId: crewId,
      selectedActionSlot: 'primary',
      lastError: null,
    },
  })),

  selectActionSlot: (slot) => set((state) => ({
    ui: {
      ...state.ui,
      selectedActionSlot: slot,
      lastError: null,
    },
  })),

  selectTarget: (targetId) => set((state) => ({
    ui: {
      ...state.ui,
      selectedTargetId: targetId,
      lastError: null,
    },
  })),

  clearSelection: () => set((state) => ({
    ui: {
      ...state.ui,
      selectedCrewId: null,
      selectedTargetId: null,
      selectedActionSlot: 'primary',
      lastError: null,
    },
  })),

  setExecutionConfirmed: (confirmed) => set((state) => ({
    ui: {
      ...state.ui,
      executionConfirmed: confirmed,
      lastError: null,
    },
  })),

  setLastError: (message) => set((state) => ({
    ui: {
      ...state.ui,
      lastError: message,
      executionConfirmed: message ? false : state.ui.executionConfirmed,
    },
  })),

  // === Board View Actions ===
  setBoardZoom: (zoom) => set((state) => ({
    ui: {
      ...state.ui,
      boardZoom: Math.max(0.5, Math.min(2, zoom)), // Clamp between 0.5x and 2x
    },
  })),

  setBoardOffset: (offset) => set((state) => ({
    ui: {
      ...state.ui,
      boardOffset: offset,
    },
  })),

  resetBoardView: () => set((state) => ({
    ui: {
      ...state.ui,
      boardZoom: 1,
      boardOffset: { x: 0, y: 0 },
    },
  })),

  // === Animation Actions ===
  startAnimation: () => set((state) => ({
    ui: {
      ...state.ui,
      isAnimating: true,
      animationStep: 0,
    },
  })),

  stopAnimation: () => set((state) => ({
    ui: {
      ...state.ui,
      isAnimating: false,
    },
  })),

  nextAnimationStep: () => set((state) => ({
    ui: {
      ...state.ui,
      animationStep: state.ui.animationStep + 1,
    },
  })),

  startRingAnimation: (fromBoard: Board) => set((state) => ({
    ui: {
      ...state.ui,
      ringAnimationPhase: 'environment',
      ringAnimationFromBoard: fromBoard,
      ringAnimationProgress: 0,
    },
  })),

  setRingAnimationProgress: (progress: number) => set((state) => ({
    ui: {
      ...state.ui,
      ringAnimationProgress: Math.max(0, Math.min(1, progress)),
    },
  })),

  stopRingAnimation: () => set((state) => ({
    ui: {
      ...state.ui,
      ringAnimationPhase: 'none',
      ringAnimationFromBoard: null,
      ringAnimationProgress: 0,
    },
  })),

  // === UI Panel Actions ===
  toggleSettings: () => set((state) => ({
    ui: {
      ...state.ui,
      settingsOpen: !state.ui.settingsOpen,
    },
  })),

  toggleRoster: () => set((state) => ({
    ui: {
      ...state.ui,
      rosterOpen: !state.ui.rosterOpen,
    },
  })),

  toggleHelp: () => set((state) => ({
    ui: {
      ...state.ui,
      helpOpen: !state.ui.helpOpen,
    },
  })),

  setEventOverlayVisible: (visible) => set((state) => ({
    ui: {
      ...state.ui,
      eventOverlayVisible: visible,
    },
  })),

  // === Derived State Helpers ===
  getCurrentPlayer: () => {
    const { game, currentPlayerId } = get();
    if (!game || !currentPlayerId) {
      return null;
    }
    return game.players.get(currentPlayerId) ?? null;
  },

  isMyTurn: () => {
    const { game, currentPlayerId } = get();
    if (!game || !currentPlayerId) {
      return false;
    }
    // During action_planning phase, all players can plan
    // For now, assume it's always the current player's turn
    return game.status === 'in_progress' &&
           game.turnPhase === 'action_planning';
  },

  // === High-level game flow helpers ===
  playTurn: () => {
    const { game, currentPlayerId, ui } = get();

    try {
      if (!game || !currentPlayerId) {
        throw new Error(
          'Cannot play turn because no game or current player is selected. ' +
          'Root cause: game or currentPlayerId is null in Gravity store. ' +
          'Fix: Ensure a game is loaded and currentPlayerId is set before calling playTurn.'
        );
      }

      if (game.status !== 'in_progress') {
        throw new Error(
          'Cannot play turn for a game that is not in progress. ' +
          `Root cause: game.status is "${game.status}". ` +
          'Fix: Only call playTurn when game.status is "in_progress".'
        );
      }

      const humanActions: TurnActions = {
        [currentPlayerId]: ui.plannedActions,
      };

      const shouldDisableBotActions = true;
      const botActions: TurnActions = shouldDisableBotActions
        ? Array.from(game.players.values()).reduce<TurnActions>((acc, player) => {
            if (player.isBot && player.status === 'active') {
              acc[player.id] = [];
            }
            return acc;
          }, {})
        : generateAllBotActionsFromEngine(game);
      const actionsByPlayer: TurnActions = { ...botActions, ...humanActions };

      let workingGame: GameState = game;
      let nextUI: UIState = ui;

      const previousLastEventId = game.lastResolvedEvent?.id ?? null;

      if (game.turnPhase === 'action_planning') {
        workingGame = processTurn(game, actionsByPlayer);
        nextUI = {
          ...nextUI,
          executionConfirmed: false,
        };
      } else if (game.turnPhase === 'action_execution') {
        if (!ui.executionConfirmed) {
          throw new Error(
            'Cannot advance out of Action Execution because actions are not confirmed complete. ' +
            'Root cause: ui.executionConfirmed is false. ' +
            'Fix: Click "All Actions Complete" in the ship dashboard before advancing.'
          );
        }

        workingGame = processTurn(game, actionsByPlayer);
        nextUI = {
          ...ui,
          plannedActions: [],
          executionConfirmed: false,
          selectedCrewId: null,
          selectedTargetId: null,
          selectedActionSlot: 'primary',
        };
      } else if (game.turnPhase === 'environment') {
        const boardBeforeEnvironment: Board = {
          rings: game.board.rings.map(ring => ({ ...ring })),
          objects: game.board.objects.map(obj => ({ ...obj, position: { ...obj.position } })),
          rotationDirection: game.board.rotationDirection,
        };

        workingGame = processTurn(game, actionsByPlayer);

        nextUI = {
          ...nextUI,
          ringAnimationPhase: 'environment',
          ringAnimationFromBoard: boardBeforeEnvironment,
          ringAnimationProgress: 0,
        };
      } else {
        workingGame = processTurn(game, actionsByPlayer);
      }

      const newLastEventId = workingGame.lastResolvedEvent?.id ?? null;

      const shouldShowEventOverlay =
        game.turnPhase === 'event' &&
        newLastEventId !== null &&
        newLastEventId !== previousLastEventId;

      const lastPlayerDiff = computePlayerDiff({
        prevGame: game,
        nextGame: workingGame,
        playerId: currentPlayerId,
      });

      set({
        game: workingGame,
        ui: {
          ...nextUI,
          lastError: null,
          lastPlayerDiff,
          eventOverlayVisible: shouldShowEventOverlay
            ? true
            : nextUI.eventOverlayVisible,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((state) => ({
        ui: {
          ...state.ui,
          executionConfirmed: false,
          lastError: message,
        },
      }));
    }
  },

  assignExplorerRepairKit: (section: ShipSection) => {
    const { game, currentPlayerId } = get();

    if (!game || !currentPlayerId) {
      throw new Error(
        'Cannot assign Explorer repair kit because no game or current player is selected. ' +
          'Root cause: game or currentPlayerId is null in Gravity store. ' +
          'Fix: Ensure a game is loaded and currentPlayerId is set before assigning the repair kit.',
      );
    }

    const updatedGame = assignExplorerRepairKitFromEngine(game, {
      playerId: currentPlayerId,
      section,
    });

    set((state) => ({
      game: updatedGame,
      ui: state.ui,
    }));
  },

  chooseSpacePirateStartingUpgrade: (upgradeId: string) => {
    const { game, currentPlayerId } = get();

    if (!game || !currentPlayerId) {
      throw new Error(
        'Cannot choose Space Pirate starting upgrade because no game or current player is selected. ' +
          'Root cause: game or currentPlayerId is null in Gravity store. ' +
          'Fix: Ensure a game is loaded and currentPlayerId is set before choosing the upgrade.',
      );
    }

    const updatedGame = chooseSpacePirateStartingUpgradeFromEngine(game, {
      playerId: currentPlayerId,
      upgradeId,
    });

    set((state) => ({
      game: updatedGame,
      ui: state.ui,
    }));
  },
}));

/**
 * Selector hooks for common derived state
 */
export const useCurrentPlayer = () => useGameStore((state) => state.getCurrentPlayer());
export const usePlannedActions = () => useGameStore((state) => state.ui.plannedActions);
export const useSelectedCrew = () => useGameStore((state) => state.ui.selectedCrewId);
export const useBoardZoom = () => useGameStore((state) => state.ui.boardZoom);
