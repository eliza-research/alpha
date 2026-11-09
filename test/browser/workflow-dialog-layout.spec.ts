import {test,expect} from '@playwright/test';
test.use({viewport:{width:360,height:430}});
const dialogs={result:['Workflow step result','Cancel run'],urgency:['Workflow urgency','Cancel run'],history:['Workflow history','Close history'],calendar:['App calendar recovery','Close recovery'],clock:['Clock alarms','Cancel']} as const;
for(const theme of ['light','dark'])for(const kind of Object.keys(dialogs) as (keyof typeof dialogs)[])test(`${theme} ${kind} dialog stays usable at compact height and large text`,async({page},info)=>{
 await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async kind=>{
  const {BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});
  if(kind==='result'){const {requestWorkflowResult}=await import('/src/browser/workflow-result-input.ts');void requestWorkflowResult('Reviewed instruction '+ 'unbroken'.repeat(20),'Selected source\n'.repeat(20),new AbortController().signal).catch(()=>{});}
  if(kind==='urgency'){const {assessWorkflowUrgency}=await import('/src/browser/workflow-urgency.ts');void assessWorkflowUrgency('Selected content\n'.repeat(20),async()=>undefined,new AbortController().signal).catch(()=>{});}
  if(kind==='history'){const {openWorkflowHistory}=await import('/src/browser/workflow-history.ts');openWorkflowHistory(()=>({flows:[],localRuns:{}}),()=>{},()=>false);}
  if(kind==='calendar'){const {openCalendarRecovery}=await import('/src/browser/calendar-recovery.ts');openCalendarRecovery();}

 },kind);
 if(kind==='clock'){await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Clock alarms',exact:true}).click();}
 const [name,close]=dialogs[kind],dialog=page.getByRole('dialog',{name,exact:true});await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 const actions=[close,...(kind==='result'?['Use result']:kind==='urgency'?['Urgent','Not urgent']:kind==='clock'?['Save alarm']:[])];
 for(const name of actions){const box=await dialog.getByRole('button',{name,exact:true}).boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(430);}
 expect(await dialog.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(theme==='dark'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
 const content=dialog.getByRole('region',{name:name+' content'});await content.focus();await page.keyboard.press('End');await expect.poll(()=>content.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('compact-dialog.png')});
 await dialog.getByRole('button',{name:close,exact:true}).click();await expect(dialog).toHaveCount(0);
});
