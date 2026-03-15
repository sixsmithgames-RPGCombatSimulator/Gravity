import type { AnyCrew, Captain, GameState, PlayerAction, PlayerState } from '../../models';
import { SHIP_SECTIONS, type ShipSection } from '../../constants';
import type { BotActionResolutionLogEvent } from './BotLogger';

export function buildBotActionResolutionLogEvent(
  previousGame: GameState,
  nextGame: GameState,
  playerId: string,
  action: PlayerAction,
): BotActionResolutionLogEvent {
  const previousPlayer = getPlayerOrThrow(previousGame, playerId, 'previous');
  const nextPlayer = getPlayerOrThrow(nextGame, playerId, 'next');

  const summary = describeActionResolution(previousGame, nextGame, previousPlayer, nextPlayer, action);

  return {
    type: 'ACTION_RESOLUTION',
    turn: previousGame.currentTurn,
    playerId,
    crewId: action.crewId,
    actionType: action.type,
    result: summary.result,
    details: summary.details,
  };
}

type ResolutionSummary = {
  details: string;
  result: 'success' | 'failed_validation' | 'no_effect';
};

function describeActionResolution(
  previousGame: GameState,
  nextGame: GameState,
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  if (action.type === 'restore') {
    return describeRestoreResolution(previousPlayer, nextPlayer, action);
  }

  if (action.type === 'repair') {
    return describeRepairResolution(previousPlayer, nextPlayer, action);
  }

  if (action.type === 'revive') {
    return describeReviveResolution(previousPlayer, nextPlayer, action);
  }

  if (action.type === 'maneuver') {
    return describeManeuverResolution(previousPlayer, nextPlayer, action);
  }

  if (action.type === 'attack') {
    return describeAttackResolution(previousGame, nextGame, previousPlayer, nextPlayer, action);
  }

  const previousSnapshot = buildPlayerSnapshot(previousPlayer);
  const nextSnapshot = buildPlayerSnapshot(nextPlayer);
  if (previousSnapshot === nextSnapshot) {
    return {
      result: 'no_effect',
      details: `No measurable player-state change detected for action type "${action.type}".`,
    };
  }

  return {
    result: 'success',
    details: `Player state changed for action type "${action.type}". Before=${previousSnapshot}. After=${nextSnapshot}.`,
  };
}

function describeRestoreResolution(
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  const actingCrew = findCrewById(previousPlayer, action.crewId);
  if (!actingCrew) {
    return {
      result: 'failed_validation',
      details: `Could not describe restore result because acting crew "${action.crewId}" was not found on the previous player state.`,
    };
  }

  const actingSection = getCrewLocationOrThrow(actingCrew);
  const previousActingPower = getSectionPower(previousPlayer, actingSection);
  const nextActingPower = getSectionPower(nextPlayer, actingSection);
  const previousTotalPower = getTotalShipPower(previousPlayer);
  const nextTotalPower = getTotalShipPower(nextPlayer);
  const previousShields = previousPlayer.ship.shields;
  const nextShields = nextPlayer.ship.shields;

  const changed =
    previousActingPower !== nextActingPower ||
    previousTotalPower !== nextTotalPower ||
    previousShields !== nextShields;

  return {
    result: changed ? 'success' : 'no_effect',
    details:
      `Restore from section "${actingSection}".` +
      ` Acting-section power ${previousActingPower} -> ${nextActingPower}.` +
      ` Total ship power ${previousTotalPower} -> ${nextTotalPower}.` +
      ` Shields ${previousShields} -> ${nextShields}.`,
  };
}

