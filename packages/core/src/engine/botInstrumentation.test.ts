import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings, PlayerState, TurnActions } from '../models/Game';
import type {
  BotActionResolutionLogEvent,
  BotDecisionLogEvent,
  BotLogger,
  BotWarningLogEvent,
  TurnSummaryLogEvent,
} from './index';
import { SECTION_CONFIG, SHIP_SECTIONS } from '../constants/GameConfig';
import {
  addPlayerToGame,
  createInitialShip,
  createNewGame,
  generateAllBotActions,
  processTurn,
  startGame,
} from './index';

class CollectingBotLogger implements BotLogger {
  public readonly botDecisions: BotDecisionLogEvent[] = [];
  public readonly actionResolutions: BotActionResolutionLogEvent[] = [];
  public readonly turnSummaries: TurnSummaryLogEvent[] = [];
  public readonly warnings: BotWarningLogEvent[] = [];

  botDecision(event: BotDecisionLogEvent): void {
    this.botDecisions.push(event);
  }

  actionResolution(event: BotActionResolutionLogEvent): void {
    this.actionResolutions.push(event);
  }

  turnSummary(event: TurnSummaryLogEvent): void {
    this.turnSummaries.push(event);
  }

  warning(event: BotWarningLogEvent): void {
    this.warnings.push(event);
  }
}

