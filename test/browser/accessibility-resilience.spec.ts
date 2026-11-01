import { test, expect, type Locator, type Page } from '@playwright/test';
import {openLegacyAttachment,openLegacyNotes} from './helpers/legacy-notes';
import { setTextScale } from './accessibility-states';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
import {openOwnedPhotoViewer} from './helpers/owned-photo';
import { auditPage, auditTabOrder, format } from './accessibility-audit';
import { settled } from './helpers/settled';

// Behaviour behind the defects the accessibility sweep found (MVP-48, renderer part).
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

/** On screen and not covered: a pointer, switch or TalkBack double-tap would reach it. */
async function reachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(async () => {
    const box = await control.boundingBox(); expect(box).not.toBeNull();
    const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(-.5); expect(box!.x + box!.width).toBeLessThanOrEqual(view.width + .5);
    expect(box!.y).toBeGreaterThanOrEqual(-.5); expect(box!.y + box!.height).toBeLessThanOrEqual(view.height + .5);
    expect(await control.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); })).toBe(true);
  }).toPass({ timeout: 5000 });
}

test.describe('camera in landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const mode of ['live', 'mock'] as const) {
    test(`every capture control is on screen and usable (${mode})`, async ({ page }, info) => {
      await page.addInitScript(offline);
      await page.goto(mode === 'mock' ? '/?mode=mock&start=camera' : '/');
      if (mode === 'live') await page.getByRole('button', { name: 'Camera', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      const shutter = page.getByRole('button', { name: 'Take photo', exact: true });
      for (const control of [shutter, ...['Photo mode', 'Video mode', 'Scan mode', 'Zoom 1x', 'Back to apps'].map(name => page.getByRole('button', { name, exact: true }))])
        await reachable(page, control);
      // The viewfinder keeps the space the controls do not use, and no control sits on another.
      const finder = (await page.locator('[data-alpha-camera="viewfinder"]').boundingBox())!, capture = (await page.locator('[data-alpha-camera="capture"]').boundingBox())!;
      expect(finder.x + finder.width).toBeLessThanOrEqual(capture.x + 1);
      expect(finder.height).toBeGreaterThan(300);
      await page.screenshot({ path: info.outputPath('camera-landscape.png') });
      // Keyboard: the mode switch is reachable and operable without a pointer.
      const video = page.getByRole('button', { name: 'Video mode', exact: true });
      await video.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: /recording/i }).first()).toBeVisible();
      // Back to portrait: the portrait stack returns unchanged.
      await page.setViewportSize({ width: 412, height: 915 });
      await expect(page.locator('html')).not.toHaveClass(/alpha-landscape/);
      await reachable(page, page.getByRole('button', { name: 'Photo mode', exact: true }));
      const portrait = (await page.locator('[data-alpha-camera="capture"]').boundingBox())!;
      expect(portrait.width).toBeGreaterThan(300);
    });
  }
});

test.describe('maps sheets', () => {
  test('directions at 200% text: Start stays reachable and is not under the composer', async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.goto('/?mode=mock&start=maps:route');
    await setTextScale(page, 2);
    const start = page.getByRole('button', { name: 'Start', exact: true });
    await reachable(page, start);
    // Travel modes wrap instead of printing over each other.
    const modes = await page.locator('[data-alpha-maps-directions] button[aria-label]').filter({ hasNotText: /^$/ }).evaluateAll(list => list.filter(el => el.getAttribute('aria-label') !== 'Back to place').map(el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, sw: el.scrollWidth, cw: el.clientWidth }; }));
    expect(modes.length).toBeGreaterThanOrEqual(2);
    for (const item of modes) expect(item.sw).toBeLessThanOrEqual(item.cw + 1);
    for (let a = 0; a < modes.length; a++) for (let b = a + 1; b < modes.length; b++) {
      const overlap = modes[a].l < modes[b].r - 1 && modes[b].l < modes[a].r - 1 && modes[a].t < modes[b].b - 1 && modes[b].t < modes[a].b - 1;
      expect(overlap).toBe(false);
    }
    await page.screenshot({ path: info.outputPath('directions-large-text.png') });
  });

  test.describe('landscape', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
    test('the directions card and the route sheet sit side by side', async ({ page }, info) => {
      await page.goto('/?mode=mock&start=maps:route');
      const card = page.locator('[data-alpha-maps-directions]'), sheet = page.locator('[data-alpha-maps-sheet="directions"]');
      const cardBox = (await card.boundingBox())!, sheetBox = (await sheet.boundingBox())!;
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(sheetBox.x + 1);
      await reachable(page, page.getByRole('button', { name: 'Back to place', exact: true }));
      await reachable(page, page.getByRole('button', { name: 'Start', exact: true }));
      await page.screenshot({ path: info.outputPath('directions-landscape.png') });
    });
    test('search results keep the search field and the list on screen', async ({ page }) => {
      await page.goto('/?mode=mock&start=maps:search');
      await reachable(page, page.getByRole('textbox', { name: 'Search places', exact: true }));
      await reachable(page, page.getByRole('button', { name: 'Resize results', exact: true }));
      await reachable(page, page.getByRole('button', { name: /Philz Coffee/ }).last());
    });
  });
});

