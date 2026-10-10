import type { SessionRequestContext } from './errors';

/** One source for API and controller recovery, including raw exceptions without a server envelope. */
export const SESSION_REQUEST_CONTEXTS = {
  create: {
    workflow: 'create-session', stage: 'create', attemptedAction: 'create a private game',
    failedResult: 'The game was not created.', safeState: 'No lobby or saved game state changed.',
    nextAction: 'Check your connection, then choose Create private session again.',
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether the private game was created.',
      safeState: 'Your other saved games are safe, but the new game details have not been confirmed.',
      nextAction: 'Keep this screen open and do not create another game yet. Please email info@sixsmithgames.com and include the support code below so we can check your game.',
      supportRequired: true,
    },
  },
  join: {
    workflow: 'join-session', stage: 'join', attemptedAction: 'join the private game',
    failedResult: 'You were not added to the roster.', safeState: 'No lobby or saved game state changed.',
    nextAction: 'Check the join code with the host, then choose Join private session again.',
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether you joined the private game.',
      safeState: 'Your last confirmed game state is safe; your player seat may already have been added.',
      nextAction: 'Check the current player list with the host, then choose Join private session with the same game code to restore your seat.',
    },
  },
  resume: {
    workflow: 'resume-session', stage: 'restore', attemptedAction: 'restore your saved game',
    failedResult: 'The game could not be restored on this screen.',
    safeState: 'Your last server-confirmed lobby or turn state was not changed.',
    nextAction: 'Check your connection, then reload Gravity once.',
  },
  cancel: {
    workflow: 'cancel-session', stage: 'cancel', attemptedAction: 'cancel this game',
    failedResult: 'The game was not canceled.', safeState: 'The lobby remains open and its roster is unchanged.',
    nextAction: 'Check your connection, then choose Cancel game again.',
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether this game was canceled.',
      safeState: 'Your last confirmed lobby is safe, but the lobby may already have closed.',
      nextAction: 'Choose Refresh lobby to check whether the lobby closed before using Cancel game again.',
    },
  },
  start: {
    workflow: 'start-session', stage: 'launch', attemptedAction: 'launch the mission',
    failedResult: 'The mission did not start.', safeState: 'The ready room and its roster are unchanged.',
    nextAction: 'Review the player slots and ready indicators, then choose Launch mission again.',
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether the mission started.',
      safeState: 'Your last confirmed game state is safe, but the mission may already have started.',
      nextAction: 'Choose Refresh lobby to check whether the mission started before using Launch mission again.',
    },
  },
  refresh: {
    workflow: 'refresh-session', stage: 'read-lobby', attemptedAction: 'refresh this lobby',
    failedResult: 'The current player list and game status could not be checked.',
    safeState: 'No changes were requested, and your last confirmed lobby or completed turn is safe.',
    nextAction: 'Check your connection, then choose Refresh lobby again.',
  },
  submit: {
    workflow: 'submit-turn', stage: 'lock-plan', attemptedAction: 'lock your plan for this turn',
    failedResult: 'Your plan was not locked.',
    safeState: 'Your last completed turn is safe, and your planned actions remain on this screen.',
    nextAction: 'Review your planned actions, then choose Lock Plans again.',
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether your original plan was locked.',
      safeState: 'Your last completed turn is safe, and your original plan remains on this screen.',
      nextAction: 'Keep this screen open, check your connection, then choose Lock Plans again to check your original plan.',
    },
  },
} satisfies Record<string, SessionRequestContext>;

/**
 * Purpose: Share action-specific readiness recovery between API and controller.
 * Parameters: Requested ready/not-ready state.
 * Returns: A player-safe context including the uncertain-result read correction.
 * Side effects: None.
 */
export function readyRequestContext(isReady: boolean): SessionRequestContext {
  return {
    workflow: 'set-ready', stage: isReady ? 'ready' : 'not-ready',
    attemptedAction: isReady ? 'mark your player ready' : 'mark your player not ready',
    failedResult: 'Your ready status was not updated.',
    safeState: 'Your previous ready status and the lobby roster are unchanged.',
    nextAction: `Check your connection, then choose ${isReady ? 'Ready up' : 'Mark not ready'} again.`,
    unconfirmed: {
      failedResult: 'Gravity could not confirm whether your ready status changed.',
      safeState: 'Your last confirmed player list is safe; your ready status may already have changed.',
      nextAction: `Choose Refresh lobby to check your ready status before using ${isReady ? 'Ready up' : 'Mark not ready'} again.`,
    },
  };
}

/**
 * Purpose: Share seat-specific roster recovery without exposing API diagnostics.
 * Parameters: Selected seat and whether it should become a bot.
 * Returns: The player-safe recovery context for that exact control.
 * Side effects: None.
 */
export function botSeatRequestContext(seatNumber: number, isBot: boolean): SessionRequestContext {
  return {
    workflow: 'configure-bot-seat', stage: isBot ? 'add-bot' : 'open-seat',
    attemptedAction: isBot ? `add a bot to seat ${seatNumber}` : `reopen seat ${seatNumber} for a player`,
    failedResult: isBot ? 'The bot was not added.' : 'The seat was not reopened.',
    safeState: 'No player slots changed, and the current lobby is still safe.',
    nextAction: `Wait a moment, then choose ${isBot ? 'Add bot' : 'Open seat'} again.`,
    unconfirmed: {
      failedResult: isBot ? 'Gravity could not confirm whether the bot was added.' : 'Gravity could not confirm whether the seat was reopened.',
      safeState: 'Your last confirmed player list is safe, but that seat may already have changed.',
      nextAction: `Choose Refresh lobby to check seat ${seatNumber} before using ${isBot ? 'Add bot' : 'Open seat'} again.`,
    },
  };
}
