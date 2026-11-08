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
    await onShell(page, 'shell.chatMotion = { mode: "full", offset: 400, scale: 1, height: 0, floor: 120, full: 800, flick: "down", moved: false }; shell.settleChatMotion("down");');
    expect(await closed(page)).toBe(1);
  });
});

test('Back over Home\'s drawer stops voice, then lowers the conversation, then closes the drawer', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'All apps', exact: true })).toBeVisible();
  const state = () => onShell<{ drawer: boolean; chat: string; stopped: number }>(page, 'const s = shell.S(); return { drawer: !!s.drawer, chat: s.chat, stopped: window.__stopped || 0 };');
  await onShell(page, 'window.__stopped = 0; shell.stopVoice = () => { window.__stopped++; shell.setState({ voice: "off" }); }; shell.setState({ drawer: true, chat: "full", voice: "listening" });');
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ drawer: true, chat: 'full', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ drawer: true, chat: 'sheet', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect(await state()).toEqual({ drawer: true, chat: 'input', stopped: 1 });
  await onShell(page, 'shell.back();');
  expect((await state()).drawer).toBe(false);
});