test('a new browser tab shows no find bar until find is opened', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tabs', exact: true })).toBeVisible();
  // The bar used to render on every page with an input bound to nothing.
  await expect(page.getByRole('search', { name: 'Find in page' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close find in page', exact: true })).toHaveCount(0);
});

test('the note editor keeps Delete on screen beside the other header actions', async ({ page }) => {
  const {foreign,errors}=await canonicalNotesFixture(page);
  await openCanonicalNotes(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  // Alpha's note editor header holds Back and every note action, Share and Delete included, in one row.
  for (const name of ['Back to notes', 'Pin', 'Share note', 'Delete note']) await reachable(page, page.getByRole('button', { name, exact: true }));
  const sizes = await page.locator('[data-alpha-subview="notes-editor"] [data-alpha-app-header="detail"] button').evaluateAll(list => list.map(el => el.getBoundingClientRect().width));
  for (const width of sizes) expect(width).toBeGreaterThanOrEqual(43.5);
  expect(sizes.length).toBeGreaterThanOrEqual(6);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('200% text keeps the way out on screen', () => {
  // Large-text layouts re-measure every rule after the text grows: explicit, as other sweeps run beside them.
  test.describe.configure({ timeout: 60_000 });
  for (const [start, open, field] of [['inbox', 'Search email', 'Search mail'], ['photos', 'Search photos', 'Search photos'], ['notes', 'Search notes', 'Search notes'], ['files', 'Search files', 'Search files']] as const) {
    test(`${start} search: the field shrinks and Close search stays reachable`, async ({ page }) => {
      await page.goto(`/?mode=mock&start=${start}`);
      await page.getByRole('button', { name: open, exact: true }).click();
      await setTextScale(page, 2);
      await reachable(page, page.getByRole('textbox', { name: field, exact: true }).or(page.getByRole('searchbox', { name: field, exact: true })));
      // Inbox uses the back arrow to leave search; its clear button keeps the search open.
      const close = page.getByRole('button', { name: start === 'inbox' ? 'Back to inbox' : 'Close search', exact: true });
      if (start === 'inbox') {
        const field = page.getByRole('searchbox', { name: 'Search mail', exact: true });
        await field.fill('synthetic query');
        const clear = page.getByRole('button', { name: 'Clear search', exact: true });
        await reachable(page, clear); await clear.click(); await expect(field).toHaveValue('');
      }
      await reachable(page, close);
      await close.click();
      await expect(close).toHaveCount(0);
    });
  }

  test('the Undo toast wraps a long file name and keeps Undo usable', async ({ page }) => {
    await page.goto('/?mode=mock&start=files:preview');
    await page.getByRole('button', { name: 'Delete file', exact: true }).click();
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    await setTextScale(page, 2);
    await reachable(page, undo);
    await undo.click();
    await expect(page.getByRole('button', { name: /^Open Northpoint_TermSheet_v3\.pdf/ })).toBeVisible();
  });

  test('browser menu rows grow with their labels instead of printing over each other', async ({ page }) => {
    await page.goto('/?mode=mock&start=browser');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await setTextScale(page, 2);
    const rows = await page.locator('[data-alpha-browser-menu] > button').evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, fits: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 }; }));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row.fits).toBe(true);
    for (let index = 1; index < rows.length; index++) expect(rows[index].top).toBeGreaterThanOrEqual(rows[index - 1].bottom - 1);
    await reachable(page, page.getByRole('button', { name: 'Read aloud', exact: true }));
  });
});

