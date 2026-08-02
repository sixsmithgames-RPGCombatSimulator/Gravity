import { io } from 'socket.io-client';

function option(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireOrigin(raw, label, allowHttp) {
  if (!raw) throw new Error(`Missing --${label} URL.`);
  const parsed = new URL(raw);
  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS unless --allow-http is explicitly supplied.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/') {
    throw new Error(`${label} must be an HTTP(S) origin without a path.`);
  }
  return parsed.origin;
}

async function requireJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return body;
}

async function expectUnauthenticatedSocket(apiOrigin) {
  await new Promise((resolve, reject) => {
    const client = io(apiOrigin, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 7_500,
    });
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error('Unauthenticated Socket.IO handshake did not reject before timeout.'));
    }, 10_000);
    client.once('connect', () => {
      clearTimeout(timer);
      client.disconnect();
      reject(new Error('Socket.IO accepted an unauthenticated connection.'));
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      client.disconnect();
      if (error.message !== 'UNAUTHENTICATED') {
        reject(new Error(`Socket.IO rejected with unexpected error: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

const allowHttp = process.argv.includes('--allow-http');
const webOrigin = requireOrigin(option('web'), 'web', allowHttp);
const apiOrigin = requireOrigin(option('api'), 'api', allowHttp);

const webResponse = await fetch(webOrigin, { redirect: 'error' });
if (!webResponse.ok) throw new Error(`Web origin returned HTTP ${webResponse.status}.`);
const html = await webResponse.text();
if (!html.includes('id="root"')) throw new Error('Web response does not contain the Gravity application root.');

const csp = webResponse.headers.get('content-security-policy');
if (!csp) throw new Error('Web response is missing Content-Security-Policy.');
if (!csp.includes(apiOrigin)) throw new Error('Content-Security-Policy does not allow the configured staging API origin.');
if (webResponse.headers.get('x-content-type-options') !== 'nosniff') {
  throw new Error('Web response is missing X-Content-Type-Options: nosniff.');
}

const live = await requireJson(await fetch(`${apiOrigin}/health/live`), 'Liveness');
if (live?.ok !== true) throw new Error('Liveness response did not report ok=true.');
const ready = await requireJson(await fetch(`${apiOrigin}/health/ready`), 'Readiness');
if (ready?.ok !== true || ready?.checks?.database !== 'ok' || ready?.checks?.redis !== 'ok') {
  throw new Error('Readiness did not confirm both PostgreSQL and Redis.');
}

const protectedResponse = await fetch(`${apiOrigin}/sessions/not-a-session`, {
  headers: { origin: webOrigin },
});
if (protectedResponse.status !== 401) {
  throw new Error(`Protected API smoke expected HTTP 401 but received ${protectedResponse.status}.`);
}
if (protectedResponse.headers.get('access-control-allow-origin') !== webOrigin) {
  throw new Error('API CORS response does not allow the configured staging web origin.');
}
const protectedBody = await protectedResponse.json();
if (protectedBody?.error?.code !== 'UNAUTHENTICATED') {
  throw new Error('Protected API smoke did not return the stable UNAUTHENTICATED code.');
}

await expectUnauthenticatedSocket(apiOrigin);
process.stdout.write(
  `Staging smoke passed: web headers, PostgreSQL/Redis readiness, CORS, REST auth, and Socket.IO auth.\n`,
);
