import type { AnyCrew, Captain, GameState, PlayerAction, PlayerActionType, PlayerState } from '../../models';
import { BoardUtils } from '../../models';
import { SECTION_CONFIG, SHIP_CONNECTION_LAYOUT, SHIP_SECTIONS, type ShipSection } from '../../constants';
import type { EngineInstrumentationOptions } from '../logging/EngineInstrumentation';
import { logBotDecisionIfEnabled, logBotWarningIfEnabled } from '../logging/EngineInstrumentation';

const DEFAULT_BOT_STRATEGY_NAME = 'default';

type BotActionSelection = {
  action: PlayerAction;
  priority: string;
  rationale: string[];
};

export function defaultBotStrategy(
  game: GameState,
  player: PlayerState,
  options?: EngineInstrumentationOptions,
): PlayerAction[] {
  if (player.status !== 'active') {
    return [];
  }

  const activeCrew = [
    ...(player.captain.status === 'active' ? [player.captain] : []),
    ...player.crew.filter((crewMember) => crewMember.status === 'active'),
  ];

  if (activeCrew.length === 0) {
    return [];
  }

  const actions: PlayerAction[] = [];
  const reservedPlayerActionTypes = new Set<PlayerActionType>();

  for (const crew of activeCrew) {
    const selection = selectBotActionForCrew(game, player, crew, reservedPlayerActionTypes);
    if (!selection) {
      logBotWarningIfEnabled(
        {
          type: 'BOT_WARNING',
          turn: game.currentTurn,
          playerId: player.id,
          crewId: crew.id,
          message: 'Bot crew has no valid action for the current state after legality checks.',
        },
        options,
      );
      continue;
    }

    actions.push(selection.action);
    if (isPlayerLimitedActionType(selection.action.type)) {
      reservedPlayerActionTypes.add(selection.action.type);
    }
    logBotDecisionIfEnabled(
      {
        type: 'BOT_DECISION',
        turn: game.currentTurn,
        playerId: player.id,
        crewId: crew.id,
        strategyName: DEFAULT_BOT_STRATEGY_NAME,
        priority: selection.priority,
        rationale: selection.rationale,
        chosenAction: selection.action,
      },
      options,
    );
  }

  return actions;
}

function selectBotActionForCrew(
  game: GameState,
  player: PlayerState,
  crew: AnyCrew | Captain,
  reservedPlayerActionTypes: ReadonlySet<PlayerActionType>,
): BotActionSelection | null {
  const candidateSelections = buildCandidateSelections(game, player, crew);

  for (const selection of candidateSelections) {
    if (isPlayerLimitedActionType(selection.action.type) && reservedPlayerActionTypes.has(selection.action.type)) {
      continue;
    }

    if (isBotActionLegal(game, player, crew, selection.action)) {
      return selection;
    }
  }

  return null;
}

function buildCandidateSelections(
  game: GameState,
  player: PlayerState,
  crew: AnyCrew | Captain,
): BotActionSelection[] {
  const selections: BotActionSelection[] = [];

  const engineeringPower = getSectionPower(player, SHIP_SECTIONS.ENGINEERING);
  if (engineeringPower < 2) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'restore',
      },
      priority: 'survival_restore_engineering',
      rationale: ['engineering power is below target threshold', 'additional generated power supports later actions'],
    });
  }

  const damagedSections = getDamagedSectionsByPriority(player);
  for (const sectionKey of damagedSections.filter((section) => isCriticalHullState(player, section))) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'repair',
        target: { section: sectionKey },
        parameters: { repairType: 'hull' },
      },
      priority: 'survival_repair_critical_hull',
      rationale: ['section hull is in critical range', 'repair preserves future action options and ship survival'],
    });
  }

  const unconsciousCrew = getUnconsciousCrewTargets(player);
  for (const targetCrew of unconsciousCrew) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'revive',
        parameters: { targetCrewId: targetCrew.id },
      },
      priority: 'support_revive_unconscious_crew',
      rationale: ['an unconscious crew member can be restored to active duty', 'revival improves future action economy'],
    });
  }

  if (player.ship.position.ring <= 3) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'maneuver',
        parameters: { direction: 'outward', powerSpent: 1 },
      },
      priority: 'escape_outward_maneuver',
      rationale: ['ship is in dangerous inner rings', 'outward movement reduces environmental risk'],
    });
  }

  for (const hostile of getAdjacentHostiles(game, player)) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'attack',
        target: { objectId: hostile.id },
      },
      priority: 'defense_attack_adjacent_hostile',
      rationale: ['hostile ship is adjacent', 'removing nearby threats protects the ship'],
    });
  }

  for (const sectionKey of damagedSections.filter((section) => !isCriticalHullState(player, section))) {
    selections.push({
      action: {
        playerId: player.id,
        crewId: crew.id,
        type: 'repair',
        target: { section: sectionKey },
        parameters: { repairType: 'hull' },
      },
      priority: 'maintenance_repair_damaged_hull',
      rationale: ['section hull is below maximum', 'repair improves long-term survivability'],
    });
  }

  selections.push({
    action: {
      playerId: player.id,
      crewId: crew.id,
      type: 'restore',
    },
    priority: 'fallback_restore',
    rationale: ['generating power improves future action legality and ship resilience'],
  });

  return selections;
}

