import type {Page} from '@playwright/test';

/** Use the visible message menu, including after returning from a reply or Undo. */
export async function chooseMailAction(page: Page, name: 'Reply' | 'Reply all' | 'Forward' | 'Archive' | 'Move to Trash' | 'Ask Alpha') {
  const menu = page.locator('.mail-message-menu');
  if (await menu.getAttribute('open') === null) await menu.getByLabel('Message actions', {exact: true}).click();
  await menu.getByRole('button', {name, exact: true}).click();
}

/** The current refresh action lives in the shared Mail options menu. */
export async function refreshInbox(page:Page){
 const menu=page.locator('.mail-selection-menu');
 if(await menu.getAttribute('open')===null)await menu.getByLabel('Mail options',{exact:true}).click();
 await menu.getByRole('menuitem',{name:'Refresh',exact:true}).click();
}
