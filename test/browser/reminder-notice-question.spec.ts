import {test,expect} from '@playwright/test';
import {installDeliveryFixture,startResidentAgent} from './helpers/delivery-fixture';
for(const mode of ['compose','cancel','source-changed','owner-changed'] as const)test('reminder Ask review '+mode,async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await installDeliveryFixture(page);
 await startResidentAgent(page);
 await page.evaluate(()=>{const f=(window as any).deliveryFixture,target={sourceId:'local-source',sourceRevision:'a'.repeat(64),reminderId:'reminder',occurrenceId:'one',revision:'b'.repeat(64),timingVersion:2};f.reminder={id:'reminder',title:'Reviewable reminder',body:'Public meeting plan',at:Date.now(),dueAt:Date.now(),alertMinutes:0,status:'posted',occurrenceId:'one',target};f.reminderTap={token:'ask-token',target,retained:true,question:true};document.dispatchEvent(new Event('visibilitychange'));});
 const review=page.getByRole('dialog',{name:'Ask about selected content'});await expect(review).toBeVisible();await expect(review.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Reviewable reminder\nPublic meeting plan');
 if(mode==='compose')await page.screenshot({path:testInfo.outputPath('question-review.png')});
 if(mode==='cancel'){await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.released)).toBe(1);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||0)).toBe(0);await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.reminderTap=f.savedTap;document.dispatchEvent(new Event('visibilitychange'));});await expect(review).toBeVisible();}
 else{
  if(mode==='source-changed')await page.evaluate(()=>{(window as any).deliveryFixture.reminderTap.retained=false;});
  // The review stays open after the owner changes; Use must refuse in place and keep the tap.
  if(mode==='owner-changed')await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;await c.disconnect();});
  await review.getByRole('button',{name:'Use in conversation',exact:true}).click();
  if(mode==='compose'){await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue(/Reviewable reminder/);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed)).toBe(1);}
  else{
   if(mode==='source-changed')await expect(page.getByText('This notification changed.',{exact:true})).toBeVisible();
   else{await expect(review.getByRole('status')).toHaveText('Selection changed. Close this review and select the content again.');await expect(review.getByRole('button',{name:'Use in conversation',exact:true})).toBeDisabled();}
   expect(await page.evaluate(()=>{const f=(window as any).deliveryFixture;return {consumed:f.consumed||0,released:f.released||0,pending:f.reminderTap.token};})).toEqual({consumed:0,released:0,pending:'ask-token'});
  }
 }
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);
});