function createBotInstrumentationGame(): {
  game: ReturnType<typeof createNewGame>;
  humanPlayerId: string;
  botPlayerId: string;
} {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  let game = createNewGame({
    id: 'bot-instrumentation-test-game',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    settings,
    boardSpeedByRing: [1, 1, 1, 1, 1, 1, 1, 1],
  });

  const humanPlayerId = 'human-player';
  const botPlayerId = 'bot-player';

  game = addPlayerToGame(game, {
    id: humanPlayerId,
    userId: 'user-1',
    isBot: false,
    ship: createInitialShip({ ring: 8, space: 0 }),
    crew: [
      {
        id: 'human-crew',
        name: 'Human Crew',
        type: 'basic',
        role: 'engineer',
        status: 'active',
        location: SHIP_SECTIONS.ENGINEERING,
        reviveProgress: 0,
        assembleProgress: 0,
        assembleItemType: null,
      },
    ],
    captain: {
      id: 'human-captain',
      name: 'Human Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  });

  game = addPlayerToGame(game, {
    id: botPlayerId,
    userId: null,
    isBot: true,
    ship: createInitialShip({ ring: 8, space: 10 }),
    crew: [
      {
        id: 'bot-crew',
        name: 'Bot Crew',
        type: 'basic',
        role: 'engineer',
        status: 'active',
        location: SHIP_SECTIONS.ENGINEERING,
        reviveProgress: 0,
        assembleProgress: 0,
        assembleItemType: null,
      },
    ],
    captain: {
      id: 'bot-captain',
      name: 'Bot Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  });

  const startedGame = startGame(game, {
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  return {
    game: startedGame,
    humanPlayerId,
    botPlayerId,
  };
}

describe('bot instrumentation', () => {
  it('logs bot decisions when choice logging is enabled', () => {
    const { game, botPlayerId } = createBotInstrumentationGame();
    const logger = new CollectingBotLogger();

    const botActions = generateAllBotActions(game, {
      logger,
      logLevel: 'choices',
    });

    expect(botActions[botPlayerId]).toHaveLength(2);
    expect(logger.botDecisions).toHaveLength(2);
    expect(logger.botDecisions.map((event) => event.crewId)).toEqual(['bot-captain', 'bot-crew']);
    expect(logger.botDecisions.every((event) => event.strategyName === 'default')).toBe(true);
  });

  it('preserves bot actions when instrumentation is omitted', () => {
    const { game, botPlayerId } = createBotInstrumentationGame();

    const withoutInstrumentation = generateAllBotActions(game);
    const withDisabledLogging = generateAllBotActions(game, {
      logger: new CollectingBotLogger(),
      logLevel: 'off',
    });

    expect(withoutInstrumentation[botPlayerId]).toEqual(withDisabledLogging[botPlayerId]);
  });

  it('logs grouped bot action resolution during action execution', () => {
    const { game, humanPlayerId, botPlayerId } = createBotInstrumentationGame();
    const logger = new CollectingBotLogger();
    const botActions = generateAllBotActions(game, {
      logger,
      logLevel: 'verbose',
    });

    const actionExecutionGame = {
      ...game,
      turnPhase: 'action_execution' as const,
    };
    const actionsByPlayer: TurnActions = {
      [humanPlayerId]: [],
      [botPlayerId]: botActions[botPlayerId],
    };

    processTurn(actionExecutionGame, actionsByPlayer, {
      logger,
      logLevel: 'verbose',
    });

    expect(logger.actionResolutions).toHaveLength(botActions[botPlayerId].length);
    expect(logger.actionResolutions.every((event) => event.playerId === botPlayerId)).toBe(true);
    expect(logger.actionResolutions.every((event) => event.result === 'success')).toBe(true);
    expect(logger.actionResolutions.every((event) => event.details.includes('->'))).toBe(true);
  });

  it('limits bots to one maneuver action per player turn even with multiple bridge crew', () => {
    const { game, botPlayerId } = createBotInstrumentationGame();

    const botPlayer = game.players.get(botPlayerId);
    if (!botPlayer) {
      throw new Error(
        'Cannot run bot maneuver test because bot player is missing. ' +
          `Root cause: player "${botPlayerId}" was not found in test game state. ` +
          'Fix: Ensure the fixture creates the expected bot player before running the test.',
      );
    }

    const tunedBotPlayer: PlayerState = {
      ...botPlayer,
      ship: {
        ...botPlayer.ship,
        position: { ring: 2, space: 10 },
        sections: {
          bridge: {
            ...botPlayer.ship.sections.bridge,
            hull: SECTION_CONFIG[SHIP_SECTIONS.BRIDGE].maxHull,
            powerDice: [6],
          },
          engineering: {
            ...botPlayer.ship.sections.engineering,
            hull: SECTION_CONFIG[SHIP_SECTIONS.ENGINEERING].maxHull,
            powerDice: [6, 6],
          },
          drives: {
            ...botPlayer.ship.sections.drives,
            hull: SECTION_CONFIG[SHIP_SECTIONS.DRIVES].maxHull,
            powerDice: [2],
          },
          med_lab: {
            ...botPlayer.ship.sections.med_lab,
            hull: SECTION_CONFIG[SHIP_SECTIONS.MED_LAB].maxHull,
            powerDice: [6],
          },
          sci_lab: {
            ...botPlayer.ship.sections.sci_lab,
            hull: SECTION_CONFIG[SHIP_SECTIONS.SCI_LAB].maxHull,
            powerDice: [6],
          },
          defense: {
            ...botPlayer.ship.sections.defense,
            hull: SECTION_CONFIG[SHIP_SECTIONS.DEFENSE].maxHull,
            powerDice: [6],
          },
        },
      },
      crew: [
        {
          id: 'bot-first-officer',
          name: 'Bot First Officer',
          type: 'officer',
          role: 'first_officer',
          status: 'active',
          location: SHIP_SECTIONS.BRIDGE,
          reviveProgress: 0,
          assembleProgress: 0,
          assembleItemType: null,
          stimPacksUsed: 0,
        },
        {
          ...botPlayer.crew[0],
          status: 'active',
          location: SHIP_SECTIONS.ENGINEERING,
        },
      ],
    };

    const tunedPlayers = new Map(game.players);
    tunedPlayers.set(botPlayerId, tunedBotPlayer);

    const tunedGame = {
      ...game,
      players: tunedPlayers,
    };

    const botActions = generateAllBotActions(tunedGame);
    const maneuverActions = botActions[botPlayerId].filter((action) => action.type === 'maneuver');

    expect(maneuverActions).toHaveLength(1);
  });

  it('logs turn summaries when environment processing completes a turn', () => {
    const { game } = createBotInstrumentationGame();
    const logger = new CollectingBotLogger();

    const environmentGame = {
      ...game,
      turnPhase: 'environment' as const,
    };

    const afterEnvironment = processTurn(environmentGame, {}, {
      logger,
      logLevel: 'summary',
    });

    const nextGame = processTurn(afterEnvironment, {}, {
      logger,
      logLevel: 'summary',
    });

    expect(nextGame.currentTurn).toBe(game.currentTurn + 1);
    expect(logger.turnSummaries).toHaveLength(1);
    expect(logger.turnSummaries[0].turn).toBe(game.currentTurn);
    expect(logger.turnSummaries[0].phase).toBe('resolution');
    expect(logger.turnSummaries[0].players).toHaveLength(2);
    expect(logger.turnSummaries[0].hostiles).toHaveLength(0);
  });
});
