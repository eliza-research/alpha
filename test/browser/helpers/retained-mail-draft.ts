import type {Page} from '@playwright/test';

/** Exercise retained draft callbacks without restoring removed user controls. */
export async function retainedMailDraft(page:Page,operation:'save'|'discard'|'status'){
 return page.evaluate(operation=>{
  const root=document.getElementById('root') as any;
  const key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!key)throw Error('Phone shell is unavailable');
  const pending=[root[key]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.renderVals==='function'&&shell.S?.().view==='inbox'){
    const composer=shell.renderVals().inbox?.c;
    if(!composer)throw Error('Open the retained email draft first');
    if(operation!=='status'){
     if(typeof composer[operation]!=='function')throw Error('Retained draft callback is unavailable');
     composer[operation]();
    }
    return String(composer.status||'');
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open Inbox first');
 },operation);
}