function describeRepairResolution(
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  const targetSection = action.target?.section;
  if (typeof targetSection !== 'string') {
    return {
      result: 'failed_validation',
      details: 'Could not describe repair result because action.target.section is missing or invalid.',
    };
  }

  const repairTypeRaw = action.parameters?.repairType;
  const repairType = typeof repairTypeRaw === 'string' ? repairTypeRaw : 'hull';
  const previousTarget = getSectionStateOrThrow(previousPlayer, targetSection as ShipSection);
  const nextTarget = getSectionStateOrThrow(nextPlayer, targetSection as ShipSection);

  if (repairType === 'hull') {
    const changed = previousTarget.hull !== nextTarget.hull;
    return {
      result: changed ? 'success' : 'no_effect',
      details: `Repair on section "${targetSection}" changed hull ${previousTarget.hull} -> ${nextTarget.hull}.`,
    };
  }

  const actingCrew = findCrewById(previousPlayer, action.crewId);
  if (!actingCrew) {
    return {
      result: 'failed_validation',
      details: `Could not describe ${repairType} repair result because acting crew "${action.crewId}" was not found on the previous player state.`,
    };
  }

  const fromSection = getCrewLocationOrThrow(actingCrew);
  const previousEdgeValue = getEdgeState(previousPlayer, fromSection, targetSection as ShipSection, repairType);
  const nextEdgeValue = getEdgeState(nextPlayer, fromSection, targetSection as ShipSection, repairType);

  return {
    result: previousEdgeValue !== nextEdgeValue ? 'success' : 'no_effect',
    details:
      `Repair on ${repairType} edge "${fromSection}" -> "${targetSection}" changed value ${previousEdgeValue} -> ${nextEdgeValue}.`,
  };
}

function describeReviveResolution(
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  const targetCrewId = action.parameters?.targetCrewId;
  if (typeof targetCrewId !== 'string') {
    return {
      result: 'failed_validation',
      details: 'Could not describe revive result because action.parameters.targetCrewId is missing or invalid.',
    };
  }

  const previousCrew = findCrewById(previousPlayer, targetCrewId);
  const nextCrew = findCrewById(nextPlayer, targetCrewId);
  if (!previousCrew || !nextCrew) {
    return {
      result: 'failed_validation',
      details: `Could not describe revive result because target crew "${targetCrewId}" was missing from player state.`,
    };
  }

  const changed =
    previousCrew.status !== nextCrew.status ||
    previousCrew.reviveProgress !== nextCrew.reviveProgress ||
    previousCrew.location !== nextCrew.location;

  return {
    result: changed ? 'success' : 'no_effect',
    details:
      `Revive target "${targetCrewId}" status ${previousCrew.status} -> ${nextCrew.status}.` +
      ` Progress ${previousCrew.reviveProgress} -> ${nextCrew.reviveProgress}.` +
      ` Location ${String(previousCrew.location)} -> ${String(nextCrew.location)}.`,
  };
}

function describeManeuverResolution(
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  const directionRaw = action.parameters?.direction;
  const direction = typeof directionRaw === 'string' ? directionRaw : 'unknown';
  const powerSpentRaw = action.parameters?.powerSpent;
  const powerSpent = typeof powerSpentRaw === 'number' ? powerSpentRaw : null;
  const previousDrivesPower = getSectionPower(previousPlayer, SHIP_SECTIONS.DRIVES);
  const nextDrivesPower = getSectionPower(nextPlayer, SHIP_SECTIONS.DRIVES);
  const previousPosition = previousPlayer.ship.position;
  const nextPosition = nextPlayer.ship.position;

  const changed =
    previousPosition.ring !== nextPosition.ring ||
    previousPosition.space !== nextPosition.space ||
    previousDrivesPower !== nextDrivesPower;

  const powerSpentText = powerSpent === null ? 'unknown' : String(powerSpent);

  return {
    result: changed ? 'success' : 'no_effect',
    details:
      `Maneuver direction "${direction}" with powerSpent=${powerSpentText}.` +
      ` Position (${previousPosition.ring}, ${previousPosition.space}) -> (${nextPosition.ring}, ${nextPosition.space}).` +
      ` Drives power ${previousDrivesPower} -> ${nextDrivesPower}.`,
  };
}