function isBotActionLegal(
  game: GameState,
  player: PlayerState,
  crew: AnyCrew | Captain,
  action: PlayerAction,
): boolean {
  if (action.type === 'restore') {
    return canCrewGenerateRestorePower(player, crew);
  }

  if (action.type === 'repair') {
    const targetSection = action.target?.section;
    if (typeof targetSection !== 'string') {
      return false;
    }

    return canCrewRepairSection(player, crew, targetSection as ShipSection);
  }

  if (action.type === 'revive') {
    const targetCrewId = action.parameters?.targetCrewId;
    if (typeof targetCrewId !== 'string') {
      return false;
    }

    return canCrewReviveTarget(player, crew, targetCrewId);
  }

  if (action.type === 'maneuver') {
    return canCrewManeuver(player, crew);
  }

  if (action.type === 'attack') {
    const targetObjectId = action.target?.objectId;
    if (typeof targetObjectId !== 'string') {
      return false;
    }

    return canCrewAttackHostile(game, player, crew, targetObjectId);
  }

  return false;
}

function canCrewGenerateRestorePower(player: PlayerState, crew: AnyCrew | Captain): boolean {
  const actingSection = getCrewLocation(crew);
  const actingSectionState = player.ship.sections[actingSection];
  if (!actingSectionState) {
    throw new Error(
      'Cannot evaluate bot restore legality because acting section state is missing. ' +
        `Root cause: ship.sections has no entry for section "${actingSection}" for player "${player.id}". ` +
        'Fix: Ensure all ship sections are initialized before generating bot actions.',
    );
  }

  if (actingSectionState.hull <= 0) {
    return false;
  }

  if (actingSection === SHIP_SECTIONS.ENGINEERING) {
    return true;
  }

  const engineeringSection = player.ship.sections[SHIP_SECTIONS.ENGINEERING];
  if (!engineeringSection) {
    throw new Error(
      'Cannot evaluate bot restore legality because Engineering section state is missing. ' +
        `Root cause: player "${player.id}" has no Engineering section in ship.sections. ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  const engineeringFunctional = engineeringSection.hull > 0 && getSectionPower(player, SHIP_SECTIONS.ENGINEERING) > 0;
  const engineeringFullyPowered = getSectionPower(player, SHIP_SECTIONS.ENGINEERING) >= SECTION_CONFIG[SHIP_SECTIONS.ENGINEERING].powerRequired;
  const isBridgeOrSciLab = actingSection === SHIP_SECTIONS.BRIDGE || actingSection === SHIP_SECTIONS.SCI_LAB;
  const isDefense = actingSection === SHIP_SECTIONS.DEFENSE;

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
    if (crew.role === 'doctor' || crew.role === 'ace_pilot' || crew.role === 'mission_specialist') {
      return false;
    }

    return false;
  }

  return (isBridgeOrSciLab && engineeringFunctional && engineeringFullyPowered) || (isDefense && engineeringFullyPowered);
}

function canCrewRepairSection(player: PlayerState, crew: AnyCrew | Captain, targetSection: ShipSection): boolean {
  const actingSection = getCrewLocation(crew);
  const actingSectionState = player.ship.sections[actingSection];
  const targetSectionState = player.ship.sections[targetSection];

  if (!actingSectionState || !targetSectionState) {
    throw new Error(
      'Cannot evaluate bot repair legality because section state is missing. ' +
        `Root cause: acting section "${actingSection}" or target section "${targetSection}" is absent for player "${player.id}". ` +
        'Fix: Ensure all ship sections are initialized before generating bot actions.',
    );
  }

  if (actingSectionState.hull <= 0) {
    return false;
  }

  if (targetSectionState.hull >= SECTION_CONFIG[targetSection].maxHull) {
    return false;
  }

  if (!canTargetRepairSectionFrom(actingSection, targetSection)) {
    return false;
  }

  if (crew.type === 'officer' && crew.role === 'chief_engineer') {
    return true;
  }

  return getSectionPower(player, actingSection) > 0;
}

function canCrewReviveTarget(player: PlayerState, crew: AnyCrew | Captain, targetCrewId: string): boolean {
  const actingSection = getCrewLocation(crew);
  if (actingSection !== SHIP_SECTIONS.MED_LAB) {
    return false;
  }

  const medLabState = player.ship.sections[SHIP_SECTIONS.MED_LAB];
  if (!medLabState) {
    throw new Error(
      'Cannot evaluate bot revive legality because Medical Lab state is missing. ' +
        `Root cause: player "${player.id}" has no Medical Lab entry in ship.sections. ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  if (medLabState.hull <= 0 || getSectionPower(player, SHIP_SECTIONS.MED_LAB) <= 0) {
    return false;
  }

  const targetCrew = findCrewById(player, targetCrewId);
  if (!targetCrew) {
    return false;
  }

  return targetCrew.status === 'unconscious';
}

function canCrewManeuver(player: PlayerState, crew: AnyCrew | Captain): boolean {
  const actingSection = getCrewLocation(crew);
  if (actingSection !== SHIP_SECTIONS.BRIDGE) {
    return false;
  }

  const bridgeState = player.ship.sections[SHIP_SECTIONS.BRIDGE];
  const drivesState = player.ship.sections[SHIP_SECTIONS.DRIVES];
  if (!bridgeState || !drivesState) {
    throw new Error(
      'Cannot evaluate bot maneuver legality because Bridge or Drives state is missing. ' +
        `Root cause: player "${player.id}" is missing Bridge or Drives in ship.sections. ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  if (bridgeState.hull <= 0 || getSectionPower(player, SHIP_SECTIONS.BRIDGE) <= 0) {
    return false;
  }

  if (drivesState.hull <= 0 || getSectionPower(player, SHIP_SECTIONS.DRIVES) <= 0) {
    return false;
  }

  return true;
}

function canCrewAttackHostile(
  game: GameState,
  player: PlayerState,
  crew: AnyCrew | Captain,
  targetObjectId: string,
): boolean {
  const actingSection = getCrewLocation(crew);
  if (actingSection !== SHIP_SECTIONS.DEFENSE) {
    return false;
  }

  const defenseState = player.ship.sections[SHIP_SECTIONS.DEFENSE];
  if (!defenseState) {
    throw new Error(
      'Cannot evaluate bot attack legality because Defense section state is missing. ' +
        `Root cause: player "${player.id}" has no Defense entry in ship.sections. ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  if (defenseState.hull <= 0 || getSectionPower(player, SHIP_SECTIONS.DEFENSE) <= 0) {
    return false;
  }

  const target = game.board.objects.find((object) => object.id === targetObjectId);
  if (!target || target.type !== 'hostile_ship') {
    return false;
  }

  return BoardUtils.calculateDistance(player.ship.position, target.position, game.board) <= 1;
}

function getDamagedSectionsByPriority(player: PlayerState): ShipSection[] {
  const sections = Object.values(SHIP_SECTIONS) as ShipSection[];

  return sections
    .filter((sectionKey) => {
      const sectionState = player.ship.sections[sectionKey];
      if (!sectionState) {
        throw new Error(
          'Cannot evaluate bot repair priorities because a ship section state is missing. ' +
            `Root cause: player "${player.id}" has no state for section "${sectionKey}". ` +
            'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
        );
      }

      return sectionState.hull < SECTION_CONFIG[sectionKey].maxHull;
    })
    .sort((left, right) => {
      const leftState = player.ship.sections[left];
      const rightState = player.ship.sections[right];
      if (!leftState || !rightState) {
        throw new Error(
          'Cannot sort bot repair priorities because section state is missing. ' +
            `Root cause: player "${player.id}" is missing state while ordering "${left}" and "${right}". ` +
            'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
        );
      }

      if (leftState.hull !== rightState.hull) {
        return leftState.hull - rightState.hull;
      }

      return left.localeCompare(right);
    });
}

function isCriticalHullState(player: PlayerState, section: ShipSection): boolean {
  const sectionState = player.ship.sections[section];
  if (!sectionState) {
    throw new Error(
      'Cannot evaluate bot hull severity because section state is missing. ' +
        `Root cause: player "${player.id}" has no state for section "${section}". ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  const threshold = Math.ceil(SECTION_CONFIG[section].maxHull / 3);
  return sectionState.hull <= threshold;
}

function getUnconsciousCrewTargets(player: PlayerState): Array<AnyCrew | Captain> {
  const targets: Array<AnyCrew | Captain> = [];

  if (player.captain.status === 'unconscious') {
    targets.push(player.captain);
  }

  for (const crewMember of player.crew) {
    if (crewMember.status === 'unconscious') {
      targets.push(crewMember);
    }
  }

  return targets.sort((left, right) => left.id.localeCompare(right.id));
}

function getAdjacentHostiles(game: GameState, player: PlayerState): Array<{ id: string; distance: number }> {
  return game.board.objects
    .filter((object) => object.type === 'hostile_ship')
    .map((object) => ({
      id: object.id,
      distance: BoardUtils.calculateDistance(player.ship.position, object.position, game.board),
    }))
    .filter((object) => object.distance <= 1)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.id.localeCompare(right.id);
    });
}

function getCrewLocation(crew: AnyCrew | Captain): ShipSection {
  if (crew.location === null || crew.location === undefined) {
    throw new Error(
      'Cannot generate bot actions because an active crew member has no location. ' +
        `Root cause: crew "${crew.id}" has location "${String(crew.location)}". ` +
        'Fix: Ensure every active crew member is assigned to a valid ship section before bot action generation.',
    );
  }

  if (typeof crew.location !== 'string') {
    throw new Error(
      'Cannot generate bot actions because an active crew member location is invalid. ' +
        `Root cause: crew "${crew.id}" has location type "${typeof crew.location}". ` +
        'Fix: Ensure every active crew member location is a valid ShipSection string before bot action generation.',
    );
  }

  const location = crew.location as ShipSection;
  const validSections = Object.values(SHIP_SECTIONS) as ShipSection[];
  if (!validSections.includes(location)) {
    throw new Error(
      'Cannot generate bot actions because an active crew member location is not a valid ship section. ' +
        `Root cause: crew "${crew.id}" has location "${location}". ` +
        'Fix: Ensure every active crew member location matches one of the SHIP_SECTIONS values before bot action generation.',
    );
  }

  return location;
}

function getSectionPower(player: PlayerState, section: ShipSection): number {
  const sectionState = player.ship.sections[section];
  if (!sectionState) {
    throw new Error(
      'Cannot evaluate bot section power because section state is missing. ' +
        `Root cause: player "${player.id}" has no state for section "${section}". ` +
        'Fix: Ensure the ship is initialized with every required section before generating bot actions.',
    );
  }

  return sectionState.powerDice.reduce((sum, die) => sum + die, 0);
}

function findCrewById(player: PlayerState, crewId: string): AnyCrew | Captain | null {
  if (player.captain.id === crewId) {
    return player.captain;
  }

  const crewMember = player.crew.find((candidate) => candidate.id === crewId);
  if (crewMember) {
    return crewMember;
  }

  return null;
}

function isPlayerLimitedActionType(actionType: PlayerActionType): boolean {
  return actionType === 'maneuver';
}

function canTargetRepairSectionFrom(from: ShipSection, target: ShipSection): boolean {
  if (from === target) {
    return true;
  }

  const layoutA = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, unknown>)[from] as {
    conduitConnections?: Record<string, number>;
    corridors?: Record<string, number>;
  } | undefined;
  const layoutB = (SHIP_CONNECTION_LAYOUT as unknown as Record<string, unknown>)[target] as {
    conduitConnections?: Record<string, number>;
    corridors?: Record<string, number>;
  } | undefined;

  const conduitConnectionForward = layoutA?.conduitConnections?.[target];
  const conduitConnectionBackward = layoutB?.conduitConnections?.[from];
  const hasConduitEdge =
    (typeof conduitConnectionForward === 'number' && conduitConnectionForward > 0) ||
    (typeof conduitConnectionBackward === 'number' && conduitConnectionBackward > 0);

  const corridorConnectionForward = layoutA?.corridors?.[target];
  const corridorConnectionBackward = layoutB?.corridors?.[from];
  const hasCorridorEdge = corridorConnectionForward === 1 || corridorConnectionBackward === 1;

  return hasConduitEdge || hasCorridorEdge;
}
