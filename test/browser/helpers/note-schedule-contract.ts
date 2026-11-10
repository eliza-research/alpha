import {expect,type Page} from '@playwright/test';

/** Test-only entry to the retained Notes scheduling contract. The owner removed
 * its overflow-menu controls; these tests still exercise the real draft flow. */
export async function installNoteScheduleContract(page:Page){
 await page.route('**/src/main.tsx*',async route=>{
  const response=await route.fetch(),source=await response.text(),anchor='let shell;';
  expect(source).toContain(anchor);
  await route.fulfill({response,body:source.replace(anchor,`${anchor}
globalThis.__noteScheduleContract = (kind, count = 1) => {
 if (!shell?.live || shell.S().view !== 'notes') throw Error('Open the source note first');
 const notes = shell.renderVals().notes, view = notes?.vo || notes?.ed;
 const action = view?.[kind === 'event' ? 'toEvent' : 'toCal'];
 if (typeof action !== 'function') throw Error('The note scheduling contract is unavailable');
 for (let index = 0; index < count; index++) action();
};`)});
 });
}

export async function reviewNoteScheduleContract(page:Page,kind:'event'|'reminder',count=1){
 await page.evaluate(({kind,count})=>(globalThis as any).__noteScheduleContract(kind,count),{kind,count});
}
