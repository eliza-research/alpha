import {seedCompletedAccessSetup} from './flag-off-android';
import {installDeliveryFixture,startResidentAgent} from './helpers/delivery-fixture';
import {test,expect} from '@playwright/test';
for(const mode of ['compose','cancel','source-changed','owner-changed'] as const)test('Gmail Ask explicit source review '+mode,async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await installDeliveryFixture(page,{gmail:true});
 await startResidentAgent(page);
 // Completed-installation UI progress keeps this fixture focused on the Gmail notice review.
 await page.evaluate(async()=>{
  const c=(await import('/src/runtime/connection-ui.tsx')).connectionController,f=(window as any).deliveryFixture,snapshot=c.getSnapshot.bind(c);f.reads=0;
  const client={gmailAccounts:async()=>[{connectionId:'grant',connected:true,label:'Owned mailbox',grantedCapabilities:['google.gmail.triage']}],gmailRead:async()=>{f.reads++;return {message:{id:'mail',threadId:'thread',subject:'Public subject',snippet:f.changed?'Changed snippet':'Public snippet'},bodyText:'PRIVATE BODY NEVER SHARED',historyId:f.changed?'11':'10',attachments:[]};}};
  c.getCloudClient=()=>({client,sessionId:'cloud-session',credentialId:'credential'} as any);const snapshots=new WeakMap<object,any>();c.getSnapshot=()=>{const original=snapshot();if(!snapshots.has(original))snapshots.set(original,{...original,cloudAccount:{environment:'production',userId:'owner',sessionId:'cloud-session'}});return snapshots.get(original);};
  f.gmailTap={token:'ask-token',grantId:'grant',credentialId:'credential',userId:'owner',generation:'generation',question:true,messageId:'mail',threadId:'thread'};
  document.dispatchEvent(new Event('visibilitychange'));
 });
 const review=page.getByRole('dialog',{name:'Ask about selected content'});await expect(review).toBeVisible();await expect(review.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Public subject\nPublic snippet');expect(await page.evaluate(()=>(window as any).deliveryFixture.reads)).toBe(1);
 if(mode==='compose')await page.screenshot({path:testInfo.outputPath('question-review.png')});
 if(mode==='cancel'){await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).deliveryFixture.released)).toBe(1);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||0)).toBe(0);await page.evaluate(()=>{const f=(window as any).deliveryFixture;f.gmailTap=f.savedTap;document.dispatchEvent(new Event('visibilitychange'));});await expect(review).toBeVisible();}
 else{
  if(mode==='source-changed')await page.evaluate(()=>{(window as any).deliveryFixture.changed=true;});
  if(mode==='owner-changed')await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.disconnect();});
  if(mode!=='owner-changed')await review.getByRole('button',{name:'Use in conversation',exact:true}).click();
  if(mode==='compose'){await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue(/Public subject/);await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).not.toHaveValue(/PRIVATE BODY/);expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed)).toBe(1);}
  else {
   if(mode==='source-changed')await expect(page.getByText('This notification changed.',{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>(window as any).deliveryFixture.consumed||0)).toBe(0);
  }
 }
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);expect(errors).toEqual([]);
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
