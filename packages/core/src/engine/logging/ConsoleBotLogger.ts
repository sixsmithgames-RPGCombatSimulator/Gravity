import type {
  BotActionResolutionLogEvent,
  BotDecisionLogEvent,
  BotLogger,
  BotWarningLogEvent,
  TurnSummaryLogEvent,
} from './BotLogger';

export class ConsoleBotLogger implements BotLogger {
  private emit(prefix: string, payload: unknown): void {
    console.log(`[GravityBot:${prefix}] ${JSON.stringify(payload)}`);
  }

  botDecision(event: BotDecisionLogEvent): void {
    this.emit('BOT_DECISION', event);
  }

  actionResolution(event: BotActionResolutionLogEvent): void {
    this.emit('ACTION_RESOLUTION', event);
  }

  turnSummary(event: TurnSummaryLogEvent): void {
    this.emit('TURN_SUMMARY', event);
  }

  warning(event: BotWarningLogEvent): void {
    console.warn(`[GravityBot:BOT_WARNING] ${JSON.stringify(event)}`);
  }
}
