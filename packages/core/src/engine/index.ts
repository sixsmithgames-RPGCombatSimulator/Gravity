import {
  GameState,
  TurnPhase,
  GameUtils,
  Board,
  BoardUtils,
  ShipPosition,
  Ship,
  ShipUtils,
  PlayerState,
  GameSettings,
  AnyCrew,
  Captain,
  CrewUtils,
  OrbitRing,
  ShipSectionState,
  ExpansionId,
  EventCard,
  UpgradeCard,
  ProbeScanLogEntry,
  ProbeScanRevealedItem,
  ActionCard,
  MissionCard,
  CaptainCard,
  OfficerCard,
  TurnActions,
  ObjectType,
  PlayerAction,
  PlayerActionType,
  AnySpaceObject,
  ScanDiscoveryRecord,
} from '../models';
import {
  ENVIRONMENT_DAMAGE,
  SHIP_SECTIONS,
  ShipSection,
  SECTION_CONFIG,
  INITIAL_SHIP_STATE,
  SHIP_CONNECTION_LAYOUT,
  DEFAULT_POWER_ROUTING_HUB_SECTION,
  PLAYER_CONFIG,
  BOARD_CONFIG,
  TURN_CONFIG,
  CORE_EVENT_CARDS,
  CORE_UPGRADE_CARDS,
  CORE_ACTION_CARDS,
  CORE_MISSION_CARDS,
  CORE_CAPTAIN_CARDS,
  CORE_OFFICER_CARDS,
  COLLISION_DAMAGE,
  HAZARD_CONFIG,
  HOSTILE_CONFIG,
  CREW_CONFIG,
  POWER_CONFIG,
  LIFE_SUPPORT_CONFIG,
} from '../constants';

const BASIC_RESOURCE_TYPES = [
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
] as const;

type BasicResourceType = typeof BASIC_RESOURCE_TYPES[number];

const LIVING_METAL_REPAIR_ORDER: ShipSection[] = [
  SHIP_SECTIONS.ENGINEERING,
  SHIP_SECTIONS.DRIVES,
  SHIP_SECTIONS.BRIDGE,
  SHIP_SECTIONS.DEFENSE,
  SHIP_SECTIONS.SCI_LAB,
  SHIP_SECTIONS.MED_LAB,
];

/**
 * Apply Living Metal hull growth for powered upgrade
 * Purpose: Add up to 2 hull per turn, walking Engineering → Drives → Bridge → Defense → Sci-Lab → Med-Lab
 * Parameters:
 *   - ship: Current ship state to mutate immutably
 * Returns: Ship with hull restored (if any sections needed repair)
 * Side effects: None (creates new ship record when changes are applied)
 */
function applyLivingMetalHullGrowth(ship: Ship): Ship {
  let remaining = 2;
  let didChange = false;
  const nextSections: Ship['sections'] = { ...ship.sections };

  for (const section of LIVING_METAL_REPAIR_ORDER) {
    if (remaining <= 0) {
      break;
    }

    const state = nextSections[section];
    if (!state) {
      continue;
    }

    const maxHull = SECTION_CONFIG[section]?.maxHull ?? state.hull;
    const deficit = Math.max(0, maxHull - state.hull);
    if (deficit <= 0) {
      continue;
    }

    const applied = Math.min(deficit, remaining);
    nextSections[section] = {
      ...state,
      hull: state.hull + applied,
    };
    remaining -= applied;
    didChange = true;
  }

  if (!didChange) {
    return ship;
  }

  return {
    ...ship,
    sections: nextSections,
  };
}

function hashStringToUint32(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function createSeededRng(seed: string): () => number {
  let state = hashStringToUint32(seed);
  if (state === 0) {
    state = 1;
  }
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleDeckWithSeed<T>(items: readonly T[], seed: string): T[] {
  const rng = createSeededRng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

type InfallSpawnObjectType = 'debris' | 'asteroid_cluster' | 'hazard' | 'wrecked_ship';

type LootAssignmentResult = {
  object: AnySpaceObject;
  upgradeDeck: UpgradeCard[];
};

function shuffleInPlaceWithRng<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

function pickWeightedInfallSpawnObjectType(rng: () => number): InfallSpawnObjectType {
  const value = rng();

  if (value < 0.35) {
    return 'asteroid_cluster';
  }

  if (value < 0.75) {
    return 'debris';
  }

  return 'wrecked_ship';
}

function assignLootToObject(params: {
  game: GameState;
  object: AnySpaceObject;
  upgradeDeck: UpgradeCard[];
  seedPrefix: string;
  forceUpgradeFromDeck?: boolean;
}): LootAssignmentResult {
  const alreadyAssigned = typeof (params.object as any).lootGeneratedAtTurn === 'number';
  if (alreadyAssigned) {
    return { object: params.object, upgradeDeck: params.upgradeDeck };
  }

  const canEverHaveLoot =
    params.object.type !== 'hazard' &&
    params.object.type !== 'hostile_ship';

  if (!canEverHaveLoot) {
    return {
      object: {
        ...params.object,
        lootResourceType: null,
        lootUpgrade: null,
        lootRollValue: null,
        lootGeneratedAtTurn: params.game.currentTurn,
      },
      upgradeDeck: params.upgradeDeck,
    };
  }

  const rng = createSeededRng(
    `${params.seedPrefix}:${params.game.id}:${params.game.currentTurn}:${params.object.id}`,
  );

  const rollValue = Math.floor(rng() * 6) + 1;
  const hasResource = rng() < 0.85;
  const resourceType = hasResource
    ? BASIC_RESOURCE_TYPES[Math.floor(rng() * BASIC_RESOURCE_TYPES.length)]
    : null;

  const upgradeEligible =
    params.object.type === 'wrecked_ship' ||
    params.object.type === 'functional_station';

  const wantsUpgrade = params.forceUpgradeFromDeck === true
    ? true
    : upgradeEligible && rng() < 0.35;

  let upgradeDeck = params.upgradeDeck;
  let lootUpgrade: UpgradeCard | null = null;

  if (wantsUpgrade && upgradeDeck.length > 0) {
    const [topUpgrade, ...remaining] = upgradeDeck;
    lootUpgrade = topUpgrade;
    upgradeDeck = remaining;
  }

  return {
    object: {
      ...params.object,
      lootResourceType: resourceType,
      lootUpgrade,
      lootRollValue: rollValue,
      lootGeneratedAtTurn: params.game.currentTurn,
    },
    upgradeDeck,
  };
}

function assignLootToObjects(params: {
  game: GameState;
  objects: AnySpaceObject[];
  upgradeDeck: UpgradeCard[];
  seedPrefix: string;
}): { objects: AnySpaceObject[]; upgradeDeck: UpgradeCard[] } {
  if (params.objects.length === 0) {
    return { objects: params.objects, upgradeDeck: params.upgradeDeck };
  }

  const sorted = [...params.objects].sort((a, b) => a.id.localeCompare(b.id));
  let upgradeDeck = params.upgradeDeck;
  const updatedById = new Map<string, AnySpaceObject>();

  for (const object of sorted) {
    const result = assignLootToObject({
      game: params.game,
      object,
      upgradeDeck,
      seedPrefix: params.seedPrefix,
    });
    upgradeDeck = result.upgradeDeck;
    updatedById.set(result.object.id, result.object);
  }

  const objects = params.objects.map((obj) => updatedById.get(obj.id) ?? obj);
  return { objects, upgradeDeck };
}

function assignLootToBoardIfMissing(game: GameState): GameState {
  const result = assignLootToObjects({
    game,
    objects: game.board.objects,
    upgradeDeck: game.upgradeDeck,
    seedPrefix: 'board_loot_init',
  });

  if (result.objects === game.board.objects && result.upgradeDeck === game.upgradeDeck) {
    return game;
  }

  return {
    ...game,
    board: {
      ...game.board,
      objects: result.objects,
    },
    upgradeDeck: result.upgradeDeck,
  };
}

function pickRandomFromSet<T>(items: Set<T>, rng: () => number): T {
  if (items.size <= 0) {
    throw new Error(
      'Cannot pick random item from empty set. ' +
      'Root cause: items.size is 0. ' +
      'Fix: Ensure the set has at least one item before calling pickRandomFromSet.'
    );
  }

  const targetIndex = Math.floor(rng() * items.size);
  let currentIndex = 0;

  for (const item of items) {
    if (currentIndex === targetIndex) {
      return item;
    }
    currentIndex += 1;
  }

  throw new Error(
    'Cannot pick random item from set because iteration did not yield an item. ' +
    `Root cause: items.size=${items.size}, targetIndex=${targetIndex}. ` +
    'Fix: Ensure the set is not mutated during iteration.'
  );
}

function pickSpreadPositionsOnRing(
  ringPositions: ShipPosition[],
  numSpaces: number,
  count: number,
  rng: () => number,
): ShipPosition[] {
  if (count <= 0 || ringPositions.length === 0) {
    return [];
  }

  const spaceToPosition = new Map<number, ShipPosition>();
  const allSpaces: number[] = [];

  for (const pos of ringPositions) {
    spaceToPosition.set(pos.space, pos);
    allSpaces.push(pos.space);
  }

  const availableNonAdjacent = new Set<number>(allSpaces);
  const selectedSpaces = new Set<number>();
  const selected: ShipPosition[] = [];

  while (selected.length < count && availableNonAdjacent.size > 0) {
    const space = pickRandomFromSet(availableNonAdjacent, rng);
    availableNonAdjacent.delete(space);
    selectedSpaces.add(space);

    const position = spaceToPosition.get(space);
    if (position) {
      selected.push(position);
    }

    const remainingNeeded = count - selected.length;
    const neighbors = [
      (space - 1 + numSpaces) % numSpaces,
      (space + 1) % numSpaces,
    ];

    for (const neighbor of neighbors) {
      if (!availableNonAdjacent.has(neighbor)) {
        continue;
      }
      if (availableNonAdjacent.size - 1 < remainingNeeded) {
        continue;
      }
      availableNonAdjacent.delete(neighbor);
    }
  }

  if (selected.length >= count) {
    return selected;
  }

  const remainingSpaces = allSpaces.filter(space => !selectedSpaces.has(space));
  shuffleInPlaceWithRng(remainingSpaces, rng);

  for (const space of remainingSpaces) {
    if (selected.length >= count) {
      break;
    }
    const position = spaceToPosition.get(space);
    if (position) {
      selected.push(position);
    }
  }

  return selected;
}

function pickInfallSpawnPositions(game: GameState, rng: () => number, requestedSpawnCount: number): ShipPosition[] {
  if (requestedSpawnCount <= 0) {
    return [];
  }

  const players = Array.from(game.players.values());
  const results: ShipPosition[] = [];

  for (let ringIndex = game.board.rings.length; ringIndex >= 1; ringIndex -= 1) {
    const ring = game.board.rings[ringIndex - 1];

    if (!ring || ring.numSpaces <= 0) {
      continue;
    }

    const ringPositions: ShipPosition[] = [];

    for (let space = 0; space < ring.numSpaces; space += 1) {
      const position: ShipPosition = { ring: ring.index, space };

      const hasObject = game.board.objects.some(obj =>
        obj.position.ring === position.ring &&
        obj.position.space === position.space,
      );

      if (hasObject) {
        continue;
      }

      const hasShip = players.some(player =>
        player.ship.position.ring === position.ring &&
        player.ship.position.space === position.space,
      );

      if (hasShip) {
        continue;
      }

      ringPositions.push(position);
    }

    if (ringPositions.length === 0) {
      continue;
    }

    const remainingNeeded = requestedSpawnCount - results.length;
    if (remainingNeeded <= 0) {
      break;
    }

    const takeCount = Math.min(remainingNeeded, ringPositions.length);
    const picked = pickSpreadPositionsOnRing(ringPositions, ring.numSpaces, takeCount, rng);
    results.push(...picked);

    if (results.length >= requestedSpawnCount) {
      break;
    }
  }

  return results;
}

function applyInfallObjectSpawns(game: GameState): GameState {
  const playerCount = game.players.size;

  if (playerCount <= 0) {
    return game;
  }

  const rng = createSeededRng(`event_object_spawn:${game.id}:${game.currentTurn}`);
  const requestedSpawnCount = playerCount + 3;

  const spawnPositions = pickInfallSpawnPositions(game, rng, requestedSpawnCount);

  if (spawnPositions.length === 0) {
    return game;
  }

  const newObjects: AnySpaceObject[] = [];

  // Always include exactly one hazard
  const shuffledPositions = [...spawnPositions];
  shuffleInPlaceWithRng(shuffledPositions, rng);

  shuffledPositions.forEach((position, index) => {
    const type = index === 0 ? 'hazard' : pickWeightedInfallSpawnObjectType(rng);

    const object: AnySpaceObject = {
      id: `event-infall-${game.currentTurn}-${index}`,
      type,
      position,
    };

    newObjects.push(object);
  });

  const lootResult = assignLootToObjects({
    game,
    objects: newObjects,
    upgradeDeck: game.upgradeDeck,
    seedPrefix: 'board_loot_spawn',
  });

  const board: Board = {
    ...game.board,
    objects: [...game.board.objects, ...lootResult.objects],
  };

  return {
    ...game,
    board,
    upgradeDeck: lootResult.upgradeDeck,
  };
}

function pickDeterministicBasicResource(game: GameState, seed: string): BasicResourceType {
  const seedHash = hashStringToUint32(seed);
  const index = (game.currentTurn + seedHash) % BASIC_RESOURCE_TYPES.length;
  return BASIC_RESOURCE_TYPES[index];
}

export type EnvironmentDamage = {
  hull: number;
  conduits: number;
  corridors: number;
};

const EVENT_CARDS_BY_EXPANSION: Record<ExpansionId, readonly EventCard[]> = {
  core: CORE_EVENT_CARDS as readonly EventCard[],
};

const UPGRADE_CARDS_BY_EXPANSION: Record<ExpansionId, readonly UpgradeCard[]> = {
  core: CORE_UPGRADE_CARDS as readonly UpgradeCard[],
};

const ACTION_CARDS_BY_EXPANSION: Record<ExpansionId, readonly ActionCard[]> = {
  core: CORE_ACTION_CARDS as readonly ActionCard[],
};

const MISSION_CARDS_BY_EXPANSION: Record<ExpansionId, readonly MissionCard[]> = {
  core: CORE_MISSION_CARDS as readonly MissionCard[],
};

const CAPTAIN_CARDS_BY_EXPANSION: Record<ExpansionId, readonly CaptainCard[]> = {
  core: CORE_CAPTAIN_CARDS as readonly CaptainCard[],
};

const OFFICER_CARDS_BY_EXPANSION: Record<ExpansionId, readonly OfficerCard[]> = {
  core: CORE_OFFICER_CARDS as readonly OfficerCard[],
};

function buildEventDeckForSettings(settings: GameSettings): EventCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build event deck because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const deck: EventCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build event deck because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = EVENT_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build event deck because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in EVENT_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to EVENT_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      deck.push(card);
    }
  }

  return deck;
}

export function buildMissionPoolForSettings(settings: GameSettings): MissionCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build mission pool because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const pool: MissionCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build mission pool because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = MISSION_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build mission pool because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in MISSION_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to MISSION_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      pool.push(card);
    }
  }

  return pool;
}

export function buildCaptainPoolForSettings(settings: GameSettings): CaptainCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build captain pool because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const pool: CaptainCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build captain pool because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = CAPTAIN_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build captain pool because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in CAPTAIN_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to CAPTAIN_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      pool.push(card);
    }
  }

  return pool;
}

export function buildSpecialCrewPoolForSettings(settings: GameSettings): OfficerCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build special crew pool because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const pool: OfficerCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build special crew pool because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = OFFICER_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build special crew pool because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in OFFICER_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to OFFICER_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      pool.push(card);
    }
  }

  return pool;
}

export function buildActionDeckForSettings(settings: GameSettings): ActionCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build action deck because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const deck: ActionCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build action deck because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = ACTION_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build action deck because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in ACTION_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to ACTION_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      deck.push(card);
    }
  }

  return deck;
}

function buildUpgradeDeckForSettings(settings: GameSettings): UpgradeCard[] {
  if (settings.expansions.length === 0) {
    throw new Error(
      'Cannot build upgrade deck because no expansions are enabled in GameSettings. ' +
      'Root cause: settings.expansions is an empty array. ' +
      'Fix: Include at least the "core" expansion in GameSettings when creating a new game.'
    );
  }

  const seenExpansions = new Set<ExpansionId>();
  const deck: UpgradeCard[] = [];

  for (const expansion of settings.expansions) {
    if (seenExpansions.has(expansion)) {
      throw new Error(
        'Cannot build upgrade deck because expansions list contains duplicates. ' +
        `Root cause: expansion "${expansion}" appears more than once in settings.expansions. ` +
        'Fix: Ensure each expansion id appears only once in GameSettings.expansions.'
      );
    }

    seenExpansions.add(expansion);

    const cards = UPGRADE_CARDS_BY_EXPANSION[expansion];

    if (!cards) {
      throw new Error(
        'Cannot build upgrade deck because expansion id is not registered. ' +
        `Root cause: no entry found for expansion "${expansion}" in UPGRADE_CARDS_BY_EXPANSION. ` +
        'Fix: Add this expansion id to UPGRADE_CARDS_BY_EXPANSION or remove it from GameSettings.expansions.'
      );
    }

    for (const card of cards) {
      deck.push(card);
    }
  }

  return deck;
}

export interface CreateBoardOptions {
  settings: GameSettings;
  speedByRing: number[];
}

export interface CreateGameOptions {
  id: string;
  createdAt: Date;
  settings: GameSettings;
  boardSpeedByRing: number[];
}

export interface CreatePlayerStateInput {
  id: string;
  userId: string | null;
  isBot: boolean;
  botStrategy?: string;
  playerOrder: number;
  ship: Ship;
  crew: AnyCrew[];
  captain: Captain;
}

export interface AddPlayerToGameInput {
  id: string;
  userId: string | null;
  isBot: boolean;
  botStrategy?: string;
  ship: Ship;
  crew: AnyCrew[];
  captain: Captain;
}

export interface StartGameOptions {
  startedAt: Date;
}

const TURN_PHASE_SEQUENCE: TurnPhase[] = [
  'event',
  'action_planning',
  'action_execution',
  'environment',
  'resolution',
];

export function createBoardFromConfig(options: CreateBoardOptions): Board {
  const numRings = BOARD_CONFIG.NUM_RINGS;

  if (options.speedByRing.length !== numRings) {
    throw new Error(
      'Cannot create board because ring speed configuration is invalid. ' +
      `Root cause: expected speedByRing length ${numRings} but received ${options.speedByRing.length}. ` +
      'Fix: Provide a speedByRing array with one entry per ring, ordered from innermost (1) to outermost.'
    );
  }

  if (BOARD_CONFIG.SPACES_PER_RING.length < numRings) {
    throw new Error(
      'Cannot create board because SPACES_PER_RING configuration is incomplete. ' +
      `Root cause: NUM_RINGS is ${numRings} but SPACES_PER_RING only defines ${BOARD_CONFIG.SPACES_PER_RING.length} entries. ` +
      'Fix: Update BOARD_CONFIG.SPACES_PER_RING to define a space count for each ring.'
    );
  }

  const rings: OrbitRing[] = [];

  for (let index = 1; index <= numRings; index += 1) {
    const numSpaces = BOARD_CONFIG.SPACES_PER_RING[index - 1];
    const speedRequirement = options.speedByRing[index - 1];

    if (speedRequirement <= 0) {
      throw new Error(
        'Cannot create board because a ring has a non-positive speed requirement. ' +
        `Root cause: speedByRing[${index - 1}] is ${speedRequirement}. ` +
        'Fix: Ensure all ring speed requirements are positive integers that match the rulebook.'
      );
    }

    if (numSpaces <= 0) {
      throw new Error(
        'Cannot create board because a ring has a non-positive number of spaces. ' +
        `Root cause: SPACES_PER_RING[${index - 1}] is ${numSpaces}. ` +
        'Fix: Ensure all ring space counts are positive integers.'
      );
    }

    const color = BoardUtils.getRingColor(index);

    rings.push({
      index,
      rotation: 0,
      numSpaces,
      speedRequirement,
      color,
    });
  }

  return {
    rings,
    objects: [],
    rotationDirection: options.settings.rotationDirection,
  };
}

export function createInitialShip(position: ShipPosition): Ship {
  const sections: Record<ShipSection, ShipSectionState> =
    {} as Record<ShipSection, ShipSectionState>;

  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const section of sectionKeys) {
    const initialSection = INITIAL_SHIP_STATE[section];

    if (!initialSection) {
      throw new Error(
        'Cannot create initial ship because a section is missing from INITIAL_SHIP_STATE. ' +
        `Root cause: no initial configuration found for section "${section}". ` +
        'Fix: Add an entry for this section to INITIAL_SHIP_STATE in GameConfig.'
      );
    }

    sections[section] = createShipSectionStateFromInitial(initialSection as {
      hull: number;
      powerDice: readonly number[];
      corridors: Partial<Record<ShipSection, number>>;
    });
  }

  const speed = INITIAL_SHIP_STATE.speed;
  const shields = INITIAL_SHIP_STATE.shields;

  if (typeof speed !== 'number' || typeof shields !== 'number') {
    throw new Error(
      'Cannot create initial ship because speed or shields are missing from INITIAL_SHIP_STATE. ' +
      'Root cause: INITIAL_SHIP_STATE.speed or INITIAL_SHIP_STATE.shields is not a number. ' +
      'Fix: Define numeric speed and shields values in INITIAL_SHIP_STATE.'
    );
  }

  const baseShip: Ship = {
    sections,
    speed,
    shields,
    position,
  };

  return {
    ...baseShip,
    lifeSupportPower: LIFE_SUPPORT_CONFIG.INITIAL_POOL,
  };
}

function createShipSectionStateFromInitial(initialSection: {
  hull: number;
  powerDice: readonly number[];
  corridors: Partial<Record<ShipSection, number>>;
}): ShipSectionState {
  if (initialSection.hull < 0) {
    throw new Error(
      'Cannot create ship section state because hull is negative in INITIAL_SHIP_STATE. ' +
      `Root cause: section hull value is ${initialSection.hull}. ` +
      'Fix: Ensure all hull values in INITIAL_SHIP_STATE are zero or positive.'
    );
  }

  const powerDice = initialSection.powerDice.map(value => {
    if (value < 0 || value > 6) {
      throw new Error(
        'Cannot create ship section state because a power die value is out of range. ' +
        `Root cause: power die value ${value} is outside the range 0-6. ` +
        'Fix: Ensure all power dice in INITIAL_SHIP_STATE are between 0 and 6 inclusive.'
      );
    }
    return value;
  });

  const corridors: Record<ShipSection, number> = {} as Record<ShipSection, number>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const corridorValue = initialSection.corridors[sectionKey];
    corridors[sectionKey] = corridorValue === 1 ? 1 : 0;
  }

  // Build conduitConnections from initial state
  // Cast to access conduitConnections which may not be in the literal type from INITIAL_SHIP_STATE
  const conduitConnections: Record<ShipSection, number> = {} as Record<ShipSection, number>;
  const initialConduitConnections = (initialSection as { conduitConnections?: Record<ShipSection, number> }).conduitConnections;
  for (const sectionKey of sectionKeys) {
    const conduitValue = initialConduitConnections?.[sectionKey];
    if (conduitValue === undefined) {
      conduitConnections[sectionKey] = 0;
      continue;
    }

    if (typeof conduitValue !== 'number' || !Number.isFinite(conduitValue) || conduitValue < 0) {
      throw new Error(
        'Cannot create ship section state because conduitConnections entry is invalid in INITIAL_SHIP_STATE. ' +
          `Root cause: conduitConnections["${sectionKey}"] is "${String(conduitValue)}". ` +
          'Fix: Use a non-negative number for conduitConnections values (0 = no connection, >0 = conduit count).'
      );
    }

    if (!Number.isInteger(conduitValue)) {
      throw new Error(
        'Cannot create ship section state because conduitConnections entry is not an integer in INITIAL_SHIP_STATE. ' +
          `Root cause: conduitConnections["${sectionKey}"] is ${conduitValue}. ` +
          'Fix: Use an integer conduit count (e.g. 0, 1, 2, 3).'
      );
    }

    conduitConnections[sectionKey] = conduitValue;
  }

  return {
    hull: initialSection.hull,
    powerDice,
    corridors,
    conduitConnections,
  };
}

export function createPlayerState(input: CreatePlayerStateInput): PlayerState {
  if (!input.id) {
    throw new Error(
      'Cannot create player state without an id. ' +
      'Root cause: input.id is an empty string. ' +
      'Fix: Provide a non-empty player id when creating a player state.'
    );
  }

  if (!input.isBot && input.userId === null) {
    throw new Error(
      'Cannot create human player state without a userId. ' +
      'Root cause: input.isBot is false but input.userId is null. ' +
      'Fix: Provide a non-null userId for human players or mark the player as a bot.'
    );
  }

  if (input.isBot && input.userId !== null) {
    throw new Error(
      'Cannot create bot player state with a non-null userId. ' +
      `Root cause: input.isBot is true but input.userId is "${input.userId}". ` +
      'Fix: Use null for userId when creating bot players.'
    );
  }

  if (input.crew.length === 0) {
    throw new Error(
      'Cannot create player state without any crew. ' +
      'Root cause: input.crew array is empty. ' +
      'Fix: Provide at least one crew member (including the basic crew) when creating a player.'
    );
  }

  return {
    id: input.id,
    userId: input.userId,
    isBot: input.isBot,
    botStrategy: input.botStrategy,
    playerOrder: input.playerOrder,
    status: 'active',
    ship: input.ship,
    crew: input.crew,
    captain: input.captain,
    missions: [],
    actionDeck: [],
    pendingUpgrades: [],
    installedUpgrades: [],
    resources: {},
    scannedHostiles: {},
    hostilesScannedPlayerByObjectId: {},
    decoysLastUsedTurn: 0,
    powerCoilsLastUsedTurn: 0,
    probeScanLogsByObjectId: {},
    explorerRepairKit: null,
    spacePirateStartingUpgradeOptions: null,
  };
}

function addStartingResourcesForImperialist(game: GameState, player: PlayerState): PlayerState {
  const updatedResources: PlayerState['resources'] = {
    ...player.resources,
  };

  for (let index = 0; index < 3; index += 1) {
    const resourceType = pickDeterministicBasicResource(game, `imperialist_start:${player.id}:${index}`);
    const current = updatedResources[resourceType as keyof PlayerState['resources']] ?? 0;
    updatedResources[resourceType as keyof PlayerState['resources']] = current + 1;
  }

  return {
    ...player,
    resources: updatedResources,
  };
}

function drawUpgradesForPlayer(params: {
  player: PlayerState;
  upgradeDeck: UpgradeCard[];
  count: number;
  toField: 'pending' | 'spacePirateOptions';
}): { player: PlayerState; upgradeDeck: UpgradeCard[] } {
  const count = Math.max(0, Math.floor(params.count));
  if (count <= 0 || params.upgradeDeck.length === 0) {
    return { player: params.player, upgradeDeck: params.upgradeDeck };
  }

  const take = Math.min(count, params.upgradeDeck.length);
  const drawn = params.upgradeDeck.slice(0, take);
  const remaining = params.upgradeDeck.slice(take);

  if (params.toField === 'pending') {
    return {
      player: {
        ...params.player,
        pendingUpgrades: [...params.player.pendingUpgrades, ...drawn],
      },
      upgradeDeck: remaining,
    };
  }

  return {
    player: {
      ...params.player,
      spacePirateStartingUpgradeOptions: drawn,
    },
    upgradeDeck: remaining,
  };
}

function applyCaptainStartOfGameEffects(game: GameState): GameState {
  let upgradeDeck = [...game.upgradeDeck];
  const players = new Map<string, PlayerState>(game.players);
  const sortedPlayers = Array.from(players.values()).sort((a, b) => a.playerOrder - b.playerOrder);

  for (const player of sortedPlayers) {
    if (player.captain.captainType === 'explorer') {
      players.set(player.id, {
        ...player,
        explorerRepairKit: { section: null, used: false },
      });
      continue;
    }

    if (player.captain.captainType === 'merchant') {
      const result = drawUpgradesForPlayer({
        player,
        upgradeDeck,
        count: 2,
        toField: 'pending',
      });
      players.set(player.id, result.player);
      upgradeDeck = result.upgradeDeck;
      continue;
    }

    if (player.captain.captainType === 'imperialist') {
      players.set(player.id, addStartingResourcesForImperialist(game, player));
      continue;
    }

    if (player.captain.captainType === 'space_pirate') {
      const result = drawUpgradesForPlayer({
        player,
        upgradeDeck,
        count: 3,
        toField: 'spacePirateOptions',
      });
      players.set(player.id, result.player);
      upgradeDeck = result.upgradeDeck;
    }
  }

  return {
    ...game,
    players,
    upgradeDeck,
  };
}

export function assignExplorerRepairKit(
  game: GameState,
  params: { playerId: string; section: ShipSection },
): GameState {
  const { playerId, section } = params;
  const player = game.players.get(playerId);

  if (!player) {
    throw new Error(
      'Cannot assign Explorer repair kit because player was not found. ' +
        `Root cause: playerId "${playerId}" does not exist in game.players. ` +
        'Fix: Pass a valid playerId that is present in the current game state.',
    );
  }

  if (player.captain.captainType !== 'explorer') {
    throw new Error(
      'Cannot assign Explorer repair kit because this player is not an Explorer captain. ' +
        `Root cause: captainType is "${player.captain.captainType}". ` +
        'Fix: Only Explorer captains receive a special repair kit to assign.',
    );
  }

  if (!player.explorerRepairKit) {
    throw new Error(
      'Cannot assign Explorer repair kit because explorerRepairKit state is missing. ' +
        'Root cause: player.explorerRepairKit is undefined or null. ' +
        'Fix: Advance to the first turn so captain start-of-game effects have been applied before assigning the kit.',
    );
  }

  if (player.explorerRepairKit.used) {
    throw new Error(
      'Cannot assign Explorer repair kit because it has already been used. ' +
        'Fix: Explorer repair kit can only be assigned before it is consumed.',
    );
  }

  if (player.explorerRepairKit.section) {
    throw new Error(
      'Cannot assign Explorer repair kit because it has already been placed on another section. ' +
        `Root cause: repair kit is currently assigned to "${player.explorerRepairKit.section}". ` +
        'Fix: The special repair kit can only be assigned once per game.',
    );
  }

  const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
  if (!validSections.has(section)) {
    throw new Error(
      'Cannot assign Explorer repair kit because target section is invalid. ' +
        `Root cause: "${section}" is not a member of SHIP_SECTIONS. ` +
        'Fix: Choose a valid ship section identifier.',
    );
  }

  const sectionState = player.ship.sections[section];
  if (!sectionState) {
    throw new Error(
      'Cannot assign Explorer repair kit because target section state does not exist. ' +
        `Root cause: ship.sections["${section}"] is undefined. ` +
        'Fix: Ensure the ship state includes this section before assigning the kit.',
    );
  }

  const maxHull = SECTION_CONFIG[section]?.maxHull ?? sectionState.hull;
  if (sectionState.hull >= maxHull) {
    throw new Error(
      'Cannot assign Explorer repair kit because the section is not damaged. ' +
        `Root cause: "${section}" currently has hull ${sectionState.hull} / ${maxHull}. ` +
        'Fix: Choose a section with less than maximum hull.',
    );
  }

  const updatedPlayers = new Map(game.players);
  updatedPlayers.set(playerId, {
    ...player,
    explorerRepairKit: {
      section,
      used: false,
    },
  });

  return {
    ...game,
    players: updatedPlayers,
  };
}

function getFixedRollRole(crew: AnyCrew | Captain): string {
  if (crew.type === 'captain') {
    return 'captain';
  }

  const rawRole = (crew as { role?: unknown }).role;
  return typeof rawRole === 'string' ? rawRole : 'unknown';
}

function getFixedReviveRollValue(crew: AnyCrew | Captain): number {
  if (crew.type === 'captain') {
    return 6;
  }

  const role = getFixedRollRole(crew);
  if (role === 'medic' || role === 'doctor' || role === 'first_officer') {
    return 6;
  }
  return 3;
}
function getFixedAssembleRollValue(crew: AnyCrew | Captain, itemType: string): number {
  if (crew.type === 'captain') {
    if (itemType === 'medical_kit' || itemType === 'probe') {
      return 6;
    }
    return 3;
  }

  const role = getFixedRollRole(crew);

  if (itemType === 'medical_kit') {
    return role === 'medic' || role === 'doctor' || role === 'first_officer' ? 6 : 3;
  }

  if (itemType === 'probe') {
    return role === 'scientist' || role === 'senior_scientist' || role === 'first_officer' ? 6 : 3;
  }

  return 3;
}

function getFixedAttackRollValues(): [number, number] {
  return [3, 3];
}

function isCloakingDeviceBlockingHostileAttack(params: {
  game: GameState;
  player: PlayerState;
  hostileId: string;
}): { blocked: boolean; player: PlayerState } {
  const cloakingPowered = playerHasPoweredUpgrade(params.player, params.player.ship, 'cloaking_device');
  if (!cloakingPowered) {
    return { blocked: false, player: params.player };
  }

  const scans = params.player.hostilesScannedPlayerByObjectId ?? {};
  const scannedTurn = scans[params.hostileId];
  if (typeof scannedTurn === 'number' && Number.isFinite(scannedTurn) && scannedTurn > 0) {
    return { blocked: false, player: params.player };
  }

  const nextScans = {
    ...scans,
    [params.hostileId]: params.game.currentTurn,
  };

  return {
    blocked: true,
    player: {
      ...params.player,
      hostilesScannedPlayerByObjectId: nextScans,
    },
  };
}

function applyPowerCoilsMitigationToEdgeLoad(params: {
  game: GameState;
  player: PlayerState;
  ship: Ship;
  edgeLoad: Map<string, { a: ShipSection; b: ShipSection; load: number }>;
}): { player: PlayerState; edgeLoad: Map<string, { a: ShipSection; b: ShipSection; load: number }> } {
  const coilsPowered = playerHasPoweredUpgrade(params.player, params.ship, 'power_coils');
  const lastUsedTurn = params.player.powerCoilsLastUsedTurn ?? 0;

  if (!coilsPowered || lastUsedTurn === params.game.currentTurn) {
    return { player: params.player, edgeLoad: params.edgeLoad };
  }

  for (const entry of params.edgeLoad.values()) {
    const aToB = params.ship.sections[entry.a]?.conduitConnections?.[entry.b] ?? 0;
    const bToA = params.ship.sections[entry.b]?.conduitConnections?.[entry.a] ?? 0;
    const conduitsOnEdge = Math.min(aToB, bToA);
    if (conduitsOnEdge <= 0) {
      continue;
    }

    const safeCapacity = conduitsOnEdge * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
    if (entry.load <= safeCapacity) {
      continue;
    }

    const nextEdgeLoad = new Map<string, { a: ShipSection; b: ShipSection; load: number }>();
    for (const [key, value] of params.edgeLoad.entries()) {
      nextEdgeLoad.set(key, { ...value });
    }

    for (const [key, value] of nextEdgeLoad.entries()) {
      if (value.a === entry.a && value.b === entry.b && value.load === entry.load) {
        nextEdgeLoad.set(key, {
          ...value,
          load: safeCapacity,
        });
        break;
      }
    }

    return {
      player: {
        ...params.player,
        powerCoilsLastUsedTurn: params.game.currentTurn,
      },
      edgeLoad: nextEdgeLoad,
    };
  }

  return { player: params.player, edgeLoad: params.edgeLoad };
}

