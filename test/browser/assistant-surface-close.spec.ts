import { test, expect, type Page } from '@playwright/test';
// Development lane. The ACTION_ASSIST surface (`?surface=assistant`) is the conversation itself, so
// dismissing the conversation closes the window: drag down, the close path behind the scrim, and
// Go Home. The window close is observed on the shell's closeAssistant(); the Android finish is
// covered by AssistantInstrumentedTest. Back order over Home's drawer is checked on the launcher.

/** Runs `body` against the phone shell instance found through the rendered tree. */
const onShell = <T,>(page: Page, body: string) => page.evaluate(body => {
  const screen = document.querySelector('[data-screen]') as any;
  const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
  let fiber = screen[key];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode.closeAssistant === 'function')) fiber = fiber.return;
  return new Function('shell', body)(fiber.stateNode);
}, body) as Promise<T>;
const spy = (page: Page) => onShell(page, 'window.__closed = 0; shell.closeAssistant = () => { window.__closed++; };');
const closed = (page: Page) => page.evaluate(() => (window as any).__closed as number);

test.describe('on the assistant surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?surface=assistant');
    await expect(page.locator('html')).toHaveClass(/alpha-assistant-surface/);
    await expect(page.getByRole('button', { name: 'Close assistant', exact: true })).toBeVisible();
    await spy(page);
  });

  test('Go Home closes the assistant window', async ({ page }) => {
    await page.getByRole('button', { name: 'Go Home', exact: true }).click();
    expect(await closed(page)).toBe(1);
  });

  test('closing the conversation closes the window', async ({ page }) => {
    await onShell(page, 'shell.renderVals().closeChat();');
    expect(await closed(page)).toBe(1);
  });

  test('dragging the conversation down closes the window', async ({ page }) => {
    // The full surface first shrinks to a sheet. Its actual captured pointer gesture
    // then dismisses to the app below, rather than leaving an unreachable Home behind.
    await page.getByRole('button', {name: 'Shrink chat', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Expand chat', exact: true})).toBeVisible();
    const grip = page.getByRole('button', {name: 'Resize chat', exact: true});
    await grip.click({trial: true});
    const box = await grip.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 600, {steps: 20});
    await page.mouse.up();
    await expect.poll(() => closed(page)).toBe(1);
  });
});

test('Back closes shade, then voice and conversation before Home\'s drawer', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeVisible();
  const state = () => onShell<{ shade: boolean; drawer: boolean; chat: string; stopped: number }>(page, 'const s = shell.S(); return { shade: !!s.shade, drawer: !!s.drawer, chat: s.chat, stopped: window.__stopped || 0 };');
  await onShell(page, 'window.__stopped = 0; shell.stopVoice = () => { window.__stopped++; shell.setState({ voice: "off" }); }; shell.setState({ shade: true, drawer: true, chat: "full", voice: "listening" });');
  // Shade alone closes first. Voice and the conversation stay above the drawer.
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ shade: false, drawer: true, chat: 'full', stopped: 0 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ shade: false, drawer: true, chat: 'full', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ shade: false, drawer: true, chat: 'sheet', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ shade: false, drawer: true, chat: 'input', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ shade: false, drawer: false, chat: 'input', stopped: 1 });
});
