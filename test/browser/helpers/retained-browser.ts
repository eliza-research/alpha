import type {Page} from '@playwright/test';

/** Exercise the retained page-reading contract after Read aloud left the menu. */
export async function readRetainedBrowserPage(page:Page){
 await page.evaluate(()=>{
  const root=document.getElementById('root') as any;
  const key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!key)throw Error('Phone shell is unavailable');
  const pending=[root[key]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.renderVals==='function'&&shell.S?.().view==='browser'){
    const read=shell.renderVals().browser?.readAloud;
    if(typeof read!=='function')throw Error('The retained reading contract is unavailable');
    read();return;
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open Browser first');
 });
}

/** Test-only entry to the retained provider module; the product exposes its single local vault. */
export async function openRetainedPasswordProvider(page:Page,action:'install'|'settings'|'open'){
 await page.evaluate(async action=>{await (await import('/src/browser/password-provider.ts')).openPasswordProvider(action);},action);
}
