import type { GameState, PlayerAction, PlayerState } from '../../models';
import type { EngineInstrumentationOptions } from '../logging/EngineInstrumentation';
import { defaultBotStrategy } from './DefaultBotStrategy';

export type BotStrategy = (
  game: GameState,
  player: PlayerState,
  options?: EngineInstrumentationOptions,
) => PlayerAction[];

export const STANDARD_BOT_STRATEGY_NAME = 'default';
export const LEGACY_SURVIVAL_BOT_STRATEGY_NAME = 'survival';

const BOT_STRATEGIES: Record<string, BotStrategy> = {
  [STANDARD_BOT_STRATEGY_NAME]: defaultBotStrategy,
  [LEGACY_SURVIVAL_BOT_STRATEGY_NAME]: defaultBotStrategy,
};

export function resolveBotStrategyName(player: PlayerState): string {
  const configuredStrategyName = player.botStrategy;
  if (typeof configuredStrategyName === 'string' && configuredStrategyName.trim().length > 0) {
    return configuredStrategyName;
  }

  return STANDARD_BOT_STRATEGY_NAME;
}

export function getBotStrategyByName(strategyName: string): BotStrategy {
  const strategy = BOT_STRATEGIES[strategyName];
  if (!strategy) {
    throw new Error(
      'Cannot generate bot actions because the requested bot strategy is not registered. ' +
        `Root cause: strategy name "${strategyName}" does not exist in BOT_STRATEGIES. ` +
        'Fix: Register the strategy in BotStrategyRegistry or update player.botStrategy to a supported value.',
    );
  }

  return strategy;
}

export function getBotStrategyForPlayer(player: PlayerState): {
  strategyName: string;
  strategy: BotStrategy;
} {
  const strategyName = resolveBotStrategyName(player);
  return {
    strategyName,
    strategy: getBotStrategyByName(strategyName),
  };
}