test.describe('menus and sheets over a scrim own focus', () => {
  // [state, steps, dialog name, scrim name, the opener focus returns to (when it survives)]
  const POPUPS = [
    ['live', ['Browser', 'Menu'], 'Browser menu', 'Close menu', 'Menu'],
    ['browser', ['Menu', 'Share'], 'Share page', 'Close share', null],
    ['photos:viewer', ['Photo info'], 'Photo info', 'Close info', 'Photo info'],
    ['photos:viewer', ['Share photo'], 'Share photo', 'Close share', 'Share photo'],
    ['notes:editor', ['Share note'], 'Share', 'Cancel', 'Share note'],
    ['files:folder', ['View and sort'], 'View and sort', 'Close menu', 'View and sort'],
    ['files:preview', ['Move file'], 'Move to', 'Close move', 'Move file'],
    ['files:preview', ['Share file'], 'Share file', 'Close share', 'Share file'],
    ['workflows:new', ['Add Read step'], 'Step editor', 'Close', null],
    ['settings', ['Connections', 'Slack'], 'Slack', 'Close sheet', 'Slack'],
  ] as const;
  for (const [start, steps, name, scrim, opener] of POPUPS) {
    test(`${start} > ${steps.join(' > ')}: focus enters, stays, and returns on Escape`, async ({ page }) => {
      const ownedInfo=start==='photos:viewer'&&name==='Photo info';
      const nativeShare=start==='notes:editor'&&name==='Share';
      if(nativeShare){
        // Alpha's note editor opens the share panel for agent Notes and Older notes alike; Older notes needs no agent fixture.
        await page.addInitScript(offline);await page.goto('/');await openLegacyNotes(page);
        await page.getByRole('button',{name:'New note',exact:true}).click();
        await page.getByRole('textbox',{name:'Title',exact:true}).fill('Owned share focus note');
        await page.getByRole('textbox',{name:'Note',exact:true}).fill('Exact locally created content.');
      }else if(ownedInfo)await openOwnedPhotoViewer(page);
      else if (start === 'live') { await page.addInitScript(offline); await page.goto('/'); }
      else await page.goto(`/?mode=mock&start=${start}`);
      for (const step of steps.slice(0, -1)) await page.getByRole('button', { name: step, exact: true }).first().click();
      const last = page.getByRole('button', { name: steps.at(-1)!, exact: true }).first();
      await expect(last).toBeVisible();
      // Everything the user could operate before the popup opened must be operable again after it.
      await page.evaluate(() => { for (const el of document.querySelectorAll('.os button, .os input, .os textarea, .os a[href]')) if (el.getClientRects().length && !el.closest('[inert]')) (el as any).__alphaBefore = true; });
      await last.click();
      const dialog = page.getByRole('dialog', { name, exact: true });
      await expect(dialog).toBeVisible();
      const inside = () => page.evaluate(() => !!document.activeElement?.closest('dialog,[role="dialog"]'));
      await expect.poll(inside).toBe(true);
      // The page under the popup is out of the tab order and the accessibility tree; the
      // popup's own scrim still closes it for a pointer or an assistive-technology tap.
      if(nativeShare){
        // Native modal inertness is supplied by showModal, not copied inert attributes.
        expect(await dialog.evaluate(el=>el.matches('dialog:modal'))).toBe(true);
        await expect(dialog.getByRole('button',{name:'Share to email',exact:true})).toBeVisible();
        await expect(dialog.getByRole('button',{name:'Share externally',exact:true})).toBeVisible();
      }else{
        const exposed = await page.evaluate(() => Array.from(document.querySelectorAll('.os button, .os input, .os textarea, .os a[href]'))
          .filter(el => el.getClientRects().length && !el.closest('[inert],[aria-hidden="true"]') && !el.closest('[data-alpha-popup],[role="dialog"]')).map(el => el.getAttribute('aria-label') || el.textContent));
        expect(exposed).toEqual([]);
      }
      if(ownedInfo){const scrim=page.locator('button[aria-label="Close album management"]');await expect(scrim).toHaveAttribute('aria-hidden','true');await expect(scrim).toHaveAttribute('tabindex','-1');}
      await expect(page.getByRole('button', { name: ownedInfo?'Close dialog':scrim, exact: true })).toHaveCount(1);
      const stops = await dialog.locator('button:not(:disabled), input, textarea, select').count();
      for (let step = 0; step < stops + 2; step++) { await page.keyboard.press('Tab'); expect(await inside()).toBe(true); }
      for (let step = 0; step < 2; step++) { await page.keyboard.press('Shift+Tab'); expect(await inside()).toBe(true); }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      if (opener) await expect(page.getByRole('button', { name: opener, exact: true }).first()).toBeFocused();
      const stranded = await page.evaluate(() => Array.from(document.querySelectorAll('.os button, .os input, .os textarea, .os a[href]'))
        .filter(el => (el as any).__alphaBefore && el.isConnected && !!el.closest('[inert],[aria-hidden="true"]')).map(el => el.getAttribute('aria-label') || el.textContent));
      expect(stranded).toEqual([]);
    });
  }

  test('a tap on the scrim still closes the popup, and Delete is not operable under the share sheet', async ({ page }) => {
    await page.goto('/?mode=mock&start=photos:viewer');
    await page.getByRole('button', { name: 'Share photo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share photo', exact: true });
    await expect(dialog).toBeVisible();
    // Delete photo sits under the sheet: before, Tab reached it there and Enter deleted unseen.
    expect(await page.locator('button[aria-label="Delete photo"]').evaluate(el => !!el.closest('[inert]'))).toBe(true);
    await page.getByRole('button', { name: 'Close share', exact: true }).click({ position: { x: 8, y: 60 } });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete photo', exact: true })).toBeVisible();
    // The Android Back gesture reaches the renderer as alpha-back: it closes the sheet, not the viewer.
    await page.getByRole('button', { name: 'Share photo', exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('alpha-back', { cancelable: true })))).toBe(true);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-alpha-subview="photos-viewer"]:not([inert])')).toBeVisible();
  });
});

