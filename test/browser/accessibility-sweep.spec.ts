import { test, expect } from '@playwright/test';
import { auditPage, auditReadingOrder, auditTabOrder, auditTree, format } from './accessibility-audit';
import { CONNECTED_STATES, DEVELOPMENT_STATES, FAILURE_STATES, FIXTURE_STATES, LAUNCHER_STATES, LIVE_STATES, MOCK_STATES, setTextScale } from './accessibility-states';
import { settled } from './helpers/settled';

// MVP-48, renderer part. Every retained primary view, subview and failure screen is checked for
// accessible names and roles, keyboard reachability, focus order and traps, contrast, pointer
// target size, TalkBack reading order (the rule AccessibilityInstrumentedTest applies on Android),
// 200% and 300% text and landscape. This is Chromium on a development server. It is not a TalkBack, Switch
// Access, physical large-font, rotation or device pass; those remain open.
test.describe.configure({ mode: 'parallel' });

const STATES = [...LIVE_STATES, ...DEVELOPMENT_STATES, ...MOCK_STATES, ...CONNECTED_STATES, ...FAILURE_STATES];
// Deliberate single-line ellipsis and line clamps on previews of user content are allowed: the
// full text is one tap away and is exposed whole to assistive technology. Hard clipping is not, and
// neither is a cut app title: it names the screen and has room to wrap.
const appTitle = (line: string) => /^text-truncated: .*<[^>]*\bdata-alpha-app-title\b/.test(line);
const blocking = (lines: string[]) => lines.filter(line => !line.startsWith('text-truncated:') || appTitle(line));
// A state at large text is opened, re-laid out and audited rule by rule. Under four workers on a
// loaded machine that has run past the 30s default, so the large-text and landscape sweeps say
// how long they may take instead of inheriting it.
const LARGE_TEXT_TIMEOUT = 90_000;

for (const theme of ['light', 'dark'] as const) {
  for (const state of STATES) {
    test(`names, roles, focus and contrast: ${state.name} (${theme})`, async ({ page }) => {
      test.setTimeout(60_000);
      await state.open(page, theme);
      const found = format([
        ...await auditTree(page),
        ...await auditPage(page, { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true }),
        ...await auditTabOrder(page),
        // Reading order does not depend on the theme; it is read once, in the light one.
        ...theme === 'light' ? await auditReadingOrder(page) : [],
      ]);
      expect(blocking(found), blocking(found).join('\n')).toEqual([]);
    });
  }
}

for (const state of STATES) {
  test(`200% text is not clipped and does not overlap: ${state.name}`, async ({ page }, info) => {
    test.setTimeout(LARGE_TEXT_TIMEOUT);
    await state.open(page, 'light');
    await setTextScale(page, 2);
    // Clipping and overlap: nothing is cut, nothing is printed over anything else, no label is
    // split mid-word and no control sits on or is cut by another box (accessibility-audit.ts rule 7).
    // Nothing on Home is under the composer, and whatever an app scrolls under it can be scrolled clear.
    const found = format(await auditPage(page, { clipping: true, overlap: true, dock: true }));
    await info.attach('truncated', { body: found.filter(line => line.startsWith('text-truncated:')).join('\n') || 'none', contentType: 'text/plain' });
    expect(blocking(found), blocking(found).join('\n')).toEqual([]);
    // Names and focusability must survive the reflow too.
    const tree = format(await auditTree(page));
    expect(tree, tree.join('\n')).toEqual([]);
    // The tab order survives it as well, and no stop is left partly under the composer.
    const focus = format(await auditTabOrder(page));
    expect(focus, focus.join('\n')).toEqual([]);
    // So does TalkBack's reading order: the round 8 emulator failure was this check at 200% text.
    const order = format(await auditReadingOrder(page));
    expect(order, order.join('\n')).toEqual([]);
  });
}

