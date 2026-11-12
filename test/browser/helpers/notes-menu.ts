import {type Page} from '@playwright/test';

/** Open recovery through the current Notes menu after its return transition settles. */
export async function openRecentlyDeletedNotes(page:Page){
 const menu=page.getByRole('dialog',{name:'Notes options',exact:true});
 if(!await menu.isVisible())await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await menu.getByRole('button',{name:'Recently deleted',exact:true}).click();
}

/** Exercise the retained text-file export after the custom share chooser was removed. */
export async function exportRetainedNote(page: Page) {
 await page.evaluate(() => {
  const root = document.getElementById('root') as any;
  const key = Object.keys(root).find(name => name.startsWith('__reactContainer$'));
  if (!key) throw Error('Phone shell is unavailable');
  const pending = [root[key]];
  while (pending.length) {
   const fiber = pending.pop(), shell = fiber?.stateNode;
   if (typeof shell?.renderVals === 'function' && shell.S?.().view === 'notes') {
    const action = shell.renderVals().notes?.exportText;
    if (typeof action !== 'function') throw Error('Retained note export is unavailable');
    action();
    return;
   }
   if (fiber?.sibling) pending.push(fiber.sibling);
   if (fiber?.child) pending.push(fiber.child);
  }
  throw Error('Open the selected note first');
 });
}