test.describe('toast status messages', () => {
  test('a toast lands in a polite live region that exists before it appears', async ({ page }) => {
    await page.goto('/?mode=mock&start=files:preview');
    const region = page.locator('[data-alpha-toast]');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // Present and empty beforehand: a live region inserted together with its text is not announced reliably.
    await expect(region).toBeEmpty();
    expect(await region.evaluate(el => !!el.closest('[inert],[aria-hidden="true"]'))).toBe(false);
    await page.getByRole('button', { name: 'Delete file', exact: true }).click();
    await expect(region).toContainText('Northpoint_TermSheet_v3.pdf');
    await expect(region.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  });

  test('a refusal raised from an open menu is still announced', async ({ page }) => {
    await page.addInitScript(offline);
    await page.goto('/');
    await page.getByRole('button', { name: 'Browser', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Browser menu', exact: true });
    // Find in page is native-only, so the web build's menu refuses through Bookmark instead.
    await menu.getByRole('button', { name: 'Bookmark', exact: true }).click();
    const region = page.locator('[data-alpha-toast]');
    await expect(region).toContainText('Load an HTTPS page before bookmarking it.');
    // The menu is still open and holds the page inert; the status region is not part of what it retired.
    await expect(menu).toBeVisible();
    expect(await region.evaluate(el => !!el.closest('[inert],[aria-hidden="true"]'))).toBe(false);
    expect(await page.getByRole('button', { name: 'Tabs', exact: true }).count()).toBe(0);
  });
});

test.describe('photo editor in landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  test('scrolls to Rotate, Crop and the filters, which sit below the preview', async ({ page }) => {
    await openOwnedPhotoViewer(page);
    await page.getByRole('button', { name: 'Edit photo', exact: true }).click();
    const editor = page.locator('[data-alpha-subview="photos-edit"]');
    await expect(editor).toBeVisible();
    expect(await editor.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
    for (const name of ['Rotate', 'Crop', 'Mono filter']) await reachable(page, page.getByRole('button', { name, exact: true }));
    // Keyboard: a filter is operable without a pointer, and Save is still reachable afterwards.
    const mono = page.getByRole('button', { name: 'Mono filter', exact: true });
    await mono.focus(); await page.keyboard.press('Enter');
    await expect(mono).toHaveAttribute('aria-pressed', 'true');
    await reachable(page, page.getByRole('button', { name: 'Save edit', exact: true }));
  });
});

test.describe('recovery screen', () => {
  const startupFailure = async (page: Page) => {
    await page.addInitScript(offline);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await page.evaluate(async () => { const module = await import('/src/runtime/error-boundary.tsx' as string); module.showRecoveryScreen('startup', new Error('Private note text')); });
    return page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
  };

  test('takes the page behind it out of focus order and out of the accessibility tree', async ({ page }) => {
    const recovery = await startupFailure(page);
    await expect(recovery.getByRole('button', { name: 'Reload', exact: true })).toBeFocused();
    expect(await page.evaluate(() => (document.getElementById('root') as HTMLElement).inert)).toBe(true);
    expect(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(el => !!el.closest('[inert]'))).toBe(true);
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => { const active = document.activeElement; return !active || active === document.body || !!active.closest('.alpha-recovery'); })).toBe(true);
    }
    await expect(recovery.locator('pre')).not.toContainText('Private note text');
  });

  test('a render failure under an open modal dialog dismisses the dialog and hands focus to Reload', async ({ page }) => {
    await page.addInitScript(offline);
    await page.goto('/');
    await openLegacyAttachment(page);
    const dialog = page.getByRole('dialog', { name: 'Note source document' });
    await expect(dialog).toBeVisible();
    // A modal <dialog> is in the top layer: left open, it covers recovery and makes it inert.
    expect(await page.evaluate(() => document.querySelector('dialog[open]')?.matches(':modal'))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
    const recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
    await expect(recovery).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const reload = recovery.getByRole('button', { name: 'Reload', exact: true });
    await expect(reload).toBeFocused();
    await reachable(page, reload);
    // The dismissed dialog linked nothing and focus stays in recovery.
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => { const active = document.activeElement; return !active || active === document.body || !!active.closest('.alpha-recovery'); })).toBe(true);
    }
  });

  for (const kind of ['startup', 'render'] as const) {
    test.describe(`${kind} failure in landscape with 200% text`, () => {
      test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
      test('scrolls instead of cutting off the title or Reload', async ({ page }, info) => {
        let recovery: Locator;
        if (kind === 'startup') recovery = await startupFailure(page);
        else {
          await page.addInitScript(offline); await page.goto('/');
          await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
          await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
          recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
        }
        await expect(recovery).toBeVisible();
        // The screen uses fixed pixel sizes outside the phone, so scale it the way text zoom would.
        await recovery.evaluate(el => { (el as HTMLElement).style.fontSize = '32px'; for (const pre of el.querySelectorAll('pre')) (pre as HTMLElement).style.fontSize = '24px'; });
        await recovery.getByText('Diagnostics', { exact: true }).click();
        expect(await recovery.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        // Scrolled to the top, the heading is whole; nothing sits above the scroll origin.
        await recovery.evaluate(el => { el.scrollTop = 0; });
        expect(await recovery.getByRole('heading', { name: 'Alpha Phone needs to reload' }).evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
        await page.screenshot({ path: info.outputPath('recovery.png') });
        const reload = recovery.getByRole('button', { name: 'Reload', exact: true });
        await reachable(page, reload);
        await recovery.locator('pre').scrollIntoViewIfNeeded();
        await expect(recovery.locator('pre')).toBeInViewport();
      });
    });
  }
});