// Above 200% (MVP-48): Android multiplies Alpha's own text size by the system font scale, so the
// largest in-app size (150%) with the largest system font (200%) draws text at 300%. Every primary
// view, in the standalone and the launcher presentation, is held to the 200% rules there.
// The states below failed on real layout defects when this lane was added (issue #701). They still
// run every rule, and must still report a defect: a fix makes the test fail with "now passes", and
// the entry must then be removed. A timeout or a state that no longer opens fails as well, instead
// of counting as the expected failure. The list may only shrink (test/accessibility-coverage.test.mjs).
const OPEN_AT_300 = new Set([
]);
for (const state of [...LIVE_STATES, ...LAUNCHER_STATES]) {
  test(`300% text (largest in-app size and system font) is not clipped and does not overlap: ${state.name}`, async ({ page }) => {
    test.setTimeout(LARGE_TEXT_TIMEOUT);
    await state.open(page, 'light');
    await setTextScale(page, 3);
    const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page), ...await auditReadingOrder(page)]));
    if (OPEN_AT_300.has(state.name)) expect(found, `${state.name} now passes at 300%: remove it from OPEN_AT_300 (issue #701)`).not.toEqual([]);
    else expect(found, found.join('\n')).toEqual([]);
  });
}
// Calendar's title is the month, so the sweep above checks whichever month it runs in. September
// is the widest month name; "November" split mid-word in the launcher at 300% when the lane above
// first ran in November.
test('300% text keeps the widest month name whole in the launcher Calendar header', async ({ page }) => {
  test.setTimeout(LARGE_TEXT_TIMEOUT);
  await page.clock.setFixedTime(new Date('2026-09-15T12:00:00'));
  await LAUNCHER_STATES.find(state => state.name === 'launcher Calendar')!.open(page, 'light');
  await setTextScale(page, 3);
  await expect(page.getByRole('heading', { name: 'September', exact: true })).toBeVisible();
  const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page)]));
  expect(found, found.join('\n')).toEqual([]);
});

test.describe('landscape', () => {
  // A touch phone on its side (the Android WebView path in main.tsx).
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const state of STATES) {
    test(`landscape keeps every control on screen: ${state.name}`, async ({ page }) => {
      test.setTimeout(LARGE_TEXT_TIMEOUT);
      await state.open(page, 'light');
      // The landscape layout is what is being checked, not a scaled-down portrait canvas.
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page), ...await auditReadingOrder(page)]));
      expect(blocking(found), blocking(found).join('\n')).toEqual([]);
    });
  }
  // The two together: a phone on its side with the system's largest font (round 10).
  for (const state of STATES) {
    test(`landscape at 200% text keeps every control on screen: ${state.name}`, async ({ page }) => {
      test.setTimeout(LARGE_TEXT_TIMEOUT);
      await state.open(page, 'light');
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      await setTextScale(page, 2);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page), ...await auditReadingOrder(page)]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});

