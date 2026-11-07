import { test, expect } from '@playwright/test';
import { auditPage, auditTabOrder, auditTree, format } from './accessibility-audit';
import { CONNECTED_STATES, DEVELOPMENT_STATES, FAILURE_STATES, FIXTURE_STATES, LAUNCHER_STATES, LIVE_STATES, MOCK_STATES, setTextScale } from './accessibility-states';

// MVP-48, renderer part. Every retained primary view, subview and failure screen is checked for
// accessible names and roles, keyboard reachability, focus order and traps, contrast, pointer
// target size, 200% text and landscape. This is Chromium on a development server. It is not a
// TalkBack, Switch Access, physical large-font, rotation or device pass; those remain open.
test.describe.configure({ mode: 'parallel' });

const STATES = [...LIVE_STATES, ...DEVELOPMENT_STATES, ...MOCK_STATES, ...CONNECTED_STATES, ...FAILURE_STATES];
// Deliberate single-line ellipsis and line clamps on previews of user content are allowed: the
// full text is one tap away and is exposed whole to assistive technology. Hard clipping is not, and
// neither is a cut app title: it names the screen and has room to wrap.
const appTitle = (line: string) => /^text-truncated: .*<[^>]*\bdata-alpha-app-title\b/.test(line);
const blocking = (lines: string[]) => lines.filter(line => !line.startsWith('text-truncated:') || appTitle(line));

for (const theme of ['light', 'dark'] as const) {
  for (const state of STATES) {
    test(`names, roles, focus and contrast: ${state.name} (${theme})`, async ({ page }) => {
      await state.open(page, theme);
      const found = format([
        ...await auditTree(page),
        ...await auditPage(page, { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true }),
        ...await auditTabOrder(page),
      ]);
      expect(blocking(found), blocking(found).join('\n')).toEqual([]);
    });
  }
}

for (const state of STATES) {
  test(`200% text is not clipped and does not overlap: ${state.name}`, async ({ page }, info) => {
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
  });
}

test.describe('landscape', () => {
  // A touch phone on its side (the Android WebView path in main.tsx).
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const state of STATES) {
    test(`landscape keeps every control on screen: ${state.name}`, async ({ page }) => {
      await state.open(page, 'light');
      // The landscape layout is what is being checked, not a scaled-down portrait canvas.
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page)]));
      expect(blocking(found), blocking(found).join('\n')).toEqual([]);
    });
  }
  // The two together: a phone on its side with the system's largest font (round 10).
  for (const state of STATES) {
    test(`landscape at 200% text keeps every control on screen: ${state.name}`, async ({ page }) => {
      await state.open(page, 'light');
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      await setTextScale(page, 2);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page)]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});

// Screens the states above do not reach: the fixture lock screen and photos-empty viewer and the
// Android HOME (launcher) presentation. Provider-connected states are in STATES.
for (const state of [...FIXTURE_STATES, ...LAUNCHER_STATES]) {
  for (const scale of [1, 2]) {
    test(`${scale * 100}% text, names, focus and contrast: ${state.name}`, async ({ page }) => {
      await state.open(page, 'light');
      if (scale !== 1) await setTextScale(page, scale);
      const found = blocking(format([
        ...await auditTree(page),
        ...await auditPage(page, scale === 1 ? { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true } : { clipping: true, overlap: true, dock: true }),
        ...await auditTabOrder(page),
      ]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}

// The current collapsed composer renders status in its separate notice region.
// Add a late source-owned unsent notice after opening the drawer and retain the
// bottom-clearance assertion without relying on an obsolete draft-store read.
test('launcher All apps keeps scroll clearance when a late assistant status arrives', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const waiting = new MutationObserver(() => {
      const dock = document.querySelector<HTMLElement>('[data-alpha-layer="composer"]');
      if (!dock) return;
      waiting.disconnect();
      const status = new MutationObserver(() => {
        const list = document.querySelector<HTMLElement>('[data-alpha-app-scroll="drawer"]');
        const clock = list?.querySelector<HTMLElement>('[aria-label="Open Synthetic clock"]');
        const notice = document.querySelector<HTMLElement>('[data-alpha-draft-notice]');
        if (!list || !clock || !notice?.textContent?.includes('Not sent. Your message is back in the composer.')) return;
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
  await LAUNCHER_STATES.find(state => state.name === 'launcher All apps')!.open(page, 'light');
  await page.evaluate(() => {
    const root = document.getElementById('root') as any;
    const key = Object.keys(root).find(key => key.startsWith('__reactContainer$'))!;
    const pending = [root[key]];
    while (pending.length) {
      const fiber = pending.pop();
      if (typeof fiber?.stateNode?.vset === 'function') {
        fiber.stateNode.unsentNotice = 'Not sent. Your message is back in the composer.';
        fiber.stateNode.setState({});
        return;
      }
      if (fiber?.sibling) pending.push(fiber.sibling);
      if (fiber?.child) pending.push(fiber.child);
    }
    throw Error('No phone shell');
  });
  await expect(page.locator('[data-alpha-draft-notice]')).toContainText('Not sent. Your message is back in the composer.');
  await expect.poll(() => page.evaluate(() => (window as any).__alphaLateDockLayout)).toBeTruthy();
  const layout = await page.evaluate(() => (window as any).__alphaLateDockLayout as { room: number; need: number });
  await info.attach('late-draft-status-layout', { body: JSON.stringify(layout), contentType: 'application/json' });
  expect(layout.room).toBeGreaterThanOrEqual(layout.need);
  expect(errors).toEqual([]);
});
