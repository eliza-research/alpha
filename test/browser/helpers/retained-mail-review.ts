import type {Page} from '@playwright/test';

/** Inspect retained review data in synthetic fixtures without restoring retired receipt UI. */
export async function retainedMailReview(page:Page,action?:'check'|'clear'|'close'){
 return page.evaluate(action=>{
  const root=document.getElementById('root') as any;
  const key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!key)throw Error('Phone shell is unavailable');
  const pending=[root[key]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.renderVals==='function'&&shell.S?.().view==='inbox'){
    const review=shell.renderVals().inbox?.provider;
    if(!review)throw Error('Open the retained mail review first');
    if(action){
     if(typeof review[action]!=='function')throw Error('Review action is unavailable');
     review[action]();
    }
    return Object.fromEntries(Object.entries(review).filter(([,value])=>typeof value!=='function')) as Record<string,any>;
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open Inbox first');
 },action);
}