function rollHostileAttackDamage(params: {
  game: GameState;
  hostileId: string;
  targetPlayerId: string;
}): number {
  const rng = createSeededRng(
    `hostile_attack:${params.game.id}:${params.game.currentTurn}:${params.hostileId}:${params.targetPlayerId}`,
  );
  let total = HOSTILE_CONFIG.attackBaseDamage;
  for (let i = 0; i < HOSTILE_CONFIG.attackDiceCount; i += 1) {
    total += Math.floor(rng() * 6) + 1;
  }
  return total;
}

function applyIncomingWeaponDamageToPlayer(params: {
  game: GameState;
  player: PlayerState;
  damage: number;
}): PlayerState {
  const absorbedByShields = Math.min(params.player.ship.shields, params.damage);
  const hasShieldModulator = playerHasPoweredUpgrade(params.player, params.player.ship, 'shield_modulator');
  const shieldLoss = hasShieldModulator
    ? Math.max(0, Math.ceil(absorbedByShields / 2))
    : absorbedByShields;
  const remainingDamage = params.damage - absorbedByShields;

  let nextShip: Ship = {
    ...params.player.ship,
    shields: Math.max(0, params.player.ship.shields - shieldLoss),
  };

  if (remainingDamage > 0) {
    const targetSection = selectSectionForCollisionDamage(nextShip);
    nextShip = applyCollisionDamageToShip(nextShip, { hull: remainingDamage }, targetSection);
  }

  return {
    ...params.player,
    ship: nextShip,
    status: ShipUtils.isWrecked(nextShip) ? 'wrecked' : params.player.status,
  };
}

function appendProbeScanLog(params: {
  game: GameState;
  player: PlayerState;
  crewId: string;
  objectId: string;
  objectType: ObjectType;
  rollValue: number;
  revealed: ProbeScanRevealedItem[];
}): PlayerState {
  const existingByObjectId = params.player.probeScanLogsByObjectId ?? {};
  const existingLogs = existingByObjectId[params.objectId] ?? [];
  const seed = `${params.player.id}:${params.crewId}:${params.objectId}:${params.rollValue}:${params.game.currentTurn}:${existingLogs.length}`;
  const id = `probe_scan:${hashStringToUint32(seed)}`;
  const createdAtMs =
    params.game.createdAt.getTime() +
    params.game.currentTurn * 60_000 +
    existingLogs.length;
  const createdAt = new Date(createdAtMs).toISOString();

  const nextEntry: ProbeScanLogEntry = {
    id,
    turn: params.game.currentTurn,
    source: 'probe',
    crewId: params.crewId,
    objectId: params.objectId,
    objectType: params.objectType,
    rollValue: params.rollValue,
    revealed: params.revealed,
    createdAt,
  };

  return {
    ...params.player,
    probeScanLogsByObjectId: {
      ...existingByObjectId,
      [params.objectId]: [...existingLogs, nextEntry],
    },
  };
}

export function createNewGame(options: CreateGameOptions): GameState {
  if (!options.id) {
    throw new Error(
      'Cannot create game without an id. ' +
      'Root cause: options.id is an empty string. ' +
      'Fix: Provide a non-empty game id when creating a new game.'
    );
  }

  if (options.settings.maxPlayers < PLAYER_CONFIG.MIN_PLAYERS ||
      options.settings.maxPlayers > PLAYER_CONFIG.MAX_PLAYERS) {
    throw new Error(
      'Cannot create game because maxPlayers is outside allowed bounds. ' +
      `Root cause: settings.maxPlayers is ${options.settings.maxPlayers}, but allowed range is ` +
      `${PLAYER_CONFIG.MIN_PLAYERS}-${PLAYER_CONFIG.MAX_PLAYERS}. ` +
      'Fix: Choose a maxPlayers value within the configured player limits.'
    );
  }

  const board = createBoardFromConfig({
    settings: options.settings,
    speedByRing: options.boardSpeedByRing,
  });

  const eventDeckUnshuffled = buildEventDeckForSettings(options.settings);
  const upgradeDeckUnshuffled = buildUpgradeDeckForSettings(options.settings);
  const deckSeed = `${options.id}:${options.createdAt.toISOString()}`;
  const eventDeck = shuffleDeckWithSeed(eventDeckUnshuffled, `event:${deckSeed}`);
  const upgradeDeck = shuffleDeckWithSeed(upgradeDeckUnshuffled, `upgrade:${deckSeed}`);

  return {
    id: options.id,
    status: 'setup',
    currentTurn: 1,
    turnPhase: 'event',
    board,
    players: new Map<string, PlayerState>(),
    eventDeck,
    upgradeDeck,
    createdAt: options.createdAt,
    startedAt: null,
    settings: options.settings,
  };
}

export function addPlayerToGame(game: GameState, input: AddPlayerToGameInput): GameState {
  if (game.status !== 'setup') {
    throw new Error(
      'Cannot add player to game that has already started or completed. ' +
      `Root cause: game.status is "${game.status}". ` +
      'Fix: Only call addPlayerToGame when the game status is "setup".'
    );
  }

  const currentPlayerCount = game.players.size;

  if (currentPlayerCount >= game.settings.maxPlayers) {
    throw new Error(
      'Cannot add player because the game is already at maxPlayers. ' +
      `Root cause: current player count is ${currentPlayerCount} and settings.maxPlayers is ${game.settings.maxPlayers}. ` +
      'Fix: Increase maxPlayers in settings when creating the game or remove a player before adding another.'
    );
  }

  if (game.players.has(input.id)) {
    throw new Error(
      'Cannot add player because a player with the same id already exists in the game. ' +
      `Root cause: attempted to add player with duplicate id "${input.id}". ` +
      'Fix: Use a unique player id for each player in the game.'
    );
  }

  if (input.userId !== null) {
    for (const existingPlayer of game.players.values()) {
      if (existingPlayer.userId === input.userId) {
        throw new Error(
          'Cannot add player because a player with the same userId already exists in the game. ' +
          `Root cause: existing player with userId "${input.userId}". ` +
          'Fix: Ensure each human user joins the game with a unique userId.'
        );
      }
    }
  }

  const playerOrder = currentPlayerCount + 1;

  const playerState = createPlayerState({
    id: input.id,
    userId: input.userId,
    isBot: input.isBot,
    botStrategy: input.botStrategy,
    playerOrder,
    ship: input.ship,
    crew: input.crew,
    captain: input.captain,
  });

  const players = new Map<string, PlayerState>(game.players);
  players.set(playerState.id, playerState);

  return {
    ...game,
    players,
  };
}

export function startGame(game: GameState, options: StartGameOptions): GameState {
  if (game.status !== 'setup') {
    throw new Error(
      'Cannot start game that has already started or completed. ' +
      `Root cause: game.status is "${game.status}". ` +
      'Fix: Only call startGame when the game status is "setup".'
    );
  }

  const playerCount = game.players.size;

  if (playerCount < PLAYER_CONFIG.MIN_PLAYERS) {
    throw new Error(
      'Cannot start game because there are too few players. ' +
      `Root cause: player count is ${playerCount}, but minimum required is ${PLAYER_CONFIG.MIN_PLAYERS}. ` +
      'Fix: Add more players before starting the game.'
    );
  }

  if (playerCount > game.settings.maxPlayers) {
    throw new Error(
      'Cannot start game because player count exceeds maxPlayers. ' +
      `Root cause: player count is ${playerCount}, but settings.maxPlayers is ${game.settings.maxPlayers}. ` +
      'Fix: Decrease the number of players or increase maxPlayers in settings when creating the game.'
    );
  }

  const outerRing = game.board.rings[game.board.rings.length - 1];
  const numSpaces = outerRing.numSpaces;

  if (numSpaces % playerCount !== 0) {
    throw new Error(
      'Cannot start game because players cannot be spaced evenly around the outer ring. ' +
      `Root cause: outer ring has ${numSpaces} spaces, which is not evenly divisible by ${playerCount} players. ` +
      'Fix: Adjust the number of players or the SPACES_PER_RING configuration so the outer ring can be divided evenly.'
    );
  }

  const spacing = numSpaces / playerCount;
  const sortedPlayers = Array.from(game.players.values()).sort(
    (a, b) => a.playerOrder - b.playerOrder,
  );

  const players = new Map<string, PlayerState>();

  for (let index = 0; index < sortedPlayers.length; index += 1) {
    const player = sortedPlayers[index];
    const space = index * spacing;

    const ship: Ship = {
      ...player.ship,
      position: {
        ring: outerRing.index,
        space,
      },
    };

    const updatedPlayer: PlayerState = {
      ...player,
      status: 'active',
      ship,
    };

    players.set(updatedPlayer.id, updatedPlayer);
  }

  const startedGame: GameState = {
    ...game,
    status: 'in_progress',
    startedAt: options.startedAt,
    players,
  };

  return assignLootToBoardIfMissing(startedGame);
}

export function chooseSpacePirateStartingUpgrade(
  game: GameState,
  params: { playerId: string; upgradeId: string },
): GameState {
  const player = game.players.get(params.playerId);
  if (!player) {
    throw new Error(
      'Cannot choose Space Pirate starting upgrade because player was not found. ' +
        `Root cause: playerId "${params.playerId}" does not exist in game.players. ` +
        'Fix: Pass a valid playerId for an existing player.',
    );
  }

  if (player.captain.captainType !== 'space_pirate') {
    throw new Error(
      'Cannot choose Space Pirate starting upgrade because this player is not a Space Pirate captain. ' +
        `Root cause: captainType is "${player.captain.captainType}". ` +
        'Fix: Only Space Pirate captains can select an extra starting upgrade.',
    );
  }

  const options = player.spacePirateStartingUpgradeOptions;
  if (!options || options.length === 0) {
    throw new Error(
      'Cannot choose Space Pirate starting upgrade because there are no available options. ' +
        'Root cause: player.spacePirateStartingUpgradeOptions is empty or null. ' +
        'Fix: Advance to the first turn so captain start-of-game effects have been applied before choosing the upgrade.',
    );
  }

  const selected = options.find((u) => u.id === params.upgradeId);
  if (!selected) {
    throw new Error(
      'Cannot choose Space Pirate starting upgrade because the requested upgrade is not in the available options. ' +
        `Root cause: upgradeId "${params.upgradeId}" is not present in player.spacePirateStartingUpgradeOptions. ` +
        'Fix: Choose an upgradeId from the provided options.',
    );
  }

  const updatedPlayers = new Map(game.players);
  updatedPlayers.set(player.id, {
    ...player,
    pendingUpgrades: [...player.pendingUpgrades, selected],
    spacePirateStartingUpgradeOptions: null,
  });

  return {
    ...game,
    players: updatedPlayers,
  };
}

export function getNextTurnPhase(currentPhase: TurnPhase): TurnPhase | null {
  const index = TURN_PHASE_SEQUENCE.indexOf(currentPhase);

  if (index === -1) {
    throw new Error(
      'Failed to determine next turn phase. ' +
      `Root cause: turnPhase value "${currentPhase}" is not valid. ` +
      'Fix: Initialize game.turnPhase using a valid TurnPhase literal.'
    );
  }

  if (index === TURN_PHASE_SEQUENCE.length - 1) {
    return null;
  }

  return TURN_PHASE_SEQUENCE[index + 1];
}

export function advanceTurn(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot advance turn for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call advanceTurn when game.status is "in_progress".'
    );
  }

  const nextPhase = getNextTurnPhase(game.turnPhase);

  if (nextPhase !== null) {
    return {
      ...game,
      turnPhase: nextPhase,
    };
  }

  if (GameUtils.shouldEndGame(game)) {
    return {
      ...game,
      status: 'completed',
    };
  }

  return {
    ...game,
    currentTurn: game.currentTurn + 1,
    turnPhase: 'event',
  };
}

export function applyPlayerActions(
  game: GameState,
  actionsByPlayer: TurnActions,
): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot apply player actions for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call applyPlayerActions when game.status is "in_progress".'
    );
  }

  if (game.turnPhase !== 'action_execution') {
    throw new Error(
      'Cannot apply player actions outside the action_execution phase. ' +
      `Root cause: game.turnPhase is "${game.turnPhase}". ` +
      'Fix: Only call applyPlayerActions when game.turnPhase is "action_execution".'
    );
  }

  const activePlayerIds = new Set(
    Array.from(game.players.values())
      .filter(player => player.status === 'active')
      .map(player => player.id),
  );

  const submittedPlayerIds = new Set(Object.keys(actionsByPlayer));

  if (!GameUtils.allPlayersSubmitted(game, submittedPlayerIds)) {
    const activePlayers = Array.from(game.players.values())
      .filter(player => player.status === 'active');
    const missingPlayerIds = activePlayers
      .map(player => player.id)
      .filter(id => !submittedPlayerIds.has(id));

    throw new Error(
      'Cannot apply player actions because actions are missing for some active players. ' +
      `Root cause: actionsByPlayer is missing entries for active player ids: ${missingPlayerIds.join(', ')}. ` +
      'Fix: Ensure every active player appears as a key in actionsByPlayer, using an empty action array for players taking no actions this turn.'
    );
  }

  const allPlayerIds = new Set(game.players.keys());
  const objectIds = new Set(game.board.objects.map(object => object.id));
  const validSections = new Set(Object.values(SHIP_SECTIONS));

  for (const [playerId, actions] of Object.entries(actionsByPlayer)) {
    if (!activePlayerIds.has(playerId)) {
      throw new Error(
        'Cannot apply player actions for an unknown or inactive player. ' +
        `Root cause: actionsByPlayer contains key "${playerId}" but no active PlayerState exists with this id. ` +
        'Fix: Only include active player ids from game.players in the actionsByPlayer map.'
      );
    }

    if (!Array.isArray(actions)) {
      throw new Error(
        'Cannot apply player actions because actions list is not an array. ' +
        `Root cause: actionsByPlayer["${playerId}"] is of type "${typeof actions}" instead of "PlayerAction[]". ` +
        'Fix: Ensure each value in actionsByPlayer is an array of PlayerAction objects.'
      );
    }

    for (const action of actions) {
      if (action.playerId !== playerId) {
        throw new Error(
          'Cannot apply player action because playerId does not match its owner entry. ' +
          `Root cause: action.playerId is "${action.playerId}", but it was provided under key "${playerId}" in actionsByPlayer. ` +
          'Fix: Ensure each PlayerAction.playerId matches the key under which it is stored in the actionsByPlayer map.'
        );
      }

      if (!action.crewId || typeof action.crewId !== 'string') {
        throw new Error(
          'Cannot apply player action because crewId is missing or invalid. ' +
          'Root cause: action.crewId is not a non-empty string. ' +
          'Fix: Provide a valid crewId for every PlayerAction so the engine can attribute the action to a specific crew member.'
        );
      }

      if (!action.type) {
        throw new Error(
          'Cannot apply player action because type is missing. ' +
          'Root cause: action.type is undefined. ' +
          'Fix: Set action.type to a valid PlayerActionType literal (e.g. "restore", "repair", "maneuver").'
        );
      }

      const target = action.target;

      if (target != null) {
        if (typeof target !== 'object') {
          throw new Error(
            'Cannot apply player action because target is not an object. ' +
            `Root cause: action.target is of type "${typeof target}" instead of "PlayerActionTarget | null". ` +
            'Fix: Provide a structured PlayerActionTarget object or null for action.target.'
          );
        }

        if (target.playerId && !allPlayerIds.has(target.playerId)) {
          throw new Error(
            'Cannot apply player action because target.playerId refers to an unknown player. ' +
            `Root cause: target.playerId is "${target.playerId}", which does not exist in game.players. ` +
            'Fix: Use a valid player id from game.players when targeting a player, or omit target.playerId.'
          );
        }

        if (target.objectId && !objectIds.has(target.objectId)) {
          throw new Error(
            'Cannot apply player action because target.objectId refers to an unknown board object. ' +
            `Root cause: target.objectId is "${target.objectId}", which does not exist in game.board.objects. ` +
            'Fix: Use a valid object id from game.board.objects when targeting a space object, or omit target.objectId.'
          );
        }

        if (target.position) {
          if (!BoardUtils.isValidPosition(target.position, game.board)) {
            throw new Error(
              'Cannot apply player action because target.position is outside the board bounds. ' +
              `Root cause: target.position is at ring=${target.position.ring}, space=${target.position.space}, which is not a valid board coordinate. ` +
              'Fix: Use a position within the configured board rings and spaces for action targets.'
            );
          }
        }

        if (target.section && !validSections.has(target.section as ShipSection)) {
          throw new Error(
            'Cannot apply player action because target.section is not a valid ship section. ' +
            `Root cause: target.section is "${target.section}", which does not match any SHIP_SECTIONS value. ` +
            'Fix: Use a valid ship section key from SHIP_SECTIONS when specifying target.section.'
          );
        }
      }
    }
  }

  // === ACTION RESOLUTION PIPELINE ===
  // Actions are resolved in rulebook order, all players simultaneously per action type.
  // This ensures fair play and predictable state transitions.

  // Collect all actions from all players into a single list for ordered processing
  const allActions: { playerId: string; action: PlayerAction }[] = [];
  for (const [playerId, actions] of Object.entries(actionsByPlayer)) {
    for (const action of actions) {
      allActions.push({ playerId, action });
    }
  }

  // Define the resolution order per rulebook
  const actionOrder: PlayerActionType[] = [
    'restore',
    'route',
    'revive',
    'repair',
    'maneuver',
    'scan',
    'acquire',
    'attack',
    'launch',
    'retaliate',
    'assemble',
    'integrate',
  ];

  // Group actions by type
  const actionsByType = new Map<PlayerActionType, typeof allActions>();
  for (const { playerId, action } of allActions) {
    const existing = actionsByType.get(action.type) ?? [];
    existing.push({ playerId, action });
    actionsByType.set(action.type, existing);
  }

  const resolvedActionCountsByPlayerId = new Map<string, Map<string, number>>();
  const cyberneticsBonusCrewIdByPlayerId = new Map<string, string | null>();

  // Process actions in rulebook order
  let currentGame = game;
  for (const actionType of actionOrder) {
    const actionsOfType = actionsByType.get(actionType);
    if (!actionsOfType || actionsOfType.length === 0) {
      continue;
    }

    validateAndTrackCyberneticsActionLimits(
      currentGame,
      actionType,
      actionsOfType,
      resolvedActionCountsByPlayerId,
      cyberneticsBonusCrewIdByPlayerId,
    );

    // Resolve all actions of this type simultaneously
    currentGame = resolveActionsOfType(currentGame, actionType, actionsOfType);
  }

  return currentGame;
}

function validateAndTrackCyberneticsActionLimits(
  game: GameState,
  actionType: PlayerActionType,
  actions: Array<{ playerId: string; action: PlayerAction }>,
  resolvedActionCountsByPlayerId: Map<string, Map<string, number>>,
  cyberneticsBonusCrewIdByPlayerId: Map<string, string | null>,
): void {
  const actionCountsByPlayerAndCrew = new Map<string, Map<string, number>>();
  for (const entry of actions) {
    const playerMap = actionCountsByPlayerAndCrew.get(entry.playerId) ?? new Map<string, number>();
    const current = playerMap.get(entry.action.crewId) ?? 0;
    playerMap.set(entry.action.crewId, current + 1);
    actionCountsByPlayerAndCrew.set(entry.playerId, playerMap);
  }

  for (const [playerId, batchCountsByCrewId] of actionCountsByPlayerAndCrew.entries()) {
    const player = game.players.get(playerId);
    if (!player) {
      throw new Error(
        'Cannot resolve actions because playerId is unknown. ' +
          `Root cause: action batch for type "${actionType}" contains playerId "${playerId}" which is not present in game.players. ` +
          'Fix: Ensure all actions reference valid active players.'
      );
    }

    const resolvedCounts = resolvedActionCountsByPlayerId.get(playerId) ?? new Map<string, number>();
    const existingBonusCrewId = cyberneticsBonusCrewIdByPlayerId.get(playerId) ?? null;
    let candidateBonusCrewId: string | null = existingBonusCrewId;

    for (const [crewId, batchCount] of batchCountsByCrewId.entries()) {
      const previousCount = resolvedCounts.get(crewId) ?? 0;
      const nextCount = previousCount + batchCount;

      if (nextCount <= 1) {
        continue;
      }

      if (nextCount > 2) {
        throw new Error(
          'Cannot resolve actions because a crew member submitted too many actions in a single turn. ' +
            `Root cause: player "${playerId}" submitted ${nextCount} total actions for crew "${crewId}" (extra actions detected while resolving "${actionType}" actions). ` +
            'Fix: A crew member may take at most 1 action per turn (or 2 actions when using Cybernetics).'
        );
      }

      if (candidateBonusCrewId !== null && candidateBonusCrewId !== crewId) {
        throw new Error(
          'Cannot resolve actions because a bonus-action upgrade was used by more than one crew member this turn. ' +
            `Root cause: player "${playerId}" attempted a second action for crew "${crewId}", but the bonus action is already assigned to crew "${candidateBonusCrewId}".` +
            'Fix: Only one crew member may take a second action per turn when using Cybernetics or Temporal Shift.'
        );
      }

      const hasCyberneticsInstalled = playerHasInstalledUpgrade(player, 'cybernetics');
      const hasTemporalShiftInstalled = playerHasInstalledUpgrade(player, 'temporal_shift');

      const cyberneticsPowered =
        hasCyberneticsInstalled && playerHasPoweredUpgrade(player, player.ship, 'cybernetics');
      const temporalShiftPowered =
        hasTemporalShiftInstalled && playerHasPoweredUpgrade(player, player.ship, 'temporal_shift');

      const hasBonusActionUpgradePowered = cyberneticsPowered || temporalShiftPowered;
      if (!hasBonusActionUpgradePowered) {
        if (hasCyberneticsInstalled) {
          throw new Error(
            'Cannot resolve actions because Cybernetics is not powered. ' +
              `Root cause: player "${playerId}" submitted 2 actions for crew "${crewId}", but Cybernetics was not powered at the start of resolving "${actionType}" actions. ` +
              'Fix: Ensure Cybernetics has enough stored power and the Med Lab is powered before taking the bonus action.'
          );
        }
        if (hasTemporalShiftInstalled) {
          throw new Error(
            'Cannot resolve actions because Temporal Shift is not powered. ' +
              `Root cause: player "${playerId}" submitted 2 actions for crew "${crewId}", but Temporal Shift was not powered at the start of resolving "${actionType}" actions. ` +
              'Fix: Ensure Temporal Shift has enough stored power and the Sci Lab is powered before taking the bonus action.'
          );
        }

        throw new Error(
          'Cannot resolve actions because no bonus-action upgrade is installed. ' +
            `Root cause: player "${playerId}" submitted 2 actions for crew "${crewId}" while resolving "${actionType}" actions. ` +
            'Fix: Install and power Cybernetics or Temporal Shift to allow one crew member to take a second action, or remove the extra action.'
        );
      }

      candidateBonusCrewId = crewId;
    }

    for (const [crewId, batchCount] of batchCountsByCrewId.entries()) {
      const previousCount = resolvedCounts.get(crewId) ?? 0;
      resolvedCounts.set(crewId, previousCount + batchCount);
    }

    resolvedActionCountsByPlayerId.set(playerId, resolvedCounts);
    cyberneticsBonusCrewIdByPlayerId.set(playerId, candidateBonusCrewId);
  }
}

/**
 * Resolve all actions of a specific type
 * Purpose: Process a batch of same-type actions simultaneously
 * Parameters:
 *   - game: Current game state
 *   - actionType: Type of actions being resolved
 *   - actions: Array of player actions to resolve
 * Returns: New GameState with actions applied
 * Side effects: None (pure function)
 *
 * This function dispatches to type-specific resolvers.
 * Each resolver is responsible for validating prerequisites and applying effects.
 */
function resolveActionsOfType(
  game: GameState,
  actionType: PlayerActionType,
  actions: Array<{ playerId: string; action: PlayerAction }>,
): GameState {
  switch (actionType) {
    case 'revive':
      return resolveReviveActions(game, actions);
    case 'repair':
      return resolveRepairActions(game, actions);
    case 'restore':
      return resolveRestoreActions(game, actions);
    case 'route':
      return resolveRouteActions(game, actions);
    case 'maneuver':
      return resolveManeuverActions(game, actions);
    case 'scan':
      return resolveScanActions(game, actions);
    case 'acquire':
      return resolveAcquireActions(game, actions);
    case 'attack':
      return resolveAttackActions(game, actions);
    case 'launch':
      return resolveLaunchActions(game, actions);
    case 'retaliate':
      return resolveRetaliateActions(game, actions);
    case 'assemble':
      return resolveAssembleActions(game, actions);
    case 'integrate':
      return resolveIntegrateActions(game, actions);
    default:
      throw new Error(
        'Cannot resolve actions because action type is unknown. ' +
        `Root cause: actionType "${actionType}" is not handled by resolveActionsOfType. ` +
        'Fix: Add a case for this action type in the switch statement.'
      );
  }
}

// === ACTION RESOLVER STUBS ===
// Each resolver will be fully implemented in subsequent phases.
// For now, they validate basic prerequisites and return the game unchanged.

type ActionBatch = Array<{ playerId: string; action: PlayerAction }>;

function spendPowerInSection(ship: Ship, section: ShipSection, amount: number): Ship {
  if (amount <= 0) {
    return ship;
  }

  const sectionState = ship.sections[section];
  if (!sectionState) {
    throw new Error(
      'Cannot spend power because section does not exist on ship. ' +
        `Root cause: no section found for "${section}" in ship.sections. ` +
        'Fix: Ensure all SHIP_SECTIONS are initialized in the Ship.'
    );
  }

  const available = sectionState.powerDice.reduce((sum, die) => sum + die, 0);
  if (available < amount) {
    throw new Error(
      'Cannot spend power because section does not have enough power. ' +
        `Root cause: requested ${amount} power but section "${section}" has only ${available}. ` +
        'Fix: Restore or route more power to the section before spending it.'
    );
  }

  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const state = ship.sections[sectionKey];
    sections[sectionKey] = {
      hull: state.hull,
      powerDice: [...state.powerDice],
      corridors: { ...state.corridors },
      conduitConnections: { ...state.conduitConnections },
    };
  }

  let remaining = amount;
  const dice = sections[section].powerDice;
  for (let i = dice.length - 1; i >= 0 && remaining > 0; i--) {
    const removal = Math.min(dice[i], remaining);
    dice[i] -= removal;
    remaining -= removal;
    if (dice[i] === 0) {
      dice.splice(i, 1);
    }
  }

  if (remaining > 0) {
    throw new Error(
      'Cannot spend power because power removal underflowed. ' +
        `Root cause: ${remaining} power remained after removal loop for section "${section}". ` +
        'Fix: Ensure spendPowerInSection is only called after validating available power.'
    );
  }

  return {
    ...ship,
    sections,
  };
}

function requireCrewLocationForAction(
  crew: AnyCrew | Captain,
  actionType: PlayerActionType,
  crewId: string,
): ShipSection {
  const rawLocation = (crew as { location?: unknown }).location;

  if (rawLocation === null || rawLocation === undefined) {
    throw new Error(
      `Cannot resolve ${actionType} action because crew member has no location. ` +
        `Root cause: crew "${crewId}" has location "${String(rawLocation)}". ` +
        'Fix: Ensure crew.location is set to a valid ship section before performing actions.'
    );
  }

  if (typeof rawLocation !== 'string') {
    throw new Error(
      `Cannot resolve ${actionType} action because crew member location is not a string. ` +
        `Root cause: crew "${crewId}" has location of type "${typeof rawLocation}" with value "${String(rawLocation)}". ` +
        'Fix: Ensure crew.location is a valid ShipSection string from SHIP_SECTIONS.'
    );
  }

  const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
  if (!validSections.has(rawLocation as ShipSection)) {
    throw new Error(
      `Cannot resolve ${actionType} action because crew member location is not a valid ShipSection. ` +
        `Root cause: crew "${crewId}" has location "${rawLocation}". ` +
        'Fix: Ensure crew.location is set to one of the SHIP_SECTIONS values.'
    );
  }

  return rawLocation as ShipSection;
}

function requireActingSectionPoweredAndIntact(
  ship: Ship,
  actingSection: ShipSection,
  actionType: PlayerActionType,
  crewId: string,
): void {
  const sectionState = ship.sections[actingSection];

  if (!sectionState) {
    throw new Error(
      `Cannot resolve ${actionType} action because acting section state was not found. ` +
        `Root cause: ship.sections has no entry for section "${actingSection}" (crew "${crewId}"). ` +
        'Fix: Ensure all ship sections are initialized in ship.sections.'
    );
  }

  if (sectionState.hull <= 0) {
    throw new Error(
      `Cannot resolve ${actionType} action because acting section is damaged (hull is zero). ` +
        `Root cause: crew "${crewId}" is in section "${actingSection}" with hull=${sectionState.hull}. ` +
        'Fix: Repair hull to at least 1 before performing actions in this section.'
    );
  }

  const availablePower = sectionState.powerDice.reduce((sum, die) => sum + die, 0);

  if (availablePower <= 0) {
    throw new Error(
      `Cannot resolve ${actionType} action because acting section has no power. ` +
        `Root cause: crew "${crewId}" is in section "${actingSection}" with 0 total power. ` +
        'Fix: Restore or route power to the acting section before performing this action.'
    );
  }
}

// Restore_Power: Engine source-of-truth for which sections/roles are allowed to generate restore power.
function requireRestoreAllowedForCrew(
  ship: Ship,
  crew: AnyCrew | Captain,
  actingSection: ShipSection,
  crewId: string,
): void {
  if (actingSection === SHIP_SECTIONS.ENGINEERING) {
    return;
  }

  const engineeringFunctional = ShipUtils.isFunctional(ship, SHIP_SECTIONS.ENGINEERING);
  const engineeringFullyPowered = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.ENGINEERING);

  const isBridgeOrSciLab =
    actingSection === SHIP_SECTIONS.BRIDGE || actingSection === SHIP_SECTIONS.SCI_LAB;
  const isDefense = actingSection === SHIP_SECTIONS.DEFENSE;

  const canRestoreFromHere = (() => {
    if (crew.type === 'basic') {
      if (crew.role === 'scientist') {
        return isBridgeOrSciLab && engineeringFunctional && engineeringFullyPowered;
      }
      if (crew.role === 'tactician') {
        return isDefense && engineeringFullyPowered;
      }
      return false;
    }

    if (crew.type === 'officer') {
      if (crew.role === 'senior_scientist') {
        return isBridgeOrSciLab && engineeringFunctional;
      }
      if (crew.role === 'master_tactician') {
        return isDefense && engineeringFunctional;
      }
      return false;
    }

    // Captain inherits the same section exceptions as basic Scientist / basic Tactician.
    return (
      (isBridgeOrSciLab && engineeringFunctional && engineeringFullyPowered) ||
      (isDefense && engineeringFullyPowered)
    );
  })();

  if (!canRestoreFromHere) {
    throw new Error(
      'Cannot resolve restore action because crew is not in a section that can generate power. ' +
        `Root cause: crew "${crewId}" (type="${crew.type}"` +
        (crew.type !== 'captain' ? `, role="${(crew as any).role}"` : '') +
        `) is in section "${actingSection}", and Engineering functional=${engineeringFunctional}, fullyPowered=${engineeringFullyPowered}. ` +
        'Fix: Move the crew to Engineering, or use a Scientist/Tactician (or applicable officer) in their allowed section with the required Engineering state.'
    );
  }
}

/**
 * Resolve revive actions
 * Purpose: Process crew revival attempts
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of revive actions to process
 * Returns: New GameState with revival progress updated
 * Side effects: None (pure function)
 *
 * Revive rules (from rulebook):
 * - Fixed roll value (no d6 randomness), accumulate toward 12 points to revive
 * - Powered Med Lab: +2 to roll
 * - Medic: +1, Doctor: +2
 * - Med-Kit resource: +2
 * - If result >= 8: crew can act same turn
 * - Target crew specified in action.target.crewId (in parameters)
 * - rollValue is not provided in action.parameters (engine computes a fixed value)
 */
function resolveReviveActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  // Process each revive action
  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer = player;

    // Find the crew member performing the action
    const performingCrew = findCrewById(workingPlayer, action.crewId);

    if (!performingCrew) {
      throw new Error(
        'Cannot resolve revive action because performing crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (performingCrew.status !== 'active') {
      throw new Error(
        'Cannot resolve revive action because performing crew member is not active. ' +
        `Root cause: crew "${action.crewId}" has status "${performingCrew.status}". ` +
        'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(performingCrew, 'revive', action.crewId);
    requireActingSectionPoweredAndIntact(player.ship, actingSection, 'revive', action.crewId);

    if (actingSection !== SHIP_SECTIONS.MED_LAB) {
      throw new Error(
        'Cannot resolve revive action because crew is not in Medical Lab. ' +
          `Root cause: crew "${action.crewId}" is in section "${String(actingSection)}" but must be in "${SHIP_SECTIONS.MED_LAB}" to revive. ` +
          'Fix: Move the performing crew member to Medical Lab before attempting to revive.'
      );
    }

    if (!ShipUtils.isFunctional(player.ship, SHIP_SECTIONS.MED_LAB)) {
      throw new Error(
        'Cannot resolve revive action because Medical Lab is not functional. ' +
          `Root cause: Medical Lab hull=${player.ship.sections[SHIP_SECTIONS.MED_LAB]?.hull ?? 0}, power=${player.ship.sections[SHIP_SECTIONS.MED_LAB]?.powerDice?.reduce((sum, die) => sum + die, 0) ?? 0}. ` +
          'Fix: Repair Medical Lab hull and restore/route power to it before reviving.'
      );
    }

    // Section_Bonus: Med Lab fully-powered revive bonus; UI preview must mirror this +2.(source)
    const medLabFullyPoweredAtStart = ShipUtils.isFullyPowered(player.ship, SHIP_SECTIONS.MED_LAB);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, performingCrew, actingSection);
    workingPlayer = stimResult.player;

    const workingShip = spendPowerInSection(workingPlayer.ship, actingSection, 1);

    // Get target crew to revive from parameters
    const targetCrewId = action.parameters?.targetCrewId as string | undefined;

    if (!targetCrewId) {
      throw new Error(
        'Cannot resolve revive action because target crew is not specified. ' +
        `Root cause: action.parameters.targetCrewId is undefined for player "${playerId}". ` +
        'Fix: Specify which unconscious crew member to revive.'
      );
    }

    const baseRollValue = getFixedReviveRollValue(performingCrew);
    const rollValue = stimResult.stimmed ? baseRollValue * 2 : baseRollValue;

    const reviveThreshold = workingPlayer.captain.captainType === 'explorer' ? 8 : CREW_CONFIG.REVIVE_THRESHOLD;

    // Calculate revive bonus
    let reviveBonus = 0;

    // Med Lab bonus (+2 if fully powered)
    if (medLabFullyPoweredAtStart) {
      reviveBonus += 2;
    }

    // Crew bonus
    const crewReviveBonus = getReviveBonus(performingCrew);
    reviveBonus += crewReviveBonus;
    if (workingPlayer.captain.captainType === 'technologist' && performingCrew.type === 'basic' && crewReviveBonus > 0) {
      reviveBonus += 1;
    }

    const hasPoweredNanoBotsAtStart = playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'nano_bots');

    // Total revive points this action
    let revivePoints = rollValue + reviveBonus;
    if (hasPoweredNanoBotsAtStart) {
      revivePoints *= 2;
    }

    // Find and update the target crew
    const targetIndex = workingPlayer.crew.findIndex(c => c.id === targetCrewId);
    const isTargetCaptain = workingPlayer.captain.id === targetCrewId;

    if (targetIndex === -1 && !isTargetCaptain) {
      throw new Error(
        'Cannot resolve revive action because target crew not found. ' +
        `Root cause: targetCrewId "${targetCrewId}" not found in player's crew or captain. ` +
        'Fix: Specify a valid crew member ID to revive.'
      );
    }

    let updatedCrew = [...workingPlayer.crew];
    let updatedCaptain = workingPlayer.captain;

    if (isTargetCaptain) {
      if (workingPlayer.captain.status !== 'unconscious') {
        throw new Error(
          'Cannot resolve revive action because target is not unconscious. ' +
          `Root cause: captain has status "${workingPlayer.captain.status}". ` +
          'Fix: Only unconscious crew members can be revived.'
        );
      }

      const newProgress = workingPlayer.captain.reviveProgress + revivePoints;

      if (newProgress >= reviveThreshold) {
        // Revived! If >= 8, can act this turn (status stays active)
        updatedCaptain = {
          ...workingPlayer.captain,
          status: 'active',
          reviveProgress: 0,
          location: SHIP_SECTIONS.BRIDGE, // Captain returns to bridge
        };
      } else {
        // Still reviving
        updatedCaptain = {
          ...workingPlayer.captain,
          reviveProgress: newProgress,
        };
      }
    } else {
      const targetCrew = workingPlayer.crew[targetIndex];

      if (targetCrew.status !== 'unconscious') {
        throw new Error(
          'Cannot resolve revive action because target is not unconscious. ' +
          `Root cause: crew "${targetCrewId}" has status "${targetCrew.status}". ` +
          'Fix: Only unconscious crew members can be revived.'
        );
      }

      const newProgress = targetCrew.reviveProgress + revivePoints;

      if (newProgress >= reviveThreshold) {
        // Revived!
        updatedCrew[targetIndex] = {
          ...targetCrew,
          status: 'active',
          reviveProgress: 0,
          location: SHIP_SECTIONS.BRIDGE, // Default location after revival
        };
      } else {
        // Still reviving
        updatedCrew[targetIndex] = {
          ...targetCrew,
          reviveProgress: newProgress,
        };
      }
    }

    const updatedPlayer: PlayerState = {
      ...workingPlayer,
      ship: workingShip,
      crew: updatedCrew,
      captain: updatedCaptain,
    };

    updatedPlayers.set(playerId, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

// Crew_Bonus: Source of truth for revive bonus values; ShipDashboard getCrewReviveBonusForPreview must mirror this.
/**
 * Get revive bonus for a crew member
 * Purpose: Calculate crew-specific revive bonuses
 * Parameters:
 *   - crew: Crew member performing revive action
 * Returns: Revive bonus (0 for no bonus, up to +2 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Medic: +1
 * - Doctor: +2
 */
function getReviveBonus(crew: AnyCrew | Captain): number {
  if (crew.type !== 'basic' && crew.type !== 'officer' && crew.type !== 'captain') {
    const rawId = (crew as unknown as { id?: unknown }).id;
    const rawType = (crew as { type?: unknown }).type;
    const rawRole = (crew as { role?: unknown }).role;
    throw new Error(
      'Cannot calculate revive bonus because crew.type is invalid or missing. ' +
        `Root cause: crew "${String(rawId)}" has type "${String(rawType)}" and role "${String(rawRole)}". ` +
        'Fix: Ensure crew objects include a valid discriminant type ("basic", "officer", or "captain") and a valid role string.'
    );
  }

  if (crew.type === 'captain') {
    const captainBonuses = CrewUtils.getBonuses(crew as Captain);
    const reviveBonus = captainBonuses.reviveBonus ?? 0;
    if (typeof reviveBonus !== 'number' || !Number.isFinite(reviveBonus)) {
      throw new Error(
        'Cannot calculate revive bonus because captain bonuses returned a non-numeric value. ' +
          `Root cause: reviveBonus is "${String(reviveBonus)}" for captain "${crew.id}". ` +
          'Fix: Ensure CrewUtils.getBonuses returns a finite number for reviveBonus when defined.'
      );
    }
    return reviveBonus;
  }

  const rawRole = (crew as { role?: unknown }).role;
  if (typeof rawRole !== 'string') {
    throw new Error(
      'Cannot calculate revive bonus because crew.role is missing or invalid. ' +
        `Root cause: crew "${crew.id}" has role "${String(rawRole)}". ` +
        'Fix: Ensure crew.role is set to a valid BasicCrewType or OfficerType string.'
    );
  }

  if (crew.type === 'officer') {
    const rawStimPacksUsed = (crew as { stimPacksUsed?: unknown }).stimPacksUsed;
    if (typeof rawStimPacksUsed !== 'number' || !Number.isFinite(rawStimPacksUsed) || rawStimPacksUsed < 0) {
      throw new Error(
        'Cannot calculate revive bonus because officer.stimPacksUsed is missing or invalid. ' +
          `Root cause: crew "${crew.id}" has stimPacksUsed "${String(rawStimPacksUsed)}". ` +
          'Fix: Ensure officer crew objects include a non-negative number stimPacksUsed field.'
      );
    }
  }

  const bonuses = CrewUtils.getBonuses(crew as AnyCrew);
  const reviveBonus = bonuses.reviveBonus;
  if (reviveBonus === undefined) {
    return 0;
  }

  if (typeof reviveBonus !== 'number' || !Number.isFinite(reviveBonus)) {
    throw new Error(
      'Cannot calculate revive bonus because CrewUtils returned a non-numeric reviveBonus. ' +
        `Root cause: reviveBonus is "${String(reviveBonus)}" for crew "${crew.id}". ` +
        'Fix: Ensure CrewUtils.getBonuses returns a finite number for reviveBonus when defined.'
    );
  }

  return reviveBonus;
}

/**
 * Resolve repair actions
 * Purpose: Process hull, conduit, and corridor repairs
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of repair actions to process
 * Returns: New GameState with repairs applied
 * Side effects: None (pure function)
 *
 * Repair rules (from rulebook):
 * - Must be adjacent to damaged section (or in it for hull repair)
 * - Restore 1 hull, 1 conduit, or 1 corridor per action
 * - Engineer: 2x repairs for cost of 1
 * - Chief Engineer/Android: 3x repairs for cost of 1
 * - Consumes 1 power from adjacent section
 * - Target section specified in action.target.section
 * - Repair type specified in action.parameters.repairType: 'hull' | 'conduit' | 'corridor'
 */
function resolveRepairActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  const droidStationAssignments = new Map<string, PlayerAction>();

  const actionsByPlayer = new Map<string, PlayerAction[]>();
  for (const entry of actions) {
    if (!actionsByPlayer.has(entry.playerId)) {
      actionsByPlayer.set(entry.playerId, []);
    }
    actionsByPlayer.get(entry.playerId)?.push(entry.action);
  }

  for (const [playerId, playerActions] of actionsByPlayer.entries()) {
    const actingPlayer = updatedPlayers.get(playerId);

    if (!actingPlayer || actingPlayer.status !== 'active') {
      continue;
    }

    if (!playerHasPoweredUpgrade(actingPlayer, actingPlayer.ship, 'droid_station')) {
      continue;
    }

    const enabledActions = playerActions.filter((action) => {
      const params = action.parameters as Record<string, unknown> | undefined;
      return params?.useDroidStation === true;
    });

    if (enabledActions.length > 1) {
      throw new Error(
        'Cannot resolve repair actions because Droid Station was enabled more than once. ' +
          `Root cause: player "${playerId}" attempted to apply Droid Station to ${enabledActions.length} repairs this turn. ` +
          'Fix: Enable Droid Station on only one repair action per turn.',
      );
    }

    if (enabledActions.length === 1) {
      droidStationAssignments.set(playerId, enabledActions[0]);
      continue;
    }

    if (playerActions.length === 1) {
      droidStationAssignments.set(playerId, playerActions[0]);
    }
  }

  // Process each repair action
  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve repair action because crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve repair action because crew member is not active. ' +
        `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
        'Fix: Only active crew members can perform actions.'
      );
    }

    const isChiefEngineer = crew.type === 'officer' && (crew as { role: string }).role === 'chief_engineer';

    // Get target section from action
    const targetSection = action.target?.section as ShipSection | undefined;

    if (!targetSection) {
      throw new Error(
        'Cannot resolve repair action because target section is not specified. ' +
        `Root cause: action.target.section is undefined for player "${playerId}". ` +
        'Fix: Specify which section to repair in action.target.section.'
      );
    }

    // Get repair type from parameters
    const repairType = (action.parameters?.repairType as string) ?? 'hull';

    const fromSection = requireCrewLocationForAction(crew, 'repair', action.crewId);

    const ship = workingPlayer.ship;
    const fromState = ship.sections[fromSection];
    const targetState = ship.sections[targetSection];

    const isUsingExplorerRepairKit =
      workingPlayer.captain.captainType === 'explorer' &&
      !!workingPlayer.explorerRepairKit &&
      workingPlayer.explorerRepairKit.used === false &&
      workingPlayer.explorerRepairKit.section === targetSection;

    if (!fromState || !targetState) {
      throw new Error(
        'Cannot resolve repair action because section state not found. ' +
          `Root cause: fromState or targetState is undefined for sections "${fromSection}" and "${targetSection}". ` +
          'Fix: Ensure all ship sections are properly initialized.'
      );
    }

    if (fromState.hull <= 0) {
      throw new Error(
        'Cannot resolve repair action because acting section is damaged (hull is zero). ' +
          `Root cause: crew "${action.crewId}" is in section "${fromSection}" with hull=${fromState.hull}. ` +
          'Fix: Repair hull to at least 1 before performing actions in this section.'
      );
    }

    if (!isChiefEngineer) {
      requireActingSectionPoweredAndIntact(ship, fromSection, 'repair', action.crewId);
    }

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, fromSection);
    workingPlayer = stimResult.player;

    const layoutA = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[fromSection];
    const layoutB = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[targetSection];
    const hasConduitEdge =
      (layoutA?.conduitConnections?.[targetSection] ?? 0) > 0 ||
      (layoutB?.conduitConnections?.[fromSection] ?? 0) > 0;
    const hasCorridorEdge =
      layoutA?.corridors?.[targetSection] === 1 ||
      layoutB?.corridors?.[fromSection] === 1;
    const hasAnyEdge = hasConduitEdge || hasCorridorEdge;

    if (fromSection !== targetSection && !hasAnyEdge) {
      const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
      const adjacentToFrom = sectionKeys
        .filter((other) => other !== fromSection)
        .filter((other) => {
          const otherLayout = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[other];
          const conduit =
            (layoutA?.conduitConnections?.[other] ?? 0) > 0 ||
            (otherLayout?.conduitConnections?.[fromSection] ?? 0) > 0;
          const corridor =
            layoutA?.corridors?.[other] === 1 ||
            otherLayout?.corridors?.[fromSection] === 1;
          return conduit || corridor;
        });

      throw new Error(
        'Cannot resolve repair action because target section is not adjacent by ship layout. ' +
          `Root cause: player "${playerId}" attempted repair with crew "${action.crewId}". ` +
          `Root cause: no corridor or conduit edge exists between "${fromSection}" and "${targetSection}". ` +
          `Adjacent sections to "${fromSection}" are: ${adjacentToFrom.length ? adjacentToFrom.join(', ') : '(none)'}. ` +
          'Fix: Choose an adjacent target section or move crew to an adjacent section.'
      );
    }

    if (repairType === 'conduit' && fromSection !== targetSection && !hasConduitEdge) {
      throw new Error(
        'Cannot resolve conduit repair because no conduit connection exists on this edge. ' +
          `Root cause: no conduit edge exists between "${fromSection}" and "${targetSection}" in SHIP_CONNECTION_LAYOUT. ` +
          'Fix: Choose a target section connected by conduits from the crew location.'
      );
    }

    if (repairType === 'corridor' && fromSection !== targetSection && !hasCorridorEdge) {
      throw new Error(
        'Cannot resolve corridor repair because no corridor exists on this edge. ' +
          `Root cause: no corridor edge exists between "${fromSection}" and "${targetSection}" in SHIP_CONNECTION_LAYOUT. ` +
          'Fix: Choose a target section connected by a corridor from the crew location.'
      );
    }

    if (!isUsingExplorerRepairKit && (repairType === 'conduit' || repairType === 'corridor') && targetState.hull <= 0) {
      throw new Error(
        'Cannot resolve repair action because target section is damaged (hull is zero). ' +
          `Root cause: target section "${targetSection}" has hull=${targetState.hull}. ` +
          'Fix: Repair hull to at least 1 before restoring conduits or corridors.'
      );
    }

    if (!isChiefEngineer) {
      const availablePower = fromState.powerDice.reduce((sum, die) => sum + die, 0);
      if (availablePower <= 0) {
        throw new Error(
          'Cannot resolve repair action because there is no available power in the acting section. ' +
            `Root cause: section "${fromSection}" has 0 total power. ` +
            'Fix: Restore or route power to the acting section before repairing.'
        );
      }
    }

    let workingShip = workingPlayer.ship;
    if (!isChiefEngineer) {
      workingShip = spendPowerInSection(workingShip, fromSection, 1);
    }

    const updatedShip = (() => {
      if (!isUsingExplorerRepairKit) {
        // Calculate repair multiplier based on crew
        let repairMultiplier = getRepairMultiplier(crew);
        if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && repairMultiplier > 1) {
          repairMultiplier += 1;
        }
        if (stimResult.stimmed) {
          repairMultiplier *= 2;
        }

        const repairDroidsPoweredAtStart = playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'repair_droids');
        if (fromSection === SHIP_SECTIONS.ENGINEERING && repairDroidsPoweredAtStart) {
          repairMultiplier *= 2;
        }

        const assignedDroidStationAction = droidStationAssignments.get(playerId);
        const requestedDroidStation = ((action.parameters as Record<string, unknown> | undefined)?.useDroidStation) === true;
        const hasDroidStationInstalled = playerHasInstalledUpgrade(workingPlayer, 'droid_station');
        const isDroidStationPoweredAtStart = hasDroidStationInstalled
          ? playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'droid_station')
          : false;
        const shouldApplyDroidStation = isDroidStationPoweredAtStart && assignedDroidStationAction === action;

        if (requestedDroidStation && !hasDroidStationInstalled) {
          throw new Error(
            'Cannot resolve repair action because Droid Station is not installed. ' +
              `Root cause: player "${playerId}" attempted to enable Droid Station without the upgrade. ` +
              'Fix: Install Droid Station in the Med Lab before enabling it on repairs.',
          );
        }

        if (requestedDroidStation && hasDroidStationInstalled && !isDroidStationPoweredAtStart) {
          throw new Error(
            'Cannot resolve repair action because Droid Station is not powered. ' +
              `Root cause: player "${playerId}" attempted to enable Droid Station but Med Lab does not have enough power. ` +
              'Fix: Route or restore power to Med Lab until it meets the upgrade power requirement.',
          );
        }

        if (requestedDroidStation && assignedDroidStationAction !== action) {
          throw new Error(
            'Cannot resolve repair action because Droid Station has already been used this turn. ' +
              `Root cause: player "${playerId}" attempted to enable it for multiple repairs. ` +
              'Fix: Enable Droid Station on only one repair action per turn.',
          );
        }

        if (shouldApplyDroidStation) {
          repairMultiplier *= 2;
        }

        return applyRepairs(
          workingShip,
          targetSection,
          repairType,
          repairMultiplier,
          fromSection,
        );
      }

      // Explorer captain special repair kit:
      // One repair action restores 2 hull, 1 conduit, and 1 corridor on the kit section.
      let repaired = workingShip;
      const stimMultiplier = stimResult.stimmed ? 2 : 1;
      repaired = applyRepairs(repaired, targetSection, 'hull', 2 * stimMultiplier, fromSection);
      repaired = applyRepairs(repaired, targetSection, 'conduit', 1 * stimMultiplier, fromSection);
      repaired = applyRepairs(repaired, targetSection, 'corridor', 1 * stimMultiplier, fromSection);
      return repaired;
    })();

    const updatedPlayer: PlayerState = {
      ...workingPlayer,
      ship: updatedShip,
      explorerRepairKit: isUsingExplorerRepairKit
        ? {
            section: workingPlayer.explorerRepairKit?.section ?? null,
            used: true,
          }
        : workingPlayer.explorerRepairKit,
    };

    updatedPlayers.set(playerId, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

// Crew_Bonus: Source of truth for repair multiplier values; UI preview helper must stay aligned.
/**
 * Get repair multiplier for a crew member
 * Purpose: Calculate how many repairs a crew can do per action
 * Parameters:
 *   - crew: Crew member performing repair action
 * Returns: Repair multiplier (1 for normal, 2 for Engineer, 3 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Engineer: 2x repairs
 * - Chief Engineer: 3x repairs
 * - Android: 3x repairs
 */
function getRepairMultiplier(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'engineer') {
      return 2;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'chief_engineer' || officer.role === 'android') {
      return 3;
    }
    if (officer.role === 'first_officer') {
      return 2;
    }
  }

  if (crew.type === 'captain') {
    return 2;
  }

  return 1;
}

/**
 * Apply repairs to a ship section
 * Purpose: Restore hull, conduits, or corridors
 * Parameters:
 *   - ship: Current ship state
 *   - section: Section to repair
 *   - repairType: Type of repair ('hull', 'conduit', 'corridor')
 *   - multiplier: Number of repair points to apply
 * Returns: New Ship state with repairs applied
 * Side effects: None (pure function)
 */
function applyRepairs(
  ship: Ship,
  section: ShipSection,
  repairType: string,
  multiplier: number,
  fromSection: ShipSection | null,
): Ship {
  const sectionState = ship.sections[section];

  if (!sectionState) {
    throw new Error(
      'Cannot apply repairs because section does not exist on ship. ' +
      `Root cause: no section found for "${section}" in ship.sections. ` +
      'Fix: Ensure target section is a valid SHIP_SECTIONS value.'
    );
  }

  // Clone all sections
  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const state = ship.sections[sectionKey];
    sections[sectionKey] = {
      hull: state.hull,
      powerDice: [...state.powerDice],
      corridors: { ...state.corridors },
      conduitConnections: { ...state.conduitConnections },
    };
  }

  const targetState = sections[section];
  const maxHull = SECTION_CONFIG[section]?.maxHull ?? 12;

  const getAdjacentSections = (seed: ShipSection): ShipSection[] => {
    const neighbors: ShipSection[] = [];
    const aInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[seed];
    for (const other of sectionKeys) {
      if (other === seed) {
        continue;
      }
      const bInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[other];
      const hasConduit =
        (aInitial?.conduitConnections?.[other] ?? 0) > 0 || (bInitial?.conduitConnections?.[seed] ?? 0) > 0;
      const hasCorridor = aInitial?.corridors?.[other] === 1 || bInitial?.corridors?.[seed] === 1;
      if (hasConduit || hasCorridor) {
        neighbors.push(other);
      }
    }
    return neighbors;
  };

  const applyOverflowHullRepairs = (seed: ShipSection, amount: number): number => {
    let remaining = amount;
    const visited = new Set<ShipSection>();
    const queue: ShipSection[] = [];

    visited.add(seed);
    for (const neighbor of getAdjacentSections(seed)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    while (queue.length > 0 && remaining > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const currentState = sections[current];
      const currentMaxHull = SECTION_CONFIG[current]?.maxHull ?? 12;
      const capacity = Math.max(0, currentMaxHull - currentState.hull);
      if (capacity > 0) {
        const applied = Math.min(remaining, capacity);
        currentState.hull += applied;
        remaining -= applied;
      }

      for (const neighbor of getAdjacentSections(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return remaining;
  };

  switch (repairType) {
    case 'hull':
      {
        let remaining = multiplier;
        const capacity = Math.max(0, maxHull - targetState.hull);
        if (capacity > 0) {
          const applied = Math.min(remaining, capacity);
          targetState.hull += applied;
          remaining -= applied;
        }

        if (remaining > 0) {
          remaining = applyOverflowHullRepairs(section, remaining);
        }
      }
      break;

    case 'conduit':
      {
        const getInitialMaxEdgeConduits = (a: ShipSection, b: ShipSection): number => {
          const aInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[a];
          const bInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[b];
          const maxAtoB = aInitial?.conduitConnections?.[b];
          const maxBtoA = bInitial?.conduitConnections?.[a];
          return Math.max(typeof maxAtoB === 'number' ? maxAtoB : 0, typeof maxBtoA === 'number' ? maxBtoA : 0);
        };

        const repairEdge = (a: ShipSection, b: ShipSection, amount: number): number => {
          const max = getInitialMaxEdgeConduits(a, b);
          if (max <= 0) {
            return amount;
          }

          const aToB = sections[a].conduitConnections[b] ?? 0;
          const bToA = sections[b].conduitConnections[a] ?? 0;
          const current = Math.min(aToB, bToA);
          if (current >= max) {
            return amount;
          }

          const delta = Math.min(amount, max - current);
          sections[a].conduitConnections[b] = Math.min(max, aToB + delta);
          sections[b].conduitConnections[a] = Math.min(max, bToA + delta);
          return amount - delta;
        };

        let remaining = multiplier;

        if (fromSection && fromSection !== section) {
          remaining = repairEdge(fromSection, section, remaining);
        }

        const visited = new Set<ShipSection>();
        const queue: ShipSection[] = [section];
        visited.add(section);

        while (queue.length > 0 && remaining > 0) {
          const current = queue.shift();
          if (!current) {
            break;
          }

          for (const otherSection of sectionKeys) {
            if (remaining <= 0) {
              break;
            }
            if (otherSection === current) {
              continue;
            }
            remaining = repairEdge(current, otherSection, remaining);
          }

          for (const neighbor of getAdjacentSections(current)) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        if (remaining > 0) {
          const selfCapacity = Math.max(0, maxHull - targetState.hull);
          if (selfCapacity > 0) {
            const applied = Math.min(remaining, selfCapacity);
            targetState.hull += applied;
            remaining -= applied;
          }
        }

        if (remaining > 0) {
          remaining = applyOverflowHullRepairs(section, remaining);
        }
      }
      break;

    case 'corridor':
      {
        const getInitialHasEdgeCorridor = (a: ShipSection, b: ShipSection): boolean => {
          const aInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[a];
          const bInitial = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[b];
          const aToB = aInitial?.corridors?.[b];
          const bToA = bInitial?.corridors?.[a];
          return aToB === 1 || bToA === 1;
        };

        const repairCorridorEdge = (a: ShipSection, b: ShipSection, amount: number): number => {
          const hasEdge = getInitialHasEdgeCorridor(a, b);
          if (!hasEdge) {
            return amount;
          }

          const aToB = sections[a].corridors[b] ?? 0;
          const bToA = sections[b].corridors[a] ?? 0;
          if (aToB === 0 || bToA === 0) {
            if (amount <= 0) {
              return amount;
            }
            sections[a].corridors[b] = 1;
            sections[b].corridors[a] = 1;
            return amount - 1;
          }

          return amount;
        };

        let remaining = multiplier;

        if (fromSection && fromSection !== section && remaining > 0) {
          remaining = repairCorridorEdge(fromSection, section, remaining);
        }

        const visited = new Set<ShipSection>();
        const queue: ShipSection[] = [section];
        visited.add(section);

        while (queue.length > 0 && remaining > 0) {
          const current = queue.shift();
          if (!current) {
            break;
          }

          for (const otherSection of sectionKeys) {
            if (remaining <= 0) {
              break;
            }
            if (otherSection === current) {
              continue;
            }
            remaining = repairCorridorEdge(current, otherSection, remaining);
          }

          for (const neighbor of getAdjacentSections(current)) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        if (remaining > 0) {
          const selfCapacity = Math.max(0, maxHull - targetState.hull);
          if (selfCapacity > 0) {
            const applied = Math.min(remaining, selfCapacity);
            targetState.hull += applied;
            remaining -= applied;
          }
        }

        if (remaining > 0) {
          remaining = applyOverflowHullRepairs(section, remaining);
        }
      }
      break;

    default:
      throw new Error(
        'Cannot apply repairs because repair type is unknown. ' +
        `Root cause: repairType "${repairType}" is not one of: hull, conduit, corridor. ` +
        'Fix: Set action.parameters.repairType to a valid repair type.'
      );
  }

  return {
    ...ship,
    sections,
  };
}

/**
 * Resolve restore actions
 * Purpose: Process power restoration and routing
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of restore actions to process
 * Returns: New GameState with power added to ships
 * Side effects: None (pure function)
 *
 * Restore rules (from rulebook):
 * - Must be in Engineering (or special crew locations)
 * - Base: +1 power in Engineering
 * - If Engineering fully powered: +3 power total
 * - Engineer/Chief Engineer: +1/+2 power
 * - Tactician: +1 shield when restoring from Defense
 * - Power routing not implemented yet (future: respect conduit limits)
 */
// Restore_Power: Core computation that combines eligibility, base generation, bonuses, routing, and transfers.
function resolveRestoreActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const LIFE_SUPPORT_ROUTE_KEY = 'life_support';

  const updatedPlayers = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

  const restoreActionsByPlayerId = new Map<string, PlayerAction[]>();
  for (const { playerId, action } of actions) {
    const existing = restoreActionsByPlayerId.get(playerId);
    if (existing) {
      existing.push(action);
    } else {
      restoreActionsByPlayerId.set(playerId, [action]);
    }
  }

  for (const [playerId, restoreActions] of restoreActionsByPlayerId.entries()) {
    const player = updatedPlayers.get(playerId);
    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer = player;
    let workingShip = player.ship;
    const edgeLoad = new Map<string, { a: ShipSection; b: ShipSection; load: number }>();

    for (const action of restoreActions) {
      const crew = findCrewById(workingPlayer, action.crewId);

      if (!crew) {
        throw new Error(
          'Cannot resolve restore action because crew member not found. ' +
            `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
            'Fix: Ensure action.crewId references a valid crew member in the player\'s crew or captain.'
        );
      }

      if (crew.status !== 'active') {
        throw new Error(
          'Cannot resolve restore action because crew member is not active. ' +
            `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
            'Fix: Only active crew members can perform actions.'
        );
      }

      const actingSection = requireCrewLocationForAction(crew, 'restore', action.crewId);
      const actingSectionState = workingShip.sections[actingSection];
      if (!actingSectionState) {
        throw new Error(
          'Cannot resolve restore action because acting section state was not found. ' +
            `Root cause: ship.sections has no entry for section "${actingSection}" (crew "${action.crewId}"). ` +
            'Fix: Ensure all ship sections are initialized in ship.sections.'
        );
      }
      if (actingSectionState.hull <= 0) {
        throw new Error(
          'Cannot resolve restore action because acting section is damaged (hull is zero). ' +
            `Root cause: crew "${action.crewId}" is in section "${actingSection}" with hull=${actingSectionState.hull}. ` +
            'Fix: Repair hull to at least 1 before generating power from this section.'
        );
      }

      let canGeneratePower = true;
      try {
        requireRestoreAllowedForCrew(workingShip, crew, actingSection, action.crewId);
      } catch (err) {
        canGeneratePower = false;
      }

      const rawStimmed = (action.parameters as Record<string, unknown> | undefined)?.stimmed;
      if (!canGeneratePower && rawStimmed === true) {
        throw new Error(
          'Cannot resolve restore action because stim packs only apply to generated power, but the acting crew cannot generate power from their section. ' +
            `Root cause: crew "${action.crewId}" acted from "${actingSection}" with parameters.stimmed=true but powerRestored would be 0. ` +
            'Fix: Remove stimmed from this action, or move the crew to a section that can generate power.'
        );
      }

      const stimResult = consumeStimPackIfRequested({
        ...workingPlayer,
        ship: workingShip,
      }, action, crew, actingSection);
      workingPlayer = stimResult.player;
      workingShip = stimResult.player.ship;

      const rawTransfers = (action.parameters as Record<string, unknown> | undefined)?.transfers;

      let powerRestored = 0;
      let shieldBonus = 0;
      if (canGeneratePower) {
        // Restore_Power: Base=1 + Engineering full + role bonus + Technologist + Coolant + Stim (doubling) + Defense shields.
        powerRestored = 1;
        // Section_Bonus: Engineering fully-powered restore adds +2 base power.(source)
        if (
          actingSection === DEFAULT_POWER_ROUTING_HUB_SECTION &&
          ShipUtils.isFullyPowered(workingShip, DEFAULT_POWER_ROUTING_HUB_SECTION)
        ) {
          powerRestored += 2;
        }

        const crewBonus = getRestorePowerBonus(crew);
        powerRestored += crewBonus;
        if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && crewBonus > 0) {
          powerRestored += 1;
        }

        if (actingSection === SHIP_SECTIONS.ENGINEERING && playerHasPoweredUpgrade(workingPlayer, workingShip, 'coolant')) {
          powerRestored += 1;
        }

        if (stimResult.stimmed) {
          powerRestored *= 2;
        }

        if (actingSection === SHIP_SECTIONS.DEFENSE) {
          shieldBonus = getRestoreShieldBonus(crew);
          if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && shieldBonus > 0) {
            shieldBonus += 1;
          }
        }
      }

      const rawAllocations = action.parameters?.routeAllocations as
        | Array<{ section?: string; amount?: number }>
        | undefined;

      const allocationBySection = new Map<ShipSection, number>();

      if (rawAllocations !== undefined) {
        if (!Array.isArray(rawAllocations)) {
          throw new Error(
            'Cannot resolve restore action because routeAllocations is not an array. ' +
              `Root cause: typeof action.parameters.routeAllocations is "${typeof rawAllocations}". ` +
              'Fix: Provide routeAllocations as an array of { section, amount } objects.'
          );
        }

        for (const entry of rawAllocations) {
          const sectionKey = entry.section as string | undefined;
          const amount = entry.amount as number | undefined;

          if (!sectionKey || !validSections.has(sectionKey as ShipSection)) {
            throw new Error(
              'Cannot resolve restore action because a routed section is invalid. ' +
                `Root cause: routeAllocations contains section "${sectionKey}". ` +
                'Fix: Use a valid ship section key from SHIP_SECTIONS for each route allocation.'
            );
          }

          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
            throw new Error(
              'Cannot resolve restore action because a routed amount is invalid. ' +
                `Root cause: routeAllocations entry for section "${sectionKey}" has amount "${amount}". ` +
                'Fix: Provide a positive numeric amount for each route allocation.'
            );
          }

          const castSection = sectionKey as ShipSection;
          const previous = allocationBySection.get(castSection) ?? 0;
          allocationBySection.set(castSection, previous + amount);
        }
      }

      let totalRequested = 0;
      for (const amount of allocationBySection.values()) {
        totalRequested += amount;
      }

      if (!canGeneratePower && totalRequested > 0) {
        throw new Error(
          'Cannot resolve restore action because routed power was requested but the acting crew cannot generate power from their section. ' +
            `Root cause: crew "${action.crewId}" acted from "${actingSection}" and routeAllocations requested ${totalRequested} power while powerRestored=0. ` +
            'Fix: Remove routeAllocations for this restore action, or move the crew to a section that can generate power.'
        );
      }

      if (totalRequested > powerRestored) {
        throw new Error(
          'Cannot resolve restore action because routed power exceeds power restored. ' +
            `Root cause: routeAllocations request ${totalRequested} power but only ${powerRestored} is available. ` +
            'Fix: Reduce routed amounts so their total does not exceed powerRestored.'
        );
      }

      const actingSectionShare = powerRestored - totalRequested;
      workingShip = addPowerToSection(workingShip, actingSection, actingSectionShare, shieldBonus);

      for (const [section, amount] of allocationBySection.entries()) {
        if (section === actingSection) {
          workingShip = addPowerToSection(workingShip, section, amount);
        } else {
          workingShip = routePowerWithConduitLimits(
            workingShip,
            actingSection,
            section,
            amount,
            edgeLoad,
            true,
          );
        }
      }

      if (rawTransfers !== undefined) {
        if (!Array.isArray(rawTransfers)) {
          throw new Error(
            'Cannot resolve restore action because transfers is not an array. ' +
              `Root cause: typeof action.parameters.transfers is "${typeof rawTransfers}". ` +
              'Fix: Provide transfers as an array of { fromSection, toSection, amount } objects.'
          );
        }

        const upgradeTransferLoadByUpgradeId = new Map<string, number>();

        for (const entry of rawTransfers as Array<Record<string, unknown>>) {
          const fromSectionRaw = entry?.fromSection as string | undefined;
          const toSectionRaw = entry?.toSection as string | undefined;
          const toUpgradeIdRaw = entry?.toUpgradeId as string | undefined;
          const amountRaw = entry?.amount as number | undefined;

          if (!fromSectionRaw || !validSections.has(fromSectionRaw as ShipSection)) {
            throw new Error(
              'Cannot resolve restore action because a transfer source section is invalid. ' +
                `Root cause: transfers contains fromSection "${fromSectionRaw}". ` +
                'Fix: Set fromSection to a valid SHIP_SECTIONS key.'
            );
          }

          if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw) || amountRaw <= 0) {
            throw new Error(
              'Cannot resolve restore action because a transfer amount is invalid. ' +
                `Root cause: transfers entry from "${fromSectionRaw}" to "${toSectionRaw}" has amount "${String(amountRaw)}". ` +
                'Fix: Provide a positive numeric amount for each transfer.'
            );
          }

          const fromSection = fromSectionRaw as ShipSection;
          const amount = amountRaw;

          if (typeof toUpgradeIdRaw === 'string' && toUpgradeIdRaw.length > 0) {
            const previousUpgradeLoad = upgradeTransferLoadByUpgradeId.get(toUpgradeIdRaw) ?? 0;
            if (previousUpgradeLoad + amount > POWER_CONFIG.MAX_POWER_PER_CONDUIT) {
              throw new Error(
                'Cannot resolve restore action because upgrade transfer exceeds max upgrade conduit capacity. ' +
                  `Root cause: transfers entry from "${fromSection}" to upgrade "${toUpgradeIdRaw}" would transfer ${previousUpgradeLoad + amount} this action but max is ${POWER_CONFIG.MAX_POWER_PER_CONDUIT}. ` +
                  'Fix: Reduce the total upgrade transfer amount to 3 or less this action.'
              );
            }

            upgradeTransferLoadByUpgradeId.set(toUpgradeIdRaw, previousUpgradeLoad + amount);

            const targetUpgrade = workingPlayer.installedUpgrades.find((u) => u.id === toUpgradeIdRaw);
            if (!targetUpgrade) {
              throw new Error(
                'Cannot resolve restore action because transfer target upgrade was not found. ' +
                  `Root cause: transfers entry references upgrade "${toUpgradeIdRaw}" but it is not installed. ` +
                  'Fix: Ensure the upgrade is installed before transferring power to it.'
              );
            }

            const upgradeSectionRaw = (targetUpgrade as { section?: unknown }).section;
            if (typeof upgradeSectionRaw !== 'string' || !validSections.has(upgradeSectionRaw as ShipSection)) {
              throw new Error(
                'Cannot resolve restore action because upgrade installation section is missing or invalid. ' +
                  `Root cause: upgrade "${toUpgradeIdRaw}" has section "${String(upgradeSectionRaw)}". ` +
                  'Fix: Ensure installed upgrades store a valid ship section in their section field.'
              );
            }

            const upgradeSection = upgradeSectionRaw as ShipSection;
            const upgradeSectionState = workingShip.sections[upgradeSection];
            if (!upgradeSectionState) {
              throw new Error(
                'Cannot resolve restore action because upgrade installation section state was not found. ' +
                  `Root cause: ship.sections has no entry for section "${upgradeSection}" (upgrade "${toUpgradeIdRaw}"). ` +
                  'Fix: Ensure all ship sections are initialized in ship.sections.'
              );
            }

            if (upgradeSectionState.hull <= 0) {
              throw new Error(
                'Cannot resolve restore action because upgrade installation section is damaged (hull is zero). ' +
                  `Root cause: upgrade "${toUpgradeIdRaw}" is installed in section "${upgradeSection}" with hull=${upgradeSectionState.hull}. ` +
                  'Fix: Repair hull to at least 1 before transferring power to the upgrade.'
              );
            }

            if (fromSection !== upgradeSection) {
              const path = findConduitPath(workingShip, fromSection, upgradeSection);
              if (!path || path.length < 2) {
                throw new Error(
                  'Cannot resolve restore action because no conduit path exists from transfer source to upgrade installation section. ' +
                    `Root cause: transfers entry attempted to charge upgrade "${toUpgradeIdRaw}" (installed in "${upgradeSection}") from "${fromSection}", but no conduit path exists. ` +
                    'Fix: Repair conduit connections, or choose a source section that is connected to the upgrade section.'
                );
              }

              for (let i = 0; i < path.length - 1; i++) {
                const from = path[i];
                const to = path[i + 1];
                const a = from < to ? from : to;
                const b = from < to ? to : from;
                const key = `${a}|${b}`;
                const existing = edgeLoad.get(key);
                if (existing) {
                  existing.load += amount;
                } else {
                  edgeLoad.set(key, { a, b, load: amount });
                }
              }
            }

            const sourceState = workingShip.sections[fromSection];
            if (!sourceState) {
              throw new Error(
                'Cannot resolve restore action because upgrade transfer source section state was not found. ' +
                  `Root cause: ship.sections has no entry for section "${fromSection}". ` +
                  'Fix: Ensure all ship sections are initialized in ship.sections.'
              );
            }

            if (sourceState.hull <= 0) {
              throw new Error(
                'Cannot resolve restore action because upgrade transfer source section is damaged (hull is zero). ' +
                  `Root cause: source section "${fromSection}" has hull=${sourceState.hull}. ` +
                  'Fix: Repair hull to at least 1 before transferring power from the section.'
              );
            }

            workingShip = spendPowerInSection(workingShip, fromSection, amount);

            const powerRequiredRaw = (targetUpgrade as { powerRequired?: unknown }).powerRequired;
            const powerRequired =
              typeof powerRequiredRaw === 'number' &&
              Number.isFinite(powerRequiredRaw) &&
              powerRequiredRaw > 0
                ? powerRequiredRaw
                : null;

            const storedPowerRaw = (targetUpgrade as { storedPower?: unknown }).storedPower;
            const storedPower =
              typeof storedPowerRaw === 'number' && Number.isFinite(storedPowerRaw) && storedPowerRaw > 0
                ? storedPowerRaw
                : 0;

            const nextStored = powerRequired === null
              ? storedPower + amount
              : Math.min(powerRequired, storedPower + amount);

            workingPlayer = {
              ...workingPlayer,
              installedUpgrades: workingPlayer.installedUpgrades.map((u) =>
                u.id === toUpgradeIdRaw ? { ...u, storedPower: nextStored } : u,
              ),
            };

            continue;
          }

          if (toSectionRaw === LIFE_SUPPORT_ROUTE_KEY) {
            const sourceState = workingShip.sections[fromSection];
            if (!sourceState) {
              throw new Error(
                'Cannot resolve restore action because life support transfer source section state was not found. ' +
                  `Root cause: ship.sections has no entry for section "${fromSection}". ` +
                  'Fix: Ensure all ship sections are initialized in ship.sections.'
              );
            }

            if (sourceState.hull <= 0) {
              throw new Error(
                'Cannot resolve restore action because life support transfer source section is damaged (hull is zero). ' +
                  `Root cause: source section "${fromSection}" has hull=${sourceState.hull}. ` +
                  'Fix: Repair hull to at least 1 before transferring power from the section.'
              );
            }

            workingShip = spendPowerInSection(workingShip, fromSection, amount);

            const baseLifeSupportPowerRaw = workingShip.lifeSupportPower;
            const baseLifeSupportPower = (() => {
              if (typeof baseLifeSupportPowerRaw === 'undefined') {
                return 0;
              }
              if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
                throw new Error(
                  'Cannot resolve restore action because ship.lifeSupportPower is invalid. ' +
                    `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}" for player "${playerId}". ` +
                    'Fix: Ensure ship.lifeSupportPower is a finite number.'
                );
              }
              if (baseLifeSupportPowerRaw < 0) {
                throw new Error(
                  'Cannot resolve restore action because ship.lifeSupportPower is negative. ' +
                    `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw} for player "${playerId}". ` +
                    'Fix: Ensure ship.lifeSupportPower is never set below 0.'
                );
              }
              return baseLifeSupportPowerRaw;
            })();

            workingShip = {
              ...workingShip,
              lifeSupportPower: baseLifeSupportPower + amount,
            };
            continue;
          }

          if (!toSectionRaw || !validSections.has(toSectionRaw as ShipSection)) {
            throw new Error(
              'Cannot resolve restore action because a transfer target section is invalid. ' +
                `Root cause: transfers contains toSection "${toSectionRaw}". ` +
                'Fix: Set toSection to a valid SHIP_SECTIONS key (or "life_support" to transfer into the life support pool).'
            );
          }

          const toSection = toSectionRaw as ShipSection;

          if (fromSection === toSection) {
            throw new Error(
              'Cannot resolve restore action because a transfer has the same source and target section. ' +
                `Root cause: transfers entry uses fromSection=toSection="${fromSection}". ` +
                'Fix: Use different sections for fromSection and toSection.'
            );
          }

          const sourceState = workingShip.sections[fromSection];
          const targetState = workingShip.sections[toSection];

          if (!sourceState || !targetState) {
            throw new Error(
              'Cannot resolve restore action because transfer section state was not found. ' +
                `Root cause: sourceState or targetState is undefined for sections "${fromSection}" and "${toSection}". ` +
                'Fix: Ensure all ship sections are initialized in ship.sections.'
            );
          }

          if (sourceState.hull <= 0) {
            throw new Error(
              'Cannot resolve restore action because transfer source section is damaged (hull is zero). ' +
                `Root cause: source section "${fromSection}" has hull=${sourceState.hull}. ` +
                'Fix: Repair hull to at least 1 before transferring power from the section.'
            );
          }

          if (targetState.hull <= 0) {
            throw new Error(
              'Cannot resolve restore action because transfer target section is damaged (hull is zero). ' +
                `Root cause: target section "${toSection}" has hull=${targetState.hull}. ` +
                'Fix: Repair hull to at least 1 before transferring power to the section.'
            );
          }

          workingShip = spendPowerInSection(workingShip, fromSection, amount);
          workingShip = routePowerWithConduitLimits(
            workingShip,
            fromSection,
            toSection,
            amount,
            edgeLoad,
            true,
          );
        }
      }

      const restoreRepairTargetRaw = action.target?.section;
      if (
        crew.type === 'officer' &&
        (crew as { role: string }).role === 'chief_engineer' &&
        typeof restoreRepairTargetRaw !== 'undefined'
      ) {
        if (!canGeneratePower) {
          throw new Error(
            'Cannot resolve restore action repair because the acting crew cannot generate power from their section. ' +
              `Root cause: crew "${action.crewId}" attempted a Chief Engineer restore repair from section "${actingSection}" but powerRestored=0. ` +
              'Fix: Move the Chief Engineer to Engineering before requesting a restore repair.'
          );
        }

        if (typeof restoreRepairTargetRaw !== 'string' || !validSections.has(restoreRepairTargetRaw as ShipSection)) {
          throw new Error(
            'Cannot resolve restore action repair because target.section is invalid. ' +
              `Root cause: action.target.section is "${String(restoreRepairTargetRaw)}" for crew "${action.crewId}". ` +
              'Fix: Set action.target.section to a valid SHIP_SECTIONS key when requesting a restore repair.'
          );
        }

        const repairTypeRaw = action.parameters?.repairType as unknown;
        if (typeof repairTypeRaw !== 'string') {
          throw new Error(
            'Cannot resolve restore action repair because repairType is missing or invalid. ' +
              `Root cause: action.parameters.repairType is "${String(repairTypeRaw)}" for crew "${action.crewId}". ` +
              'Fix: Set action.parameters.repairType to one of: hull, conduit, corridor when requesting a restore repair.'
          );
        }

        if (repairTypeRaw !== 'hull' && repairTypeRaw !== 'conduit' && repairTypeRaw !== 'corridor') {
          throw new Error(
            'Cannot resolve restore action repair because repairType is not recognized. ' +
              `Root cause: action.parameters.repairType is "${repairTypeRaw}" for crew "${action.crewId}". ` +
              'Fix: Use one of: hull, conduit, corridor.'
          );
        }

        const repairTargetSection = restoreRepairTargetRaw as ShipSection;
        const repairTargetState = workingShip.sections[repairTargetSection];
        if (!repairTargetState) {
          throw new Error(
            'Cannot resolve restore action repair because target section state was not found. ' +
              `Root cause: ship.sections has no entry for section "${repairTargetSection}" (crew "${action.crewId}"). ` +
              'Fix: Ensure all ship sections are initialized in ship.sections.'
          );
        }

        const layoutA = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[actingSection];
        const layoutB = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[repairTargetSection];
        const hasConduitEdge =
          (layoutA?.conduitConnections?.[repairTargetSection] ?? 0) > 0 ||
          (layoutB?.conduitConnections?.[actingSection] ?? 0) > 0;
        const hasCorridorEdge =
          layoutA?.corridors?.[repairTargetSection] === 1 ||
          layoutB?.corridors?.[actingSection] === 1;
        const hasAnyEdge = hasConduitEdge || hasCorridorEdge;

        if (actingSection !== repairTargetSection && !hasAnyEdge) {
          throw new Error(
            'Cannot resolve restore action repair because target section is not adjacent by ship layout. ' +
              `Root cause: crew "${action.crewId}" attempted restore repair from "${actingSection}" to "${repairTargetSection}". ` +
              'Fix: Choose an adjacent target section or move the Chief Engineer to an adjacent section.'
          );
        }

        if (repairTypeRaw === 'conduit' && actingSection !== repairTargetSection && !hasConduitEdge) {
          throw new Error(
            'Cannot resolve restore action conduit repair because no conduit connection exists on this edge. ' +
              `Root cause: no conduit edge exists between "${actingSection}" and "${repairTargetSection}" in SHIP_CONNECTION_LAYOUT. ` +
              'Fix: Choose a target section connected by conduits from the crew location.'
          );
        }

        if (repairTypeRaw === 'corridor' && actingSection !== repairTargetSection && !hasCorridorEdge) {
          throw new Error(
            'Cannot resolve restore action corridor repair because no corridor exists on this edge. ' +
              `Root cause: no corridor edge exists between "${actingSection}" and "${repairTargetSection}" in SHIP_CONNECTION_LAYOUT. ` +
              'Fix: Choose a target section connected by a corridor from the crew location.'
          );
        }

        if ((repairTypeRaw === 'conduit' || repairTypeRaw === 'corridor') && repairTargetState.hull <= 0) {
          throw new Error(
            'Cannot resolve restore action repair because target section is damaged (hull is zero). ' +
              `Root cause: target section "${repairTargetSection}" has hull=${repairTargetState.hull}. ` +
              'Fix: Repair hull to at least 1 before restoring conduits or corridors.'
          );
        }

        const restoreRepairMultiplier = stimResult.stimmed ? 2 : 1;
        workingShip = applyRepairs(
          workingShip,
          repairTargetSection,
          repairTypeRaw,
          restoreRepairMultiplier,
          actingSection,
        );
      }
    }

    const mitigation = applyPowerCoilsMitigationToEdgeLoad({
      game,
      player: workingPlayer,
      ship: workingShip,
      edgeLoad,
    });
    workingPlayer = mitigation.player;
    workingShip = applyConduitOverloadDamageForEdgeLoads(workingShip, mitigation.edgeLoad);

    updatedPlayers.set(playerId, {
      ...workingPlayer,
      ship: workingShip,
    });
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

