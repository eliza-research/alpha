import {test, expect, type Page} from '@playwright/test';
import {setupTelephony} from './telephony-fixture';
// AP-16 Phone (docs/agentic-comms.md AC-03, AC-17 to AC-22) in the browser. Evidence for the
// renderer only: the fixture call is simulated, and nothing here proves a Telecom call, a dial
// intent or the Alpha image's own call screen (AGENTS.md).

/** The shell component, reached through the rendered tree like shell-toast.spec.ts. */
async function shellInit(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
    (window as any).alphaShell = () => {
      const screen = document.querySelector('[data-screen]') as any;
      let fiber = screen[Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!];
      while (fiber && !(fiber.stateNode && typeof fiber.stateNode.openView === 'function')) fiber = fiber.return;
      return fiber.stateNode;
    };
  });
}
/** Relative luminance contrast of two computed CSS colors. */
function contrast(a: string, b: string) {
  const lum = (color: string) => {
    const [r, g, b2] = (color.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + .05) / (y + .05);
}
/** The element at the center of a selector's box is that element (or inside it). */
async function hits(page: Page, selector: string) {
  return page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !!top && (top === element || element.contains(top));
  }, selector);
}
const recents = async (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('alpha.dev.app.phone') || '{"recents":[]}').recents.filter((row: any) => row.at));
const openAlpha = (page: Page) => page.getByRole('button', {name: 'Open Alpha', exact: true}).click();
async function askAlpha(page: Page, text: string) {
  const field = page.locator('[data-alpha-bar-field="alpha"]:visible');
  await field.fill(text);
  await field.press('Enter');
}