// Screens the states above do not reach: the fixture lock screen and photos-empty viewer and the
// Android HOME (launcher) presentation. Provider-connected states are in STATES.
for (const state of [...FIXTURE_STATES, ...LAUNCHER_STATES]) {
  for (const scale of [1, 2]) {
    test(`${scale * 100}% text, names, focus and contrast: ${state.name}`, async ({ page }) => {
      test.setTimeout(LARGE_TEXT_TIMEOUT);
      await state.open(page, 'light');
      if (scale !== 1) await setTextScale(page, scale);
      if (state.name === 'launcher Home' && scale === 2) {
        // This bridge has no draft storage. Audit the 200% Home after its
        // delayed draft status and floating dock have finished laying out.
        await expect(page.getByRole('status', { name: 'Assistant draft status' })).toBeVisible();
        await settled(page);
      }
      const found = blocking(format([
        ...await auditTree(page),
        ...await auditPage(page, scale === 1 ? { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true } : { clipping: true, overlap: true, dock: true }),
        ...await auditTabOrder(page),
        ...await auditReadingOrder(page),
      ]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}

// The launcher bridge has no draft-storage plugin. Its normal read retries fail
// after the drawer opens, adding a real status row above the floating composer.
// Check that mutation checkpoint, rather than waiting another frame for layout.
test('launcher Apps keeps scroll clearance when a late draft status arrives', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const waiting = new MutationObserver(() => {
      const dock = document.querySelector<HTMLElement>('[data-alpha-layer="composer"]');
      if (!dock) return;
      waiting.disconnect();
      const status = new MutationObserver(() => {
        const list = document.querySelector<HTMLElement>('[data-alpha-layer="drawer"] [data-installed-apps-scroll]');
        const clock = list?.querySelector<HTMLElement>('[aria-label="Open Synthetic clock"]');
        if (!list || !clock || !dock.textContent?.includes('Local draft could not be read')) return;
        const box = clock.getBoundingClientRect(), dockBox = dock.getBoundingClientRect();
        const screen = document.querySelector<HTMLElement>('[data-screen]')!;
        const scale = screen.getBoundingClientRect().width / screen.offsetWidth;
        (window as any).__alphaLateDockLayout = {
          room: (list.scrollHeight - list.clientHeight - list.scrollTop) * scale,
          need: box.bottom - dockBox.top,
        };
        status.disconnect();
      });
      status.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    waiting.observe(document, { childList: true, subtree: true });
  });
  await LAUNCHER_STATES.find(state => state.name === 'launcher Apps')!.open(page, 'light');
  await expect.poll(() => page.evaluate(() => (window as any).__alphaLateDockLayout)).toBeTruthy();
  const layout = await page.evaluate(() => (window as any).__alphaLateDockLayout as { room: number; need: number });
  await info.attach('late-draft-status-layout', { body: JSON.stringify(layout), contentType: 'application/json' });
  expect(layout.room).toBeGreaterThanOrEqual(layout.need);
  expect(errors).toEqual([]);
});

// setTextScale emulates WebView text zoom, which a real renderer applies before any script measures.
// In the launcher at 200% the late draft status above can arrive after the size is set; the dock's
// clearance published at that row's mutation checkpoint has to be the scaled footprint, or an audit
// that runs before the next frame finds Home's last row under the composer (CI on PR #803).
test('200% text: a row added to the launcher composer is in the published clearance at once', async ({ page }) => {
  await LAUNCHER_STATES.find(state => state.name === 'launcher Home')!.open(page, 'light');
  await setTextScale(page, 2);
  const result = await page.evaluate(() => new Promise<{ published: string; measured: number }>(resolve => {
    const dock = document.querySelector<HTMLElement>('[data-alpha-layer="composer"]')!;
    const screen = document.querySelector<HTMLElement>('[data-screen]')!;
    const covered = () => {
      let top = 0;
      let node: HTMLElement | null = dock;
      for (; node && node !== screen; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
      return screen.clientHeight - top;
    };
    // Created after the app's observers and the text-zoom emulation, so it sees what they left.
    const checkpoint = new MutationObserver(() => {
      checkpoint.disconnect();
      resolve({ published: getComputedStyle(document.documentElement).getPropertyValue('--alpha-dock-clearance').trim(), measured: Math.ceil(covered()) });
    });
    checkpoint.observe(document.body, { childList: true, subtree: true, attributes: true });
    // A status row declared in pixels, as the composer's draft status is.
    const row = document.createElement('div');
    row.setAttribute('role', 'status');
    row.style.cssText = 'font-size:12px;line-height:1.5;padding:6px 16px';
    row.textContent = 'Local draft could not be read. Your current text is retained.';
    dock.prepend(row);
  }));
  expect(result.published).toBe(`${result.measured}px`);
});

// The browser build re-applies its stored text size whenever its device settings load or change
// (browser/device.ts). That can land after setTextScale, and must not undo the emulated system size.
test('200% text survives the browser build re-applying its stored text size', async ({ page }) => {
  await page.goto('/?mode=mock&start=maps:route');
  await setTextScale(page, 2);
  await page.evaluate(() => window.dispatchEvent(new Event('alpha:device-settings')));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale').trim())).toBe('2');
});

// Shared Home tiles (@elizaos/ui/mobile-shell MobileHomeScreen): every tile in the grid is one named
// button whose accessible name is its visible label; the glyph id it carries for audits
// (data-mobile-shell-tile-icon) never changes that name.
for (const theme of ['light', 'dark'] as const) {
  test(`shared Home tiles are counted, named and reachable: ${theme}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
    await page.goto('/?mode=dev&theme=' + theme);
    const home = page.getByRole('region', { name: 'Home', exact: true });
    const grid = home.locator('[data-mobile-shell-apps]');
    await expect(grid.locator('[data-mobile-shell-tile]').first()).toBeVisible();
    const tiles = await grid.locator('[data-mobile-shell-tile]').evaluateAll(elements => elements.map(element => ({
      tag: element.tagName, type: element.getAttribute('type'), name: element.getAttribute('aria-label'),
      label: element.querySelector('[data-mobile-shell-tile-label]')?.textContent ?? '',
      icon: element.getAttribute('data-mobile-shell-tile-icon'), image: !!element.querySelector('img'),
    })));
    expect(tiles.length).toBe(await grid.getByRole('button').count());
    expect(tiles.length, 'product tiles and Apps').toBeGreaterThan(1);
    for (const tile of tiles) {
      expect(tile).toMatchObject({ tag: 'BUTTON', type: 'button' });
      expect(tile.name, 'accessible name is the visible label').toBe(tile.label);
      expect(tile.icon !== null || tile.image, `${tile.name} carries a glyph id or a platform icon`).toBe(true);
    }
    expect(new Set(tiles.map(tile => tile.name)).size, 'no two tiles read alike').toBe(tiles.length);
    for (const tile of tiles) await expect(grid.getByRole('button', { name: tile.name!, exact: true })).toHaveCount(1);
    // The whole Home is audited unfiltered: a tile defect cannot hide behind a narrowed result.
    const found = format([...await auditTree(page), ...await auditPage(page, { targetSize: 24 })]);
    expect(found, found.join('\n')).toEqual([]);
  });
}
