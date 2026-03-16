import type { ShipPosition } from '../../models';
import type { PlayerAction, PlayerActionType, PlayerStatus, TurnPhase } from '../../models';
import type { ShipSection } from '../../constants';

export interface BotDecisionLogEvent {
  type: 'BOT_DECISION';
  turn: number;
  playerId: string;
  crewId: string;
  strategyName: string;
  priority: string;
  rationale: string[];
  chosenAction: PlayerAction;
}

export interface BotActionResolutionLogEvent {
  type: 'ACTION_RESOLUTION';
  turn: number;
  playerId: string;
  crewId: string;
  actionType: PlayerActionType;
  result: 'success' | 'failed_validation' | 'no_effect' | 'lost';
  details: string;
}

export interface TurnSummarySectionStatus {
  hull: number;
  power: number;
}

export interface TurnSummaryPlayerStatus {
  playerId: string;
  isBot: boolean;
  status: PlayerStatus;
  position: ShipPosition;
  shields: number;
  speed: number;
  sections: Record<ShipSection, TurnSummarySectionStatus>;
}

export interface TurnSummaryHostileStatus {
  id: string;
  hull: number;
  hasTorpedo: boolean;
  position: ShipPosition;
}

export interface TurnSummaryLogEvent {
  type: 'TURN_SUMMARY';
  turn: number;
  phase: TurnPhase;
  players: TurnSummaryPlayerStatus[];
  hostiles: TurnSummaryHostileStatus[];
  objectCountsByType: Record<string, number>;
}

export interface BotWarningLogEvent {
  type: 'BOT_WARNING';
  turn: number;
  playerId: string;
  crewId: string;
  message: string;
}

export interface BotLogger {
  botDecision(event: BotDecisionLogEvent): void;
  actionResolution(event: BotActionResolutionLogEvent): void;
  turnSummary(event: TurnSummaryLogEvent): void;
  warning(event: BotWarningLogEvent): void;
}