// Round 10 (MVP-48). The round 8 emulator run found Home's last row drawn under the floating
// composer at 200% text, read by TalkBack after the composer that sat above it. These are the
// behaviours behind the fixes, measured from bounding boxes in Chromium; the emulator check is
// AccessibilityInstrumentedTest and a device pass is still device acceptance.
const HOME_SHELLS = [{ name: 'standalone app', url: '/' }, { name: 'launcher', url: '/?shell=launcher' }];
/** Home controls whose painted box (after every clipping ancestor) meets the dock, and whether the last tile can be scrolled wholly above it. */
const homeUnderDock = (page: Page) => page.evaluate(() => {
  const home = document.querySelector<HTMLElement>('[data-alpha-layer="home"]')!;
  const docks = Array.from(document.querySelectorAll<HTMLElement>('[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *')).filter(el => el.getClientRects().length && !el.closest('[inert]')).map(el => el.getBoundingClientRect());
  const painted = (el: Element) => {
    const rect = el.getBoundingClientRect(), box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node); if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const frame = node.getBoundingClientRect();
      if (style.overflowX !== 'visible') { box.left = Math.max(box.left, frame.left); box.right = Math.min(box.right, frame.right); }
      if (style.overflowY !== 'visible') { box.top = Math.max(box.top, frame.top); box.bottom = Math.min(box.bottom, frame.bottom); }
    }
    return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
  };
  const under: string[] = [];
  for (const el of home.querySelectorAll('button,a[href],span,div')) {
    if (!el.getClientRects().length || (el.matches('span,div') && !Array.from(el.childNodes).some(node => node.nodeType === 3 && (node.nodeValue || '').trim()))) continue;
    const box = painted(el); if (!box) continue;
    if (docks.some(dock => Math.min(box.right, dock.right) - Math.max(box.left, dock.left) > 1 && Math.min(box.bottom, dock.bottom) - Math.max(box.top, dock.top) > 1)) under.push((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40));
  }
  return { docks: docks.length, under, scrolls: home.scrollHeight > home.clientHeight + 1, gap: Math.round(Math.min(...docks.map(dock => dock.top)) - home.getBoundingClientRect().bottom) };
});
/**
 * The Android check, in the page: actionable controls in document (TalkBack linear) order, by
 * the bounds left after clipping; the next one may start a new column to the right, otherwise
 * it must not sit above the one before it by more than half the taller of the two.
 */
const readingOrderProblems = (page: Page) => page.evaluate(() => {
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect(), box = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node); if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const frame = node.getBoundingClientRect();
      if (style.overflowX !== 'visible') { box.left = Math.max(box.left, frame.left); box.right = Math.min(box.right, frame.right); }
      if (style.overflowY !== 'visible') { box.top = Math.max(box.top, frame.top); box.bottom = Math.min(box.bottom, frame.bottom); }
    }
    return box.right - box.left > 0 && box.bottom - box.top > 0 ? box : null;
  };
  const problems: string[] = []; let previous: { name: string; box: NonNullable<ReturnType<typeof visible>> } | null = null;
  for (const el of document.querySelectorAll('[data-screen] button,[data-screen] a[href],[data-screen] textarea,[data-screen] input')) {
    if (!el.getClientRects().length || el.closest('[inert],[aria-hidden="true"]')) continue;
    const box = visible(el); if (!box) continue;
    const name = el.getAttribute('aria-label') || (el.textContent || '').trim();
    if (previous && box.top < previous.box.top - Math.max(previous.box.bottom - previous.box.top, box.bottom - box.top) / 2 && box.left < previous.box.right) problems.push(`reading order goes up from '${previous.name}' to '${name}'`);
    previous = { name, box };
  }
  return problems;
});
async function openHome(page: Page, url: string, scale: number) {
  await page.addInitScript(offline);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  if (scale !== 1) await setTextScale(page, scale);
  await expect(page.locator('[data-alpha-layer="composer"] [data-alpha-input-bar]')).toBeVisible();
  await settled(page);
}

for (const shell of HOME_SHELLS) for (const scale of [1, 1.5, 2]) {
  test(`${shell.name} Home at ${scale * 100}% text fills the screen and scrolls every app above the composer`, async ({ page }) => {
    test.setTimeout(60_000);
    await openHome(page, shell.url, scale);
    const home = page.locator('[data-alpha-layer="home"]');
    const top = await homeUnderDock(page);
    expect(top.docks).toBe(1);
    expect(await home.evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-document.querySelector('[data-screen]')!.getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
    // Every scroll position, and the end of the list: the last tile is wholly visible above the bar.
    for (const position of [0.33, 0.66, 1]) {
      await home.evaluate((el, fraction) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction; }, position);
      const at = await homeUnderDock(page);
      expect(format(await auditPage(page,{dock:true}))).toEqual([]);
      if(position===1){expect(at.under,at.under.join(', ')).toEqual([]);expect(await readingOrderProblems(page)).toEqual([]);}
    }
    const last = home.getByRole('button', { name: 'All apps', exact: true });
    await expect(last).toBeInViewport({ ratio: 1 });
    const tile = (await last.boundingBox())!, bar = (await page.locator('[data-alpha-input-bar]').boundingBox())!;
    expect(tile.y + tile.height).toBeLessThanOrEqual(bar.y);
    // At 200% Home has to scroll (three columns, four rows); that is the case the emulator caught.
    if (scale === 2) expect(top.scrolls).toBe(true);
    // The rule the sweep runs agrees.
    const found = format(await auditPage(page, { dock: true, clipping: true, overlap: true })).filter(line => !line.startsWith('text-truncated:'));
    expect(found, found.join('\n')).toEqual([]);
  });
}

