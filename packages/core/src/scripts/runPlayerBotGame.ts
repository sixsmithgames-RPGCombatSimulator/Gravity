/**
 * Purpose: Provide a fully automated player-bot game runner that plays the player side using bot decisions
 * Parameters:
 *   - options: PlayerBotRunOptions configuration for the simulation (see type for required fields)
 * Returns: Final GameState after running until completion or max turn limit
 * Side effects: Emits console logs when watchChoices is true or when logLevel triggers ConsoleBotLogger
 */
import {
  addPlayerToGame,
  createInitialShip,
  createNewGame,
  generateAllBotActions,
  processTurn,
  startGame,
} from '../engine/index';
import type {
  AnyCrew,
  Captain,
  GameSettings,
  GameState,
  Ship,
  TurnActions,
} from '../models';
import { BOARD_CONFIG, SHIP_SECTIONS } from '../constants';
import type { BotLogLevel, EngineInstrumentationOptions } from '../engine/logging/EngineInstrumentation';
import { ConsoleBotLogger } from '../engine/logging/ConsoleBotLogger';

/**
 * Player bot run configuration
 * Purpose: Require explicit simulation parameters to avoid silent defaults
 */
export interface PlayerBotRunOptions {
  gameId: string;
  boardSpeedByRing: number[];
  rotationDirection: GameSettings['rotationDirection'];
  maxTurns: number;
  logLevel: BotLogLevel;
  watchChoices?: boolean;
}

/**
 * Purpose: Validate boardSpeedByRing matches board configuration
 * Parameters:
 *   - boardSpeedByRing: Array of ring speed requirements supplied by caller
 * Returns: void
 * Side effects: Throws when validation fails
 */
function validateBoardSpeedByRing(boardSpeedByRing: number[]): void {
  if (!Array.isArray(boardSpeedByRing)) {
    throw new Error(
      'Cannot run player bot game because boardSpeedByRing is not an array. ' +
        'Root cause: options.boardSpeedByRing is undefined or not an array. ' +
        'Fix: Provide a numeric array matching BOARD_CONFIG.NUM_RINGS.',
    );
  }

  if (boardSpeedByRing.length !== BOARD_CONFIG.NUM_RINGS) {
    throw new Error(
      'Cannot run player bot game because boardSpeedByRing length does not match the number of rings. ' +
        `Root cause: expected ${BOARD_CONFIG.NUM_RINGS} entries but received ${boardSpeedByRing.length}. ` +
        'Fix: Supply one positive speed value for each ring index in the board.',
    );
  }

  for (let index = 0; index < boardSpeedByRing.length; index += 1) {
    const value = boardSpeedByRing[index];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        'Cannot run player bot game because a ring speed is invalid. ' +
          `Root cause: boardSpeedByRing[${index}] is ${value}. ` +
          'Fix: Provide positive finite integers for every ring speed entry.',
      );
    }
  }
}

/**
 * Purpose: Build a minimal captain for the automated player
 * Parameters:
 *   - captainId: Unique identifier for the captain
 * Returns: Captain record placed in Bridge
 * Side effects: None
 */
function createBotCaptain(captainId: string): Captain {
  return {
    id: captainId,
    name: 'Automated Captain',
    type: 'captain',
    captainType: 'merchant',
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  } as Captain;
}

/**
 * Purpose: Build a minimal crew roster for the automated player
 * Parameters:
 *   - crewPrefix: Identifier prefix to keep crew ids unique
 * Returns: Crew array with one engineer and one pilot to exercise core actions
 * Side effects: None
 */