/**
 * Resolve route actions (power transfer between sections)
 * Purpose: Transfer power from one section to another via conduit paths
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of route actions to process
 * Returns: New GameState with power transferred and conduits potentially damaged
 * Side effects: None (pure function)
 *
 * Power routing mechanics:
 * - Power is subtracted from source section and added to target section
 * - Path is calculated via conduit connections (not corridors)
 * - Bottleneck conduit (minimum conduits on path) determines safe capacity (3 power per conduit)
 * - Exceeding safe capacity damages the bottleneck conduit
 * - Cannot transfer more power than source has or target can hold
 */
function resolveRouteActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
  const validSections = new Set<ShipSection>(sectionKeys);

  const updatedPlayers = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve route action because crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member in the player\'s crew or captain.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'route', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'route', action.crewId);

    const ship = spendPowerInSection(workingPlayer.ship, actingSection, 1);

    const params = action.parameters as {
      sourceSection?: string;
      targetSection?: string;
      amount?: number;
    } | undefined;

    const sourceSectionRaw = params?.sourceSection;
    const targetSectionRaw = params?.targetSection;
    const amountRaw = params?.amount;

    if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw)) {
      throw new Error(
        'Cannot resolve route action because amount is missing or invalid. ' +
          `Root cause: amount is "${String(amountRaw)}". ` +
          'Fix: Set action.parameters.amount to a positive number.'
      );
    }

    const amount = amountRaw;

    if (typeof sourceSectionRaw !== 'string' || sourceSectionRaw.length === 0) {
      throw new Error(
        'Cannot resolve route action because sourceSection is missing or invalid. ' +
          `Root cause: sourceSection is "${String(sourceSectionRaw)}". ` +
          'Fix: Set action.parameters.sourceSection to a valid ship section key or "life_support".'
      );
    }

    if (typeof targetSectionRaw !== 'string' || targetSectionRaw.length === 0) {
      throw new Error(
        'Cannot resolve route action because targetSection is missing or invalid. ' +
          `Root cause: targetSection is "${String(targetSectionRaw)}". ` +
          'Fix: Set action.parameters.targetSection to a valid ship section key or "life_support".'
      );
    }

    if (amount <= 0) {
      throw new Error(
        'Cannot resolve route action because parameters are incomplete. ' +
        `Root cause: sourceSection="${sourceSectionRaw}", targetSection="${targetSectionRaw}", amount=${amount}. ` +
        'Fix: Provide valid sourceSection, targetSection, and amount > 0.'
      );
    }

    const sourceIsLifeSupport = sourceSectionRaw === LIFE_SUPPORT_ROUTE_KEY;
    const targetIsLifeSupport = targetSectionRaw === LIFE_SUPPORT_ROUTE_KEY;

    if (sourceIsLifeSupport && targetIsLifeSupport) {
      throw new Error(
        'Cannot resolve route action because source and target are both life support. ' +
          `Root cause: sourceSection and targetSection are both "${LIFE_SUPPORT_ROUTE_KEY}". ` +
          'Fix: Route power from life support to a ship section, or from a ship section into life support.'
      );
    }

    if (!sourceIsLifeSupport && !validSections.has(sourceSectionRaw as ShipSection)) {
      throw new Error(
        'Cannot resolve route action because sourceSection is not recognized. ' +
          `Root cause: sourceSection is "${sourceSectionRaw}". ` +
          'Fix: Set action.parameters.sourceSection to a valid SHIP_SECTIONS key or "life_support".'
      );
    }

    if (!targetIsLifeSupport && !validSections.has(targetSectionRaw as ShipSection)) {
      throw new Error(
        'Cannot resolve route action because targetSection is not recognized. ' +
          `Root cause: targetSection is "${targetSectionRaw}". ` +
          'Fix: Set action.parameters.targetSection to a valid SHIP_SECTIONS key or "life_support".'
      );
    }

    const sourceSection = sourceIsLifeSupport ? null : (sourceSectionRaw as ShipSection);
    const targetSection = targetIsLifeSupport ? null : (targetSectionRaw as ShipSection);

    if (sourceSection !== null && targetSection !== null && sourceSection === targetSection) {
      throw new Error(
        'Cannot resolve route action because source and target are the same. ' +
        `Root cause: both sourceSection and targetSection are "${sourceSection}". ` +
        'Fix: Route power to a different section than the source.'
      );
    }

    if (sourceSection !== null && targetSection === null) {
      const sourceState = ship.sections[sourceSection];

      if (!sourceState) {
        throw new Error(
          'Cannot resolve route action because source section state not found. ' +
            `Root cause: ship.sections has no entry for section "${sourceSection}". ` +
            'Fix: Ensure all ship sections are properly initialized.'
        );
      }

      if (sourceState.hull <= 0) {
        throw new Error(
          'Cannot resolve route action because source section is damaged (hull is zero). ' +
            `Root cause: source section "${sourceSection}" has hull=${sourceState.hull}. ` +
            'Fix: Repair hull to at least 1 before routing power from the section.'
        );
      }

      const sourcePower = sourceState.powerDice.reduce((sum, d) => sum + d, 0);
      if (amount > sourcePower) {
        throw new Error(
          'Cannot resolve route action because source section does not have enough power. ' +
            `Root cause: trying to transfer ${amount} power but source has only ${sourcePower}. ` +
            'Fix: Transfer an amount <= available power in source section.'
        );
      }

      const afterSpend = spendPowerInSection(ship, sourceSection, amount);
      const baseLifeSupportPowerRaw = afterSpend.lifeSupportPower;
      const baseLifeSupportPower = (() => {
        if (typeof baseLifeSupportPowerRaw === 'undefined') {
          return 0;
        }
        if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
          throw new Error(
            'Cannot resolve route action because ship.lifeSupportPower is invalid. ' +
              `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}" for player "${player.id}". ` +
              'Fix: Ensure ship.lifeSupportPower is a finite number.'
          );
        }
        if (baseLifeSupportPowerRaw < 0) {
          throw new Error(
            'Cannot resolve route action because ship.lifeSupportPower is negative. ' +
              `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw} for player "${player.id}". ` +
              'Fix: Ensure ship.lifeSupportPower is never set below 0.'
          );
        }
        return baseLifeSupportPowerRaw;
      })();

      const updatedShip: Ship = {
        ...afterSpend,
        lifeSupportPower: baseLifeSupportPower + amount,
      };

      const updatedPlayer: PlayerState = {
        ...workingPlayer,
        ship: updatedShip,
      };

      updatedPlayers.set(playerId, updatedPlayer);
      continue;
    }

    if (sourceSection === null && targetSection !== null) {
      const targetState = ship.sections[targetSection];

      if (!targetState) {
        throw new Error(
          'Cannot resolve route action because target section state not found. ' +
            `Root cause: ship.sections has no entry for section "${targetSection}". ` +
            'Fix: Ensure all ship sections are properly initialized.'
        );
      }

      if (targetState.hull <= 0) {
        throw new Error(
          'Cannot resolve route action because target section is damaged (hull is zero). ' +
            `Root cause: target section "${targetSection}" has hull=${targetState.hull}. ` +
            'Fix: Repair hull to at least 1 before routing power to the section.'
        );
      }

      const baseLifeSupportPowerRaw = ship.lifeSupportPower;
      const baseLifeSupportPower = (() => {
        if (typeof baseLifeSupportPowerRaw === 'undefined') {
          return 0;
        }
        if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
          throw new Error(
            'Cannot resolve route action because ship.lifeSupportPower is invalid. ' +
              `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}" for player "${player.id}". ` +
              'Fix: Ensure ship.lifeSupportPower is a finite number.'
          );
        }
        if (baseLifeSupportPowerRaw < 0) {
          throw new Error(
            'Cannot resolve route action because ship.lifeSupportPower is negative. ' +
              `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw} for player "${player.id}". ` +
              'Fix: Ensure ship.lifeSupportPower is never set below 0.'
          );
        }
        return baseLifeSupportPowerRaw;
      })();

      if (amount > baseLifeSupportPower) {
        throw new Error(
          'Cannot resolve route action because life support does not have enough power. ' +
            `Root cause: trying to transfer ${amount} power but life support has only ${baseLifeSupportPower}. ` +
            'Fix: Transfer an amount <= available power in life support.'
        );
      }

      const targetCurrentPower = targetState.powerDice.reduce((sum, d) => sum + d, 0);
      const targetCapacity = 18 - targetCurrentPower;
      if (amount > targetCapacity) {
        throw new Error(
          'Cannot resolve route action because target section cannot hold that much power. ' +
            `Root cause: trying to transfer ${amount} power but target can only hold ${targetCapacity} more. ` +
            'Fix: Transfer an amount <= available capacity in target section.'
        );
      }

      const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
      for (const sectionKey of sectionKeys) {
        const state = ship.sections[sectionKey];
        sections[sectionKey] = {
          hull: state.hull,
          powerDice: [...state.powerDice],
          corridors: { ...state.corridors },
          conduitConnections: { ...state.conduitConnections },
        };
      }

      let totalConduitsAtEdges = 0;
      let bottleneckNeighbor: ShipSection | null = null;
      let bottleneckConduits = Infinity;

      for (const neighbor of sectionKeys) {
        if (neighbor === targetSection) {
          continue;
        }

        const aToB = sections[targetSection].conduitConnections[neighbor] ?? 0;
        const bToA = sections[neighbor].conduitConnections[targetSection] ?? 0;
        const conduitsOnEdge = Math.min(aToB, bToA);

        if (conduitsOnEdge <= 0) {
          continue;
        }

        totalConduitsAtEdges += conduitsOnEdge;
        if (conduitsOnEdge < bottleneckConduits) {
          bottleneckConduits = conduitsOnEdge;
          bottleneckNeighbor = neighbor;
        }
      }

      if (!Number.isFinite(totalConduitsAtEdges) || totalConduitsAtEdges <= 0) {
        throw new Error(
          'Cannot resolve route action because target section has no intact conduits at its edges. ' +
            `Root cause: section "${targetSection}" has totalConduitsAtEdges=${totalConduitsAtEdges}. ` +
            'Fix: Repair at least one conduit connection adjacent to the target section before routing from life support.'
        );
      }

      const safeCapacity = totalConduitsAtEdges * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
      let willOverload = amount > safeCapacity;

      if (willOverload) {
        const coilsPowered = playerHasPoweredUpgrade(workingPlayer, ship, 'power_coils');
        const lastUsedTurn = workingPlayer.powerCoilsLastUsedTurn ?? 0;
        if (coilsPowered && lastUsedTurn !== game.currentTurn) {
          willOverload = false;
          workingPlayer = {
            ...workingPlayer,
            powerCoilsLastUsedTurn: game.currentTurn,
          };
        }
      }

      const targetDice = sections[targetSection].powerDice;
      let remainingToAdd = amount;

      for (let i = 0; i < targetDice.length && remainingToAdd > 0; i++) {
        const spaceInDie = 6 - targetDice[i];
        const powerToAdd = Math.min(spaceInDie, remainingToAdd);
        targetDice[i] += powerToAdd;
        remainingToAdd -= powerToAdd;
      }

      while (remainingToAdd > 0) {
        const newDieValue = Math.min(6, remainingToAdd);
        targetDice.push(newDieValue);
        remainingToAdd -= newDieValue;
      }

      if (willOverload && bottleneckNeighbor !== null) {
        const aToB = sections[targetSection].conduitConnections[bottleneckNeighbor] ?? 0;
        const bToA = sections[bottleneckNeighbor].conduitConnections[targetSection] ?? 0;
        if (aToB > 0) {
          sections[targetSection].conduitConnections[bottleneckNeighbor] = aToB - 1;
        }
        if (bToA > 0) {
          sections[bottleneckNeighbor].conduitConnections[targetSection] = bToA - 1;
        }
      }

      const updatedShip: Ship = {
        ...ship,
        sections,
        lifeSupportPower: baseLifeSupportPower - amount,
      };

      const updatedPlayer: PlayerState = {
        ...workingPlayer,
        ship: updatedShip,
      };

      updatedPlayers.set(playerId, updatedPlayer);
      continue;
    }

    if (sourceSection === null || targetSection === null) {
      throw new Error(
        'Cannot resolve route action because sourceSection/targetSection are invalid. ' +
          `Root cause: sourceSection=${String(sourceSection)}, targetSection=${String(targetSection)}. ` +
          'Fix: Set action.parameters.sourceSection and action.parameters.targetSection to valid ship sections.'
      );
    }

    const sourceSectionKey: ShipSection = sourceSection;
    const targetSectionKey: ShipSection = targetSection;

    const sourceState = ship.sections[sourceSectionKey];
    const targetState = ship.sections[targetSectionKey];

    if (!sourceState || !targetState) {
      throw new Error(
        'Cannot resolve route action because section state not found. ' +
        `Root cause: sourceState or targetState is undefined for sections "${String(sourceSection)}" and "${String(targetSection)}". ` +
        'Fix: Ensure all ship sections are properly initialized.'
      );
    }

    if (sourceState.hull <= 0) {
      throw new Error(
        'Cannot resolve route action because source section is damaged (hull is zero). ' +
          `Root cause: source section "${sourceSection}" has hull=${sourceState.hull}. ` +
          'Fix: Repair hull to at least 1 before routing power from the section.'
      );
    }

    if (targetState.hull <= 0) {
      throw new Error(
        'Cannot resolve route action because target section is damaged (hull is zero). ' +
          `Root cause: target section "${targetSection}" has hull=${targetState.hull}. ` +
          'Fix: Repair hull to at least 1 before routing power to the section.'
      );
    }

    // Calculate available power in source
    const sourcePower = sourceState.powerDice.reduce((sum, d) => sum + d, 0);
    if (amount > sourcePower) {
      throw new Error(
        'Cannot resolve route action because source section does not have enough power. ' +
        `Root cause: trying to transfer ${amount} power but source has only ${sourcePower}. ` +
        'Fix: Transfer an amount <= available power in source section.'
      );
    }

    // Calculate target capacity (max 18 power = 3 dice × 6)
    const targetCurrentPower = targetState.powerDice.reduce((sum, d) => sum + d, 0);
    const targetCapacity = 18 - targetCurrentPower;
    if (amount > targetCapacity) {
      throw new Error(
        'Cannot resolve route action because target section cannot hold that much power. ' +
        `Root cause: trying to transfer ${amount} power but target can only hold ${targetCapacity} more. ` +
        'Fix: Transfer an amount <= available capacity in target section.'
      );
    }

    // Find path via conduit connections
    const path = findConduitPath(ship, sourceSectionKey, targetSectionKey);
    if (!path) {
      throw new Error(
        'Cannot resolve route action because no conduit path exists between sections. ' +
          `Root cause: no conduit connection path from "${sourceSection}" to "${targetSection}". ` +
          'Fix: Repair conduit connections or choose sections that are connected.'
      );
    }

    // Find bottleneck conduit (minimum conduits on any connection along the path)
    let bottleneckIndex = -1;
    let minConduits = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const fromSection = path[i];
      const toSection = path[i + 1];
      const fromState = ship.sections[fromSection];
      // Get conduit count on this specific connection
      const conduitCount = fromState?.conduitConnections?.[toSection] ?? 0;
      if (conduitCount < minConduits) {
        minConduits = conduitCount;
        bottleneckIndex = i;
      }
    }

    const safeCapacity = minConduits * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
    let willOverload = amount > safeCapacity && safeCapacity > 0;

    if (willOverload) {
      const coilsPowered = playerHasPoweredUpgrade(workingPlayer, ship, 'power_coils');
      const lastUsedTurn = workingPlayer.powerCoilsLastUsedTurn ?? 0;
      if (coilsPowered && lastUsedTurn !== game.currentTurn) {
        willOverload = false;
        workingPlayer = {
          ...workingPlayer,
          powerCoilsLastUsedTurn: game.currentTurn,
        };
      }
    }

    // Clone sections for modification
    const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;

    for (const sectionKey of sectionKeys) {
      const state = ship.sections[sectionKey];
      sections[sectionKey] = {
        hull: state.hull,
        powerDice: [...state.powerDice],
        corridors: { ...state.corridors },
        conduitConnections: { ...state.conduitConnections },
      };
    }

    // Subtract power from source section
    let remainingToRemove = amount;
    const sourceDice = sections[sourceSectionKey].powerDice;
    for (let i = sourceDice.length - 1; i >= 0 && remainingToRemove > 0; i--) {
      const removal = Math.min(sourceDice[i], remainingToRemove);
      sourceDice[i] -= removal;
      remainingToRemove -= removal;
      if (sourceDice[i] === 0) {
        sourceDice.splice(i, 1);
      }
    }

    // Add power to target section
    let remainingToAdd = amount;
    const targetDice = sections[targetSectionKey].powerDice;
    for (let i = 0; i < targetDice.length && remainingToAdd > 0; i++) {
      const spaceInDie = 6 - targetDice[i];
      const powerToAdd = Math.min(spaceInDie, remainingToAdd);
      targetDice[i] += powerToAdd;
      remainingToAdd -= powerToAdd;
    }
    while (remainingToAdd > 0) {
      const newDieValue = Math.min(6, remainingToAdd);
      targetDice.push(newDieValue);
      remainingToAdd -= newDieValue;
    }

    // Damage bottleneck conduit if overloaded - reduce conduit count on the connection
    if (willOverload && bottleneckIndex >= 0) {
      const fromSection = path[bottleneckIndex];
      const toSection = path[bottleneckIndex + 1];
      // Reduce conduit count on both directions of the connection
      if (sections[fromSection].conduitConnections[toSection] > 0) {
        sections[fromSection].conduitConnections[toSection] -= 1;
      }
      if (sections[toSection].conduitConnections[fromSection] > 0) {
        sections[toSection].conduitConnections[fromSection] -= 1;
      }
    }

    const updatedShip: Ship = {
      ...ship,
      sections,
    };

    const updatedPlayer: PlayerState = {
      ...workingPlayer,
      ship: updatedShip,
    };

    updatedPlayers.set(playerId, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

/**
 * Find a conduit path between two sections
 * Purpose: BFS to find path via conduit connections for power routing
 * Parameters:
 *   - ship: Current ship state
 *   - from: Starting section
 *   - to: Target section
 * Returns: Array of sections in path, or null if no path exists
 * Side effects: None (pure function)
 */
function findConduitPath(ship: Ship, from: ShipSection, to: ShipSection): ShipSection[] | null {
  if (from === to) {
    return [from];
  }

  const visited = new Set<ShipSection>();
  const queue: { section: ShipSection; path: ShipSection[] }[] = [];

  visited.add(from);
  queue.push({ section: from, path: [from] });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const sectionState = ship.sections[current.section];
    if (!sectionState) {
      continue;
    }

    const conduitConnections = sectionState.conduitConnections ?? {};
    const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

    for (const neighbor of sectionKeys) {
      if (neighbor === current.section) {
        continue;
      }

      if ((conduitConnections[neighbor] ?? 0) <= 0) {
        continue;
      }

      if (visited.has(neighbor)) {
        continue;
      }

      const nextPath = [...current.path, neighbor];

      if (neighbor === to) {
        return nextPath;
      }

      visited.add(neighbor);
      queue.push({ section: neighbor, path: nextPath });
    }
  }

  return null;
}

/**
 * Find a crew member by ID in player's crew or captain
 * Purpose: Locate crew for action resolution
 * Parameters:
 *   - player: Player state to search
 *   - crewId: ID of crew to find
 * Returns: Crew member or undefined if not found
 * Side effects: None (pure function)
 */
function findCrewById(player: PlayerState, crewId: string): AnyCrew | Captain | undefined {
  if (player.captain.id === crewId) {
    return player.captain;
  }
  return player.crew.find(c => c.id === crewId);
}

 function playerHasInstalledUpgrade(player: PlayerState, upgradeId: string): boolean {
   return player.installedUpgrades.some((upgrade) => upgrade.id === upgradeId);
 }

 function playerHasPoweredUpgrade(player: PlayerState, ship: Ship, upgradeId: string): boolean {
   const upgrade = player.installedUpgrades.find((entry) => entry.id === upgradeId);
   if (!upgrade) {
     return false;
   }

   const powerRequiredRaw = (upgrade as { powerRequired?: unknown }).powerRequired;
   if (powerRequiredRaw === undefined || powerRequiredRaw === null) {
     return true;
   }
   if (typeof powerRequiredRaw !== 'number' || !Number.isFinite(powerRequiredRaw)) {
     throw new Error(
       'Cannot determine whether upgrade is powered because upgrade.powerRequired is invalid. ' +
         `Root cause: installed upgrade "${upgradeId}" has powerRequired "${String(powerRequiredRaw)}". ` +
         'Fix: Ensure all installed upgrades have numeric powerRequired (or omit it for passive upgrades).',
     );
   }
   if (powerRequiredRaw <= 0) {
     return true;
   }

   const storedPowerRaw = (upgrade as { storedPower?: unknown }).storedPower;
   const storedPower =
     typeof storedPowerRaw === 'number' && Number.isFinite(storedPowerRaw) && storedPowerRaw > 0
       ? storedPowerRaw
       : 0;

   const sectionRaw = (upgrade as { section?: unknown }).section;
   const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
   if (typeof sectionRaw !== 'string' || !validSections.has(sectionRaw as ShipSection)) {
     throw new Error(
       'Cannot determine whether upgrade is powered because installed upgrade section is missing or invalid. ' +
         `Root cause: installed upgrade "${upgradeId}" has section "${String(sectionRaw)}". ` +
         'Fix: When integrating upgrades with section="any", store the actual installed ship section on the installed upgrade card.',
     );
   }

   const section = sectionRaw as ShipSection;
   const sectionState = ship.sections[section];
   if (!sectionState) {
     throw new Error(
       'Cannot determine whether upgrade is powered because ship.sections is missing the upgrade section. ' +
         `Root cause: ship.sections has no entry for section "${section}" (upgrade "${upgradeId}"). ` +
         'Fix: Ensure all SHIP_SECTIONS are initialized in ship.sections.',
     );
   }

   if (sectionState.hull <= 0) {
     return false;
   }

   const hasConduitConnection = Object.values(sectionState.conduitConnections ?? {}).some(
     (count) => (count ?? 0) > 0,
   );
   if (!hasConduitConnection) {
     return false;
   }

   const baseRequiredRaw = (SECTION_CONFIG as Record<string, unknown>)[section];
   const baseRequired =
     typeof (baseRequiredRaw as any)?.powerRequired === 'number' &&
     Number.isFinite((baseRequiredRaw as any).powerRequired) &&
     (baseRequiredRaw as any).powerRequired > 0
       ? (baseRequiredRaw as any).powerRequired
       : 0;

   const totalPower = sectionState.powerDice.reduce((sum, die) => sum + die, 0);
   return totalPower >= baseRequired && storedPower >= powerRequiredRaw;
 }

 function upgradeListHas(upgrades: UpgradeCard[] | null | undefined, upgradeId: string): boolean {
   if (!upgrades || upgrades.length === 0) {
     return false;
   }
   return upgrades.some((upgrade) => upgrade.id === upgradeId);
 }