async function homeHasClearance(page:Page){return page.locator('[data-alpha-home-layout]').evaluate(el=>{const screen=document.querySelector('[data-screen]')!.getBoundingClientRect(),bar=document.querySelector('[data-alpha-layer="composer"]')!.getBoundingClientRect();return parseFloat(getComputedStyle(el).paddingBottom)>=screen.bottom-bar.top+4;});}
test('Home keeps enough scroll clearance when Android raises the dock and when the draft grows',async({page})=>{
 await openHome(page,'/',2);const home=page.locator('[data-alpha-layer="home"]'),height=(await home.boundingBox())!.height;
 await page.evaluate(()=>{document.documentElement.classList.add('native-phone');document.documentElement.style.setProperty('--native-bottom-inset','72px');});
 await expect.poll(()=>homeHasClearance(page)).toBe(true);
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('one\ntwo\nthree\nfour\nfive');
 await expect.poll(()=>homeHasClearance(page)).toBe(true);expect((await home.boundingBox())!.height).toBe(height);
 await home.evaluate(el=>{el.scrollTop=el.scrollHeight;});expect((await homeUnderDock(page)).under).toEqual([]);await expect(home.getByRole('button',{name:'All apps',exact:true})).toBeInViewport({ratio:1});
});
test('a status line on the composer adds Home scroll clearance without moving its rows',async({page})=>{
 await openHome(page,'/',1);const home=page.locator('[data-alpha-layer="home"]'),tile=home.getByRole('button',{name:'Inbox',exact:true});
 const before={tile:(await tile.boundingBox())!.y,height:(await home.boundingBox())!.height,padding:await page.locator('[data-alpha-home-layout]').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))};
 await page.evaluate(()=>{const block=document.createElement('div');block.dataset.testStack='';block.style.height='40px';document.querySelector('[data-alpha-layer="composer"]')!.prepend(block);});
 await expect.poll(()=>page.locator('[data-alpha-home-layout]').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))).toBe(before.padding+40);
 expect((await tile.boundingBox())!.y).toBeCloseTo(before.tile,0);expect((await home.boundingBox())!.height).toBe(before.height);
 await expect.poll(()=>homeHasClearance(page)).toBe(true);
 await page.evaluate(()=>document.querySelector('[data-test-stack]')!.remove());
 await expect.poll(()=>page.locator('[data-alpha-home-layout]').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))).toBe(before.padding);
});

test.describe('landscape Home', () => {
  // Large-text layouts re-measure every rule after the text grows: explicit, as other sweeps run beside them.
  test.describe.configure({ timeout: 60_000 });
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const scale of [1, 2]) test(`the dock stays beside Home at ${scale * 100}% text`, async ({ page }) => {
    await openHome(page, '/', scale);
    await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
    const at = await homeUnderDock(page);
    expect(at.under, at.under.join(', ')).toEqual([]);
    const home = (await page.locator('[data-alpha-layer="home"]').boundingBox())!, bar = (await page.locator('[data-alpha-input-bar]').boundingBox())!;
    expect(home.x + home.width).toBeLessThanOrEqual(bar.x);
    // Beside the dock, Home keeps the full height of the screen.
    expect(home.y + home.height).toBeGreaterThanOrEqual(bar.y + bar.height);
    await page.locator('[data-alpha-layer="home"]').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('button', { name: 'All apps', exact: true })).toBeInViewport({ ratio: 1 });
    const found = format([...await auditPage(page, { dock: true, clipping: true, overlap: true }), ...await auditTabOrder(page)]).filter(line => !line.startsWith('text-truncated:'));
    expect(found, found.join('\n')).toEqual([]);
  });
});

test.describe('keyboard focus and the floating dock', () => {
  // Large-text layouts re-measure every rule after the text grows: explicit, as other sweeps run beside them.
  test.describe.configure({ timeout: 60_000 });
  for (const scale of [1, 2]) test(`every Settings row that takes focus is wholly above the dock at ${scale * 100}% text`, async ({ page }) => {
    await page.addInitScript(offline);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Assistant controls', exact: true })).toHaveCount(1);
    const scroller = page.locator('[data-alpha-app-scroll="settings"]');
    await expect(scroller).toBeVisible();
    if (scale !== 1) await setTextScale(page, scale);
    // The page is long enough to pass under the dock, so some row would take focus there.
    expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const dock = page.locator('[data-alpha-layer="pill"] > *, [data-alpha-layer="composer"]').first();
    await expect(dock).toBeVisible();
    let visited = 0, moved = false;
    for (let step = 0; step < 60; step++) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null, scroll = el?.closest<HTMLElement>('[data-alpha-app-scroll="settings"]');
        if (!el || !scroll) return null;
        const dock = Array.from(document.querySelectorAll<HTMLElement>('[data-alpha-layer="pill"] > *,[data-alpha-layer="composer"]')).find(item => item.getClientRects().length && !item.closest('[inert]'))!.getBoundingClientRect();
        const box = el.getBoundingClientRect(), frame = scroll.getBoundingClientRect();
        const overlapsX = box.right > dock.left && box.left < dock.right;
        return { name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30), covered: overlapsX && box.bottom > dock.top + 1 && box.top < dock.bottom, inside: box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1, scrollTop: scroll.scrollTop };
      });
      if (!state) { if (visited) break; continue; }
      visited++; moved ||= state.scrollTop > 0;
      expect(state.covered, `${state.name} is under the dock`).toBe(false);
      expect(state.inside, `${state.name} is outside the scroll area`).toBe(true);
    }
    expect(visited).toBeGreaterThan(5);
    // Rows below the fold were brought up, not skipped.
    expect(moved).toBe(true);
  });

  test('a tap on a row beside the dock still opens it', async ({ page }) => {
    // Pointer focus is not scrolled: moving a pressed row out from under the finger loses the tap.
    await page.setViewportSize({ width: 412, height: 520 });
    await page.addInitScript(offline);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const scroller = page.locator('[data-alpha-app-scroll="settings"]');
    const row = page.getByRole('button', { name: 'Display', exact: true });
    await row.scrollIntoViewIfNeeded();
    const dock = (await page.locator('[data-alpha-layer="pill"] > *, [data-alpha-layer="composer"]').first().boundingBox())!;
    // Put the row so that its lower edge is just inside the dock's band, to the left of the pill.
    await scroller.evaluate((el, top) => { const target = Array.from(el.querySelectorAll('button')).find(item => (item.getAttribute('aria-label') || item.textContent || '').trim().startsWith('Display'))!; el.scrollTop += target.getBoundingClientRect().bottom - (top + 10); }, dock.y);
    const box = (await row.boundingBox())!, before = await scroller.evaluate(el => el.scrollTop);
    await page.mouse.click(box.x + 24, box.y + 8);
    await expect(page.getByRole('heading', { name: 'Display', exact: true })).toBeVisible();
    expect(before).toBeGreaterThan(0);
  });
});