function createBotCrew(crewPrefix: string): AnyCrew[] {
  return [
    {
      id: `${crewPrefix}-engineer`,
      name: 'Engineer Bot',
      type: 'basic',
      role: 'engineer',
      status: 'active',
      location: SHIP_SECTIONS.ENGINEERING,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
    {
      id: `${crewPrefix}-pilot`,
      name: 'Pilot Bot',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  ] as AnyCrew[];
}

/**
 * Purpose: Create a starter ship positioned on the outer ring before startGame spaces players evenly
 * Parameters:
 *   - rotationDirection: Board rotation direction to embed in settings
 * Returns: Ship instance
 * Side effects: None
 */
function createBotShip(): Ship {
  return createInitialShip({ ring: BOARD_CONFIG.NUM_RINGS, space: 0 }, 'normal');
}

/**
 * Purpose: Build instrumentation options using the ConsoleBotLogger
 * Parameters:
 *   - logLevel: Desired bot log level
 * Returns: EngineInstrumentationOptions
 * Side effects: None, but downstream logging writes to console
 */
function buildInstrumentationOptions(logLevel: BotLogLevel): EngineInstrumentationOptions {
  return {
    logger: new ConsoleBotLogger(),
    logLevel,
  };
}

/**
 * Purpose: Generate bot actions for every bot player
 * Parameters:
 *   - game: Current GameState
 *   - instrumentation: EngineInstrumentationOptions for logging
 * Returns: TurnActions keyed by player id
 * Side effects: None (generation only)
 */
function generateBotActionsForAllPlayers(
  game: GameState,
  instrumentation: EngineInstrumentationOptions,
): TurnActions {
  const actions = generateAllBotActions(game, instrumentation);
  if (!actions || Object.keys(actions).length === 0) {
    throw new Error(
      'Cannot generate bot actions because no actions were returned. ' +
        'Root cause: game.players may not include any bots or the generator returned an empty result. ' +
        'Fix: Ensure players are marked isBot=true and game.status is "in_progress" before processing turns.',
    );
  }
  return actions;
}

/**
 * Purpose: Run a full game with the player controlled by the default bot strategy
 * Parameters:
 *   - options: PlayerBotRunOptions with explicit configuration (gameId, boardSpeedByRing, rotationDirection, maxTurns, logLevel, watchChoices)
 * Returns: Final GameState after simulation completes or reaches maxTurns
 * Side effects: Mutates game progression and logs to console depending on instrumentation
 */
export function runPlayerBotGame(options: PlayerBotRunOptions): GameState {
  if (!options) {
    throw new Error(
      'Cannot run player bot game because options are missing. ' +
        'Root cause: runPlayerBotGame was called without parameters. ' +
        'Fix: Provide PlayerBotRunOptions with gameId, boardSpeedByRing, rotationDirection, maxTurns, and logLevel.',
    );
  }

  if (!options.gameId) {
    throw new Error(
      'Cannot run player bot game because gameId is missing. ' +
        'Root cause: options.gameId is empty. ' +
        'Fix: Supply a non-empty gameId to identify the simulation run.',
    );
  }

  validateBoardSpeedByRing(options.boardSpeedByRing);

  if (!Number.isInteger(options.maxTurns) || options.maxTurns <= 0) {
    throw new Error(
      'Cannot run player bot game because maxTurns is invalid. ' +
        `Root cause: maxTurns is ${options.maxTurns}. ` +
        'Fix: Provide a positive integer maxTurns to bound the simulation.',
    );
  }

  if (options.logLevel !== 'off' && options.logLevel !== 'summary' && options.logLevel !== 'choices' && options.logLevel !== 'verbose') {
    throw new Error(
      'Cannot run player bot game because logLevel is invalid. ' +
        `Root cause: options.logLevel is "${options.logLevel}". ` +
        'Fix: Use one of: off, summary, choices, verbose.',
    );
  }

  if (options.rotationDirection !== 'clockwise' && options.rotationDirection !== 'counter-clockwise') {
    throw new Error(
      'Cannot run player bot game because rotationDirection is invalid. ' +
        `Root cause: options.rotationDirection is "${options.rotationDirection}". ` +
        'Fix: Use "clockwise" or "counter-clockwise" to match GameSettings.',
    );
  }

  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: options.rotationDirection,
    expansions: ['core'],
  };

  const createdAt = new Date();
  let game = createNewGame({
    id: options.gameId,
    createdAt,
    settings,
    boardSpeedByRing: options.boardSpeedByRing,
  });

  game = addPlayerToGame(game, {
    id: 'player-bot',
    userId: null,
    isBot: true,
    ship: createBotShip(),
    crew: createBotCrew('player-bot'),
    captain: createBotCaptain('player-bot-captain'),
    botStrategy: 'default',
  });

  game = addPlayerToGame(game, {
    id: 'opponent-bot',
    userId: null,
    isBot: true,
    ship: createBotShip(),
    crew: createBotCrew('opponent-bot'),
    captain: createBotCaptain('opponent-bot-captain'),
    botStrategy: 'default',
  });

  game = startGame(game, { startedAt: createdAt });

  const instrumentation = buildInstrumentationOptions(options.logLevel);

  let iteration = 0;
  while (game.status === 'in_progress' && iteration < options.maxTurns) {
    const botActions = generateBotActionsForAllPlayers(game, instrumentation);
    const nextGame = processTurn(game, botActions, instrumentation);

    if (options.watchChoices === true) {
      console.log(
        `[PlayerBot:TURN] turn=${game.currentTurn} phase=${game.turnPhase} -> nextPhase=${nextGame.turnPhase} status=${nextGame.status}`,
      );
      if (nextGame.lastActionResolutionRecordsByPlayerId) {
        console.log(
          `[PlayerBot:RESOLUTION] records=${JSON.stringify(nextGame.lastActionResolutionRecordsByPlayerId)}`,
        );
      }
    }

    game = nextGame;
    iteration += 1;
  }

  if (game.status === 'in_progress') {
    console.warn(
      'Player bot game ended early because maxTurns was reached. ' +
        `Reached ${options.maxTurns} iterations without a terminal game state. ` +
        'Consider increasing maxTurns to allow completion.',
    );
  }

  return game;
}