test.describe('fixture dev build (?fixture=1&mode=dev, ELIZA_DEV_ALLOW_TEST_MOCKS=1): call card', () => {
  test.beforeEach(async ({page}) => { await shellInit(page); });

  test('light mode gives a white call screen and dark mode a black one, with a green live dot and a red End', async ({page}) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/?fixture=1&mode=dev&start=phone:call&theme=${theme}`);
      const card = page.locator('[data-alpha-call-card]');
      await expect(card).toBeVisible();
      await expect(card.locator('.pn-head .alpha-live-dot')).toBeVisible();
      const colors = await card.evaluate(element => {
        const style = getComputedStyle(element), name = element.querySelector('.pn-head .serif')!, end = element.querySelector('[data-alpha-call-end]')!;
        return {bg: style.backgroundColor, fg: getComputedStyle(name).color, end: getComputedStyle(end).backgroundColor, dot: getComputedStyle(element.querySelector('.alpha-live-dot')!).backgroundColor};
      });
      expect(colors.bg, theme).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
      expect(contrast(colors.fg, colors.bg), `${theme} name contrast`).toBeGreaterThanOrEqual(4.5);
      expect(colors.end).toBe('rgb(229, 56, 59)');
      expect(colors.dot).toBe('rgb(30, 158, 74)');
      // Mute, keypad, speaker and hold, in that order, then End (AC-03).
      expect(await card.locator('[data-alpha-stage-last] button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label')))).toEqual(['Mute', 'Show keypad', 'Speaker', 'Hold', 'End call']);
    }
  });

  test('End hit-tests at closed, open, full and mid-drag, and is the right-most call control while open', async ({page}) => {
    await page.goto('/?fixture=1&mode=dev&start=phone:call');
    await expect(page.locator('[data-alpha-call-card]')).toBeVisible();
    expect(await hits(page, '[data-alpha-bar-end]'), 'closed: End beside the bar').toBe(true);
    await openAlpha(page);
    await expect(page.locator('[data-alpha-layer="app"][data-alpha-stage="true"]')).toBeVisible();
    // The stage shows as the sheet starts rising (420ms height transition, AC-04); hit-test and
    // grab the sheet once it rests, or the press lands below a grabber still moving up.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.timeline instanceof DocumentTimeline && a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))));
    expect(await hits(page, '[data-alpha-call-end]'), 'open: End in the call card').toBe(true);
    const order = await page.locator('[data-alpha-call-card] [data-alpha-stage-last]').evaluate(row => {
      const boxes = [...row.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width).map(b => ({end: b.hasAttribute('data-alpha-call-end'), x: b.getBoundingClientRect().left}));
      return boxes.sort((a, b) => a.x - b.x).at(-1)?.end;
    });
    expect(order, 'End is right-most').toBe(true);
    const grabber = page.getByRole('button', {name: 'Resize chat', exact: true});
    const box = (await grabber.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 60, {steps: 4});
    expect(await hits(page, '[data-alpha-call-end]'), 'mid-drag').toBe(true);
    await page.mouse.move(box.x + box.width / 2, 40, {steps: 6});
    await page.mouse.up();
    await expect(page.locator('[data-alpha-strip]')).toBeVisible();
    expect(await hits(page, '[data-alpha-strip-action="end"]'), 'full: End in the strip').toBe(true);
  });

  test('Alpha proposes a call and nothing dials before the tap on Call; Back returns to the thread, then closes the chat', async ({page}) => {
    await page.goto('/?fixture=1&mode=dev&start=messages:thread');
    await openAlpha(page);
    const before = (await recents(page)).length;
    await askAlpha(page, 'can you call maya');
    const proposal = page.locator('[data-alpha-chat-proposal]');
    await expect(proposal).toContainText('(415) 555-0132');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-alpha-call-card]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).alphaShell().vget('phone').callWho)).toBeNull();
    const sheet = await page.evaluate(() => getComputedStyle(document.querySelector('[data-screen]')!).getPropertyValue('--alpha-sheet-height'));
    await proposal.locator('[data-alpha-proposal-act]').click();
    await expect(page.locator('[data-alpha-call-card]')).toBeVisible();
    await expect(page.locator('[data-alpha-stage-return]')).toContainText('Messages');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-screen]')!).getPropertyValue('--alpha-sheet-height'))).toBe(sheet);
    await page.evaluate(() => (window as any).alphaShell().back());
    await expect(page.locator('[data-alpha-call-card]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).alphaShell().S())).toMatchObject({view: 'messages', chat: 'sheet'});
    await page.evaluate(() => (window as any).alphaShell().back());
    expect(await page.evaluate(() => (window as any).alphaShell().S().chat)).toBe('input');
    expect((await recents(page)).length).toBe(before);
  });

  test('a ring over the open chat stages the incoming card; Answer and Decline are reachable at every height and Decline restores the stage', async ({page}) => {
    await page.goto('/?fixture=1&mode=dev&start=messages:thread');
    await openAlpha(page);
    await page.evaluate(() => { const shell = (window as any).alphaShell(); shell.mod('phone').actions.ring({args: {pid: 'maya'}}, shell.api(shell.S().view)); });
    await expect(page.locator('[data-alpha-incoming-card]')).toBeVisible();
    expect(await page.evaluate(() => (window as any).alphaShell().S().chat)).toBe('sheet');
    // The stage slides the incoming card in (AC-05); hit-test once it has landed.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.timeline instanceof DocumentTimeline && a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))));
    for (const marker of ['[data-alpha-incoming-answer]', '[data-alpha-incoming-decline]']) expect(await hits(page, marker), `open ${marker}`).toBe(true);
    await page.evaluate(() => (window as any).alphaShell().setState({chat: 'full'}));
    for (const action of ['answer', 'decline']) await expect(page.locator(`[data-alpha-strip-action="${action}"]`)).toBeVisible();
    await page.evaluate(() => (window as any).alphaShell().setState({chat: 'sheet'}));
    await page.locator('[data-alpha-incoming-decline]').click();
    await expect(page.locator('[data-alpha-incoming-card]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).alphaShell().S())).toMatchObject({view: 'messages', chat: 'sheet'});
  });

  test('an emergency number keeps the full-screen call: no proposal, no stage, End reachable', async ({page}) => {
    await page.goto('/?fixture=1&mode=dev&start=phone:keypad');
    for (const key of ['9', '1', '1']) await page.getByRole('button', {name: key, exact: true}).click();
    await page.getByRole('button', {name: 'Call', exact: true}).click();
    const card = page.locator('[data-alpha-call-card]');
    await expect(card).toHaveAttribute('data-emergency', 'true');
    await openAlpha(page);
    await expect(page.locator('[data-alpha-layer="app"][data-alpha-stage="true"]')).toHaveCount(0);
    expect(await hits(page, '[data-alpha-call-end]')).toBe(true);
    await askAlpha(page, 'can you call maya');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-alpha-chat-proposal]')).toHaveCount(0);
  });
});

test.describe('fixture dev build (?fixture=1&mode=dev, ELIZA_DEV_ALLOW_TEST_MOCKS=1): Recents filter', () => {
  test.beforeEach(async ({page}) => { await shellInit(page); });

  test('"Call or ask" filters Recents by name and by digits with no network request; an Alpha filter shows a clearable chip', async ({page}) => {
    await page.goto('/?fixture=1&mode=dev&start=phone');
    const external: string[] = [];
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
    const field = page.locator('[data-alpha-bar-field="filter"]');
    await expect(field).toHaveAttribute('placeholder', 'Call or ask');
    await field.fill('maya');
    await expect(page.getByRole('button', {name: /^Call / }).filter({hasNotText: 'Maya'})).toHaveCount(0);
    await field.fill('555-0187');
    await expect(page.getByRole('button', {name: 'Call Jordan Park', exact: true}).first()).toBeVisible();
    await expect(page.getByRole('button', {name: 'Call Maya Chen', exact: true})).toHaveCount(0);
    expect(external).toEqual([]);
    await field.fill('');
    await field.fill('did maya call me');
    await field.press('Enter');
    const chip = page.locator('[data-alpha-list-filter-chip]');
    await expect(chip).toContainText('Maya Chen');
    await chip.getByRole('button', {name: 'Clear filter Maya Chen'}).click();
    await expect(chip).toHaveCount(0);
  });
});

test.describe('Alpha image shape (telephony-fixture.ts): Recents filter', () => {
  test('typing in "Call or ask" filters the image Recents locally and reads nothing more', async ({page}) => {
    await setupTelephony(page);
    await page.getByRole('button', {name: 'Phone', exact: true}).first().click();
    await expect(page.getByRole('button', {name: /^Call Carmen Ruiz/})).toBeVisible();
    const reads = await page.evaluate(() => ((window as any).telephonyInputs as [string, any][]).length);
    await page.locator('[data-alpha-bar-field="filter"]').fill('carm');
    await expect(page.locator('[data-alpha-phone-recents] button[aria-label^="Call "]')).toHaveCount(1);
    await page.locator('[data-alpha-bar-field="filter"]').fill('');
    await expect(page.getByRole('button', {name: /^Unknown, missed/})).toBeVisible();
    expect(await page.evaluate(() => ((window as any).telephonyInputs as [string, any][]).filter(row => row[0] === 'listRecentCalls').length)).toBeLessThanOrEqual(reads);
  });
});
