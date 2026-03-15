import type { GameState } from '../../models';
import { SHIP_SECTIONS, type ShipSection } from '../../constants';
import type {
  BotActionResolutionLogEvent,
  BotDecisionLogEvent,
  BotLogger,
  BotWarningLogEvent,
  TurnSummaryHostileStatus,
  TurnSummaryLogEvent,
  TurnSummaryPlayerStatus,
} from './BotLogger';
import { NOOP_BOT_LOGGER } from './NoopBotLogger';

export type BotLogLevel = 'off' | 'summary' | 'choices' | 'verbose';

export interface EngineInstrumentationOptions {
  logger?: BotLogger;
  logLevel?: BotLogLevel;
}

export interface ResolvedEngineInstrumentationOptions {
  logger: BotLogger;
  logLevel: BotLogLevel;
}

export const DEFAULT_BOT_LOG_LEVEL: BotLogLevel = 'off';

export function resolveEngineInstrumentationOptions(
  options?: EngineInstrumentationOptions,
): ResolvedEngineInstrumentationOptions {
  const logger = (() => {
    if (options && options.logger) {
      return options.logger;
    }

    return NOOP_BOT_LOGGER;
  })();

  const logLevel = (() => {
    if (options && typeof options.logLevel === 'string') {
      return options.logLevel;
    }

    return DEFAULT_BOT_LOG_LEVEL;
  })();

  return {
    logger,
    logLevel,
  };
}

export function shouldLogBotChoices(options?: EngineInstrumentationOptions): boolean {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  return resolvedOptions.logLevel === 'choices' || resolvedOptions.logLevel === 'verbose';
}

export function shouldLogActionResolution(options?: EngineInstrumentationOptions): boolean {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  return resolvedOptions.logLevel === 'verbose';
}

export function shouldLogTurnSummary(options?: EngineInstrumentationOptions): boolean {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  return resolvedOptions.logLevel !== 'off';
}

export function logBotDecisionIfEnabled(
  event: BotDecisionLogEvent,
  options?: EngineInstrumentationOptions,
): void {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  if (resolvedOptions.logLevel === 'choices' || resolvedOptions.logLevel === 'verbose') {
    resolvedOptions.logger.botDecision(event);
  }
}

export function logActionResolutionIfEnabled(
  event: BotActionResolutionLogEvent,
  options?: EngineInstrumentationOptions,
): void {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  if (resolvedOptions.logLevel === 'verbose') {
    resolvedOptions.logger.actionResolution(event);
  }
}

export function logBotWarningIfEnabled(
  event: BotWarningLogEvent,
  options?: EngineInstrumentationOptions,
): void {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  if (resolvedOptions.logLevel === 'verbose') {
    resolvedOptions.logger.warning(event);
  }
}

export function buildTurnSummaryLogEvent(game: GameState, turn: number): TurnSummaryLogEvent {
  const players: TurnSummaryPlayerStatus[] = Array.from(game.players.values())
    .sort((left, right) => left.playerOrder - right.playerOrder)
    .map((player) => {
      const sections = {} as Record<ShipSection, { hull: number; power: number }>;
      for (const sectionKey of Object.values(SHIP_SECTIONS) as ShipSection[]) {
        const section = player.ship.sections[sectionKey];
        const hull = section ? section.hull : 0;
        const power = section
          ? section.powerDice.reduce((sum, die) => sum + die, 0)
          : 0;
        sections[sectionKey] = {
          hull,
          power,
        };
      }

      return {
        playerId: player.id,
        isBot: player.isBot,
        status: player.status,
        position: {
          ring: player.ship.position.ring,
          space: player.ship.position.space,
        },
        shields: player.ship.shields,
        speed: player.ship.speed,
        sections,
      };
    });

  const hostiles: TurnSummaryHostileStatus[] = game.board.objects
    .filter((object) => object.type === 'hostile_ship')
    .map((object) => {
      const hull = typeof object.hull === 'number' ? object.hull : 0;

      return {
        id: object.id,
        hull,
        hasTorpedo: object.hasTorpedo === true,
        position: {
          ring: object.position.ring,
          space: object.position.space,
        },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const objectTypeCountByName = new Map<string, number>();
  for (const object of game.board.objects) {
    const currentCount = objectTypeCountByName.get(object.type);
    if (typeof currentCount === 'number') {
      objectTypeCountByName.set(object.type, currentCount + 1);
      continue;
    }

    objectTypeCountByName.set(object.type, 1);
  }

  const objectCountsByType: Record<string, number> = {};
  for (const objectType of Array.from(objectTypeCountByName.keys()).sort((left, right) => left.localeCompare(right))) {
    const count = objectTypeCountByName.get(objectType);
    if (typeof count !== 'number') {
      throw new Error(
        'Cannot build turn summary because an object type count is missing after aggregation. ' +
          `Root cause: object type "${objectType}" was present in the key set but returned a non-number count. ` +
          'Fix: Ensure object type aggregation stores a numeric count for every encountered object type.',
      );
    }

    objectCountsByType[objectType] = count;
  }

  return {
    type: 'TURN_SUMMARY',
    turn,
    phase: game.turnPhase,
    players,
    hostiles,
    objectCountsByType,
  };
}

export function logTurnSummaryIfEnabled(game: GameState, turn: number, options?: EngineInstrumentationOptions): void {
  const resolvedOptions = resolveEngineInstrumentationOptions(options);
  if (resolvedOptions.logLevel === 'off') {
    return;
  }

  resolvedOptions.logger.turnSummary(buildTurnSummaryLogEvent(game, turn));
}