test.describe('screen titles with a large system font', () => {
  // Large-text layouts re-measure every rule after the text grows: explicit, as other sweeps run beside them.
  test.describe.configure({ timeout: 60_000 });
  for (const title of [{ name: 'Photos', steps: ['Photos'] }, { name: 'Camera', steps: ['Camera'] }, { name: 'Password manager', steps: ['Settings', 'Password manager'] }]) {
    test(`"${title.name}" is shown whole at 200% text`, async ({ page }) => {
      await page.addInitScript(offline);
      await page.goto('/');
      for (const step of title.steps) await page.getByRole('button', { name: step, exact: true }).first().click();
      const heading = page.locator('[data-alpha-app-header] [data-alpha-app-title]').filter({ hasText: title.name }).filter({ visible: true }).first();
      await expect(heading).toBeVisible();
      // At the largest in-app size the header is still one 52px row.
      await setTextScale(page, 1.5);
      await expect(page.locator('html')).not.toHaveClass(/alpha-text-xl/);
      expect(await heading.evaluate(el => Math.round(el.closest('[data-alpha-app-header]')!.getBoundingClientRect().height))).toBe(52);
      await setTextScale(page, 2);
      await expect(page.locator('html')).toHaveClass(/alpha-text-xl/);
      const measured = await heading.evaluate(el => {
        const header = el.closest('[data-alpha-app-header]')!, box = el.getBoundingClientRect(), frame = header.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(el);
        const ink = Array.from(range.getClientRects()).filter(rect => rect.width > 1);
        const buttons = Array.from(header.querySelectorAll('button')).filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect());
        return {
          cut: el.scrollWidth - el.clientWidth, style: getComputedStyle(el).textOverflow, lines: new Set(ink.map(rect => Math.round(rect.top))).size,
          inside: ink.every(rect => rect.left >= frame.left - 1 && rect.right <= frame.right + 1 && rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1),
          overButtons: ink.some(rect => buttons.some(button => Math.min(rect.right, button.right) - Math.max(rect.left, button.left) > 1 && Math.min(rect.bottom, button.bottom) - Math.max(rect.top, button.top) > 1)),
          smallest: Math.min(...buttons.map(button => Math.min(button.width, button.height))),
        };
      });
      expect(measured.cut).toBeLessThanOrEqual(0);
      expect(measured.style).toBe('clip');
      expect(measured.inside).toBe(true);
      expect(measured.overButtons).toBe(false);
      expect(measured.lines).toBe(1);
      // The header's buttons keep their size beside it (24px is the sweep's floor; Photos' view switch is 38px tall at every size).
      expect(measured.smallest).toBeGreaterThanOrEqual(24);
      const found = format(await auditPage(page, { clipping: true, overlap: true, dock: true })).filter(line => line.includes('data-alpha-app-title'));
      expect(found, found.join('\n')).toEqual([]);
    });
  }

  test('the Home calendar title is not cut by its own clamp at 200% text', async ({ page }) => {
    await openHome(page, '/', 2);
    const title = page.locator('.home-calendar-title');
    await expect(title).toBeVisible();
    expect(await title.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const found = format(await auditPage(page, { clipping: true })).filter(line => line.includes('home-calendar-title'));
    expect(found, found.join('\n')).toEqual([]);
  });
});