function describeAttackResolution(
  previousGame: GameState,
  nextGame: GameState,
  previousPlayer: PlayerState,
  nextPlayer: PlayerState,
  action: PlayerAction,
): ResolutionSummary {
  const targetObjectId = action.target?.objectId;
  if (typeof targetObjectId !== 'string') {
    return {
      result: 'failed_validation',
      details: 'Could not describe attack result because action.target.objectId is missing or invalid.',
    };
  }

  const previousObject = previousGame.board.objects.find((object) => object.id === targetObjectId);
  const nextObject = nextGame.board.objects.find((object) => object.id === targetObjectId);
  if (!previousObject || !nextObject) {
    return {
      result: 'failed_validation',
      details: `Could not describe attack result because target object "${targetObjectId}" was missing before or after resolution.`,
    };
  }

  const previousHull =
    'hull' in previousObject && typeof previousObject.hull === 'number'
      ? previousObject.hull
      : null;
  const nextHull =
    'hull' in nextObject && typeof nextObject.hull === 'number'
      ? nextObject.hull
      : null;
  const previousDefensePower = getSectionPower(previousPlayer, SHIP_SECTIONS.DEFENSE);
  const nextDefensePower = getSectionPower(nextPlayer, SHIP_SECTIONS.DEFENSE);

  const typeChanged = previousObject.type !== nextObject.type;
  const hullChanged = previousHull !== nextHull;
  const powerChanged = previousDefensePower !== nextDefensePower;
  const changed = typeChanged || hullChanged || powerChanged;

  return {
    result: changed ? 'success' : 'no_effect',
    details:
      `Attack target "${targetObjectId}" type ${previousObject.type} -> ${nextObject.type}.` +
      ` Hull ${formatNullableNumber(previousHull)} -> ${formatNullableNumber(nextHull)}.` +
      ` Defense power ${previousDefensePower} -> ${nextDefensePower}.`,
  };
}

function buildPlayerSnapshot(player: PlayerState): string {
  const totalPower = getTotalShipPower(player);
  const position = player.ship.position;
  return `position=(${position.ring},${position.space}), shields=${player.ship.shields}, totalPower=${totalPower}`;
}

function getPlayerOrThrow(game: GameState, playerId: string, stateLabel: string): PlayerState {
  const player = game.players.get(playerId);
  if (!player) {
    throw new Error(
      'Cannot build bot action resolution detail because player state is missing. ' +
        `Root cause: player "${playerId}" was not found on the ${stateLabel} game state. ` +
        'Fix: Ensure action-resolution logging only runs for players present in both the before and after game states.',
    );
  }

  return player;
}

function getSectionStateOrThrow(player: PlayerState, section: ShipSection) {
  const sectionState = player.ship.sections[section];
  if (!sectionState) {
    throw new Error(
      'Cannot build bot action resolution detail because section state is missing. ' +
        `Root cause: player "${player.id}" has no ship section state for "${section}". ` +
        'Fix: Ensure ship.sections contains every required ship section before action-resolution logging.',
    );
  }

  return sectionState;
}

function getSectionPower(player: PlayerState, section: ShipSection): number {
  const sectionState = getSectionStateOrThrow(player, section);
  return sectionState.powerDice.reduce((sum, die) => sum + die, 0);
}

function getTotalShipPower(player: PlayerState): number {
  let total = 0;
  for (const section of Object.values(SHIP_SECTIONS) as ShipSection[]) {
    total += getSectionPower(player, section);
  }
  return total;
}

function getEdgeState(
  player: PlayerState,
  fromSection: ShipSection,
  targetSection: ShipSection,
  repairType: string,
): number {
  const targetState = getSectionStateOrThrow(player, targetSection);
  if (repairType === 'conduit') {
    const conduitValue = targetState.conduitConnections[fromSection];
    return typeof conduitValue === 'number' ? conduitValue : 0;
  }

  const corridorValue = targetState.corridors[fromSection];
  return typeof corridorValue === 'number' ? corridorValue : 0;
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

function getCrewLocationOrThrow(crew: AnyCrew | Captain): ShipSection {
  if (crew.location === null || crew.location === undefined) {
    throw new Error(
      'Cannot build bot action resolution detail because acting crew location is missing. ' +
        `Root cause: crew "${crew.id}" has location "${String(crew.location)}". ` +
        'Fix: Ensure active crew members retain valid ship-section locations during action-resolution logging.',
    );
  }

  if (typeof crew.location !== 'string') {
    throw new Error(
      'Cannot build bot action resolution detail because acting crew location is invalid. ' +
        `Root cause: crew "${crew.id}" has location type "${typeof crew.location}". ` +
        'Fix: Ensure crew locations are stored as ShipSection strings during action-resolution logging.',
    );
  }

  return crew.location as ShipSection;
}

function formatNullableNumber(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  return String(value);
}
