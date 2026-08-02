import { EventEmitter } from 'node:events';

import type { SessionEvent, SessionEventPublisher } from './types';

export class SessionEventBus implements SessionEventPublisher {
  private readonly emitter = new EventEmitter();

  publish(event: SessionEvent): void {
    this.emitter.emit('session-event', event);
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.emitter.on('session-event', listener);
    return () => this.emitter.off('session-event', listener);
  }
}
