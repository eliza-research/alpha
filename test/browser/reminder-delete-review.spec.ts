import {chooseCalendarEventAction} from './helpers/browser-calendar';
import {test,expect,type Page} from '@playwright/test';
test.use({timezoneId:'UTC'});
async function setup(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.install({time:new Date('2027-03-13T00:00Z')});await page.goto('/');await page.getByRole('button',{name:'Calendar',exact:true}).waitFor();
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'delete-boundary',title:'Delete boundary reminder',at:Date.parse('2027-03-13T14:00Z')});});
 await page.reload();await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:/^Delete boundary reminder,/}).click();
}
const read=(page:Page)=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/reminder-store.ts')).reminderDocument.readRaw())!));
for(const mode of ['fresh','stale','response-loss','staging-loss','navigate','legacy','late-stale','reload-loss'])test(`reviewed reminder deletion ${mode}`,async({page})=>{
 await setup(page);
 await page.evaluate(async mode=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),stage=BrowserDaily.prototype.stageDeletion;(window as any).stages=0;
  BrowserDaily.prototype.stageDeletion=async function(...input:Parameters<typeof stage>){(window as any).stages++;
   if(mode==='staging-loss')throw Error('Synthetic storage admission failure');
   if(mode==='late-stale')await(await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].title='Changed during review';data.reminders[0].revision='b'.repeat(64);});
   const result=await stage.apply(this,input);if(mode==='response-loss'||mode==='reload-loss')throw Error('Lost admission response');return result;
  };
  if(mode==='stale')await(await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders[0].title='Concurrent replacement';data.reminders[0].revision='a'.repeat(64);});
 },mode);
 if(mode==='legacy'){
  expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps'),target=await daily.selectedReminder({id:'delete-boundary'});try{await daily.operateReminder({operationId:'bypass',bindingHash:'a'.repeat(64),operation:{type:'reminder_cancel',target}});return false;}catch{return true;}})).toBe(true);expect((await read(page)).reminders[0].status).toBe('scheduled');return;
 }
 await chooseCalendarEventAction(page, 'Delete event');
 if(mode!=='stale'){
  const review=page.getByRole('dialog',{name:'Delete reminder?',exact:true});await expect(review).toBeVisible();
  if(mode==='navigate')await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
  else await review.getByRole('button',{name:'Delete reminder',exact:true}).click();
 }
 // A changed selection is refused before admission: definite, never reported as an uncertain outcome.
 if(mode==='stale'){await expect(page.getByText('This reminder changed. Review it again before deleting.',{exact:true})).toBeVisible();await expect(page.getByText('Not confirmed. Check its status in Calendar.',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).stages)).toBe(0);}
 if(['staging-loss','late-stale'].includes(mode))await expect(page.getByText('Not confirmed. Check its status in Calendar.',{exact:true})).toBeVisible();
 if(['fresh','response-loss','reload-loss'].includes(mode)){
  const panel=page.getByRole('complementary',{name:'Pending deletions'});await expect(panel.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
  expect((await read(page)).reminders[0].status).toBe('scheduled');expect(Object.keys((await read(page)).deletions)).toHaveLength(1);
  if(mode==='reload-loss'){await page.reload();await expect(panel.getByText(/Deletion paused/)).toBeVisible();await page.clock.fastForward(11000);expect((await read(page)).reminders[0].status).toBe('scheduled');await panel.getByRole('button',{name:'Undo',exact:true}).click();}
  else{await page.clock.fastForward(11000);await expect.poll(async()=>(await read(page)).reminders[0].status).toBe('cancelled');}
 }else{await page.clock.fastForward(11000);expect((await read(page)).reminders[0].status).toBe('scheduled');expect(Object.keys((await read(page)).deletions||{})).toHaveLength(0);}
});
for(const width of [412,1440])test(`two browser tabs retain separate Undo intents at width ${width}`,async({page,context},info)=>{
 await page.setViewportSize({width,height:915});await setup(page);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('DailyApps').scheduleReminder({id:'tab-two',title:'Second tab reminder',at:Date.parse('2027-03-13T14:00Z')});});
 const second=await context.newPage();await second.setViewportSize({width,height:915});await second.clock.install({time:new Date('2027-03-13T00:00Z')});await second.goto('/');await second.getByRole('button',{name:'Calendar',exact:true}).click();await second.getByRole('button',{name:/^Second tab reminder,/}).click();
 for(const tab of [page,second]){await chooseCalendarEventAction(tab, 'Delete event');await tab.getByRole('dialog',{name:'Delete reminder?',exact:true}).getByRole('button',{name:'Delete reminder',exact:true}).click();}
 await expect.poll(async()=>Object.keys((await read(page)).deletions).length).toBe(2);
 const panel=page.getByRole('complementary',{name:'Pending deletions'});await expect(panel.getByRole('button',{name:'Undo',exact:true})).toHaveCount(2);await page.screenshot({path:info.outputPath('pending-undo.png')});
 await panel.getByRole('button',{name:'Undo',exact:true}).first().click();await expect(panel.getByRole('button',{name:'Undo',exact:true})).toHaveCount(1);await panel.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(async()=>(await read(page)).reminders.every((row:any)=>!row.pendingDeletion)).toBe(true);expect((await read(page)).reminders.map((row:any)=>row.status)).toEqual(['scheduled','scheduled']);
});
test('legacy uncertain deletion remains receipt-only across retry and reload',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts'),target=await registerPlugin<any>('DailyApps').selectedReminder({id:'delete-boundary'});await(await import('/src/runtime/reminder-deletions.ts')).retainReminderDeletion({operationId:'legacy-uncertain',bindingHash:'a'.repeat(64),operation:{type:'reminder_cancel',target}});});
 await chooseCalendarEventAction(page, 'Delete event');await expect(page.getByRole('dialog',{name:'Delete reminder?',exact:true})).toHaveCount(0);
 await expect(page.getByText('Not confirmed. Check its status in Calendar.',{exact:true})).toBeVisible();
 await page.reload();expect((await read(page)).reminders[0].status).toBe('scheduled');expect(Object.keys((await read(page)).deletions||{})).toHaveLength(0);
 expect(await page.evaluate(async()=>Object.keys(await(await import('/src/runtime/reminder-deletions.ts')).pendingReminderDeletions()))).toEqual(['legacy-uncertain']);
});
