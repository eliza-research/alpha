import { expect, test } from '@playwright/test';

test('chat presentation and exact installer own the published header and dock clearance', async ({ page }) => {
  await page.route('**/dock-clearance-fixture', route => route.fulfill({contentType: 'text/html', body: `<!doctype html>
    <div data-screen data-alpha-chat-half="true" style="position:relative;width:400px;height:600px">
      <header data-alpha-app-header style="height:60px">App</header>
      <div data-alpha-layer="conversation" style="position:absolute;top:0">
        <header data-alpha-chat-header style="height:140px">Conversation</header>
      </div>
      <div data-alpha-layer="composer" style="position:absolute;bottom:0;height:80px;width:100%">
        <div data-alpha-input-bar>Input</div>
      </div>
    </div>`}));
  await page.goto('/dock-clearance-fixture');
  const changed = await page.evaluate(async () => {
    const {installDockClearance} = await import('/src/runtime/dock-clearance.ts' as string);
    const wait = async () => {
      for (let frame = 0; frame < 5; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
    };
    const values = () => ['header-clearance', 'dock-clearance', 'dock-rest'].map(name =>
      document.documentElement.style.getPropertyValue('--alpha-' + name));
    const old = installDockClearance();
    await wait();
    const half = values();
    document.querySelector<HTMLElement>('[data-screen]')!.dataset.alphaChatHalf = 'false';
    await wait();
    const full = values();
    old();
    const current = installDockClearance();
    await wait();
    old();
    const retained = values();
    current();
    await wait();
    return {half, full, retained, removed: values()};
  });
  expect(changed).toEqual({half: ['60px', '80px', '80px'], full: ['140px', '80px', '80px'],
    retained: ['140px', '80px', '80px'], removed: ['', '', '']});
});