function consumeStimPackIfRequested(
  player: PlayerState,
  action: PlayerAction,
  actingCrew: AnyCrew | Captain,
  actingSection: ShipSection,
): { player: PlayerState; stimmed: boolean } {
  const params = action.parameters as Record<string, unknown> | undefined;
  if (params === undefined) {
    return { player, stimmed: false };
  }

  if (typeof params !== 'object' || params === null) {
    throw new Error(
      'Cannot resolve stimmed action because action.parameters is not an object. ' +
        `Root cause: typeof action.parameters is "${typeof params}". ` +
        'Fix: Provide action.parameters as an object when using stim packs.'
    );
  }

  const rawStimmed = params.stimmed;
  const rawStimDoctorId = params.stimDoctorId;

  if (rawStimmed === undefined && rawStimDoctorId === undefined) {
    return { player, stimmed: false };
  }

  if (rawStimmed !== true) {
    throw new Error(
      'Cannot resolve stimmed action because parameters.stimmed is invalid. ' +
        `Root cause: parameters.stimmed is "${String(rawStimmed)}". ` +
        'Fix: Set action.parameters.stimmed to true when requesting a stim pack.'
    );
  }

  if (typeof rawStimDoctorId !== 'string' || rawStimDoctorId.length === 0) {
    throw new Error(
      'Cannot resolve stimmed action because parameters.stimDoctorId is missing or invalid. ' +
        `Root cause: parameters.stimDoctorId is "${String(rawStimDoctorId)}". ` +
        'Fix: Set action.parameters.stimDoctorId to a valid Doctor crew id.'
    );
  }

  if (rawStimDoctorId === action.crewId) {
    throw new Error(
      'Cannot resolve stimmed action because a Doctor cannot stim their own action. ' +
        `Root cause: action.crewId equals stimDoctorId ("${rawStimDoctorId}"). ` +
        'Fix: Choose a different target crew to receive the stim pack.'
    );
  }

  const stimDoctor = player.crew.find(c => c.id === rawStimDoctorId);
  if (!stimDoctor) {
    throw new Error(
      'Cannot resolve stimmed action because stimDoctorId was not found on the player. ' +
        `Root cause: stimDoctorId "${rawStimDoctorId}" is not present in player.crew. ` +
        'Fix: Set stimDoctorId to an existing Doctor officer on the acting player.'
    );
  }

  if (stimDoctor.type !== 'officer' || stimDoctor.role !== 'doctor') {
    throw new Error(
      'Cannot resolve stimmed action because stimDoctorId does not refer to a Doctor officer. ' +
        `Root cause: crew "${stimDoctor.id}" has type="${stimDoctor.type}" and role="${(stimDoctor as any).role}". ` +
        'Fix: Choose an officer with role "doctor" as the stimDoctorId.'
    );
  }

  if (stimDoctor.status !== 'active') {
    throw new Error(
      'Cannot resolve stimmed action because the Doctor is not active. ' +
        `Root cause: Doctor "${stimDoctor.id}" has status "${stimDoctor.status}". ` +
        'Fix: Only active Doctors can apply stim packs.'
    );
  }

  const doctorSection = stimDoctor.location as ShipSection | null;
  if (!doctorSection) {
    throw new Error(
      'Cannot resolve stimmed action because the Doctor has no location. ' +
        `Root cause: Doctor "${stimDoctor.id}" has location "${String(stimDoctor.location)}". ` +
        'Fix: Ensure the Doctor is in a valid ship section before applying a stim pack.'
    );
  }

  if (doctorSection !== actingSection) {
    const actingRole = actingCrew.type === 'captain' ? 'captain' : (actingCrew as any).role;
    throw new Error(
      'Cannot resolve stimmed action because the Doctor is not in the same section as the acting crew. ' +
        `Root cause: Doctor "${stimDoctor.id}" is in "${doctorSection}" but acting crew "${action.crewId}" (role="${String(actingRole)}") is acting from "${actingSection}". ` +
        'Fix: Move the Doctor into the same section as the crew performing the stimmed action.'
    );
  }

  const rawStimPacksUsed = (stimDoctor as { stimPacksUsed?: unknown }).stimPacksUsed;
  if (typeof rawStimPacksUsed !== 'number' || !Number.isFinite(rawStimPacksUsed) || rawStimPacksUsed < 0) {
    throw new Error(
      'Cannot resolve stimmed action because doctor.stimPacksUsed is missing or invalid. ' +
        `Root cause: Doctor "${stimDoctor.id}" has stimPacksUsed "${String(rawStimPacksUsed)}". ` +
        'Fix: Ensure Doctor officers have a non-negative numeric stimPacksUsed field.'
    );
  }

  const maxStimPacks = 3;
  if (rawStimPacksUsed >= maxStimPacks) {
    throw new Error(
      'Cannot resolve stimmed action because the Doctor has no stim packs remaining. ' +
        `Root cause: Doctor "${stimDoctor.id}" has stimPacksUsed=${rawStimPacksUsed} (max=${maxStimPacks}). ` +
        'Fix: Choose a different Doctor or do not mark this action as stimmed.'
    );
  }

  const updatedCrew = player.crew.map(c =>
    c.id === stimDoctor.id
      ? {
          ...c,
          stimPacksUsed: rawStimPacksUsed + 1,
        }
      : c
  );

  return {
    player: {
      ...player,
      crew: updatedCrew,
    },
    stimmed: true,
  };
}

// Crew_Bonus: Source of truth for restore power role bonuses; UI preview helper mirrors this logic.
/**
 * Get power restoration bonus for a crew member
 * Purpose: Calculate crew-specific power bonuses
 * Parameters:
 *   - crew: Crew member performing restore action
 * Returns: Power bonus (0 for no bonus, up to +3 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Engineer: +2
 * - Chief Engineer: +3
 * - Android: +3
 * - Captain: uses base crew skill
 *
 * Restore_Power: Engine authority for per-role restore bonuses used by resolveRestoreActions.
 */
function getRestorePowerBonus(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'engineer') {
      return 2;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'chief_engineer' || officer.role === 'android') {
      return 3;
    }
    if (officer.role === 'first_officer') {
      return 2;
    }
  }

  if (crew.type === 'captain') {
    return 2;
  }

  return 0;
}

// Crew_Bonus: Source of truth for defense shield bonuses during restore; UI preview mirrors this.
/**
 * Get shield restoration bonus for a crew member
 * Purpose: Calculate crew-specific shield bonuses when restoring from Defense
 * Parameters:
 *   - crew: Crew member performing restore action
 * Returns: Shield bonus (0 for no bonus, +1 or +2 for tacticians)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Tactician: +1 shield
 * - Master Tactician: +2 shield
 */
function getRestoreShieldBonus(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'tactician') {
      return 1;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'master_tactician') {
      return 2;
    }
    if (officer.role === 'first_officer') {
      return 1;
    }
  }

  if (crew.type === 'captain') {
    return 1;
  }

  return 0;
}

/**
 * Add power to a ship section
 * Purpose: Increase power in a specific section, optionally add shields
 * Parameters:
 *   - ship: Current ship state
 *   - section: Section to add power to
 *   - power: Amount of power to add
 *   - shieldBonus: Optional shield increase
 * Returns: New Ship state with power added
 * Side effects: None (pure function)
 *
 * Note: Power is stored as power dice values.
 * This implementation adds to the first die that isn't maxed.
 * Future: Implement proper power routing with conduit limits.
 */
function addPowerToSection(
  ship: Ship,
  section: ShipSection,
  power: number,
  shieldBonus: number = 0,
): Ship {
  const sectionState = ship.sections[section];

  if (!sectionState) {
    throw new Error(
      'Cannot add power because section does not exist on ship. ' +
      `Root cause: no section found for "${section}" in ship.sections. ` +
      'Fix: Ensure all SHIP_SECTIONS are initialized in the Ship.'
    );
  }

  // Clone all sections
  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const state = ship.sections[sectionKey];
    sections[sectionKey] = {
      hull: state.hull,
      powerDice: [...state.powerDice],
      corridors: { ...state.corridors },
      conduitConnections: { ...state.conduitConnections },
    };
  }

  // Add power to the section's power dice
  // Power dice are d6 values (1-6). We add power by incrementing dice values.
  let remainingPower = power;
  const targetDice = sections[section].powerDice;

  for (let i = 0; i < targetDice.length && remainingPower > 0; i++) {
    const spaceInDie = 6 - targetDice[i];
    const powerToAdd = Math.min(spaceInDie, remainingPower);
    targetDice[i] += powerToAdd;
    remainingPower -= powerToAdd;
  }

  // If there's remaining power and we can add more dice, add a new die
  // (This represents power storage capacity)
  while (remainingPower > 0) {
    const newDieValue = Math.min(6, remainingPower);
    targetDice.push(newDieValue);
    remainingPower -= newDieValue;
  }

  return {
    ...ship,
    sections,
    shields: ship.shields + shieldBonus,
  };
}

function routePowerWithConduitLimits(
  ship: Ship,
  fromSection: ShipSection,
  toSection: ShipSection,
  power: number,
  edgeLoad?: Map<string, { a: ShipSection; b: ShipSection; load: number }>,
  skipOverloadDamage: boolean = false,
): Ship {
  if (power <= 0) {
    return ship;
  }

  if (fromSection === toSection) {
    return addPowerToSection(ship, toSection, power);
  }

  const sectionState = ship.sections[toSection];

  if (!sectionState) {
    throw new Error(
      'Cannot route power because section does not exist on ship. ' +
      `Root cause: no section found for "${toSection}" in ship.sections. ` +
      'Fix: Ensure all SHIP_SECTIONS are initialized in the Ship.'
    );
  }

  if (sectionState.hull <= 0) {
    throw new Error(
      'Cannot route power because target section is damaged (hull is zero). ' +
        `Root cause: target section "${toSection}" has hull=${sectionState.hull}. ` +
        'Fix: Repair hull to at least 1 before routing power to the section.'
    );
  }

  const path = findConduitPath(ship, fromSection, toSection);
  if (!path || path.length < 2) {
    throw new Error(
      'Cannot route power because no conduit path exists between sections. ' +
        `Root cause: no conduit connection path from "${fromSection}" to "${toSection}". ` +
        'Fix: Repair conduit connections or choose sections that are connected.'
    );
  }

  if (edgeLoad) {
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const a = from < to ? from : to;
      const b = from < to ? to : from;
      const key = `${a}|${b}`;
      const existing = edgeLoad.get(key);
      if (existing) {
        existing.load += power;
      } else {
        edgeLoad.set(key, { a, b, load: power });
      }
    }
  }

  let bottleneckIndex = -1;
  let minConduitsOnPath = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const edgeFromSection = path[i];
    const edgeToSection = path[i + 1];
    const edgeConduits = ship.sections[edgeFromSection]?.conduitConnections?.[edgeToSection] ?? 0;
    if (edgeConduits < minConduitsOnPath) {
      minConduitsOnPath = edgeConduits;
      bottleneckIndex = i;
    }
  }

  if (!Number.isFinite(minConduitsOnPath) || minConduitsOnPath <= 0) {
    throw new Error(
      'Cannot route power because conduit path has no intact conduits. ' +
        `Root cause: bottleneck conduit count along path is ${minConduitsOnPath}. ` +
        'Fix: Repair at least one conduit on the path before routing power.'
    );
  }

  const safeCapacity = minConduitsOnPath * POWER_CONFIG.MAX_POWER_PER_CONDUIT;

  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const state = ship.sections[sectionKey];
    sections[sectionKey] = {
      hull: state.hull,
      powerDice: [...state.powerDice],
      corridors: { ...state.corridors },
      conduitConnections: { ...state.conduitConnections },
    };
  }

  const targetState = sections[toSection];

  let remainingPower = power;
  const targetDice = targetState.powerDice;

  for (let i = 0; i < targetDice.length && remainingPower > 0; i++) {
    const spaceInDie = 6 - targetDice[i];
    const powerToAdd = Math.min(spaceInDie, remainingPower);
    targetDice[i] += powerToAdd;
    remainingPower -= powerToAdd;
  }

  while (remainingPower > 0) {
    const newDieValue = Math.min(6, remainingPower);
    targetDice.push(newDieValue);
    remainingPower -= newDieValue;
  }

  if (!skipOverloadDamage && power > safeCapacity && bottleneckIndex >= 0) {
    const bottleneckFrom = path[bottleneckIndex];
    const bottleneckTo = path[bottleneckIndex + 1];

    const fromTo = sections[bottleneckFrom].conduitConnections[bottleneckTo] ?? 0;
    const toFrom = sections[bottleneckTo].conduitConnections[bottleneckFrom] ?? 0;

    if (fromTo > 0) {
      sections[bottleneckFrom].conduitConnections[bottleneckTo] = fromTo - 1;
    }
    if (toFrom > 0) {
      sections[bottleneckTo].conduitConnections[bottleneckFrom] = toFrom - 1;
    }
  }

  return {
    ...ship,
    sections,
    shields: ship.shields,
  };
}

function applyConduitOverloadDamageForEdgeLoads(
  ship: Ship,
  edgeLoad: Map<string, { a: ShipSection; b: ShipSection; load: number }>,
): Ship {
  if (edgeLoad.size === 0) {
    return ship;
  }

  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const state = ship.sections[sectionKey];
    sections[sectionKey] = {
      hull: state.hull,
      powerDice: [...state.powerDice],
      corridors: { ...state.corridors },
      conduitConnections: { ...state.conduitConnections },
    };
  }

  for (const entry of edgeLoad.values()) {
    const aToB = sections[entry.a].conduitConnections[entry.b] ?? 0;
    const bToA = sections[entry.b].conduitConnections[entry.a] ?? 0;
    const conduitsOnEdge = Math.min(aToB, bToA);

    if (conduitsOnEdge <= 0) {
      continue;
    }

    const safeCapacity = conduitsOnEdge * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
    if (entry.load <= safeCapacity) {
      continue;
    }

    if (aToB > 0) {
      sections[entry.a].conduitConnections[entry.b] = aToB - 1;
    }
    if (bToA > 0) {
      sections[entry.b].conduitConnections[entry.a] = bToA - 1;
    }
  }

  return {
    ...ship,
    sections,
  };
}

/**
 * Resolve maneuver actions
 * Purpose: Process ship movement
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of maneuver actions to process
 * Returns: New GameState with ship positions updated
 * Side effects: None (pure function)
 *
 * Maneuver rules (from rulebook):
 * - Must be on Bridge to maneuver
 * - Generate acceleration from power spent + bonuses
 * - Move ship: in/out (ring change) or forward/backward (space change)
 * - Pilot: +1 acceleration
 * - Ace Pilot: +2 acceleration
 * - Bridge fully powered: +1 acceleration
 * - Direction specified in action.parameters.direction: 'forward' | 'backward' | 'inward' | 'outward'
 * - Power to spend in action.parameters.powerSpent
 */
function resolveManeuverActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const maneuverCountByPlayerId = new Map<string, number>();
  for (const entry of actions) {
    const next = (maneuverCountByPlayerId.get(entry.playerId) ?? 0) + 1;
    maneuverCountByPlayerId.set(entry.playerId, next);
  }

  for (const [playerId, count] of maneuverCountByPlayerId.entries()) {
    if (count > 1) {
      throw new Error(
        'Cannot resolve maneuver actions because more than one maneuver was planned for the same player in a single turn. ' +
          `Root cause: player "${playerId}" has ${count} maneuver actions. ` +
          'Fix: Only plan one maneuver action per player per turn.'
      );
    }
  }

  const updatedPlayers = new Map<string, PlayerState>();

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  // Process each maneuver action
  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve maneuver action because crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve maneuver action because crew member is not active. ' +
        `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
        'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'maneuver', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'maneuver', action.crewId);

    if (actingSection !== SHIP_SECTIONS.BRIDGE) {
      throw new Error(
        'Cannot resolve maneuver action because crew is not in Bridge section. ' +
          `Root cause: crew "${action.crewId}" is in section "${String(actingSection)}" but must be in "${SHIP_SECTIONS.BRIDGE}". ` +
          'Fix: Move crew to Bridge before maneuvering.'
      );
    }

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    // Get direction and power from parameters
    const direction = (action.parameters?.direction as string) ?? 'forward';
    const powerSpent = (action.parameters?.powerSpent as number) ?? 1;
    const parameters = action.parameters as Record<string, unknown> | undefined;
    const hasRequestedDistance =
      !!parameters && Object.prototype.hasOwnProperty.call(parameters, 'distance');
    const requestedDistanceRaw = (parameters as any)?.distance as unknown;
    const requestedDistance =
      typeof requestedDistanceRaw === 'number' && Number.isFinite(requestedDistanceRaw)
        ? requestedDistanceRaw
        : null;

    if (
      direction !== 'forward' &&
      direction !== 'backward' &&
      direction !== 'inward' &&
      direction !== 'outward'
    ) {
      throw new Error(
        'Cannot resolve maneuver action because direction is unknown. ' +
          `Root cause: action.parameters.direction is "${String(direction)}". ` +
          'Fix: Set action.parameters.direction to one of: forward, backward, inward, outward.'
      );
    }

    if (typeof powerSpent !== 'number' || !Number.isFinite(powerSpent) || powerSpent < 1) {
      throw new Error(
        'Cannot resolve maneuver action because powerSpent is invalid. ' +
          `Root cause: action.parameters.powerSpent is "${String(powerSpent)}". ` +
          'Fix: Set action.parameters.powerSpent to a positive number.'
      );
    }

    if (hasRequestedDistance) {
      if (requestedDistanceRaw === null || requestedDistanceRaw === undefined) {
        // Null/undefined means: move full distance (max acceleration)
      } else if (requestedDistance === null) {
        throw new Error(
          'Cannot resolve maneuver action because distance is invalid. ' +
            `Root cause: action.parameters.distance is "${String(requestedDistanceRaw)}". ` +
            'Fix: Set action.parameters.distance to a positive integer number of spaces (or omit it to move the full distance).'
        );
      } else if (!Number.isInteger(requestedDistance) || requestedDistance < 1) {
        throw new Error(
          'Cannot resolve maneuver action because distance is invalid. ' +
            `Root cause: action.parameters.distance is "${String(requestedDistanceRaw)}". ` +
            'Fix: Set action.parameters.distance to a positive integer number of spaces (or omit it to move the full distance).'
        );
      }
    }

    const drivesState = workingPlayer.ship.sections[SHIP_SECTIONS.DRIVES];
    if (!drivesState) {
      throw new Error(
        'Cannot resolve maneuver action because Drives section state was not found. ' +
          `Root cause: ship.sections has no entry for section "${SHIP_SECTIONS.DRIVES}" (crew "${action.crewId}"). ` +
          'Fix: Ensure all ship sections are initialized in ship.sections.'
      );
    }

    if (drivesState.hull <= 0) {
      throw new Error(
        'Cannot resolve maneuver action because Drives section is damaged (hull is zero). ' +
          `Root cause: Drives hull=${drivesState.hull} for crew "${action.crewId}". ` +
          'Fix: Repair Drives hull to at least 1 before maneuvering.'
      );
    }

    const drivesPower = drivesState.powerDice.reduce((sum, die) => sum + die, 0);
    if (drivesPower < powerSpent) {
      throw new Error(
        'Cannot resolve maneuver action because Drives section does not have enough power to spend. ' +
          `Root cause: requested ${powerSpent} power but Drives has only ${drivesPower}. ` +
          'Fix: Restore or route more power to Drives before maneuvering.'
      );
    }

    // Section_Bonus: Bridge fully powered adds +1 maneuver acceleration.(source)
    const bridgeFullyPoweredAtStart = ShipUtils.isFullyPowered(workingPlayer.ship, SHIP_SECTIONS.BRIDGE);
    const workingShip = spendPowerInSection(workingPlayer.ship, SHIP_SECTIONS.DRIVES, powerSpent);

    // Calculate maximum acceleration
    let acceleration = powerSpent;

    // Bridge fully powered bonus
    if (bridgeFullyPoweredAtStart) {
      acceleration += 1;
    }

    // Crew bonuses
    const maneuverBonus = getManeuverBonus(crew);
    acceleration += maneuverBonus;
    if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && maneuverBonus > 0) {
      acceleration += 1;
    }

    if (playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'inertia_control')) {
      acceleration += 1;
    }
    if (playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'ion_engine')) {
      acceleration += 1;
    }

    const distanceToMove = requestedDistance === null ? acceleration : requestedDistance;
    if (distanceToMove > acceleration) {
      throw new Error(
        'Cannot resolve maneuver action because requested distance exceeds maximum acceleration. ' +
          `Root cause: requested distance ${distanceToMove} but max acceleration is ${acceleration}. ` +
          'Fix: Reduce action.parameters.distance (or omit it to move the full distance).'
      );
    }

    // Apply movement based on direction
    let updatedShip = moveShip(workingShip, direction, distanceToMove, game.board);
    if (playerHasPoweredUpgrade(workingPlayer, workingShip, 'plasma_engine')) {
      updatedShip = addPowerToSection(updatedShip, SHIP_SECTIONS.DRIVES, 1);
    }

    const updatedPlayer: PlayerState = {
      ...workingPlayer,
      ship: updatedShip,
    };

    updatedPlayers.set(playerId, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

// Crew_Bonus: Source of truth for maneuver acceleration bonuses; referenced by ShipDashboard previews.
/**
 * Get maneuver bonus for a crew member
 * Purpose: Calculate crew-specific acceleration bonuses
 * Parameters:
 *   - crew: Crew member performing maneuver action
 * Returns: Acceleration bonus (0 for no bonus, up to +2 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Pilot: +1 acceleration
 * - Ace Pilot: +2 acceleration
 */
function getManeuverBonus(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'pilot') {
      return 1;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'ace_pilot') {
      return 2;
    }
    if (officer.role === 'first_officer') {
      return 1;
    }
  }

  return 0;
}

/**
 * Move a ship in a direction
 * Purpose: Update ship position based on acceleration and direction
 * Parameters:
 *   - ship: Current ship state
 *   - direction: Movement direction ('forward', 'backward', 'inward', 'outward')
 *   - acceleration: Number of spaces to move
 *   - board: Current board for bounds checking
 * Returns: New Ship state with updated position
 * Side effects: None (pure function)
 */
function moveShip(
  ship: Ship,
  direction: string,
  acceleration: number,
  board: Board,
): Ship {
  let newRing = ship.position.ring;
  let newSpace = ship.position.space;

  const currentRing = board.rings[ship.position.ring - 1];

  if (!currentRing) {
    throw new Error(
      'Cannot move ship because current ring is invalid. ' +
      `Root cause: ring ${ship.position.ring} not found in board.rings. ` +
      'Fix: Ensure ship position is valid before maneuvering.'
    );
  }

  switch (direction) {
    case 'forward':
      // Move forward along the ring (counterclockwise per rulebook)
      newSpace = (ship.position.space + acceleration) % currentRing.numSpaces;
      break;

    case 'backward':
      // Move backward along the ring
      newSpace = (ship.position.space - acceleration + currentRing.numSpaces) % currentRing.numSpaces;
      break;

    case 'inward':
      // Move toward center (lower ring number). Radial steps scale with acceleration.
      {
        const radialSteps = Math.max(1, Math.floor(acceleration));
        let workingRing = ship.position.ring;
        let workingSpace = ship.position.space;
        let workingRingDef = currentRing;

        for (let i = 0; i < radialSteps; i++) {
          if (workingRing <= 1) {
            break;
          }
          const nextRing = workingRing - 1;
          const nextRingDef = board.rings[nextRing - 1];
          if (!nextRingDef) {
            break;
          }
          workingSpace = Math.floor(workingSpace * nextRingDef.numSpaces / workingRingDef.numSpaces);
          workingRing = nextRing;
          workingRingDef = nextRingDef;
        }

        newRing = workingRing;
        newSpace = workingSpace;
      }
      break;

    case 'outward':
      // Move away from center (higher ring number). Radial steps scale with acceleration.
      {
        const radialSteps = Math.max(1, Math.floor(acceleration));
        let workingRing = ship.position.ring;
        let workingSpace = ship.position.space;
        let workingRingDef = currentRing;

        for (let i = 0; i < radialSteps; i++) {
          if (workingRing >= board.rings.length) {
            break;
          }
          const nextRing = workingRing + 1;
          const nextRingDef = board.rings[nextRing - 1];
          if (!nextRingDef) {
            break;
          }
          workingSpace = Math.floor(workingSpace * nextRingDef.numSpaces / workingRingDef.numSpaces);
          workingRing = nextRing;
          workingRingDef = nextRingDef;
        }

        newRing = workingRing;
        newSpace = workingSpace;
      }
      break;

    default:
      throw new Error(
        'Cannot move ship because direction is unknown. ' +
        `Root cause: direction "${direction}" is not one of: forward, backward, inward, outward. ` +
        'Fix: Set action.parameters.direction to a valid movement direction.'
      );
  }

  // Validate new position
  const newPosition = { ring: newRing, space: newSpace };

  if (!BoardUtils.isValidPosition(newPosition, board)) {
    throw new Error(
      'Cannot move ship because new position would be outside board bounds. ' +
      `Root cause: calculated position ring=${newRing}, space=${newSpace} is invalid. ` +
      'Fix: Reduce acceleration or choose a different direction.'
    );
  }

  return {
    ...ship,
    position: newPosition,
  };
}

export function previewManeuver(
  ship: Ship,
  crew: AnyCrew | Captain,
  direction: string,
  powerSpent: number,
  board: Board,
  distance?: number,
  installedUpgrades?: UpgradeCard[],
): { shipAfterCost: Ship; updatedShip: Ship; acceleration: number; distanceMoved: number } {
  const actingSection = requireCrewLocationForAction(crew, 'maneuver', crew.id);
  requireActingSectionPoweredAndIntact(ship, actingSection, 'maneuver', crew.id);

  if (actingSection !== SHIP_SECTIONS.BRIDGE) {
    throw new Error(
      'Cannot preview maneuver because crew is not in Bridge section. ' +
        `Root cause: crew "${crew.id}" is in section "${String(actingSection)}" but must be in "${SHIP_SECTIONS.BRIDGE}". ` +
        'Fix: Move crew to Bridge before maneuvering.'
    );
  }

  if (
    direction !== 'forward' &&
    direction !== 'backward' &&
    direction !== 'inward' &&
    direction !== 'outward'
  ) {
    throw new Error(
      'Cannot preview maneuver because direction is unknown. ' +
        `Root cause: direction is "${String(direction)}". ` +
        'Fix: Set direction to one of: forward, backward, inward, outward.'
    );
  }

  if (typeof powerSpent !== 'number' || !Number.isFinite(powerSpent) || powerSpent < 1) {
    throw new Error(
      'Cannot preview maneuver because powerSpent is invalid. ' +
        `Root cause: powerSpent is "${String(powerSpent)}". ` +
        'Fix: Set powerSpent to a positive number.'
    );
  }

  if (distance !== undefined) {
    if (typeof distance !== 'number' || !Number.isFinite(distance) || !Number.isInteger(distance) || distance < 1) {
      throw new Error(
        'Cannot preview maneuver because distance is invalid. ' +
          `Root cause: distance is "${String(distance)}". ` +
          'Fix: Provide distance as a positive integer number of spaces (or omit it to preview the full distance).'
      );
    }
  }

  const drivesState = ship.sections[SHIP_SECTIONS.DRIVES];
  if (!drivesState) {
    throw new Error(
      'Cannot preview maneuver because Drives section state was not found. ' +
        `Root cause: ship.sections has no entry for section "${SHIP_SECTIONS.DRIVES}" (crew "${crew.id}"). ` +
        'Fix: Ensure all ship sections are initialized in ship.sections.'
    );
  }

  if (drivesState.hull <= 0) {
    throw new Error(
      'Cannot preview maneuver because Drives section is damaged (hull is zero). ' +
        `Root cause: Drives hull=${drivesState.hull} for crew "${crew.id}". ` +
        'Fix: Repair Drives hull to at least 1 before maneuvering.'
    );
  }

  const drivesPower = drivesState.powerDice.reduce((sum, die) => sum + die, 0);
  if (drivesPower < powerSpent) {
    throw new Error(
      'Cannot preview maneuver because Drives section does not have enough power to spend. ' +
        `Root cause: requested ${powerSpent} power but Drives has only ${drivesPower}. ` +
        'Fix: Restore or route more power to Drives before maneuvering.'
    );
  }

  // Section_Bonus: Bridge fully powered adds +1 acceleration for manual maneuvers.(source)
  const bridgeFullyPoweredAtStart = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.BRIDGE);

  const shipAfterCost = spendPowerInSection(ship, SHIP_SECTIONS.DRIVES, powerSpent);

  let acceleration = powerSpent;
  if (bridgeFullyPoweredAtStart) {
    acceleration += 1;
  }
  acceleration += getManeuverBonus(crew);

  if (upgradeListHas(installedUpgrades, 'inertia_control')) {
    acceleration += 1;
  }
  if (upgradeListHas(installedUpgrades, 'ion_engine')) {
    acceleration += 1;
  }

  const distanceToMove = distance === undefined ? acceleration : distance;
  if (distanceToMove > acceleration) {
    throw new Error(
      'Cannot preview maneuver because requested distance exceeds maximum acceleration. ' +
        `Root cause: requested distance ${distanceToMove} but max acceleration is ${acceleration}. ` +
        'Fix: Reduce distance or increase powerSpent/bonuses so max acceleration is high enough.'
    );
  }

  const updatedShip = moveShip(shipAfterCost, direction, distanceToMove, board);
  return { shipAfterCost, updatedShip, acceleration, distanceMoved: distanceToMove };
}

/**
 * Resolve scan actions
 * Purpose: Process object scanning and discovery
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of scan actions to process
 * Returns: New GameState with scan results tracked
 * Side effects: None (pure function)
 *
 * Scan rules (from rulebook):
 * - Must be in range (adjacent, or +2 if Sci-Lab fully powered)
 * - Roll d6 for resource discovery based on object type
 * - Asteroid: 6+ = random resource
 * - Debris: 4+ = random resource
 * - Wreck: 2+ = resource, 5+ = upgrade
 * - Station: auto resource, 4+ = upgrade
 * - Hostile: +2 damage to next attack (tracked separately)
 * - Target object in action.target.objectId
 * - Roll value in action.parameters.rollValue
 *
 * Note: Scan results are stored but not collected until Acquire action.
 * For simplicity, we track scan results in action.parameters.scanResult.
 */
function resolveScanActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  // For now, scan is primarily informational – it validates range and may
  // trigger event-based rewards such as Distress Call. Actual resource
  // discovery happens during Acquire based on roll.

  const players = new Map<string, PlayerState>(game.players);
  let updatedObjects = [...game.board.objects];
  let eventState = game.eventState;

  for (const { playerId, action } of actions) {
    const player = players.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve scan action because crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve scan action because crew member is not active. ' +
        `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
        'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'scan', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'scan', action.crewId);

    // Section_Bonus: Science Lab fully powered grants +2 (or +3 technologist) scan range.(source)
    const sciLabFullyPoweredAtStart = ShipUtils.isFullyPowered(workingPlayer.ship, SHIP_SECTIONS.SCI_LAB);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    // Get target object
    const targetObjectId = action.target?.objectId;

    if (!targetObjectId) {
      throw new Error(
        'Cannot resolve scan action because target object is not specified. ' +
        `Root cause: action.target.objectId is undefined for player "${playerId}". ` +
        'Fix: Specify which object to scan in action.target.objectId.'
      );
    }

    const targetObject = updatedObjects.find(obj => obj.id === targetObjectId);

    if (!targetObject) {
      throw new Error(
        'Cannot resolve scan action because target object not found on board. ' +
        `Root cause: objectId "${targetObjectId}" not found in game.board.objects. ` +
        'Fix: Specify a valid object ID from the current board.'
      );
    }

    // Check range
    const distance = BoardUtils.calculateDistance(workingPlayer.ship.position, targetObject.position, game.board);
    let maxRange = 1; // Adjacent

    const sciLabRangeBonus = sciLabFullyPoweredAtStart
      ? (workingPlayer.captain.captainType === 'technologist' ? 3 : 2)
      : 0;
    maxRange += sciLabRangeBonus;

    // Crew bonus (Scientist/Senior Scientist)
    const scanRangeBonus = getScanRangeBonus(crew);
    maxRange += scanRangeBonus;
    if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && scanRangeBonus > 0) {
      maxRange += 1;
    }

    if (actingSection === SHIP_SECTIONS.BRIDGE && playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'neutron_calibrator')) {
      maxRange += 1;
    }

    if (distance > maxRange) {
      throw new Error(
        'Cannot resolve scan action because target object is out of range. ' +
        `Root cause: distance to object is ${distance}, but max range is ${maxRange}. ` +
        'Fix: Move closer to the object or improve Sci-Lab power/crew bonuses.'
      );
    }

    const canTachyonBeamClearHazard =
      actingSection === SHIP_SECTIONS.SCI_LAB &&
      targetObject.type === 'hazard' &&
      playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'tachyon_beam');

    if (canTachyonBeamClearHazard) {
      if (distance > 1) {
        throw new Error(
          'Cannot resolve Tachyon Beam scan because hazard is not adjacent. ' +
            `Root cause: distance to hazard is ${distance}, but Tachyon Beam requires distance 1 or less. ` +
            'Fix: Move closer to the hazard before attempting to remove it.'
        );
      }

      const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);
      workingPlayer = {
        ...workingPlayer,
        ship: shipAfterCost,
      };

      updatedObjects = updatedObjects.filter(obj => obj.id !== targetObjectId);
      players.set(playerId, workingPlayer);
      continue;
    }

    const scanTargets = [targetObject];
    const rawSecondaryTargetObjectId = (action.parameters as Record<string, unknown> | undefined)
      ?.secondaryTargetObjectId;

    if (stimResult.stimmed && typeof rawSecondaryTargetObjectId === 'string' && rawSecondaryTargetObjectId.length > 0) {
      const secondaryObject = updatedObjects.find(obj => obj.id === rawSecondaryTargetObjectId);
      if (!secondaryObject) {
        throw new Error(
          'Cannot resolve scan action because secondary target object not found on board. ' +
            `Root cause: action.parameters.secondaryTargetObjectId is "${String(rawSecondaryTargetObjectId)}" but no matching object exists in game.board.objects. ` +
            'Fix: Set secondaryTargetObjectId to a valid object id in game.board.objects, or omit it.'
        );
      }

      const secondaryDistance = BoardUtils.calculateDistance(
        workingPlayer.ship.position,
        secondaryObject.position,
        game.board,
      );
      if (secondaryDistance > maxRange) {
        throw new Error(
          'Cannot resolve scan action because secondary target object is out of range. ' +
            `Root cause: distance to object is ${secondaryDistance}, but max range is ${maxRange}. ` +
            'Fix: Move closer to the object or improve Sci-Lab power/crew bonuses.'
        );
      }

      scanTargets.push(secondaryObject);
    }

    for (const scanTarget of scanTargets) {
      if (scanTarget.type === 'hostile_ship') {
        const scannedHostiles = {
          ...(workingPlayer.scannedHostiles ?? {}),
          [scanTarget.id]: game.currentTurn,
        };

        workingPlayer = {
          ...workingPlayer,
          scannedHostiles,
        };
      }

      const distressState = eventState?.distressCall;
      const isDistressStation =
        distressState &&
        distressState.stationId === scanTarget.id &&
        (!distressState.claimedByPlayerId || distressState.claimedByPlayerId === null);

      if (isDistressStation) {
        const objectIndex = updatedObjects.findIndex((obj) => obj.id === scanTarget.id);
        const station = objectIndex >= 0 ? updatedObjects[objectIndex] : null;
        const stationUpgrade = station ? (station as any).lootUpgrade : null;

        if (stationUpgrade) {
          workingPlayer = {
            ...workingPlayer,
            pendingUpgrades: [...workingPlayer.pendingUpgrades, stationUpgrade],
          };

          updatedObjects[objectIndex] = {
            ...station,
            lootUpgrade: null,
          } as AnySpaceObject;
        }

        eventState = {
          ...(eventState ?? {}),
          distressCall: {
            stationId: distressState!.stationId,
            claimedByPlayerId: playerId,
          },
        };
      }
    }

    const refreshedScanTargets = scanTargets.map(
      (target) => updatedObjects.find((obj) => obj.id === target.id) ?? target,
    );

    const discoveries = { ...(workingPlayer.scanDiscoveriesByObjectId ?? {}) };

    for (const scanTarget of refreshedScanTargets) {
      const lootResourceTypeRaw = (scanTarget as any).lootResourceType;
      const lootUpgradeRaw = (scanTarget as any).lootUpgrade;
      const lootRollValueRaw = (scanTarget as any).lootRollValue;

      const rollValue = typeof lootRollValueRaw === 'number' && Number.isFinite(lootRollValueRaw)
        ? lootRollValueRaw
        : 0;

      const totalRoll = rollValue;

      const hasLootUpgrade = !!lootUpgradeRaw;
      const reservedUpgrade: UpgradeCard | null = hasLootUpgrade ? (lootUpgradeRaw as UpgradeCard) : null;
      const resourceType = (() => {
        const hasLootResource = typeof lootResourceTypeRaw === 'string' && lootResourceTypeRaw.length > 0;
        if (!hasLootResource) {
          return null;
        }
        if (!BASIC_RESOURCE_TYPES.includes(lootResourceTypeRaw as BasicResourceType)) {
          return null;
        }
        return lootResourceTypeRaw as BasicResourceType;
      })();

      const foundResource = resourceType !== null;

      discoveries[scanTarget.id] = {
        objectId: scanTarget.id,
        objectType: scanTarget.type,
        source: 'scan',
        rollValue,
        totalRoll,
        foundResource,
        resourceType,
        foundUpgrade: hasLootUpgrade,
        reservedUpgrade,
        revealedAtTurn: game.currentTurn,
        crewId: action.crewId,
      } satisfies ScanDiscoveryRecord;
    }

    const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);
    workingPlayer = {
      ...workingPlayer,
      ship: shipAfterCost,
      scanDiscoveriesByObjectId: discoveries,
    };

    players.set(playerId, workingPlayer);
  }

  // Scan validation passed - actual discovery happens on Acquire.
  // Only event-driven side effects (like Distress Call) modify state here.
  return {
    ...game,
    board: {
      ...game.board,
      objects: updatedObjects,
    },
    players,
    eventState,
  };
}

