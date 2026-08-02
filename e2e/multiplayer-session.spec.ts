import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

type PlayerBrowser = { context: BrowserContext; page: Page; errors: string[] };

async function openPlayer(browser: Browser, id: string, displayName: string): Promise<PlayerBrowser> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ token, name }) => {
      sessionStorage.setItem('gravity:e2e-auth-token', token);
      sessionStorage.setItem('gravity:e2e-display-name', name);
    },
    { token: `e2e:${id}`, name: displayName },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'GRAVITY' })).toBeVisible();
  return { context, page, errors };
}

async function chooseRestoreActions(page: Page): Promise<void> {
  const actionSelectors = page.getByRole('combobox', { name: /^Action for / });
  await expect(actionSelectors).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await actionSelectors.nth(index).selectOption('restore');
  }
}

async function reconnectWave(apiOrigin: string, sessionId: string, count: number): Promise<void> {
  const clients: Socket[] = [];
  try {
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        new Promise<void>((resolve, reject) => {
          const client = io(apiOrigin, {
            auth: { token: 'e2e:guest' },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
            timeout: 7_500,
          });
          clients.push(client);
          client.once('connect_error', reject);
          client.once('connect', () => {
            client.emit(
              'join_session',
              { sessionId },
              (ack: { ok: boolean; code?: string; message?: string }) => {
                if (ack.ok) {
                  resolve();
                  return;
                }
                reject(new Error(`Reconnect ${index + 1} failed: ${ack.code || 'UNKNOWN'} ${ack.message || ''}`));
              },
            );
          });
        }),
      ),
    );
  } finally {
    clients.forEach((client) => client.disconnect());
  }
}

test('two players can create, join, commit, resume, and survive a reconnect wave', async ({ browser }, testInfo) => {
  const host = await openPlayer(browser, 'host', 'Host Commander');
  const guest = await openPlayer(browser, 'guest', 'Guest Commander');

  try {
    await host.page.locator('#create-display-name').fill('Host Commander');
    await host.page.locator('#max-players').selectOption('2');
    await host.page.getByRole('button', { name: 'Create private session' }).click();
    await expect(host.page.getByRole('heading', { name: 'Crew assembly' })).toBeVisible();
    const joinCode = (await host.page.getByTestId('join-code').textContent())?.trim();
    expect(joinCode).toMatch(/^[A-Z0-9]{8}$/);

    await guest.page.locator('#join-display-name').fill('Guest Commander');
    await guest.page.locator('#join-code').fill(joinCode!);
    await guest.page.getByRole('button', { name: 'Join private session' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Crew assembly' })).toBeVisible();
    await expect(host.page.getByText('2 of 2 seats occupied')).toBeVisible();

    await guest.page.getByRole('button', { name: 'Ready up' }).click();
    await host.page.getByRole('button', { name: 'Ready up' }).click();
    const launch = host.page.getByRole('button', { name: 'Launch mission' });
    await expect(launch).toBeEnabled();
    await launch.click();

    await expect(host.page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);
    await expect(guest.page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);
    await chooseRestoreActions(host.page);
    await chooseRestoreActions(guest.page);

    await guest.page.getByTestId('phase-action-button').click();
    await expect(guest.page.getByText(/Plan locked\. Waiting/)).toBeVisible();
    await host.page.getByTestId('phase-action-button').click();
    await expect(host.page.getByTestId('current-turn')).toHaveText('2');
    await expect(guest.page.getByTestId('current-turn')).toHaveText('2');
    await expect(host.page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);
    await expect(guest.page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);

    await guest.page.reload();
    await expect(guest.page.getByTestId('current-turn')).toHaveText('2');
    await expect(guest.page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);

    const storedSession = await guest.page.evaluate(() =>
      JSON.parse(localStorage.getItem('gravity:beta-session:v1') || 'null') as { sessionId?: string } | null,
    );
    expect(storedSession?.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    const apiOrigin = String(testInfo.project.metadata.apiOrigin || 'http://127.0.0.1:3100');
    await reconnectWave(apiOrigin, storedSession!.sessionId!, 12);
    await reconnectWave(apiOrigin, storedSession!.sessionId!, 12);

    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);

    await testInfo.attach('host-turn-two', {
      body: await host.page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await testInfo.attach('guest-resumed-turn-two', {
      body: await guest.page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});
