import { createServer } from 'node:http';

import { Server as SocketIOServer } from 'socket.io';

import { createApp } from '../src/app';
import type { IdentityVerifier } from '../src/auth/identity';
import { SessionEventBus } from '../src/sessions/eventBus';
import { gravitySessionGameFactory } from '../src/sessions/gravitySessionGameFactory';
import { MemorySessionRepository } from '../src/sessions/memorySessionRepository';
import { SessionService } from '../src/sessions/sessionService';
import { configureSessionSockets } from '../src/sessions/sessionSockets';

if (process.env.GRAVITY_E2E !== '1') {
  throw new Error('The E2E server can run only when GRAVITY_E2E=1.');
}

const host = '127.0.0.1';
const port = 3100;
const webOrigin = 'http://127.0.0.1:4187';
const tokenPattern = /^e2e:([a-z0-9-]{1,32})$/;

const identityVerifier: IdentityVerifier = {
  async verify(token) {
    const match = tokenPattern.exec(token);
    if (!match) throw new Error('Invalid E2E identity token.');
    return { subject: `e2e:${match[1]}`, displayName: match[1] };
  },
};

const events = new SessionEventBus();
const service = new SessionService({
  repository: new MemorySessionRepository(),
  gameFactory: gravitySessionGameFactory,
  events,
  joinCodePepper: 'gravity-e2e-loopback-only-pepper',
});
const app = createApp({
  corsOrigin: webOrigin,
  readiness: {
    checkDatabase: async () => undefined,
    checkRedis: async () => undefined,
  },
  sessions: { service, identityVerifier },
});
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: webOrigin, credentials: true },
});
const stopBroadcasts = configureSessionSockets({ io, identityVerifier, service, events });

server.listen(port, host, () => {
  process.stdout.write(`Gravity E2E server listening on http://${host}:${port}\n`);
});

async function shutdown(): Promise<void> {
  stopBroadcasts();
  await io.close();
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