// Crew_Bonus: Source of truth for scan range bonuses; ShipDashboard preview must remain in sync.
/**
 * Get scan range bonus for a crew member
 * Purpose: Calculate crew-specific scan range bonuses
 * Parameters:
 *   - crew: Crew member performing scan action
 * Returns: Range bonus (0 for no bonus, up to +2 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Scientist: +1 range
 * - Senior Scientist: +2 range
 */
function getScanRangeBonus(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'scientist' && crew.location === SHIP_SECTIONS.SCI_LAB) {
      return 1;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (
      crew.type === 'officer' &&
      crew.role === 'senior_scientist' &&
      (crew.location === SHIP_SECTIONS.BRIDGE || crew.location === SHIP_SECTIONS.SCI_LAB)
    ) {
      return 2;
    }
    if (officer.role === 'first_officer' && crew.location === SHIP_SECTIONS.SCI_LAB) {
      return 1;
    }
  }

  if (crew.type === 'captain' && crew.location === SHIP_SECTIONS.SCI_LAB) {
    return 1;
  }

  return 0;
}

/**
 * Resolve acquire actions
 * Purpose: Process resource collection from scanned objects
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of acquire actions to process
 * Returns: New GameState with resources added to players
 * Side effects: None (pure function)
 *
 * Acquire rules (from rulebook):
 * - Must be in range of object (same as scan)
 * - Roll determines what is found (provided in parameters)
 * - Resources added to player inventory
 * - Upgrades added to pendingUpgrades
 *
 * Discovery thresholds:
 * - Asteroid: 6+ = random resource
 * - Debris: 4+ = random resource
 * - Wreck: 2+ = resource, 5+ = upgrade
 * - Station: auto resource, 4+ = upgrade
 */
function resolveAcquireActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();
  const removedObjectIds = new Set<string>();
  let updatedObjects = [...game.board.objects];

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve acquire action because crew member not found. ' +
          `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
          'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve acquire action because crew member is not active. ' +
          `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
          'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'acquire', action.crewId);
    const hasTeleporterUpgrade = actingSection === SHIP_SECTIONS.SCI_LAB && playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'teleporter');
    if (!hasTeleporterUpgrade) {
      requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'acquire', action.crewId);
    } else {
      const sectionState = workingPlayer.ship.sections[actingSection];
      if (!sectionState) {
        throw new Error(
          'Cannot resolve acquire action because acting section state was not found. ' +
            `Root cause: ship.sections has no entry for section "${actingSection}" (crew "${action.crewId}"). ` +
            'Fix: Ensure all ship sections are initialized in ship.sections.'
        );
      }
      if (sectionState.hull <= 0) {
        throw new Error(
          'Cannot resolve acquire action because acting section is damaged (hull is zero). ' +
            `Root cause: crew "${action.crewId}" is in section "${actingSection}" with hull=${sectionState.hull}. ` +
            'Fix: Repair hull to at least 1 before performing actions in this section.'
        );
      }
    }

    const sciLabFullyPoweredAtStart = ShipUtils.isFullyPowered(workingPlayer.ship, SHIP_SECTIONS.SCI_LAB);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    // Get target object
    const targetObjectId = action.target?.objectId;
    const targetObject = updatedObjects.find(obj => obj.id === targetObjectId);

    if (!targetObject) {
      throw new Error(
        'Cannot resolve acquire action because target object was not found on board. ' +
          `Root cause: action.target.objectId is "${String(targetObjectId)}" but no matching object exists in game.board.objects. ` +
          'Fix: Select a valid object on the board before acquiring.'
      );
    }

    // Check range (same as scan)
    const distance = BoardUtils.calculateDistance(workingPlayer.ship.position, targetObject.position, game.board);
    let maxRange = 1;
    const sciLabRangeBonus = sciLabFullyPoweredAtStart
      ? (workingPlayer.captain.captainType === 'technologist' ? 3 : 2)
      : 0;
    maxRange += sciLabRangeBonus;
    const scanRangeBonus = getScanRangeBonus(crew);
    maxRange += scanRangeBonus;
    if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && scanRangeBonus > 0) {
      maxRange += 1;
    }
    if (actingSection === SHIP_SECTIONS.BRIDGE && playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'neutron_calibrator')) {
      maxRange += 1;
    }
    if (distance > maxRange) {
      throw new Error(
        'Cannot resolve acquire action because target object is out of range. ' +
          `Root cause: distance to object is ${distance}, but max range is ${maxRange}. ` +
          'Fix: Move closer to the object or improve Sci-Lab power/crew bonuses.'
      );
    }

    const shipAfterCost = hasTeleporterUpgrade
      ? workingPlayer.ship
      : spendPowerInSection(workingPlayer.ship, actingSection, 1);
    workingPlayer = {
      ...workingPlayer,
      ship: shipAfterCost,
    };

    const discoveries = workingPlayer.scanDiscoveriesByObjectId ?? {};
    const acquireTargets = [targetObject];
    const rawSecondaryAcquireTargetObjectId = (action.parameters as Record<string, unknown> | undefined)
      ?.secondaryTargetObjectId;

    if (
      stimResult.stimmed &&
      typeof rawSecondaryAcquireTargetObjectId === 'string' &&
      rawSecondaryAcquireTargetObjectId.length > 0
    ) {
      const secondaryObject = updatedObjects.find(obj => obj.id === rawSecondaryAcquireTargetObjectId);
      if (!secondaryObject) {
        throw new Error(
          'Cannot resolve acquire action because secondary target object was not found on board. ' +
            `Root cause: action.parameters.secondaryTargetObjectId is "${String(rawSecondaryAcquireTargetObjectId)}" but no matching object exists in game.board.objects. ` +
            'Fix: Set secondaryTargetObjectId to a valid object id in game.board.objects, or omit it.'
        );
      }

      const secondaryDistance = BoardUtils.calculateDistance(
        workingPlayer.ship.position,
        secondaryObject.position,
        game.board,
      );
      if (secondaryDistance > maxRange) {
        throw new Error(
          'Cannot resolve acquire action because secondary target object is out of range. ' +
            `Root cause: distance to object is ${secondaryDistance}, but max range is ${maxRange}. ` +
            'Fix: Move closer to the object or improve Sci-Lab power/crew bonuses.'
        );
      }

      acquireTargets.push(secondaryObject);
    }

    const updatedScanDiscoveries = { ...discoveries };

    for (const acquireTarget of acquireTargets) {
      const stored = discoveries[acquireTarget.id];
      if (!stored) {
        throw new Error(
          'Cannot resolve acquire action because target was never scanned. ' +
            `Root cause: player "${playerId}" attempted to acquire object "${acquireTarget.id}" without a recorded scan. ` +
            'Fix: Perform a scan action on the object before acquiring.',
        );
      }

      const { foundResource, foundUpgrade, resourceType } = stored;

      if (foundResource && resourceType) {
        const updatedResources: PlayerState['resources'] = {
          ...workingPlayer.resources,
        };

        const currentCount = updatedResources[resourceType] ?? 0;
        updatedResources[resourceType] = currentCount + 1;

        if (workingPlayer.captain.captainType === 'merchant') {
          const bonusType = pickDeterministicBasicResource(
            game,
            `acquire_bonus:${playerId}:${action.crewId}:${acquireTarget.id}:${game.currentTurn}`,
          );
          const currentBonus = updatedResources[bonusType] ?? 0;
          updatedResources[bonusType] = currentBonus + 1;
        }

        workingPlayer = {
          ...workingPlayer,
          resources: updatedResources,
        };
      }

      if (foundUpgrade) {
        if (stored.reservedUpgrade) {
          workingPlayer = {
            ...workingPlayer,
            pendingUpgrades: [...workingPlayer.pendingUpgrades, stored.reservedUpgrade],
          };
        }
      }

      updatedObjects = updatedObjects.filter((obj) => obj.id !== acquireTarget.id);
      removedObjectIds.add(acquireTarget.id);

      delete updatedScanDiscoveries[acquireTarget.id];
    }

    workingPlayer = {
      ...workingPlayer,
      scanDiscoveriesByObjectId: updatedScanDiscoveries,
    };

    updatedPlayers.set(playerId, workingPlayer);

    // Upgrades would be handled similarly with pendingUpgrades
    // (Simplified for now - full implementation would draw from upgrade deck)
  }

  if (removedObjectIds.size > 0) {
    for (const [playerId, player] of updatedPlayers.entries()) {
      const discoveries = player.scanDiscoveriesByObjectId;
      if (!discoveries) {
        continue;
      }

      let didChange = false;
      const next = { ...discoveries };
      for (const removedId of removedObjectIds) {
        if (next[removedId]) {
          delete next[removedId];
          didChange = true;
        }
      }

      if (didChange) {
        updatedPlayers.set(playerId, {
          ...player,
          scanDiscoveriesByObjectId: next,
        });
      }
    }
  }

  return {
    ...game,
    board: {
      ...game.board,
      objects: updatedObjects,
    },
    players: updatedPlayers,
  };
}

/**
 * Determine discovery result from scanning an object
 * Purpose: Calculate what resources/upgrades are found
 * Parameters:
 *   - objectType: Type of object being acquired from
 *   - rollValue: D6 roll result
 * Returns: Discovery result with optional resource type and upgrade flag
 * Side effects: None (pure function)
 */


/**
 * Resolve attack actions
 * Purpose: Process weapon attacks against hostiles or other targets
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of attack actions to process
 * Returns: New GameState with attack damage applied
 * Side effects: None (pure function)
 *
 * Attack rules (from rulebook):
 * - Must be in Defense section with power
 * - Fixed roll value (no d6 randomness), 2 dice fixed at 3 each
 * - Damage applies to target shields first, then hull
 * - Hostile ships: base damage + modifiers
 * - Scanned hostiles: +2 damage
 * - Tactician: +2 damage, Master Tactician: +4 damage
 * - Target in action.target.objectId (hostile) or action.target.playerId (PvP)
 * - rollValues are not provided in action.parameters (engine computes a fixed value)
 */
function resolveAttackActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  const updatedObjects = [...game.board.objects];

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve attack action because crew member not found. ' +
        `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
        'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve attack action because crew member is not active. ' +
        `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
        'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'attack', action.crewId);

    const canAttackFromBridge =
      actingSection === SHIP_SECTIONS.BRIDGE &&
      playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'tactical_bridge');

    if (actingSection !== SHIP_SECTIONS.DEFENSE && !canAttackFromBridge) {
      throw new Error(
        'Cannot resolve attack action because crew is not in Defense section and Tactical Bridge is not active. ' +
          `Root cause: crew is in "${crew.location}" and acted from "${actingSection}". ` +
          'Fix: Move crew to Defense section, or install and power Tactical Bridge to attack from Bridge.'
      );
    }

    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'attack', action.crewId);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    const attackSection = canAttackFromBridge ? SHIP_SECTIONS.BRIDGE : SHIP_SECTIONS.DEFENSE;
    const attackSectionFullyPoweredAtStart = ShipUtils.isFullyPowered(workingPlayer.ship, attackSection);

    const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);
    workingPlayer = {
      ...workingPlayer,
      ship: shipAfterCost,
    };

    if (!attackSectionFullyPoweredAtStart) {
      const sectionState = player.ship.sections[attackSection];
      if (!sectionState || sectionState.powerDice.length === 0) {
        throw new Error(
          'Cannot resolve attack action because the attack section has no power. ' +
            `Root cause: ${attackSection} powerDice is empty. ` +
            'Fix: Generate power to the section used to perform the attack before attacking.'
        );
      }
    }

    const rollValues = getFixedAttackRollValues();

    const baseDamage = rollValues.reduce((sum, v) => sum + v, 0);

    // Calculate damage bonuses
    let damageBonus = 0;

    // Crew bonus
    const crewDamageBonus = getAttackDamageBonus(crew);
    damageBonus += crewDamageBonus;
    if (workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && crewDamageBonus > 0) {
      damageBonus += 1;
    }

    if (workingPlayer.captain.captainType === 'imperialist') {
      damageBonus += 1;
    }

    if (attackSectionFullyPoweredAtStart) {
      damageBonus += 2;
    }

    // Check if target is a hostile object
    const targetObjectId = action.target?.objectId;

    if (targetObjectId) {
      const objectIndex = updatedObjects.findIndex(obj => obj.id === targetObjectId);

      if (objectIndex === -1) {
        throw new Error(
          'Cannot resolve attack action because target object not found. ' +
          `Root cause: objectId "${targetObjectId}" not found on board. ` +
          'Fix: Specify a valid target object ID.'
        );
      }

      const targetObject = updatedObjects[objectIndex];

      // Validate target is attackable (hostile)
      if (targetObject.type !== 'hostile_ship') {
        throw new Error(
          'Cannot resolve attack action because target is not hostile. ' +
          `Root cause: object type is "${targetObject.type}" not "hostile_ship". ` +
          'Fix: Only hostile ships can be attacked.'
        );
      }

      // Check range (must be adjacent for attack)
      const distance = BoardUtils.calculateDistance(
        workingPlayer.ship.position,
        targetObject.position,
        game.board
      );

      if (distance > 1) {
        throw new Error(
          'Cannot resolve attack action because target is out of range. ' +
          `Root cause: distance to target is ${distance}, must be adjacent (1). ` +
          'Fix: Move closer to the hostile ship before attacking.'
        );
      }

      const scannedTurn = workingPlayer.scannedHostiles?.[targetObjectId];
      if (typeof scannedTurn === 'number') {
        damageBonus += 2;

        const scannedHostiles = { ...(workingPlayer.scannedHostiles ?? {}) };
        delete scannedHostiles[targetObjectId];
        workingPlayer = {
          ...workingPlayer,
          scannedHostiles,
        };
      }

      if (playerHasPoweredUpgrade(workingPlayer, workingPlayer.ship, 'ai_defense')) {
        const scannedHostiles = {
          ...(workingPlayer.scannedHostiles ?? {}),
          [targetObjectId]: game.currentTurn,
        };
        workingPlayer = {
          ...workingPlayer,
          scannedHostiles,
        };
      }

      // Calculate total damage
      const totalDamage = baseDamage + damageBonus;

      // Apply damage to hostile
      // Hostiles have hull points; when reduced to 0, they become debris
      const hostile = targetObject as { id: string; type: ObjectType; position: ShipPosition; hull?: number };
      const currentHull = hostile.hull ?? 12;
      const newHull = Math.max(0, currentHull - totalDamage);

      if (newHull <= 0) {
        // Hostile destroyed - convert to debris
        // Create a new debris object at the same position
        const debris: AnySpaceObject = {
          id: targetObject.id,
          type: 'debris',
          position: targetObject.position,
        } as AnySpaceObject;

        updatedObjects[objectIndex] = assignLootToObject({
          game,
          object: debris,
          upgradeDeck: game.upgradeDeck,
          seedPrefix: 'board_loot_convert',
        }).object;
      } else {
        // Update hostile hull
        updatedObjects[objectIndex] = {
          ...targetObject,
          hull: newHull,
        } as typeof targetObject;
      }
    }

    updatedPlayers.set(playerId, workingPlayer);

    // PvP attacks would target action.target.playerId
    // (Not implemented for now - focus on PvE vs hostiles)
  }

  // Update board with modified objects
  const updatedBoard: Board = {
    ...game.board,
    objects: updatedObjects,
  };

  return {
    ...game,
    board: updatedBoard,
    players: updatedPlayers,
  };
}

// Crew_Bonus: Source of truth for attack damage bonuses; UI preview and combat displays should mirror.
/**
 * Get attack damage bonus for a crew member
 * Purpose: Calculate crew-specific attack damage bonuses
 * Parameters:
 *   - crew: Crew member performing attack action
 * Returns: Damage bonus (0 for no bonus, up to +4 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Tactician: +2 damage
 * - Master Tactician: +4 damage
 */
function getAttackDamageBonus(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'tactician') {
      return 2;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'master_tactician') {
      return 4;
    }
    if (officer.role === 'first_officer') {
      return 1;
    }
  }

  return 0;
}

/**
 * Resolve launch actions
 * Purpose: Process torpedo/probe launches
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of launch actions to process
 * Returns: New GameState with launch effects applied
 * Side effects: None (pure function)
 *
 * Launch rules (from rulebook):
 * - Torpedo: 6 damage to target, consumes 1 torpedo resource
 * - Probe: Reveals hidden object information, consumes 1 probe
 * - Must have resource available
 * - Target in action.target.objectId
 * - Launch type in action.parameters.launchType: 'torpedo' | 'probe'
 */
function resolveLaunchActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();
  let updatedObjects = [...game.board.objects];
  const upgradeDeck = game.upgradeDeck;

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve launch action because crew member not found. ' +
          `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
          'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve launch action because crew member is not active. ' +
          `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
          'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'launch', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'launch', action.crewId);

    if (actingSection !== SHIP_SECTIONS.BRIDGE) {
      throw new Error(
        'Cannot resolve launch action because crew is not in Bridge section. ' +
          `Root cause: crew is in "${actingSection}" but launch must be performed from Bridge. ` +
          'Fix: Move crew to Bridge section before launching.'
      );
    }

    const rawLaunchType = action.parameters?.launchType as unknown;
    if (typeof rawLaunchType !== 'string') {
      throw new Error(
        'Cannot resolve launch action because launchType is missing or invalid. ' +
          `Root cause: action.parameters.launchType is "${String(rawLaunchType)}". ` +
          'Fix: Set action.parameters.launchType to "torpedo" or "probe".'
      );
    }

    const launchType = rawLaunchType;

    if (launchType !== 'torpedo' && launchType !== 'probe') {
      throw new Error(
        'Cannot resolve launch action because launchType is invalid. ' +
          `Root cause: action.parameters.launchType is "${String(launchType)}". ` +
          'Fix: Set action.parameters.launchType to "torpedo" or "probe".'
      );
    }

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);
    workingPlayer = {
      ...workingPlayer,
      ship: shipAfterCost,
    };

    const parameters = action.parameters as Record<string, unknown> | undefined;
    const rawSecondaryLaunchType = parameters?.secondaryLaunchType;
    const rawSecondaryTargetObjectId = parameters?.secondaryTargetObjectId;

    const launchSteps: Array<{ launchType: 'torpedo' | 'probe'; targetObjectId: string }> = [];

    const primaryTargetObjectId = action.target?.objectId;
    if (typeof primaryTargetObjectId !== 'string' || primaryTargetObjectId.length === 0) {
      throw new Error(
        'Cannot resolve launch action because target is not specified. ' +
          `Root cause: action.target.objectId is "${String(primaryTargetObjectId)}" for player "${playerId}". ` +
          'Fix: Specify which object to target when launching.'
      );
    }

    launchSteps.push({ launchType, targetObjectId: primaryTargetObjectId });

    if (
      stimResult.stimmed &&
      (rawSecondaryLaunchType !== undefined || rawSecondaryTargetObjectId !== undefined)
    ) {
      if (typeof rawSecondaryTargetObjectId !== 'string' || rawSecondaryTargetObjectId.length === 0) {
        throw new Error(
          'Cannot resolve stimmed launch action because secondaryTargetObjectId is missing or invalid. ' +
            `Root cause: action.parameters.secondaryTargetObjectId is "${String(rawSecondaryTargetObjectId)}". ` +
            'Fix: Set action.parameters.secondaryTargetObjectId to a valid object id, or omit all secondary launch parameters.'
        );
      }

      const secondaryLaunchTypeRaw = rawSecondaryLaunchType ?? launchType;
      if (secondaryLaunchTypeRaw !== 'torpedo' && secondaryLaunchTypeRaw !== 'probe') {
        throw new Error(
          'Cannot resolve stimmed launch action because secondaryLaunchType is invalid. ' +
            `Root cause: action.parameters.secondaryLaunchType is "${String(secondaryLaunchTypeRaw)}". ` +
            'Fix: Set secondaryLaunchType to "torpedo" or "probe" (or omit it to reuse launchType).'
        );
      }

      launchSteps.push({
        launchType: secondaryLaunchTypeRaw,
        targetObjectId: rawSecondaryTargetObjectId,
      });
    }

    let discoveries = { ...(workingPlayer.scanDiscoveriesByObjectId ?? {}) };

    for (const step of launchSteps) {
      if (step.launchType === 'torpedo') {
        const torpedoCount = workingPlayer.resources.torpedo ?? 0;

        if (torpedoCount <= 0) {
          throw new Error(
            'Cannot resolve launch action because no torpedoes available. ' +
              `Root cause: player "${playerId}" has ${torpedoCount} torpedoes. ` +
              'Fix: Acquire or assemble torpedoes before launching.'
          );
        }

        const objectIndex = updatedObjects.findIndex(obj => obj.id === step.targetObjectId);

        if (objectIndex === -1) {
          throw new Error(
            'Cannot resolve launch action because target object not found. ' +
              `Root cause: objectId "${step.targetObjectId}" not found on board. ` +
              'Fix: Specify a valid target object ID.'
          );
        }

        const targetObject = updatedObjects[objectIndex];

        const torpedoDamage = 6;

        if (targetObject.type === 'hostile_ship') {
          const hostile = targetObject as { hull?: number };
          const currentHull = hostile.hull ?? 12;
          const newHull = Math.max(0, currentHull - torpedoDamage);

          if (newHull <= 0) {
            const debris: AnySpaceObject = {
              id: targetObject.id,
              type: 'debris',
              position: targetObject.position,
            } as AnySpaceObject;

            updatedObjects[objectIndex] = assignLootToObject({
              game,
              object: debris,
              upgradeDeck: game.upgradeDeck,
              seedPrefix: 'board_loot_convert',
            }).object;
          } else {
            updatedObjects[objectIndex] = {
              ...targetObject,
              hull: newHull,
            } as typeof targetObject;
          }
        }

        workingPlayer = {
          ...workingPlayer,
          resources: {
            ...workingPlayer.resources,
            torpedo: torpedoCount - 1,
          },
        };
      }

      if (step.launchType === 'probe') {
        const probeCount = workingPlayer.resources.probe ?? 0;

        if (probeCount <= 0) {
          throw new Error(
            'Cannot resolve launch action because no probes available. ' +
              `Root cause: player "${playerId}" has ${probeCount} probes. ` +
              'Fix: Acquire or assemble probes before launching.'
          );
        }

        const targetObject = updatedObjects.find(obj => obj.id === step.targetObjectId);

        if (!targetObject) {
          throw new Error(
            'Cannot resolve launch action because probe target object was not found on board. ' +
              `Root cause: target objectId is "${String(step.targetObjectId)}" but no matching object exists in game.board.objects. ` +
              'Fix: Select a valid object on the board before launching a probe.'
          );
        }

        const lootResourceTypeRaw = (targetObject as any).lootResourceType;
        const lootUpgradeRaw = (targetObject as any).lootUpgrade;
        const lootRollValueRaw = (targetObject as any).lootRollValue;

        const rollValue = typeof lootRollValueRaw === 'number' && Number.isFinite(lootRollValueRaw)
          ? lootRollValueRaw
          : 0;

        const totalRoll = rollValue;

        const revealed: ProbeScanRevealedItem[] = [];
        const resourceType =
          typeof lootResourceTypeRaw === 'string' &&
          BASIC_RESOURCE_TYPES.includes(lootResourceTypeRaw as BasicResourceType)
            ? (lootResourceTypeRaw as BasicResourceType)
            : null;

        if (resourceType) {
          revealed.push({ kind: 'resource', resourceType });
        }

        const reservedUpgrade: UpgradeCard | null = lootUpgradeRaw ? (lootUpgradeRaw as UpgradeCard) : null;
        if (reservedUpgrade) {
          revealed.push({ kind: 'upgrade', upgrade: reservedUpgrade });
        }

        discoveries = {
          ...discoveries,
          [targetObject.id]: {
            objectId: targetObject.id,
            objectType: targetObject.type,
            source: 'probe',
            rollValue,
            totalRoll,
            foundResource: resourceType !== null,
            resourceType,
            foundUpgrade: reservedUpgrade !== null,
            reservedUpgrade,
            revealedAtTurn: game.currentTurn,
            crewId: action.crewId,
          },
        };

        const playerWithLog = appendProbeScanLog({
          game,
          player: workingPlayer,
          crewId: action.crewId,
          objectId: targetObject.id,
          objectType: targetObject.type,
          rollValue: totalRoll,
          revealed,
        });

        workingPlayer = {
          ...playerWithLog,
          resources: {
            ...playerWithLog.resources,
            probe: probeCount - 1,
          },
          scanDiscoveriesByObjectId: discoveries,
        };
      }
    }

    updatedPlayers.set(playerId, workingPlayer);
  }

  // Update board with modified objects
  const updatedBoard: Board = {
    ...game.board,
    objects: updatedObjects,
  };

  return {
    ...game,
    board: updatedBoard,
    players: updatedPlayers,
    upgradeDeck,
  };
}

/**
 * Resolve retaliate actions
 * Purpose: Process defensive counter-attacks when attacked
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of retaliate actions to process
 * Returns: New GameState with retaliate damage applied
 * Side effects: None (pure function)
 *
 * Retaliate rules (from rulebook):
 * - Free attack response when your ship is attacked
 * - Same requirements as normal attack (Defense section, power, range)
 * - Can only retaliate once per attack received
 * - Uses same damage calculation as attack
 */
function resolveRetaliateActions(game: GameState, actions: ActionBatch): GameState {
  // Retaliate is essentially the same as attack but triggered defensively
  // The main difference is it doesn't consume an action slot
  // For implementation purposes, we delegate to the attack logic
  return resolveAttackActions(game, actions);
}

/**
 * Resolve assemble actions
 * Purpose: Process resource crafting
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of assemble actions to process
 * Returns: New GameState with assembly progress updated
 * Side effects: None (pure function)
 *
 * Assemble rules (from rulebook):
 * - Fixed roll value (no d6 randomness), accumulate toward 6 points to craft
 * - Craft: spare parts, med-kits, probes, torps
 * - Item type in action.parameters.itemType
 * - rollValue is not provided in action.parameters (engine computes a fixed value)
 */
function resolveAssembleActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve assemble action because crew member not found. ' +
          `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
          'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve assemble action because crew member is not active. ' +
          `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
          'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'assemble', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'assemble', action.crewId);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);

    const rawItemType = action.parameters?.itemType as unknown;
    if (typeof rawItemType !== 'string') {
      throw new Error(
        'Cannot resolve assemble action because itemType is missing or invalid. ' +
          `Root cause: action.parameters.itemType is "${String(rawItemType)}" for crew "${action.crewId}". ` +
          'Fix: Set action.parameters.itemType to one of: spare_parts, medical_kit, probe, torpedo.'
      );
    }

    if (
      rawItemType !== 'spare_parts' &&
      rawItemType !== 'medical_kit' &&
      rawItemType !== 'probe' &&
      rawItemType !== 'torpedo'
    ) {
      throw new Error(
        'Cannot resolve assemble action because itemType is not recognized. ' +
          `Root cause: action.parameters.itemType is "${rawItemType}" for crew "${action.crewId}". ` +
          'Fix: Use one of: spare_parts, medical_kit, probe, torpedo.'
      );
    }

    const itemType = rawItemType;

    const rollValue = getFixedAssembleRollValue(crew, itemType);

    const assembleBonus = getAssembleBonus(crew, itemType);
    const adjustedAssembleBonus =
      workingPlayer.captain.captainType === 'technologist' && crew.type === 'basic' && assembleBonus > 0
        ? assembleBonus + 1
        : assembleBonus;
    const pointsThisAction = rollValue + adjustedAssembleBonus;

    const isCaptain = workingPlayer.captain.id === crew.id;
    const crewIndex = isCaptain ? -1 : workingPlayer.crew.findIndex((c) => c.id === crew.id);
    if (!isCaptain && crewIndex < 0) {
      throw new Error(
        'Cannot resolve assemble action because performing crew member is not present in player crew list. ' +
          `Root cause: crewId "${crew.id}" not found in player.crew for player "${playerId}". ` +
          'Fix: Ensure player.crew contains the crew referenced by the action.'
      );
    }

    const storedAssembleItemType =
      typeof (crew as { assembleItemType?: unknown }).assembleItemType === 'string'
        ? (crew as { assembleItemType: string }).assembleItemType
        : null;

    const storedAssembleProgress =
      typeof (crew as { assembleProgress?: unknown }).assembleProgress === 'number' &&
      Number.isFinite((crew as { assembleProgress: number }).assembleProgress) &&
      (crew as { assembleProgress: number }).assembleProgress > 0
        ? (crew as { assembleProgress: number }).assembleProgress
        : 0;

    const storedProgressByItemTypeRaw = (crew as { assembleProgressByItemType?: unknown })
      .assembleProgressByItemType;

    const storedProgressByItemType: Record<string, number> = {};
    if (
      storedProgressByItemTypeRaw &&
      typeof storedProgressByItemTypeRaw === 'object' &&
      !Array.isArray(storedProgressByItemTypeRaw)
    ) {
      for (const [key, value] of Object.entries(storedProgressByItemTypeRaw as Record<string, unknown>)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          continue;
        }
        storedProgressByItemType[key] = value;
      }
    }

    if (storedAssembleItemType && storedAssembleProgress > 0) {
      const previous = storedProgressByItemType[storedAssembleItemType];
      if (typeof previous !== 'number' || !Number.isFinite(previous) || previous < storedAssembleProgress) {
        storedProgressByItemType[storedAssembleItemType] = storedAssembleProgress;
      }
    }

    const existingProgressRaw = storedProgressByItemType[itemType];
    const existingProgress =
      typeof existingProgressRaw === 'number' && Number.isFinite(existingProgressRaw) && existingProgressRaw > 0
        ? existingProgressRaw
        : 0;

    const iterations = stimResult.stimmed ? 2 : 1;
    let progress = existingProgress;
    let itemsCrafted = 0;

    for (let i = 0; i < iterations; i += 1) {
      const newProgress = progress + pointsThisAction;
      const isComplete = newProgress >= CREW_CONFIG.ASSEMBLE_THRESHOLD;

      if (isComplete) {
        itemsCrafted += 1;
        if (pointsThisAction >= 8) {
          itemsCrafted += 1;
        }
        progress = 0;
      } else {
        progress = newProgress;
      }
    }

    const nextProgressByItemType: Record<string, number> = { ...storedProgressByItemType };
    if (progress > 0) {
      nextProgressByItemType[itemType] = progress;
    } else {
      delete nextProgressByItemType[itemType];
    }

    const updatedCaptain = isCaptain
      ? {
          ...workingPlayer.captain,
          assembleProgress: progress,
          assembleItemType: progress > 0 ? itemType : null,
          assembleProgressByItemType: nextProgressByItemType,
        }
      : workingPlayer.captain;

    const updatedCrew = isCaptain
      ? workingPlayer.crew
      : workingPlayer.crew.map((c, index) =>
          index === crewIndex
            ? {
                ...c,
                assembleProgress: progress,
                assembleItemType: progress > 0 ? itemType : null,
                assembleProgressByItemType: nextProgressByItemType,
              }
            : c,
        );

    const resourceKey = itemType as keyof PlayerState['resources'];
    const updatedResources: PlayerState['resources'] = {
      ...workingPlayer.resources,
    };

    if (itemsCrafted > 0) {
      updatedResources[resourceKey] = (updatedResources[resourceKey] ?? 0) + itemsCrafted;
    }

    workingPlayer = {
      ...workingPlayer,
      ship: shipAfterCost,
      crew: updatedCrew,
      captain: updatedCaptain,
      resources: updatedResources,
    };

    updatedPlayers.set(playerId, workingPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

// Crew_Bonus: Source of truth for assemble bonuses per role/item; UI preview helper references this.
/**
 * Get assemble bonus for a crew member
 * Purpose: Calculate crew-specific assembly bonuses
 * Parameters:
 *   - crew: Crew member performing assemble action
 *   - itemType: Type of item being assembled
 * Returns: Assembly bonus (0 for no bonus, up to +2 for specialists)
 * Side effects: None (pure function)
 *
 * Bonuses (from rulebook):
 * - Medic: +1 on med-kit
 * - Doctor: +2 on med-kit
 * - Scientist: +1 on probe
 * - Senior Scientist: +1 on probe
 */
function getAssembleBonus(crew: AnyCrew | Captain, itemType: string): number {
  if (crew.type === 'basic') {
    const basicCrew = crew as { role: string };
    if (basicCrew.role === 'medic' && itemType === 'medical_kit') {
      return 1;
    }
    if (basicCrew.role === 'scientist' && itemType === 'probe') {
      return 1;
    }
  }

  if (crew.type === 'officer') {
    const officer = crew as { role: string };
    if (officer.role === 'doctor' && itemType === 'medical_kit') {
      return 2;
    }
    if (officer.role === 'senior_scientist' && itemType === 'probe') {
      return 1;
    }
    if (officer.role === 'first_officer' && (itemType === 'medical_kit' || itemType === 'probe')) {
      return 1;
    }
  }

  if (crew.type === 'captain' && (itemType === 'medical_kit' || itemType === 'probe')) {
    return 1;
  }

  return 0;
}

/**
 * Resolve integrate actions
 * Purpose: Process upgrade activation
 * Parameters:
 *   - game: Current game state
 *   - actions: Array of integrate actions to process
 * Returns: New GameState with upgrades activated
 * Side effects: None (pure function)
 *
 * Integrate rules (from rulebook):
 * - Move upgrade from pendingUpgrades to installedUpgrades
 * - Crew must be in appropriate section for the upgrade
 * - Upgrade ID in action.parameters.upgradeId
 */
function resolveIntegrateActions(game: GameState, actions: ActionBatch): GameState {
  if (actions.length === 0) {
    return game;
  }

  const updatedPlayers = new Map<string, PlayerState>();

  // Copy all players first
  for (const player of game.players.values()) {
    updatedPlayers.set(player.id, player);
  }

  for (const { playerId, action } of actions) {
    const player = updatedPlayers.get(playerId);

    if (!player || player.status !== 'active') {
      continue;
    }

    let workingPlayer: PlayerState = player;

    // Find the crew member performing the action
    const crew = findCrewById(workingPlayer, action.crewId);

    if (!crew) {
      throw new Error(
        'Cannot resolve integrate action because crew member not found. ' +
          `Root cause: crewId "${action.crewId}" not found for player "${playerId}". ` +
          'Fix: Ensure action.crewId references a valid crew member.'
      );
    }

    if (crew.status !== 'active') {
      throw new Error(
        'Cannot resolve integrate action because crew member is not active. ' +
          `Root cause: crew "${action.crewId}" has status "${crew.status}". ` +
          'Fix: Only active crew members can perform actions.'
      );
    }

    const actingSection = requireCrewLocationForAction(crew, 'integrate', action.crewId);
    requireActingSectionPoweredAndIntact(workingPlayer.ship, actingSection, 'integrate', action.crewId);

    const stimResult = consumeStimPackIfRequested(workingPlayer, action, crew, actingSection);
    workingPlayer = stimResult.player;

    const shipAfterCost = spendPowerInSection(workingPlayer.ship, actingSection, 1);

    // Get upgrade ID from parameters
    const upgradeId = action.parameters?.upgradeId as string | undefined;

    if (!upgradeId) {
      throw new Error(
        'Cannot resolve integrate action because upgrade ID is not specified. ' +
        `Root cause: action.parameters.upgradeId is undefined for player "${playerId}". ` +
        'Fix: Specify which pending upgrade to integrate.'
      );
    }

    const integrateOne = (nextUpgradeId: string) => {
      const upgradeIndex = workingPlayer.pendingUpgrades.findIndex(u => u.id === nextUpgradeId);

      if (upgradeIndex === -1) {
        throw new Error(
          'Cannot resolve integrate action because upgrade not found in pending upgrades. ' +
            `Root cause: upgradeId "${nextUpgradeId}" not found in player.pendingUpgrades. ` +
            'Fix: Specify a valid pending upgrade ID.'
        );
      }

      const upgrade = workingPlayer.pendingUpgrades[upgradeIndex];
      const requiredSectionRaw = (upgrade as { section?: unknown }).section;
      if (typeof requiredSectionRaw !== 'string') {
        throw new Error(
          'Cannot resolve integrate action because upgrade.section is missing or invalid. ' +
            `Root cause: upgrade "${upgrade.id}" has section "${String(requiredSectionRaw)}". ` +
            'Fix: Ensure all UpgradeCard definitions include a valid section string (or "any").'
        );
      }

      const installedUpgrade = requiredSectionRaw === 'any'
        ? {
            ...upgrade,
            section: actingSection,
            storedPower: 0,
          }
        : {
            ...upgrade,
            storedPower: 0,
          };

      if (requiredSectionRaw !== 'any') {
        const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
        if (!validSections.has(requiredSectionRaw as ShipSection)) {
          throw new Error(
            'Cannot resolve integrate action because upgrade.section is not a valid ship section. ' +
              `Root cause: upgrade "${upgrade.id}" requires section "${requiredSectionRaw}" which is not in SHIP_SECTIONS. ` +
              'Fix: Update the UpgradeCard definition to use a valid ship section or "any".'
          );
        }

        if (actingSection !== (requiredSectionRaw as ShipSection)) {
          throw new Error(
            'Cannot resolve integrate action because crew is in the wrong section for this upgrade. ' +
              `Root cause: upgrade "${upgrade.name}" requires section "${requiredSectionRaw}" but crew "${action.crewId}" is in "${actingSection}". ` +
              'Fix: Move the performing crew member to the required section before integrating this upgrade.'
          );
        }
      }

      workingPlayer = {
        ...workingPlayer,
        pendingUpgrades: workingPlayer.pendingUpgrades.filter((_, i) => i !== upgradeIndex),
        installedUpgrades: [...workingPlayer.installedUpgrades, installedUpgrade],
      };
    };

    integrateOne(upgradeId);

    const rawSecondaryUpgradeId = (action.parameters as Record<string, unknown> | undefined)?.secondaryUpgradeId;
    if (stimResult.stimmed && typeof rawSecondaryUpgradeId === 'string' && rawSecondaryUpgradeId.length > 0) {
      if (rawSecondaryUpgradeId === upgradeId) {
        throw new Error(
          'Cannot resolve stimmed integrate action because secondaryUpgradeId matches upgradeId. ' +
            `Root cause: upgradeId and secondaryUpgradeId are both "${rawSecondaryUpgradeId}". ` +
            'Fix: Choose a different secondaryUpgradeId (or omit it).'
        );
      }
      integrateOne(rawSecondaryUpgradeId);
    }

    updatedPlayers.set(playerId, {
      ...workingPlayer,
      ship: shipAfterCost,
    });
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

// === GAME STATE TRANSITIONS (Block D) ===

/**
 * Check and update wrecked ship status for all players
 * Purpose: Transition players to 'wrecked' status when their ship meets wrecked criteria
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with player statuses updated
 * Side effects: None (pure function)
 *
 * Wrecked criteria (from rulebook):
 * - Less than 2 functional sections (hull > 0)
 * - No functional conduits remaining
 * - No functional corridors remaining
 * - Ship pulled into ring 0 (black hole)
 */
export function checkAndUpdateWreckedStatus(game: GameState): GameState {
  const updatedPlayers = new Map<string, PlayerState>();
  let hasChanges = false;

  for (const player of game.players.values()) {
    // Skip if already wrecked or escaped
    if (player.status !== 'active') {
      updatedPlayers.set(player.id, player);
      continue;
    }

    // Check if ship is wrecked
    const isWrecked = ShipUtils.isWrecked(player.ship);

    // Check if pulled into black hole (ring 0 or less)
    const inBlackHole = player.ship.position.ring <= 0;

    if (isWrecked || inBlackHole) {
      hasChanges = true;
      const updatedPlayer: PlayerState = {
        ...player,
        status: 'wrecked',
      };
      updatedPlayers.set(player.id, updatedPlayer);
    } else {
      updatedPlayers.set(player.id, player);
    }
  }

  if (!hasChanges) {
    return game;
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

/**
 * Check and update escaped status for all players
 * Purpose: Transition players to 'escaped' status when they reach the escape zone
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with player statuses updated
 * Side effects: None (pure function)
 *
 * Escape criteria (from rulebook):
 * - Ship reaches ring 8 (outermost ring) or beyond
 * - Ship has enough velocity to escape gravity well
 */
export function checkAndUpdateEscapedStatus(game: GameState): GameState {
  const updatedPlayers = new Map<string, PlayerState>();
  let hasChanges = false;

  const escapeRing = BOARD_CONFIG.NUM_RINGS; // Ring 8

  for (const player of game.players.values()) {
    // Skip if already wrecked or escaped
    if (player.status !== 'active') {
      updatedPlayers.set(player.id, player);
      continue;
    }

    // Check if in escape zone
    const hasEscaped = player.ship.position.ring > escapeRing;

    if (hasEscaped) {
      hasChanges = true;
      const updatedPlayer: PlayerState = {
        ...player,
        status: 'escaped',
      };
      updatedPlayers.set(player.id, updatedPlayer);
    } else {
      updatedPlayers.set(player.id, player);
    }
  }

  if (!hasChanges) {
    return game;
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

/**
 * Calculate victory points for a player
 * Purpose: Compute final score based on game achievements
 * Parameters:
 *   - player: Player state to calculate points for
 * Returns: Victory point total
 * Side effects: None (pure function)
 *
 * Victory point sources (from rulebook):
 * - Completed missions
 * - Surviving crew
 * - Resources collected
 * - Escape bonus
 */
export function calculateVictoryPoints(player: PlayerState): number {
  let points = 0;

  // Escape bonus (major points for escaping)
  if (player.status === 'escaped') {
    points += 10;
  }

  // Surviving crew points
  const activeCrew = player.crew.filter(c => c.status === 'active').length;
  points += activeCrew * 2;

  // Captain survival bonus
  if (player.captain.status === 'active') {
    points += 3;
  }

  const missionMultiplier =
    player.captain.captainType === 'emissary' ||
    player.crew.some((crew) => crew.type === 'officer' && crew.role === 'mission_specialist')
      ? 1.5
      : 1;

  for (const mission of player.missions) {
    let missionPoints = 0;
    if (mission.objectives.primary.completed) {
      missionPoints += mission.objectives.primary.points;
    }
    if (mission.objectives.secondary?.completed) {
      missionPoints += mission.objectives.secondary.points;
    }
    points += missionPoints * missionMultiplier;
  }

  // Resources collected (minor points)
  const totalResources = Object.values(player.resources).reduce(
    (sum, count) => sum + (count ?? 0),
    0
  );
  points += Math.floor(totalResources / 2);

  // Installed upgrades
  points += player.installedUpgrades.length;

  return points;
}

/**
 * Check if game should end and update game status
 * Purpose: Determine if victory/defeat conditions are met
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with status updated if game should end
 * Side effects: None (pure function)
 *
 * Game end conditions:
 * - All players have escaped (victory - compare scores)
 * - All players are wrecked (defeat)
 * - Mix: some escaped, some wrecked (partial victory)
 */
export function checkGameEndConditions(game: GameState): GameState {
  const players = Array.from(game.players.values());

  // Count player states
  const activePlayers = players.filter(p => p.status === 'active');
  const escapedPlayers = players.filter(p => p.status === 'escaped');
  const wreckedPlayers = players.filter(p => p.status === 'wrecked');

  // If any players still active, game continues
  if (activePlayers.length > 0) {
    return game;
  }

  // All players have either escaped or are wrecked
  let newStatus: 'completed' | 'abandoned';

  if (wreckedPlayers.length === players.length) {
    // Total party wipe
    newStatus = 'abandoned';
  } else {
    // At least someone escaped
    newStatus = 'completed';
  }

  // Calculate final scores for escaped players
  const playerScores: Record<string, number> = {};
  for (const player of escapedPlayers) {
    playerScores[player.id] = calculateVictoryPoints(player);
  }

  return {
    ...game,
    status: newStatus,
  };
}

/**
 * Apply all game state transitions
 * Purpose: Run all state checks in order after each phase
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with all transitions applied
 * Side effects: None (pure function)
 */
export function applyGameStateTransitions(game: GameState): GameState {
  // Order matters: check wrecked first, then escaped, then game end
  const afterWrecked = checkAndUpdateWreckedStatus(game);
  const afterEscaped = checkAndUpdateEscapedStatus(afterWrecked);
  const afterEndCheck = checkGameEndConditions(afterEscaped);

  return afterEndCheck;
}

// === BOT ACTION SELECTION (Block E) ===

/**
 * Generate actions for a bot player
 * Purpose: Select appropriate actions based on current game state
 * Parameters:
 *   - game: Current game state
 *   - playerId: ID of the bot player
 * Returns: Array of PlayerAction for the bot's turn
 * Side effects: None (pure function)
 *
 * Bot strategy priorities:
 * 1. Survival: Repair critical damage, generate power
 * 2. Escape: Maneuver toward outer rings
 * 3. Defense: Attack nearby hostiles
 * 4. Support: Revive unconscious crew
 */
export function generateBotActions(game: GameState, playerId: string): PlayerAction[] {
  const player = game.players.get(playerId);

  if (!player) {
    throw new Error(
      'Cannot generate bot actions because player not found. ' +
      `Root cause: playerId "${playerId}" not found in game.players. ` +
      'Fix: Ensure the player ID is valid and exists in the game.'
    );
  }

  if (!player.isBot) {
    throw new Error(
      'Cannot generate bot actions for a human player. ' +
      `Root cause: player "${playerId}" has isBot=${player.isBot}. ` +
      'Fix: Only call generateBotActions for bot players.'
    );
  }

  if (player.status !== 'active') {
    return []; // No actions for wrecked/escaped players
  }

  const actions: PlayerAction[] = [];

  // Get active crew members
  const activeCrew = [
    ...(player.captain.status === 'active' ? [player.captain] : []),
    ...player.crew.filter(c => c.status === 'active'),
  ];

  if (activeCrew.length === 0) {
    return []; // No crew to perform actions
  }

  // Assign actions based on priority
  for (const crew of activeCrew) {
    const action = selectBotActionForCrew(game, player, crew);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

/**
 * Select the best action for a specific crew member
 * Purpose: Determine what action a bot crew should take
 * Parameters:
 *   - game: Current game state
 *   - player: Bot player state
 *   - crew: Crew member to select action for
 * Returns: PlayerAction or null if no action needed
 * Side effects: None (pure function)
 */
function selectBotActionForCrew(
  game: GameState,
  player: PlayerState,
  crew: AnyCrew | Captain,
): PlayerAction | null {
  const canTargetRepairSectionFrom = (from: ShipSection, target: ShipSection): boolean => {
    if (from === target) {
      return true;
    }

    const layoutA = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[from];
    const layoutB = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, any>)[target];

    const hasConduitEdge =
      (layoutA?.conduitConnections?.[target] ?? 0) > 0 ||
      (layoutB?.conduitConnections?.[from] ?? 0) > 0;

    const hasCorridorEdge =
      layoutA?.corridors?.[target] === 1 ||
      layoutB?.corridors?.[from] === 1;

    return hasConduitEdge || hasCorridorEdge;
  };

  // Priority 1: Restore power if Engineering is low
  const engineeringPower = player.ship.sections[SHIP_SECTIONS.ENGINEERING]?.powerDice.length ?? 0;
  if (engineeringPower < 2 && crew.location === SHIP_SECTIONS.ENGINEERING) {
    return {
      playerId: player.id,
      crewId: crew.id,
      type: 'restore',
    };
  }

  // Priority 2: Repair if any section has low hull
  const crewLocation = crew.location as ShipSection | null;
  if (crewLocation) {
    for (const sectionKey of Object.values(SHIP_SECTIONS)) {
      const section = player.ship.sections[sectionKey];
      if (!section || section.hull >= 4) {
        continue;
      }

      if (!canTargetRepairSectionFrom(crewLocation, sectionKey)) {
        continue;
      }

      return {
        playerId: player.id,
        crewId: crew.id,
        type: 'repair',
        target: { section: sectionKey },
        parameters: { repairType: 'hull' },
      };
    }
  }

  // Priority 3: Maneuver outward if in danger zone (inner rings)
  if (player.ship.position.ring <= 3 && crew.location === SHIP_SECTIONS.BRIDGE) {
    return {
      playerId: player.id,
      crewId: crew.id,
      type: 'maneuver',
      parameters: { direction: 'outward', powerSpent: 2 },
    };
  }

  // Priority 4: Attack nearby hostiles
  const nearbyHostiles = game.board.objects.filter(
    obj => obj.type === 'hostile_ship' &&
    BoardUtils.calculateDistance(player.ship.position, obj.position, game.board) <= 1
  );
  if (nearbyHostiles.length > 0 && crew.location === SHIP_SECTIONS.DEFENSE) {
    return {
      playerId: player.id,
      crewId: crew.id,
      type: 'attack',
      target: { objectId: nearbyHostiles[0].id },
    };
  }

  // Priority 5: Revive unconscious crew
  const unconsciousCrew = player.crew.find(c => c.status === 'unconscious');
  if (unconsciousCrew && crew.location === SHIP_SECTIONS.MED_LAB) {
    return {
      playerId: player.id,
      crewId: crew.id,
      type: 'revive',
      parameters: { targetCrewId: unconsciousCrew.id },
    };
  }

  // Default: Restore power
  return {
    playerId: player.id,
    crewId: crew.id,
    type: 'restore',
  };
}

/**
 * Generate actions for all bot players in a game
 * Purpose: Prepare bot actions for turn processing
 * Parameters:
 *   - game: Current game state
 * Returns: TurnActions record with bot player actions
 * Side effects: None (pure function)
 */
export function generateAllBotActions(game: GameState): TurnActions {
  const botActions: TurnActions = {};

  for (const player of game.players.values()) {
    if (player.isBot && player.status === 'active') {
      const actions = generateBotActions(game, player.id);
      botActions[player.id] = actions;
    }
  }

  return botActions;
}

export function applyEventPhase(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot apply event phase for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call applyEventPhase when game.status is "in_progress".'
    );
  }

  if (TURN_CONFIG.EVENT_FREQUENCY <= 0) {
    throw new Error(
      'Cannot apply event phase because EVENT_FREQUENCY is not a positive integer. ' +
      `Root cause: TURN_CONFIG.EVENT_FREQUENCY is ${TURN_CONFIG.EVENT_FREQUENCY}. ` +
      'Fix: Set EVENT_FREQUENCY to a positive integer in GameConfig.'
    );
  }

  // Only apply events on configured turns
  if (game.currentTurn % TURN_CONFIG.EVENT_FREQUENCY !== 0) {
    return game;
  }

  const afterSpawns = applyInfallObjectSpawns(game);

  if (afterSpawns.eventDeck.length === 0) {
    return afterSpawns;
  }

  const [topCard, ...remainingDeck] = afterSpawns.eventDeck;

  // Apply event effects based on the card's configured kind
  const afterEffects = applyEventEffects(afterSpawns, topCard);

  return {
    ...afterEffects,
    eventDeck: remainingDeck,
    lastResolvedEvent: topCard,
  };
}

function applyEventEffects(game: GameState, card: EventCard): GameState {
  const kind = (card.effects && typeof (card.effects as any).kind === 'string')
    ? (card.effects as any).kind as string
    : null;

  if (!kind) {
    return game;
  }

  switch (kind) {
    case 'distress_call':
      return applyDistressCallEvent(game);
    case 'hazards_add_d3':
      return applyHazardsAddD3Event(game);
    case 'gravity_flux_objects_forward':
      return applyGravityFluxObjectsEvent(game, 1);
    case 'gravity_flux_objects_backward':
      return applyGravityFluxObjectsEvent(game, -1);
    case 'gravity_flux_players_forward':
      return applyGravityFluxPlayersEvent(game, 1);
    case 'gravity_flux_players_backward':
      return applyGravityFluxPlayersEvent(game, -1);
    default:
      // Unknown event type – treat as no-op for forward compatibility
      return game;
  }
}

function getAllEmptyBoardPositions(game: GameState): ShipPosition[] {
  const positions: ShipPosition[] = [];
  const players = Array.from(game.players.values());

  for (const ring of game.board.rings) {
    const spaces = ring.numSpaces;

    if (spaces <= 0) {
      continue;
    }

    for (let space = 0; space < spaces; space += 1) {
      const position: ShipPosition = { ring: ring.index, space };

      const hasObject = game.board.objects.some(obj =>
        obj.position.ring === position.ring &&
        obj.position.space === position.space,
      );

      if (hasObject) {
        continue;
      }

      const hasShip = players.some(player =>
        player.ship.position.ring === position.ring &&
        player.ship.position.space === position.space,
      );

      if (!hasShip) {
        positions.push(position);
      }
    }
  }

  return positions;
}

function applyDistressCallEvent(game: GameState): GameState {
  const emptyPositions = getAllEmptyBoardPositions(game);

  if (emptyPositions.length === 0) {
    return game;
  }

  const index = game.currentTurn % emptyPositions.length;
  const position = emptyPositions[index];

  const stationId = `event-station-${game.currentTurn}-${position.ring}-${position.space}`;

  const station: AnySpaceObject = {
    id: stationId,
    type: 'functional_station',
    position,
    // Station durability based on Board model documentation
    hull: 24,
    shields: 12,
  } as AnySpaceObject;

  const lootResult = assignLootToObject({
    game,
    object: station,
    upgradeDeck: game.upgradeDeck,
    seedPrefix: 'board_loot_event_distress_call',
    forceUpgradeFromDeck: true,
  });

  const board: Board = {
    ...game.board,
    objects: [...game.board.objects, lootResult.object],
  };

  const eventState = {
    ...(game.eventState ?? {}),
    distressCall: {
      stationId,
      claimedByPlayerId: null,
    },
  };

  return {
    ...game,
    board,
    upgradeDeck: lootResult.upgradeDeck,
    eventState,
  };
}

function applyHazardsAddD3Event(game: GameState): GameState {
  const emptyPositions = getAllEmptyBoardPositions(game);

  if (emptyPositions.length === 0) {
    return game;
  }

  // Deterministic d3 based on current turn
  const raw = (game.currentTurn % 3) + 1; // 1-3
  const hazardCount = Math.min(raw, emptyPositions.length);

  const step = Math.max(1, Math.floor(emptyPositions.length / hazardCount));
  const newHazards: AnySpaceObject[] = [];

  for (let index = 0; index < hazardCount; index += 1) {
    const positionIndex = (index * step) % emptyPositions.length;
    const position = emptyPositions[positionIndex];

    const hazard: AnySpaceObject = {
      id: `event-hazard-${game.currentTurn}-${index}`,
      type: 'hazard',
      position,
    } as AnySpaceObject;

    newHazards.push(hazard);
  }

  const lootResult = assignLootToObjects({
    game,
    objects: newHazards,
    upgradeDeck: game.upgradeDeck,
    seedPrefix: 'board_loot_event_hazards_add_d3',
  });

  const board: Board = {
    ...game.board,
    objects: [...game.board.objects, ...lootResult.objects],
  };

  return {
    ...game,
    board,
    upgradeDeck: lootResult.upgradeDeck,
  };
}

function applyGravityFluxObjectsEvent(game: GameState, direction: 1 | -1): GameState {
  const board = game.board;

  const movedObjects: AnySpaceObject[] = board.objects.map(object => {
    const ring = board.rings[object.position.ring - 1];

    if (!ring) {
      throw new Error(
        'Cannot apply Gravity Flux to objects because a ring index is invalid. ' +
        `Root cause: object id "${object.id}" is at ring=${object.position.ring}, but no ring exists at that index. ` +
        'Fix: Ensure all board objects reference valid rings before applying Gravity Flux.'
      );
    }

    const spaces = ring.numSpaces;

    if (spaces <= 0) {
      throw new Error(
        'Cannot apply Gravity Flux to objects because a ring has a non-positive number of spaces. ' +
        `Root cause: ring index ${ring.index} has numSpaces=${spaces}. ` +
        'Fix: Ensure BOARD_CONFIG.SPACES_PER_RING defines a positive space count for every ring.'
      );
    }

    let newSpace = object.position.space + direction;

    if (newSpace < 0) {
      newSpace = (newSpace % spaces) + spaces;
    }

    newSpace %= spaces;

    return {
      ...object,
      position: {
        ring: object.position.ring,
        space: newSpace,
      },
    } as AnySpaceObject;
  });

  const movedBoard: Board = {
    ...board,
    objects: movedObjects,
  };

  return {
    ...game,
    board: movedBoard,
  };
}

function applyGravityFluxPlayersEvent(game: GameState, direction: 1 | -1): GameState {
  const board = game.board;
  const players = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    if (player.status !== 'active') {
      players.set(player.id, player);
      continue;
    }

    const position = player.ship.position;
    const ring = board.rings[position.ring - 1];

    if (!ring) {
      throw new Error(
        'Cannot apply Gravity Flux to players because a ring index is invalid. ' +
        `Root cause: player "${player.id}" ship is at ring=${position.ring}, but no ring exists at that index. ` +
        'Fix: Ensure all player ship positions reference valid rings before applying Gravity Flux.'
      );
    }

    const spaces = ring.numSpaces;

    if (spaces <= 0) {
      throw new Error(
        'Cannot apply Gravity Flux to players because a ring has a non-positive number of spaces. ' +
        `Root cause: ring index ${ring.index} has numSpaces=${spaces}. ` +
        'Fix: Ensure BOARD_CONFIG.SPACES_PER_RING defines a positive space count for every ring.'
      );
    }

    let newSpace = position.space + direction;

    if (newSpace < 0) {
      newSpace = (newSpace % spaces) + spaces;
    }

    newSpace %= spaces;

    const updatedShip: Ship = {
      ...player.ship,
      position: {
        ring: position.ring,
        space: newSpace,
      },
    };

    const updatedPlayer: PlayerState = {
      ...player,
      ship: updatedShip,
    };

    players.set(player.id, updatedPlayer);
  }

  return {
    ...game,
    players,
  };
}

export function processTurn(
  game: GameState,
  actionsByPlayer: TurnActions,
): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot process turn for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call processTurn when game.status is "in_progress".'
    );
  }

  const gameWithLoot = assignLootToBoardIfMissing(game);

  if (gameWithLoot.turnPhase === 'event') {
    const gameWithCaptainStartEffects =
      gameWithLoot.currentTurn === 1 ? applyCaptainStartOfGameEffects(gameWithLoot) : gameWithLoot;
    const afterEvent = applyEventPhase(gameWithCaptainStartEffects);
    return advanceTurn(afterEvent);
  }

  if (gameWithLoot.turnPhase === 'action_execution') {
    // Action execution phase sequence:
    // 1. Apply player actions in rulebook order
    const afterActions = applyPlayerActions(gameWithLoot, actionsByPlayer);
    // 2. Auto-generate shields from Defense, check life support
    const afterAutoGenerate = applyAutoGenerate(afterActions);
    // 3. Check for game state transitions (wrecked, escaped, game end)
    const afterTransitions = applyGameStateTransitions(afterAutoGenerate);
    // 4. If game ended, return without advancing turn
    if (afterTransitions.status !== 'in_progress') {
      return afterTransitions;
    }
    return advanceTurn(afterTransitions);
  }

  if (gameWithLoot.turnPhase === 'environment') {
    // Environment phase sequence:
    // 1. Apply ring-based environment damage (yellow/orange/red zones)
    const afterEnvDamage = applyEnvironmentDamage(gameWithLoot);
    // 2. Apply hazard proximity damage (radiation within 2 spaces)
    const afterHazardDamage = applyHazardDamage(afterEnvDamage);
    // 3. Update orbits, object movement, and resolve collisions
    const afterEnvironment = updateOrbitsAndObjects(afterHazardDamage);
    // 4. Check for game state transitions (wrecked, escaped, game end)
    const afterTransitions = applyGameStateTransitions(afterEnvironment);
    // 5. If game ended, return without advancing turn
    if (afterTransitions.status !== 'in_progress') {
      return afterTransitions;
    }
    return advanceTurn(afterTransitions);
  }

  return advanceTurn(gameWithLoot);
}

/**
 * Calculate rotation in spaces from degrees for a specific ring
 * Purpose: Convert degree rotation to space units for game state updates
 * Parameters:
 *   - degrees: Rotation amount in degrees
 *   - numSpaces: Total spaces on the ring
 * Returns: Number of spaces to rotate (can be fractional, will accumulate)
 * Side effects: None (pure function)
 */
function degreesToSpaces(degrees: number, numSpaces: number): number {
  // Each space spans (360 / numSpaces) degrees
  // So rotation in spaces = degrees / (360 / numSpaces) = degrees * numSpaces / 360
  return (degrees * numSpaces) / 360;
}

export function updateOrbitsAndObjects(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot update orbits and objects for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call updateOrbitsAndObjects when game.status is "in_progress".'
    );
  }

  const rings = game.board.rings.map(ring => {
    const spaces = ring.numSpaces;

    if (spaces <= 0) {
      throw new Error(
        'Cannot update orbits because a ring has a non-positive number of spaces. ' +
        `Root cause: ring index ${ring.index} has numSpaces=${spaces}. ` +
        'Fix: Ensure BOARD_CONFIG.SPACES_PER_RING defines a positive space count for every ring.'
      );
    }

    // Get degree rotation for this ring from pair-based configuration
    // ring.index is 1-based, array is 0-based
    const rotationDegrees = TURN_CONFIG.RING_ROTATION_DEGREES_BY_PAIR[ring.index - 1] ?? 20;
    const rotationInSpaces = degreesToSpaces(rotationDegrees, spaces);
    
    // Round to nearest space for discrete movement
    const effectiveDelta = Math.round(rotationInSpaces);

    if (effectiveDelta === 0) {
      return {
        index: ring.index,
        rotation: ring.rotation,
        numSpaces: ring.numSpaces,
        speedRequirement: ring.speedRequirement,
        color: ring.color,
      };
    }

    const directionMultiplier = game.board.rotationDirection === 'clockwise' ? 1 : -1;
    let newRotation = ring.rotation + directionMultiplier * effectiveDelta;

    if (newRotation < 0) {
      newRotation = (newRotation % spaces) + spaces;
    }

    newRotation %= spaces;

    return {
      index: ring.index,
      rotation: newRotation,
      numSpaces: ring.numSpaces,
      speedRequirement: ring.speedRequirement,
      color: ring.color,
    };
  });

  const shouldFall = game.currentTurn % TURN_CONFIG.CYCLE_LENGTH === 0;
  const boardForDistance: Board = {
    rings,
    objects: [],
    rotationDirection: game.board.rotationDirection,
  };

  const objects = game.board.objects.reduce<Board['objects']>((accumulator, object) => {
    const isValid = BoardUtils.isValidPosition(object.position, game.board);

    if (!isValid) {
      throw new Error(
        'Cannot update orbits and objects because a space object has an invalid position. ' +
        `Root cause: object id "${object.id}" is at ring=${object.position.ring}, space=${object.position.space}, which is outside board bounds. ` +
        'Fix: Validate and correct all Board.objects positions before calling updateOrbitsAndObjects.'
      );
    }

    let newRing = object.position.ring;

    if (shouldFall) {
      if (newRing <= 1) {
        return accumulator;
      }

      newRing -= 1;
    }

    if (newRing < 1 || newRing > rings.length) {
      throw new Error(
        'Cannot update orbits and objects because a space object would move to a non-existent ring. ' +
        `Root cause: object id "${object.id}" would move to ring index ${newRing}, but only ${rings.length} rings exist. ` +
        'Fix: Ensure BOARD_CONFIG.NUM_RINGS matches the board layout and that objects only occupy valid rings.'
      );
    }

    const ringForObject = rings[newRing - 1];
    const spacesForObject = ringForObject.numSpaces;
    
    // Calculate rotation for this ring using pair-based degree configuration
    const rotationDegreesForObject = TURN_CONFIG.RING_ROTATION_DEGREES_BY_PAIR[newRing - 1] ?? 20;
    const rotationInSpacesForObject = degreesToSpaces(rotationDegreesForObject, spacesForObject);
    const effectiveDeltaForObject = Math.round(rotationInSpacesForObject);

    let newSpace = object.position.space;

    if (effectiveDeltaForObject !== 0) {
      const directionMultiplier = game.board.rotationDirection === 'clockwise' ? 1 : -1;
      newSpace += directionMultiplier * effectiveDeltaForObject;

      if (newSpace < 0) {
        newSpace = (newSpace % spacesForObject) + spacesForObject;
      }

      newSpace %= spacesForObject;
    }

    if (object.type === 'hostile_ship') {
      const activePlayers = Array.from(game.players.values()).filter(
        player => player.status === 'active',
      );

      if (activePlayers.length > 0) {
        const hostilePosition: ShipPosition = {
          ring: newRing,
          space: newSpace,
        };

        let closestPlayer = activePlayers[0];
        let closestDistance = BoardUtils.calculateDistance(
          hostilePosition,
          closestPlayer.ship.position,
          boardForDistance,
        );

        for (let index = 1; index < activePlayers.length; index += 1) {
          const candidate = activePlayers[index];
          const distance = BoardUtils.calculateDistance(
            hostilePosition,
            candidate.ship.position,
            boardForDistance,
          );

          if (distance < closestDistance) {
            closestDistance = distance;
            closestPlayer = candidate;
          }
        }

        const targetPosition = closestPlayer.ship.position;

        if (targetPosition.ring === newRing) {
          const clockwiseDistance = (targetPosition.space - newSpace + spacesForObject) % spacesForObject;
          const counterClockwiseDistance = (newSpace - targetPosition.space + spacesForObject) % spacesForObject;

          let stepDirection = 0;

          if (clockwiseDistance < counterClockwiseDistance) {
            stepDirection = 1;
          } else if (counterClockwiseDistance < clockwiseDistance) {
            stepDirection = -1;
          } else {
            stepDirection = 1;
          }

          newSpace += stepDirection;

          if (newSpace < 0) {
            newSpace = (newSpace % spacesForObject) + spacesForObject;
          }

          newSpace %= spacesForObject;
        }
      }
    }

    accumulator.push({
      ...object,
      position: {
        ring: newRing,
        space: newSpace,
      },
    });

    return accumulator;
  }, []);

  const board: Board = {
    rings,
    objects,
    rotationDirection: game.board.rotationDirection,
  };

  // Track updated player states for collision resolution
  const updatedPlayers = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    if (player.status !== 'active') {
      updatedPlayers.set(player.id, player);
      continue;
    }

    const position = player.ship.position;

    if (!BoardUtils.isValidPosition(position, game.board)) {
      throw new Error(
        'Cannot update orbits and objects because a player ship has an invalid position before orbit rotation. ' +
          `Root cause: player "${player.id}" ship is at ring=${position.ring}, space=${position.space}, which is outside board bounds. ` +
          'Fix: Ensure all player ship positions are validated before calling updateOrbitsAndObjects.'
      );
    }

    const ringForShip = rings[position.ring - 1];

    if (!ringForShip) {
      throw new Error(
        'Cannot update orbits and objects because a player ship references a non-existent ring. ' +
          `Root cause: player "${player.id}" ship is at ring=${position.ring}, but updated board has ${rings.length} rings. ` +
          'Fix: Ensure player ship ring indices stay within BOARD_CONFIG.NUM_RINGS.'
      );
    }

    const spacesForShip = ringForShip.numSpaces;

    if (spacesForShip <= 0) {
      throw new Error(
        'Cannot update orbits and objects because a ring has a non-positive number of spaces for ship rotation. ' +
          `Root cause: ring index ${ringForShip.index} has numSpaces=${spacesForShip}. ` +
          'Fix: Ensure BOARD_CONFIG.SPACES_PER_RING defines a positive space count for every ring.'
      );
    }

    const rotationDegreesForShip = TURN_CONFIG.RING_ROTATION_DEGREES_BY_PAIR[position.ring - 1] ?? 20;
    const rotationInSpacesForShip = degreesToSpaces(rotationDegreesForShip, spacesForShip);
    const effectiveDeltaForShip = Math.round(rotationInSpacesForShip);

    let newSpace = position.space;

    if (effectiveDeltaForShip !== 0) {
      const directionMultiplier = game.board.rotationDirection === 'clockwise' ? 1 : -1;
      newSpace += directionMultiplier * effectiveDeltaForShip;

      if (newSpace < 0) {
        newSpace = (newSpace % spacesForShip) + spacesForShip;
      }

      newSpace %= spacesForShip;
    }

    const updatedShip: Ship = {
      ...player.ship,
      position: {
        ring: position.ring,
        space: newSpace,
      },
    };

    updatedPlayers.set(player.id, {
      ...player,
      ship: updatedShip,
    });
  }

  // Process collisions for active players
  const activePlayers = Array.from(updatedPlayers.values()).filter(
    player => player.status === 'active',
  );

  for (const player of activePlayers) {
    const position = player.ship.position;

    if (!BoardUtils.isValidPosition(position, board)) {
      throw new Error(
        'Cannot update orbits and objects because a player ship has an invalid position after environment movement. ' +
        `Root cause: player "${player.id}" ship is at ring=${position.ring}, space=${position.space}, which is outside the updated board bounds. ` +
        'Fix: Ensure all player ship positions remain within board bounds when applying environment and movement rules.'
      );
    }

    const objectsAtPosition = BoardUtils.getObjectsAtPosition(position, board);

    if (objectsAtPosition.length === 0) {
      continue;
    }

    // Apply collision damage for each object at this position
    // Note: Hazards are skipped here - they use proximity damage (handled in A.4)
    let currentShip = player.ship;

    for (const object of objectsAtPosition) {
      // Skip hazards - they use radiation damage, not collision damage
      if (object.type === 'hazard') {
        continue;
      }

      // Apply collision damage using automatic section selection
      currentShip = resolveCollisionAutomatic(currentShip, object.type);
    }

    // Check if ship became wrecked after collision(s)
    const isNowWrecked = ShipUtils.isWrecked(currentShip);

    const updatedPlayer: PlayerState = {
      ...player,
      ship: currentShip,
      status: isNowWrecked ? 'wrecked' : player.status,
    };

    updatedPlayers.set(player.id, updatedPlayer);
  }

  // Hostile actions: after orbit movement + collisions, hostiles attack the nearest active player.
  // - Adjacent: attack using HOSTILE_CONFIG.attackBaseDamage + 2d6.
  // - Range 2-3: fire torpedo if the hostile still has one.
  // - Cloaking Device: forces hostiles to "scan" first (tracked per player+hostile) before any hostile attack can land.
  // - Decoys: evade 1 hostile torpedo per turn when powered.
  // - Shield Modulator: halves shield loss from hostile attacks/torpedoes.
  const boardForCombat: Board = {
    rings: board.rings,
    objects: [],
    rotationDirection: board.rotationDirection,
  };

  const updatedObjectsAfterHostiles = [...board.objects];
  const updatedPlayersAfterHostiles = new Map<string, PlayerState>(updatedPlayers);
  const activePlayersAfterCollisions = Array.from(updatedPlayersAfterHostiles.values()).filter(
    (player) => player.status === 'active',
  );

  for (let objectIndex = 0; objectIndex < updatedObjectsAfterHostiles.length; objectIndex += 1) {
    const object = updatedObjectsAfterHostiles[objectIndex];
    if (object.type !== 'hostile_ship') {
      continue;
    }

    if (activePlayersAfterCollisions.length === 0) {
      continue;
    }

    let closestPlayer = activePlayersAfterCollisions[0];
    let closestDistance = BoardUtils.calculateDistance(object.position, closestPlayer.ship.position, boardForCombat);

    for (let index = 1; index < activePlayersAfterCollisions.length; index += 1) {
      const candidate = activePlayersAfterCollisions[index];
      const distance = BoardUtils.calculateDistance(object.position, candidate.ship.position, boardForCombat);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPlayer = candidate;
      }
    }

    const hostile = object as { id: string; type: 'hostile_ship'; hasTorpedo?: boolean };
    const targetId = closestPlayer.id;
    const latestTarget = updatedPlayersAfterHostiles.get(targetId);
    if (!latestTarget || latestTarget.status !== 'active') {
      continue;
    }

    if (closestDistance <= 1) {
      const cloakingCheck = isCloakingDeviceBlockingHostileAttack({
        game,
        player: latestTarget,
        hostileId: hostile.id,
      });
      if (cloakingCheck.blocked) {
        updatedPlayersAfterHostiles.set(targetId, cloakingCheck.player);
        continue;
      }

      const damage = rollHostileAttackDamage({
        game,
        hostileId: hostile.id,
        targetPlayerId: targetId,
      });

      const afterDamage = applyIncomingWeaponDamageToPlayer({
        game,
        player: cloakingCheck.player,
        damage,
      });
      updatedPlayersAfterHostiles.set(targetId, afterDamage);
      continue;
    }

    const hasTorpedo = hostile.hasTorpedo !== false;
    if (hasTorpedo && closestDistance >= HOSTILE_CONFIG.torpedoMinRange && closestDistance <= HOSTILE_CONFIG.torpedoMaxRange) {
      const cloakingCheck = isCloakingDeviceBlockingHostileAttack({
        game,
        player: latestTarget,
        hostileId: hostile.id,
      });
      if (cloakingCheck.blocked) {
        updatedPlayersAfterHostiles.set(targetId, cloakingCheck.player);
        continue;
      }

      const decoysPowered = playerHasPoweredUpgrade(cloakingCheck.player, cloakingCheck.player.ship, 'decoys');
      const decoysLastUsedTurn = cloakingCheck.player.decoysLastUsedTurn ?? 0;
      if (decoysPowered && decoysLastUsedTurn !== game.currentTurn) {
        updatedPlayersAfterHostiles.set(targetId, {
          ...cloakingCheck.player,
          decoysLastUsedTurn: game.currentTurn,
        });
        updatedObjectsAfterHostiles[objectIndex] = {
          ...object,
          hasTorpedo: false,
        } as typeof object;
        continue;
      }

      const afterDamage = applyIncomingWeaponDamageToPlayer({
        game,
        player: cloakingCheck.player,
        damage: HOSTILE_CONFIG.torpedoDamage,
      });
      updatedPlayersAfterHostiles.set(targetId, afterDamage);
      updatedObjectsAfterHostiles[objectIndex] = {
        ...object,
        hasTorpedo: false,
      } as typeof object;
    }
  }

  // Check for object-object collisions (currently just validates - future: resolve)
  const objectsByPosition = new Map<string, typeof objects>();

  for (const object of updatedObjectsAfterHostiles) {
    const key = `${object.position.ring}:${object.position.space}`;
    const list = objectsByPosition.get(key) ?? [];
    list.push(object);
    objectsByPosition.set(key, list);
  }

  for (const [key, objectsAtPosition] of objectsByPosition.entries()) {
    if (objectsAtPosition.length <= 1) {
      continue;
    }

    const [ringString, spaceString] = key.split(':');
    const ring = Number(ringString);
    const space = Number(spaceString);

    const objectsDescription = objectsAtPosition
      .map(object => `"${object.id}" (${object.type})`)
      .join(', ');

    // TODO: Implement object-object collision resolution when rules are clarified.
    // For now, allow objects to share space (rulebook doesn't explicitly forbid it).
    // Hostiles attacking is handled separately during hostile movement.
    // Log warning for debugging but don't throw error.
    console.warn(
      `[updateOrbitsAndObjects] Multiple objects share position ring=${ring}, space=${space}: ${objectsDescription}. ` +
      'Object-object collision resolution is not yet implemented.'
    );
  }

  return {
    ...game,
    board: {
      ...board,
      objects: updatedObjectsAfterHostiles,
    },
    players: updatedPlayersAfterHostiles,
  };
}

