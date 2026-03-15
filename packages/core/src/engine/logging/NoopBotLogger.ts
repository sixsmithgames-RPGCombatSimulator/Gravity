import type { BotLogger } from './BotLogger';

export const NOOP_BOT_LOGGER: BotLogger = {
  botDecision(): void {
  },
  actionResolution(): void {
  },
  turnSummary(): void {
  },
  warning(): void {
  },
};
