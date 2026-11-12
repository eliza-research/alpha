import type {Page} from '@playwright/test';

/** Exercise the retained Notes contract without adding a product UI or source hook. */
export async function reviewNoteScheduleContract(page:Page,kind:'event'|'reminder',count=1){
 await page.evaluate(({kind,count})=>{
  const root=document.getElementById('root') as any;
  const key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!key)throw Error('Phone shell is unavailable');
  const pending=[root[key]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.renderVals==='function'&&shell.S?.().view==='notes'){
    const notes=shell.renderVals().notes,view=notes?.vo||notes?.ed;
    const action=view?.[kind==='event'?'toEvent':'toCal'];
    if(typeof action!=='function')throw Error('The retained note scheduling contract is unavailable');
    for(let index=0;index<count;index++)action();
    return;
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open the source note first');
 },{kind,count});
}