/**
 * Collision damage type (simpler than environment damage - hull only)
 * Purpose: Represent damage from object collisions
 *
 * Note: Collision damage bypasses shields per rulebook:
 * "For each point of damage you receive you will lower your SHIELD value first,
 *  unless damage is from a collision or other special circumstance."
 */
export type CollisionDamage = {
  hull: number;
};

/**
 * Get collision damage for a specific object type
 * Purpose: Look up damage value from COLLISION_DAMAGE constants
 * Parameters:
 *   - objectType: Type of object collided with
 * Returns: CollisionDamage containing hull damage
 * Side effects: None (pure function)
 *
 * Note: Hazards use radiation damage (range-based), not collision damage.
 * Use applyHazardDamage for hazard proximity effects.
 */
export function getCollisionDamage(objectType: ObjectType): CollisionDamage {
  if (objectType === 'hazard') {
    throw new Error(
      'Cannot get collision damage for hazard because hazards use radiation damage, not collision damage. ' +
      'Root cause: hazards deal damage within a range, not on direct collision. ' +
      'Fix: Use applyHazardDamage for hazard proximity effects instead of collision resolution.'
    );
  }

  const damage = COLLISION_DAMAGE[objectType];

  if (damage === undefined) {
    throw new Error(
      'Cannot get collision damage because object type is not defined in COLLISION_DAMAGE. ' +
      `Root cause: no COLLISION_DAMAGE entry for object type "${objectType}". ` +
      'Fix: Add the missing object type to COLLISION_DAMAGE in GameConfig.ts.'
    );
  }

  return { hull: damage };
}

/**
 * Apply collision damage to a ship's specific section
 * Purpose: Apply hull damage from collision to player-chosen section
 * Parameters:
 *   - ship: Current ship state
 *   - damage: CollisionDamage to apply
 *   - targetSection: Section to receive the damage (player's choice per rulebook)
 * Returns: New Ship state with damage applied
 * Side effects: None (pure function)
 *
 * Collision damage rules (from rulebook):
 * - Bypasses shields (applied directly to hull)
 * - Applied to one section of player's choice
 * - If section reaches 0 hull, section becomes damaged
 * - Excess damage is lost (not carried to other sections for collision)
 */
export function applyCollisionDamageToShip(
  ship: Ship,
  damage: CollisionDamage,
  targetSection: ShipSection,
): Ship {
  if (damage.hull < 0) {
    throw new Error(
      'Cannot apply negative collision damage to ship. ' +
      `Root cause: damage.hull is ${damage.hull}. ` +
      'Fix: Ensure collision damage values are non-negative.'
    );
  }

  if (damage.hull === 0) {
    return ship;
  }

  const originalSection = ship.sections[targetSection];

  if (!originalSection) {
    throw new Error(
      'Cannot apply collision damage because target section does not exist on ship. ' +
      `Root cause: no section found for "${targetSection}" in ship.sections. ` +
      'Fix: Ensure all SHIP_SECTIONS are initialized in the Ship before applying damage.'
    );
  }

  // Deep clone all sections
  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

  for (const sectionKey of sectionKeys) {
    const sectionState = ship.sections[sectionKey];

    if (!sectionState) {
      throw new Error(
        'Cannot apply collision damage because ship is missing a section. ' +
        `Root cause: no entry found for section "${sectionKey}" in ship.sections. ` +
        'Fix: Ensure all SHIP_SECTIONS are initialized before applying collision damage.'
      );
    }

    sections[sectionKey] = {
      hull: sectionState.hull,
      powerDice: [...sectionState.powerDice],
      corridors: { ...sectionState.corridors },
      conduitConnections: { ...sectionState.conduitConnections },
    };
  }

  // Apply hull damage to target section (cannot go below 0)
  const currentHull = sections[targetSection].hull;
  sections[targetSection].hull = Math.max(0, currentHull - damage.hull);

  return {
    ...ship,
    sections,
  };
}

/**
 * Resolve collision between player ship and space object
 * Purpose: Compute and apply collision damage for a player's ship
 * Parameters:
 *   - ship: Current ship state
 *   - objectType: Type of object collided with
 *   - targetSection: Section to receive damage (player's choice)
 * Returns: New Ship state with collision damage applied
 * Side effects: None (pure function)
 *
 * This is the main entry point for collision resolution.
 * It combines getCollisionDamage and applyCollisionDamageToShip.
 */
export function resolveCollision(
  ship: Ship,
  objectType: ObjectType,
  targetSection: ShipSection,
): Ship {
  const damage = getCollisionDamage(objectType);
  return applyCollisionDamageToShip(ship, damage, targetSection);
}

/**
 * Select the best section to absorb collision damage
 * Purpose: Deterministic section selection for automatic collision resolution
 * Parameters:
 *   - ship: Current ship state
 * Returns: ShipSection with the most hull remaining
 * Side effects: None (pure function)
 *
 * Selection priority (for determinism):
 * 1. Section with most hull remaining
 * 2. If tied, prefer sections in order: engineering > bridge > drives > defense > med_lab > sci_lab
 *
 * Rationale: Engineering and Bridge are most critical for survival,
 * but also have the most hull capacity to absorb damage.
 *
 * Note: This is a fallback for automatic collision resolution.
 * In a full implementation, player input would determine the section.
 */
export function selectSectionForCollisionDamage(ship: Ship): ShipSection {
  const sectionPriority: ShipSection[] = [
    SHIP_SECTIONS.ENGINEERING,
    SHIP_SECTIONS.BRIDGE,
    SHIP_SECTIONS.DRIVES,
    SHIP_SECTIONS.DEFENSE,
    SHIP_SECTIONS.MED_LAB,
    SHIP_SECTIONS.SCI_LAB,
  ];

  let bestSection: ShipSection = SHIP_SECTIONS.BRIDGE;
  let bestHull = -1;

  for (const section of sectionPriority) {
    const sectionState = ship.sections[section];

    if (!sectionState) {
      continue;
    }

    // Prefer section with more hull (can absorb more damage)
    if (sectionState.hull > bestHull) {
      bestHull = sectionState.hull;
      bestSection = section;
    }
  }

  return bestSection;
}

/**
 * Resolve collision automatically using deterministic section selection
 * Purpose: Handle collisions during environment phase when player input unavailable
 * Parameters:
 *   - ship: Current ship state
 *   - objectType: Type of object collided with
 * Returns: New Ship state with collision damage applied
 * Side effects: None (pure function)
 *
 * Uses selectSectionForCollisionDamage for automatic section selection.
 */
export function resolveCollisionAutomatic(
  ship: Ship,
  objectType: ObjectType,
): Ship {
  const targetSection = selectSectionForCollisionDamage(ship);
  return resolveCollision(ship, objectType, targetSection);
}

/**
 * Hazard proximity damage type
 * Purpose: Represent radiation damage from nearby hazards
 *
 * Note: Unlike collision damage, hazard damage is range-based (within 2 spaces)
 * and includes life support reduction.
 */
export type HazardDamage = {
  hull: number;
  lifeSupportReduction: number;
};

/**
 * Calculate hazard damage for a ship position
 * Purpose: Compute radiation damage from all nearby hazards
 * Parameters:
 *   - position: Ship's current position
 *   - board: Current board state
 * Returns: Total HazardDamage from all hazards within range
 * Side effects: None (pure function)
 *
 * Hazard rules (from rulebook):
 * - 3 damage to ships within 2 spaces
 * - 2 life support reduction if within range
 * - Multiple hazards stack their damage
 */
export function computeHazardDamageForPosition(
  position: ShipPosition,
  board: Board,
): HazardDamage {
  const hazards = board.objects.filter(obj => obj.type === 'hazard');

  let totalHullDamage = 0;
  let totalLifeSupportReduction = 0;

  for (const hazard of hazards) {
    const distance = BoardUtils.calculateDistance(position, hazard.position, board);

    if (distance <= HAZARD_CONFIG.range) {
      totalHullDamage += HAZARD_CONFIG.damage;
      totalLifeSupportReduction += HAZARD_CONFIG.lifeSupportReduction;
    }
  }

  return {
    hull: totalHullDamage,
    lifeSupportReduction: totalLifeSupportReduction,
  };
}

/**
 * Apply hazard damage to a ship
 * Purpose: Apply radiation damage from hazards to a specific section
 * Parameters:
 *   - ship: Current ship state
 *   - damage: HazardDamage to apply
 *   - targetSection: Section to receive hull damage
 * Returns: New Ship state with damage applied
 * Side effects: None (pure function)
 *
 * Note: Life support reduction is tracked separately by the game state,
 * not directly on the ship. This function only applies hull damage.
 */
export function applyHazardDamageToShip(
  ship: Ship,
  damage: HazardDamage,
  targetSection: ShipSection,
): Ship {
  if (damage.hull === 0) {
    return ship;
  }

  // Reuse collision damage application (same mechanics for hull damage)
  return applyCollisionDamageToShip(ship, { hull: damage.hull }, targetSection);
}

/**
 * Apply hazard proximity damage to all active players
 * Purpose: Process hazard radiation damage during environment phase
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with hazard damage applied to all nearby ships
 * Side effects: None (pure function)
 *
 * This function:
 * 1. Finds all hazards on the board
 * 2. Checks each active player's proximity to hazards
 * 3. Applies hull damage using automatic section selection
 * 4. Tracks total life support reduction for later processing
 * 5. Updates player status to 'wrecked' if applicable
 */
export function applyHazardDamage(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot apply hazard damage for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call applyHazardDamage when game.status is "in_progress".'
    );
  }

  const updatedPlayers = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    if (player.status !== 'active') {
      updatedPlayers.set(player.id, player);
      continue;
    }

    const hazardDamage = computeHazardDamageForPosition(player.ship.position, game.board);

    if (hazardDamage.hull === 0) {
      updatedPlayers.set(player.id, player);
      continue;
    }

    // Apply hull damage using automatic section selection
    const targetSection = selectSectionForCollisionDamage(player.ship);
    let updatedShip = applyHazardDamageToShip(player.ship, hazardDamage, targetSection);

    const baseLifeSupportPowerRaw = updatedShip.lifeSupportPower;
    const baseLifeSupportPower = (() => {
      if (typeof baseLifeSupportPowerRaw === 'undefined') {
        return 0;
      }
      if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
        throw new Error(
          'Cannot apply hazard damage because ship.lifeSupportPower is invalid. ' +
            `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}". ` +
            'Fix: Ensure ship.lifeSupportPower is a finite number.'
        );
      }
      if (baseLifeSupportPowerRaw < 0) {
        throw new Error(
          'Cannot apply hazard damage because ship.lifeSupportPower is negative. ' +
            `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw}. ` +
            'Fix: Ensure ship.lifeSupportPower is never set below 0.'
        );
      }
      return baseLifeSupportPowerRaw;
    })();

    const nextLifeSupportPower = Math.max(0, baseLifeSupportPower - hazardDamage.lifeSupportReduction);
    if (nextLifeSupportPower !== baseLifeSupportPower) {
      updatedShip = {
        ...updatedShip,
        lifeSupportPower: nextLifeSupportPower,
      };
    }

    // Check if ship became wrecked
    const isNowWrecked = ShipUtils.isWrecked(updatedShip);

    // Note: lifeSupportReduction is handled during the auto-generate phase
    // where we check if active crew exceeds available life support

    const updatedPlayer: PlayerState = {
      ...player,
      ship: updatedShip,
      status: isNowWrecked ? 'wrecked' : player.status,
    };

    updatedPlayers.set(updatedPlayer.id, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

/**
 * Apply auto-generate effects at end of turn
 * Purpose: Process automatic shield generation and life support checks
 * Parameters:
 *   - game: Current game state
 * Returns: New GameState with shields updated and excess crew marked unconscious
 * Side effects: None (pure function)
 *
 * Auto-generate rules (from rulebook):
 * 1. Defense section (if fully powered): +2 shields at end of turn
 * 2. Life support check: if active crew > life support capacity,
 *    excess crew fall unconscious
 *
 * This function runs after actions, before environment phase advances turn.
 */
export function applyAutoGenerate(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot apply auto-generate for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call applyAutoGenerate when game.status is "in_progress".'
    );
  }

  const updatedPlayers = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    if (player.status !== 'active') {
      updatedPlayers.set(player.id, player);
      continue;
    }

    // Step 1: Auto-generate shields from powered Defense section
    let updatedShip = player.ship;
    const defenseConfig = SECTION_CONFIG[SHIP_SECTIONS.DEFENSE];

    // Section_Bonus: Defense fully powered auto-generates shields each turn.(source)
    if (ShipUtils.isFullyPowered(player.ship, SHIP_SECTIONS.DEFENSE)) {
      const shieldBonus = player.captain.captainType === 'imperialist' ? 3 : defenseConfig.fullyPoweredBenefits.shieldGeneration;

      if (shieldBonus > 0) {
        updatedShip = {
          ...player.ship,
          shields: player.ship.shields + shieldBonus,
        };
      }
    }

    // Living Metal upgrade: automatically restore hull to sections in priority order once powered.
    // Root cause: Living Metal was previously wired in UI but never applied in engine, so hull never healed.
    if (playerHasPoweredUpgrade(player, updatedShip, 'living_metal')) {
      updatedShip = applyLivingMetalHullGrowth(updatedShip);
    }

    if (playerHasPoweredUpgrade(player, updatedShip, 'energy_hull')) {
      const installed = player.installedUpgrades.find(u => u.id === 'energy_hull');
      const sectionRaw = (installed as { section?: unknown } | undefined)?.section;
      const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
      if (typeof sectionRaw !== 'string' || !validSections.has(sectionRaw as ShipSection)) {
        throw new Error(
          'Cannot apply Energy Hull upkeep because the upgrade installation section is missing or invalid. ' +
            `Root cause: installed upgrade "energy_hull" has section "${String(sectionRaw)}". ` +
            'Fix: Ensure Energy Hull is installed with section set to a valid SHIP_SECTIONS key.'
        );
      }

      const section = sectionRaw as ShipSection;
      const state = updatedShip.sections[section];
      if (!state) {
        throw new Error(
          'Cannot apply Energy Hull upkeep because ship.sections is missing the upgrade section. ' +
            `Root cause: ship.sections has no entry for section "${section}" (Energy Hull). ` +
            'Fix: Ensure all SHIP_SECTIONS are initialized on the ship state.'
        );
      }

      const maxHull = SECTION_CONFIG[section]?.maxHull ?? state.hull;
      if (state.hull > 0 && state.hull < maxHull) {
        updatedShip = {
          ...updatedShip,
          sections: {
            ...updatedShip.sections,
            [section]: {
              ...state,
              hull: Math.min(maxHull, state.hull + 1),
            },
          },
        };
      }
    }

    // Step 2: Check life support vs crew that require life support
    const baseLifeSupportPowerRaw = updatedShip.lifeSupportPower;
    let lifeSupportPower = (() => {
      if (typeof baseLifeSupportPowerRaw === 'undefined') {
        return 0;
      }
      if (typeof baseLifeSupportPowerRaw !== 'number' || !Number.isFinite(baseLifeSupportPowerRaw)) {
        throw new Error(
          'Cannot apply auto-generate because ship.lifeSupportPower is invalid. ' +
            `Root cause: ship.lifeSupportPower is "${String(baseLifeSupportPowerRaw)}" for player "${player.id}". ` +
            'Fix: Ensure ship.lifeSupportPower is a finite number.'
        );
      }
      if (baseLifeSupportPowerRaw < 0) {
        throw new Error(
          'Cannot apply auto-generate because ship.lifeSupportPower is negative. ' +
            `Root cause: ship.lifeSupportPower is ${baseLifeSupportPowerRaw} for player "${player.id}". ` +
            'Fix: Ensure ship.lifeSupportPower is never set below 0.'
        );
      }
      return baseLifeSupportPowerRaw;
    })();
    if (player.captain.captainType === 'explorer') {
      lifeSupportPower += 5;
    }
    if (playerHasPoweredUpgrade(player, updatedShip, 'bio_filters')) {
      lifeSupportPower += 3;
    }
    if (playerHasPoweredUpgrade(player, updatedShip, 'bio_engine')) {
      lifeSupportPower += 1;
    }
    const powerPerCrew = LIFE_SUPPORT_CONFIG.POWER_PER_CREW;
    if (typeof powerPerCrew !== 'number' || !Number.isFinite(powerPerCrew) || powerPerCrew <= 0) {
      throw new Error(
        'Cannot apply auto-generate because LIFE_SUPPORT_CONFIG.POWER_PER_CREW is invalid. ' +
          `Root cause: LIFE_SUPPORT_CONFIG.POWER_PER_CREW is "${String(powerPerCrew)}". ` +
          'Fix: Configure a positive finite power-per-crew ratio.',
      );
    }
    const lifeSupportCapacity = Math.floor(lifeSupportPower / powerPerCrew);
    const crewRequiringLifeSupport = player.crew.filter(c => CrewUtils.requiresLifeSupport(c));
    const crewRequiringLifeSupportCount = crewRequiringLifeSupport.length;

    const captainActive = player.captain.status === 'active';
    const totalLifeSupportConsumers = crewRequiringLifeSupportCount + (captainActive ? 1 : 0);

    let updatedCrew = player.crew;
    let updatedCaptain = player.captain;

    if (totalLifeSupportConsumers > lifeSupportCapacity) {
      // Excess crew must fall unconscious
      // Priority: Basic crew first (by order), then officers, captain last
      const excessCount = totalLifeSupportConsumers - lifeSupportCapacity;

      // Sort active crew by priority (basic crew first, then officers)
      const crewToKnockOut = [...crewRequiringLifeSupport]
        .sort((a, b) => {
          // Basic crew knocked out first (lower priority to keep)
          if (a.type === 'basic' && b.type !== 'basic') return -1;
          if (a.type !== 'basic' && b.type === 'basic') return 1;
          return 0;
        })
        .slice(0, excessCount);

      const crewIdsToKnockOut = new Set(crewToKnockOut.map(c => c.id));

      updatedCrew = player.crew.map(c => {
        if (crewIdsToKnockOut.has(c.id)) {
          return {
            ...c,
            status: 'unconscious' as const,
            location: null,
          };
        }
        return c;
      });

      // If still excess after all crew, captain falls unconscious (extremely rare)
      const remainingExcess = excessCount - crewToKnockOut.length;
      if (remainingExcess > 0 && captainActive) {
        updatedCaptain = {
          ...player.captain,
          status: 'unconscious' as const,
          location: null,
        };
      }
    }

    const updatedPlayer: PlayerState = {
      ...player,
      ship: updatedShip,
      crew: updatedCrew,
      captain: updatedCaptain,
    };

    updatedPlayers.set(updatedPlayer.id, updatedPlayer);
  }

  return {
    ...game,
    players: updatedPlayers,
  };
}

function applyEnvironmentDamageToShip(
  ship: Ship,
  damage: EnvironmentDamage,
): Ship {
  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
  const sections: Record<ShipSection, ShipSectionState> = {} as Record<ShipSection, ShipSectionState>;

  for (const sectionKey of sectionKeys) {
    const originalSection = ship.sections[sectionKey];

    if (!originalSection) {
      throw new Error(
        'Cannot apply environment damage because ship is missing section in Ship.sections. ' +
        `Root cause: no entry found for section "${sectionKey}". ` +
        'Fix: Ensure all Ship.sections entries are initialized for every SHIP_SECTIONS value before applying environment damage.'
      );
    }

    sections[sectionKey] = {
      hull: originalSection.hull,
      powerDice: [...originalSection.powerDice],
      corridors: { ...originalSection.corridors },
      conduitConnections: { ...originalSection.conduitConnections },
    };
  }

  let hullRemaining = damage.hull;

  while (hullRemaining > 0) {
    let appliedThisPass = false;

    for (const sectionKey of sectionKeys) {
      if (hullRemaining <= 0) {
        break;
      }

      const section = sections[sectionKey];

      if (section.hull > 0) {
        section.hull -= 1;
        hullRemaining -= 1;
        appliedThisPass = true;
      }
    }

    if (!appliedThisPass) {
      break;
    }
  }

  let conduitsRemaining = damage.conduits;

  if (conduitsRemaining > 0) {
    const conduitPairs: Array<[ShipSection, ShipSection]> = [];

    for (const from of sectionKeys) {
      const conduitConnections = sections[from].conduitConnections;
      for (const to of sectionKeys) {
        if (from < to && (conduitConnections[to] ?? 0) > 0) {
          conduitPairs.push([from, to]);
        }
      }
    }

    while (conduitsRemaining > 0) {
      let appliedThisPass = false;

      for (const [from, to] of conduitPairs) {
        if (conduitsRemaining <= 0) {
          break;
        }

        const fromSection = sections[from];
        const toSection = sections[to];

        const fromTo = fromSection.conduitConnections[to] ?? 0;
        const toFrom = toSection.conduitConnections[from] ?? 0;
        const currentEdge = Math.min(fromTo, toFrom);

        if (currentEdge > 0) {
          const nextEdge = currentEdge - 1;
          fromSection.conduitConnections[to] = nextEdge;
          toSection.conduitConnections[from] = nextEdge;
          conduitsRemaining -= 1;
          appliedThisPass = true;
        }
      }

      if (!appliedThisPass) {
        break;
      }
    }
  }

  let corridorsRemaining = damage.corridors;

  if (corridorsRemaining > 0) {
    const corridorPairs: Array<[ShipSection, ShipSection]> = [];

    for (const from of sectionKeys) {
      const corridors = sections[from].corridors;

      for (const to of sectionKeys) {
        if (corridors[to] === 1 && from < to) {
          corridorPairs.push([from, to]);
        }
      }
    }

    for (const [from, to] of corridorPairs) {
      if (corridorsRemaining <= 0) {
        break;
      }

      const fromSection = sections[from];
      const toSection = sections[to];

      if (fromSection.corridors[to] === 1 || toSection.corridors[from] === 1) {
        fromSection.corridors[to] = 0;
        toSection.corridors[from] = 0;
        corridorsRemaining -= 1;
      }
    }
  }

  return {
    ...ship,
    sections,
  };
}

export function applyEnvironmentDamage(game: GameState): GameState {
  if (game.status !== 'in_progress') {
    throw new Error(
      'Cannot apply environment damage for a game that is not in progress. ' +
      `Root cause: game status is "${game.status}". ` +
      'Fix: Only call applyEnvironmentDamage when game.status is "in_progress".'
    );
  }

  // Skip environment damage on turn 1 to give players a chance to move from starting position
  if (game.currentTurn === 1) {
    return game;
  }

  const damageByPlayer = computeEnvironmentDamageForActivePlayers(game);
  const players = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    const damage = damageByPlayer[player.id];

    if (!damage || player.status !== 'active') {
      players.set(player.id, player);
      continue;
    }

    const adjustedDamage: EnvironmentDamage = playerHasPoweredUpgrade(player, player.ship, 'high_density_plates')
      ? {
          hull: Math.max(0, Math.ceil(damage.hull / 2)),
          conduits: damage.conduits,
          corridors: damage.corridors,
        }
      : damage;

    const updatedShip = applyEnvironmentDamageToShip(player.ship, adjustedDamage);
    const wrecked = ShipUtils.isWrecked(updatedShip);

    const updatedPlayer: PlayerState = {
      ...player,
      ship: updatedShip,
      status: wrecked && player.status === 'active' ? 'wrecked' : player.status,
    };

    players.set(updatedPlayer.id, updatedPlayer);
  }

  return {
    ...game,
    players,
  };
}

export function computeEnvironmentDamageForPosition(
  position: ShipPosition,
  board: Board,
): EnvironmentDamage {
  const isValid = BoardUtils.isValidPosition(position, board);

  if (!isValid) {
    throw new Error(
      'Cannot compute environment damage for invalid position. ' +
      `Root cause: ring=${position.ring}, space=${position.space} is outside board bounds. ` +
      'Fix: Ensure ship and object positions are validated before computing environment damage.'
    );
  }

  const ringColor = BoardUtils.getRingColor(position.ring);
  const damageKey = ringColor.toUpperCase() as keyof typeof ENVIRONMENT_DAMAGE;
  const damageConfig = ENVIRONMENT_DAMAGE[damageKey];

  if (!damageConfig) {
    throw new Error(
      'Environment damage configuration is missing for ring color. ' +
      `Root cause: no ENVIRONMENT_DAMAGE entry for key "${damageKey}". ` +
      'Fix: Define ENVIRONMENT_DAMAGE for all possible ring colors in GameConfig.'
    );
  }

  return {
    hull: damageConfig.hull,
    conduits: damageConfig.conduits,
    corridors: damageConfig.corridors,
  };
}

export function computeEnvironmentDamageForActivePlayers(
  game: GameState,
): Record<string, EnvironmentDamage> {
  const results: Record<string, EnvironmentDamage> = {};

  for (const player of game.players.values()) {
    if (player.status !== 'active') {
      continue;
    }
    const damage = computeEnvironmentDamageForPosition(player.ship.position, game.board);
    results[player.id] = damage;
  }

  return results;
}