test.describe('a toast raised while a top-layer dialog is open', () => {
  /** The phone shell's own toast(), reached through the rendered tree: the call every adapter makes. */
  const raise = (page: Page, message: string, undo = false) => page.evaluate(({ message, undo }) => {
    const screen = document.querySelector('[data-screen]') as any;
    const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
    let fiber = screen[key];
    while (fiber && !(fiber.stateNode && typeof fiber.stateNode.toast === 'function')) fiber = fiber.return;
    (window as any).__undone = 0;
    fiber.stateNode.toast(message, undo ? { undo: () => { (window as any).__undone++; } } : undefined);
  }, { message, undo });
  async function openDialog(page: Page) {
    await page.addInitScript(offline);
    await page.goto('/');
    await openLegacyAttachment(page);
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    return dialog;
  }

  test('it is drawn above the dialog, inside it, in a live region that was there before the text', async ({ page }) => {
    const dialog = await openDialog(page);
    const region = dialog.locator('[data-alpha-dialog-toast]');
    // Present and empty as soon as the dialog is open.
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // Marked like the page's own toast region: a live region with no role of its own.
    expect(await region.getAttribute('role')).toBeNull();
    await expect(region).toHaveAttribute('aria-atomic', 'true');
    await expect(region).toBeEmpty();
    await raise(page, 'Saved to Notes');
    await expect(region).toHaveText('Saved to Notes');
    // The page's own region holds it too, but under the dialog and inert: not what is seen or read.
    await expect(page.locator('[data-alpha-toast]')).toContainText('Saved to Notes');
    const measured = await region.evaluate(el => {
      const body = el.firstElementChild!, box = body.getBoundingClientRect(), screen = document.querySelector('[data-screen]')!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { onTop: !!hit && body.contains(hit), inside: box.left >= screen.left && box.right <= screen.right && box.bottom <= screen.bottom && box.top >= screen.top, height: Math.round(box.height), inert: !!el.closest('[inert]'), topLayer: el.matches(':popover-open') };
    });
    expect(measured).toEqual({ onTop: true, inside: true, height: 48, inert: false, topLayer: true });
    // Assistive technology is offered it: the text is in Chromium's accessibility tree once, not ignored.
    const session = await page.context().newCDPSession(page);
    await session.send('Accessibility.enable');
    const { nodes } = await session.send('Accessibility.getFullAXTree') as { nodes: Array<{ ignored?: boolean; role?: { value?: string }; name?: { value?: string } }> };
    const exposed = nodes.filter(node => !node.ignored);
    expect(exposed.filter(node => node.role?.value === 'StaticText' && node.name?.value === 'Saved to Notes')).toHaveLength(1);
    const found = format(await auditPage(page, { dock: true })).filter(line => line.startsWith('toast-'));
    expect(found, found.join('\n')).toEqual([]);
    // It leaves when the toast does, and the region stays for the next one.
    await expect(region).toBeEmpty({ timeout: 5000 });
    await expect(region).toHaveCount(1);
  });

  test('Undo works from inside the dialog, and nothing is left behind when the dialog closes', async ({ page }) => {
    const dialog = await openDialog(page);
    await raise(page, 'Note deleted', true);
    const undo = dialog.locator('[data-alpha-dialog-toast]').getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await undo.click();
    expect(await page.evaluate(() => (window as any).__undone)).toBe(1);
    await raise(page, 'Still open');
    await expect(dialog.locator('[data-alpha-dialog-toast]')).toHaveText('Still open');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('[data-alpha-dialog-toast]')).toHaveCount(0);
    // With no dialog the page's own region is the one on screen again.
    await raise(page, 'Back on the page');
    await expect(page.locator('[data-alpha-toast]')).toContainText('Back on the page');
    const found = format(await auditPage(page, { dock: true })).filter(line => line.startsWith('toast-'));
    expect(found, found.join('\n')).toEqual([]);
  });
});

// The product side of the accessibility click Android delivers (docs/verification.md, round 10).
// WebView's native click only reaches a node that is enabled with every ancestor enabled, and it
// arrives in the page as pointerdown, mousedown, pointerup, mouseup and click on the element with
// no pointer travel. Chromium's desktop tree and synthetic events stand in for WebView here; the
// native delivery itself is AccessibilityInstrumentedTest on an emulator.
// The Notifications button exists on launcher Home only (#416, #417). On Android it asks Android to
// open its shade; this development build opens the stand-in for that shade instead.
for (const shell of HOME_SHELLS.filter(item => item.name === 'launcher')) test(`${shell.name}: the notifications button is an enabled button under enabled ancestors, and an accessibility click's events reach it`, async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto(shell.url);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const session = await page.context().newCDPSession(page);
  await session.send('Accessibility.enable');
  type Node = { nodeId: string; parentId?: string; ignored?: boolean; role?: { value?: string }; name?: { value?: string }; properties?: Array<{ name: string; value: { value?: unknown } }> };
  const { nodes } = await session.send('Accessibility.getFullAXTree') as { nodes: Node[] };
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const handle = nodes.find(node => !node.ignored && node.role?.value === 'button' && node.name?.value === 'Open notifications');
  expect(handle).toBeTruthy();
  const restricted: string[] = [];
  for (let node: Node | undefined = handle; node; node = node.parentId ? byId.get(node.parentId) : undefined)
    for (const property of node.properties || []) if (['disabled', 'readonly'].includes(property.name) && property.value.value) restricted.push(`${node.role?.value}:${property.name}`);
  expect(restricted).toEqual([]);
  expect(handle!.properties?.find(property => property.name === 'focusable')?.value.value).toBe(true);
  const seen = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('[data-alpha-shade-handle]')!, log: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) document.addEventListener(type, event => { if (event.target === target) log.push(type); }, true);
    target.focus();
    const fire = (type: string, Kind: typeof MouseEvent) => target.isConnected && target.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, view: window }));
    fire('pointerdown', PointerEvent); fire('mousedown', MouseEvent); fire('pointerup', PointerEvent); fire('mouseup', MouseEvent); fire('click', MouseEvent);
    return log;
  });
  // The button is still the same element when the click arrives: nothing re-renders it on pointerdown.
  expect(seen).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  await expect(page.locator('[data-alpha-layer="shade"]')).toHaveAttribute('aria-hidden', 'false');
});
test('standalone app: Home offers no notifications control; Android\'s top-edge swipe is the way in', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('[data-alpha-shade-handle]')).toHaveCount(0);
});
