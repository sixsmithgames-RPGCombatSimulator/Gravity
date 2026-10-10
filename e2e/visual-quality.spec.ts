import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'compact', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
] as const;

/**
 * Purpose: Open the real UI using the loopback identity and canonical server.
 * Parameters: Runner browser, fixed scenario name and viewport. Returns: An
 * isolated page plus diagnostic arrays. Side effects: Creates a browser context.
 * External font requests fail this test even if the system font hides the issue.
 */
async function openQualityPlayer(browser: Browser, id: string, viewport: { width: number; height: number }, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  const context = await browser.newContext({ viewport, reducedMotion, colorScheme: 'dark' });
  const errors: string[] = [];
  const remoteFonts: string[] = [];
  const failedLocalRequests: string[] = [];
  const loadedFonts: string[] = [];
  await context.addInitScript(({ token }) => {
    sessionStorage.setItem('gravity:e2e-auth-token', token);
    sessionStorage.setItem('gravity:e2e-display-name', 'Quality Commander');
  }, { token: `e2e:${id}` });
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => {
    remoteFonts.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('http://127.0.0.1') && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      failedLocalRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  page.on('response', (response) => {
    if (!response.url().startsWith('http://127.0.0.1')) return;
    if (response.status() >= 400) failedLocalRequests.push(`${response.status()} ${response.url()}`);
    if (/\.woff2(?:\?|$)/.test(response.url()) && response.ok()) loadedFonts.push(response.url());
  });
  await page.goto('http://127.0.0.1:4187/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Create private session' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors, remoteFonts, failedLocalRequests, loadedFonts };
}

/**
 * Purpose: Fill a real authoritative lobby with server-controlled bots.
 * Parameters: Player page and configured seats. Returns: Nothing. Side effects:
 * Creates a mission and issues normal ready-room mutations to the local server.
 */
async function createBotLobby(page: Page, seats = 2) {
  await page.getByRole('combobox', { name: 'Maximum players' }).selectOption(String(seats));
  await page.getByRole('button', { name: 'Create private session' }).click();
  await expect(page.getByRole('heading', { name: 'Crew assembly' })).toBeVisible();
  for (let seat = 2; seat <= seats; seat += 1) {
    await page.getByRole('button', { name: `Add bot to seat ${seat}`, exact: true }).click();
    await expect(page.getByText(`Seat ${seat}: Bot Commander ${seat}`, { exact: false })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Ready up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Launch mission', exact: true })).toBeEnabled();
}

/**
 * Purpose: Catch responsive clipping independently of screenshot similarity.
 * Parameters: Active page. Returns: Nothing. Side effects: None.
 */
async function expectContainedDocument(page: Page) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

/**
 * Purpose: Let a real input reach its presented frame before automation scans
 * the accessibility tree or issues the next input. Parameters: Active page.
 * Returns: Nothing. Side effects: Waits two frames; does not reset observers.
 * Root cause: Injected role queries themselves contributed pre-paint CPU work,
 * so the prior tight loop measured part of the driver as application latency.
 */
async function waitForPresentedFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Purpose: Capture a visually stable, reviewed scenario and retain a convenient
 * report image. Parameters: Page, evidence name, runner metadata. Returns:
 * Nothing. Side effects: Writes a baseline only with explicit update command.
 */
async function capture(page: Page, name: string, testInfo: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    mask: [page.getByTestId('join-code')],
    maskColor: '#164e63',
  });
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

for (const viewport of VIEWPORTS) {
  test(`visual and keyboard journey at ${viewport.name}`, async ({ browser }, testInfo) => {
    const player = await openQualityPlayer(browser, `visual-${viewport.name}`, viewport);
    const { page } = player;
    try {
      await expectContainedDocument(page);
      await capture(page, `${viewport.name}-home`, testInfo);
      await createBotLobby(page);
      await expectContainedDocument(page);
      await capture(page, `${viewport.name}-ready-room`, testInfo);
      await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
      await expect(page.getByTestId('current-turn')).toHaveText('1');
      if (viewport.width >= 640) await expect(page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);
      await expect(page.getByRole('button', { name: 'New Game', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Opponent AI/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open developer settings' })).toHaveCount(0);
      // Browser CSS, not jsdom, proves the bounded scene isolates paint/layout
      // without size containment that could collapse responsive board geometry.
      const serializedContainment = await page.getByTestId('game-board-viewport').evaluate((element) => getComputedStyle(element).contain);
      // Chromium canonically serializes exactly layout+paint+style as content.
      const containment = serializedContainment === 'content' ? ['layout', 'paint', 'style'] : serializedContainment.split(' ');
      expect(containment).toEqual(expect.arrayContaining(['layout', 'paint', 'style']));
      expect(containment).not.toContain('size');
      expect(containment).not.toContain('inline-size');
      // Reduced motion must stop CSS animation lifecycles, not merely shorten
      // them. jsdom cannot certify computed media styles or pseudo-elements.
      const cssMotion = await page.evaluate(() => {
        const controls = document.querySelectorAll('[class*="animate-"], [class*="transition-"], .btn, .crew-token, .power-slot, .hull-box, .tracker-cell');
        return {
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          count: controls.length,
          active: [...controls].flatMap((control) => [null, '::before', '::after'].flatMap((pseudo) => {
            const style = getComputedStyle(control, pseudo);
            return style.animationName === 'none' && style.transitionProperty === 'none'
              ? [] : [{ element: control.tagName, pseudo, animation: style.animationName, transition: style.transitionProperty }];
          })),
        };
      });
      expect(cssMotion.reduced).toBe(true);
      expect(cssMotion.count).toBeGreaterThan(0);
      expect(cssMotion.active).toEqual([]);
      await expectContainedDocument(page);
      await capture(page, `${viewport.name}-mission`, testInfo);
      if (viewport.width < 640) {
        const planning = page.getByRole('button', { name: /Plan actions.*ready/ });
        await planning.click();
        await expect(page.getByRole('combobox', { name: /^Action for / })).toHaveCount(3);
        await expect(page.getByTestId('phase-action-button')).toHaveText(/Lock Plans/);
        await capture(page, `${viewport.name}-planning-expanded`, testInfo);
        await planning.click();
      }

      const help = page.getByRole('button', { name: 'Open game help' });
      await help.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const bounds = await page.getByTestId('modal-surface').boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      await capture(page, `${viewport.name}-help`, testInfo);
      const background = page.getByRole('main', { includeHidden: true });
      const backgroundScroll = await background.evaluate((main) => main.scrollTop);
      await page.mouse.move(2, viewport.height / 2);
      await page.mouse.wheel(0, 300);
      expect(await background.evaluate((main) => main.scrollTop)).toBe(backgroundScroll);
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(help).toBeFocused();
      await help.click();
      await expect(dialog).toBeVisible();
      await page.getByTestId('modal-backdrop').click({ position: { x: 2, y: viewport.height / 2 } });
      await expect(dialog).toHaveCount(0);
      await expect(help).toBeFocused();

      const roster = page.getByRole('button', { name: 'Roster', exact: true });
      await roster.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0);
      await capture(page, `${viewport.name}-crew`, testInfo);
      await page.keyboard.press('Escape');
      await expect(roster).toBeFocused();

      const hazard = page.getByRole('button', { name: /^Inspect Hazard,/ }).first();
      await hazard.focus();
      await page.keyboard.press('Enter');
      const inspection = page.getByRole('region', { name: 'Board object inspection' });
      await expect(inspection).toBeVisible();
      const inspectionBounds = await inspection.boundingBox();
      expect(inspectionBounds!.x).toBeGreaterThanOrEqual(0);
      expect(inspectionBounds!.x + inspectionBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      await capture(page, `${viewport.name}-inspection`, testInfo);
      await inspection.getByRole('button', { name: /Close/ }).click();

      // At stacked widths inspect the ship controls as well as the board above.
      if (viewport.width < 1280) {
        await page.getByRole('complementary').scrollIntoViewIfNeeded();
        await capture(page, `${viewport.name}-ship`, testInfo);
      }

      const motion = await page.getByTestId('game-board').evaluate((svg) => ({
        paused: (svg as SVGSVGElement).animationsPaused(),
        animations: svg.querySelectorAll('animate, animateTransform').length,
      }));
      expect(motion.animations === 0 || motion.paused).toBe(true);
      expect(player.remoteFonts).toEqual([]);
      expect(player.errors).toEqual([]);
      expect(player.failedLocalRequests).toEqual([]);
      expect(new Set(player.loadedFonts).size).toBeGreaterThanOrEqual(2);
    } finally {
      await player.context.close();
    }
  });
}

for (const motion of ['reduce', 'no-preference'] as const) {
test(`six-player board interactions stay responsive under four-times CPU slowdown (${motion})`, async ({ browser }, testInfo) => {
  const player = await openQualityPlayer(browser, `performance-host-${motion}`, { width: 1440, height: 900 }, motion);
  const { page } = player;
  try {
    await createBotLobby(page, 6);
    await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
    await expect(page.getByTestId('current-turn')).toHaveText('1');
    const cdp = await player.context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes)).toEqual(expect.arrayContaining(['event', 'longtask']));
    // Resolve geometry before observing: locator actionability/ARIA traversal
    // belongs to the driver, not to application input response. No hover or
    // Help warm-up occurs here; trusted click targets are verified below.
    const centers = await page.evaluate(() => Object.fromEntries(['Zoom in', 'Zoom out', 'Open game help'].map((label) => {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) throw new Error(`Expected mission control ${label}`);
      const bounds = button.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) throw new Error(`Mission control ${label} is not displayed`);
      return [label, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }];
    })));
    const profiling = process.env.GRAVITY_PROFILE_QUALITY === '1';
    if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    await page.evaluate(() => {
      const observations = { longTasks: [] as number[], events: [] as number[], eventDetails: [] as unknown[], clickTargets: [] as (string | null)[], escapeCount: 0 };
      Object.assign(window, { gravityQualityObservations: observations });
      document.addEventListener('click', (event) => {
        if (event.isTrusted) observations.clickTargets.push(event.target instanceof Element ? event.target.closest('button')?.getAttribute('aria-label') ?? null : null);
      }, { capture: true });
      document.addEventListener('keydown', (event) => {
        if (event.isTrusted && event.key === 'Escape') observations.escapeCount += 1;
      }, { capture: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) observations.longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Chromium exposes interactionId for grouping physical input sequences;
          // TypeScript's stable DOM surface does not yet include this extension.
          const event = entry as PerformanceEventTiming & { interactionId: number };
          observations.events.push(event.duration);
          observations.eventDetails.push({ name: event.name, duration: event.duration, interactionId: event.interactionId,
            startTime: event.startTime, processingStart: event.processingStart, processingEnd: event.processingEnd,
            processingMs: event.processingEnd - event.processingStart,
            delayMs: event.processingStart - event.startTime,
            target: event.target instanceof Element ? event.target.closest('button')?.getAttribute('aria-label') ?? event.target.getAttribute('aria-label') ?? event.target.tagName : null });
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    });
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      // Event handler start → a frame after commit. Driver/IPC latency is excluded.
      const timing = await page.evaluate(async (label) => {
        const control = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        if (!control) throw new Error(`Expected board control ${label}`);
        const started = performance.now();
        control.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return performance.now() - started;
      }, index % 2 === 0 ? 'Zoom in' : 'Zoom out');
      samples.push(timing);
    }
    for (let index = 0; index < 6; index += 1) {
      const center = centers[index % 2 === 0 ? 'Zoom in' : 'Zoom out'];
      await page.mouse.click(center.x, center.y);
      await waitForPresentedFrame(page);
    }
    for (let index = 0; index < 5; index += 1) {
      const center = centers['Open game help'];
      await page.mouse.click(center.x, center.y);
      await waitForPresentedFrame(page);
      expect(await page.evaluate(() => document.querySelector<HTMLDialogElement>('dialog')?.open === true)).toBe(true);
      await page.keyboard.press('Escape');
      await waitForPresentedFrame(page);
      expect(await page.evaluate(() => document.querySelector('dialog') === null && document.activeElement === document.querySelector('button[aria-label="Open game help"]'))).toBe(true);
    }
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
    const observations = await page.evaluate(() => (window as unknown as {
      gravityQualityObservations: { longTasks: number[]; events: number[]; eventDetails: { interactionId: number; duration: number }[]; clickTargets: (string | null)[]; escapeCount: number };
    }).gravityQualityObservations);
    expect(observations.clickTargets).toEqual([
      ...Array.from({ length: 6 }, (_, index) => index % 2 === 0 ? 'Zoom in' : 'Zoom out'),
      ...Array.from({ length: 5 }, () => 'Open game help'),
    ]);
    expect(observations.escapeCount).toBe(5);
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const interactions = new Map<number, number>();
    for (const event of observations.eventDetails) {
      if (event.interactionId > 0) interactions.set(event.interactionId, Math.max(interactions.get(event.interactionId) ?? 0, event.duration));
    }
    const interactionDurations = [...interactions.values()].sort((a, b) => a - b);
    expect(interactionDurations.length).toBeGreaterThanOrEqual(10);
    const eventP95 = interactionDurations[Math.ceil(interactionDurations.length * 0.95) - 1] ?? 0;
    if (profiling) {
      const { profile } = await cdp.send('Profiler.stop');
      await testInfo.attach('interaction-cpu.cpuprofile', { body: Buffer.from(JSON.stringify(profile)), contentType: 'application/json' });
    }
    const evidence = {
      browser: browser.version(), viewport: { width: 1440, height: 900 }, cpuSlowdown: 4, reducedMotion: motion,
      scenario: 'canonical-server-opening-six-players-2026-10-10',
      build: 'Production React via Vite loopback module-serving harness; bundled startup and Clerk are separate live checks',
      inputSequence: 'Pre-resolved control centers, verified trusted click targets, native post-paint state/focus checks; cold open and all observer entries retained',
      boardHandlerToFrameMs: samples, boardHandlerToFrameP95Ms: p95,
      browserInteractionP95Ms: eventP95, interactionDurationsMs: interactionDurations,
      longTasksMs: observations.longTasks, eventDetails: observations.eventDetails,
      trustedClickTargets: observations.clickTargets, trustedEscapeCount: observations.escapeCount,
      domNodes: await page.locator('*').count(),
    };
    await testInfo.attach('interaction-performance.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json',
    });
    console.log(`Interaction budget: board p95 ${p95} ms; input p95 ${eventP95} ms; largest task ${Math.max(0, ...observations.longTasks)} ms.`);
    expect(p95).toBeLessThanOrEqual(200);
    expect(eventP95).toBeLessThanOrEqual(200);
    expect(Math.max(0, ...observations.longTasks)).toBeLessThan(200);
    expect(player.errors).toEqual([]);
    expect(player.remoteFonts).toEqual([]);
    expect(player.failedLocalRequests).toEqual([]);
  } finally {
    await player.context.close();
  }
});
}
