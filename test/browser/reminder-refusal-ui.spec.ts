import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
// A definite native refusal shows its specific reason, leaves no unknown creation and keeps
// the draft open. Browser storage only; the refusal is injected at the plugin boundary.
test.use({timezoneId:'UTC'});
for(const status of ['storage-full','past','permission-denied','failed'] as const)test(`refused reminder creation (${status}) is retired with its reason`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.clock.setFixedTime(new Date('2027-03-13T00:00Z'));await page.goto('/');
 await openBrowserCalendar(page);
 const accept=async(dialog:any)=>{await dialog.accept();};page.on('dialog',accept);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Refused reminder');await page.getByRole('button',{name:'Reminders',exact:true}).click();
 const message=await page.evaluate(async status=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts'),{reminderRefusalMessage}=await import('/src/runtime/reminder-creations.ts');(window as any).creates=0;
  BrowserDaily.prototype.scheduleReminder=async function(input:{id:string}){(window as any).creates++;return {status,id:input.id,mode:'inexact',message:'refused'} as any;};
  return reminderRefusalMessage(status,false);
 },status);
 const save=page.getByRole('button',{name:'Save event',exact:true});
 for(let attempt=1;attempt<=3;attempt++){
  await save.click();
  await expect(page.getByText(message,{exact:true}).last()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).creates)).toBe(attempt);
  // Each refusal is retired after readback; nothing remains pending and the draft stays open.
  await expect.poll(()=>page.evaluate(async()=>Object.values(await (await import('/src/runtime/reminder-creations.ts')).reminderCreations()).filter(row=>row.state==='pending').length)).toBe(0);
  await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Refused reminder');
  await expect(save).toBeEnabled();
 }
 await expect(page.getByRole('button',{name:'Check new reminder status',exact:true})).toHaveCount(0);
});
