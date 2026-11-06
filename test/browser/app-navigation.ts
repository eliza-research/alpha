import { expect, type Page } from '@playwright/test';

/** Return through the standalone app's visible controls, including nested app pages. */
export async function returnToApps(page: Page) {
  const settings = page.getByRole('button', {name: 'Settings', exact: true});
  // Read-only nested detail pages hide the app header. Unwind their visible
  // back controls first, rather than opening and dragging the chat over them.
  for (let depth = 0; depth < 4 && !await settings.isVisible(); depth++) {
    const nested = page.getByRole('button', {name: /^(Back to calendar|Back to notes|Back from photo|Back to albums)$/}).filter({visible:true});
    if (!await nested.count()) break;
    await nested.click();
    await expect(nested).toBeHidden();
  }
  const home = page.getByRole('button', {name: 'Go Home', exact: true});
  if (await settings.isVisible()) {
    if (await home.isVisible()) await home.press('Enter');
  } else {
  const back = page.getByRole('button', {name: 'Back to apps', exact: true}).filter({visible:true});
  if (await back.count()) await back.first().press('Enter');
  else {
    if (!await home.isVisible()) await page.getByRole('button', {name: 'Open conversation', exact: true}).click();
    await home.press('Enter');
  }
  }
  // Go Home deliberately preserves an open conversation. Minimize it through
  // the visible control before interacting with Home underneath. The layer's
  // own hidden state says whether it is open: the Minimize button is still
  // rising with the sheet right after Go Home, so its visibility is not.
  const conversation=page.locator('[data-alpha-layer="conversation"]');
  if(await conversation.getAttribute('aria-hidden')==='false'){
    await page.getByRole('button',{name:'Minimize chat',exact:true}).press('Enter');
    await expect(conversation).toHaveAttribute('aria-hidden','true');
  }
  await expect(settings).toBeVisible();
}
