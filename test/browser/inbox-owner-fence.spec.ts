import {test,expect} from '@playwright/test';
for(const mode of ['read-switch','same-owner','clear-delete','clear-receipt'] as const)test(`Gmail owner fence ${mode}`,async({page})=>{
 const switching=mode!=='same-owner', clearing=mode.startsWith('clear');
 // Isolate mailbox ownership from the separately tested access walkthrough; this records UI progress only.
 await page.addInitScript(()=>localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4,choices:['skipped','skipped','skipped','skipped']})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const w=window as any,f=w.ownerFixture={slots:{},owner:'owner-a',grant:'a',reads:0,dispatches:0,release:null,finished:false,aborts:0,prepares:0,holdClear:false};
  const owner=(id:string)=>JSON.stringify(['production',id,'']);const key=async(id:string,grant:string)=>'inbox-operation:v1:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner(id),grant])))),b=>b.toString(16).padStart(2,'0')).join('');
  const record=(id:string,grant:string)=>({version:1,owner:owner(id),grantId:grant,requestId:'receipt-'+grant,proposal:{kind:'draft-create',mode:'new',to:['fixture@example.invalid'],cc:[],bcc:[],subject:'Private '+grant,bodyText:'Body '+grant,attachments:[]},phase:'observed',review:null,receipt:{requestId:'receipt-'+grant,kind:'draft-create',state:'succeeded',reviewDigest:'digest-'+grant,providerResult:{draftId:'draft-'+grant,providerDigest:'provider-'+grant}}});
  f.oldKey=await key('owner-a','a');f.newKey=await key('owner-b','b');f.slots[f.oldKey]=record('owner-a','a');f.newRecord=record('owner-b','b');f.slots[f.newKey]=f.newRecord;
  // Drain actual fixture work, including asynchronous receipt-key hashes, rather
  // than assuming a delayed stale continuation finishes within a fixed sleep.
  const inFlight=new Set<Promise<unknown>>(),digest=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=(...args)=>{const promise=digest(...args);inFlight.add(promise);void promise.then(()=>inFlight.delete(promise),()=>inFlight.delete(promise));return promise;};
  const checkpoint=()=>new Promise<void>(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
  f.drain=async()=>{for(;;){await checkpoint();if(inFlight.size){await Promise.allSettled([...inFlight]);continue;}await checkpoint();if(!inFlight.size)return;}};

  s.read=async k=>structuredClone(f.slots[k]||null);s.compareExchange=async(k,old,next)=>{if(f.holdClear&&k===f.oldKey&&next===null)await new Promise(resolve=>f.releaseClear=resolve);if(JSON.stringify(f.slots[k]||null)!==JSON.stringify(old))return{status:'conflict'};if(next===null)delete f.slots[k];else f.slots[k]=structuredClone(next);return{status:'saved'};};
  const client={gmailAccounts:async()=>[{connectionId:f.grant,label:'Mailbox '+f.grant,connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({send:true,providerDrafts:true,mailboxMutations:true,from:'fixture@example.invalid'}),gmailPrepareOperation:async()=>{f.prepares++;throw Error('No new provider review allowed');},gmailDraft:async(_grant,_draft,signal)=>{signal.addEventListener('abort',()=>f.aborts++,{once:true});f.reads++;return new Promise(resolve=>f.release=()=>{resolve({draftId:'draft-a',providerDigest:'provider-a'});f.finished=true;});},gmailDispatchOperation:async()=>{f.dispatches++;throw Error('No provider dispatch allowed');}};
  c.getCloudClient=()=>({client,sessionId:'session-'+f.owner} as any);const original=c.getSnapshot(),snapshots=new Map();c.getSnapshot=()=>{if(!snapshots.has(f.owner))snapshots.set(f.owner,{...original,cloudAccount:{environment:'production',userId:f.owner,sessionId:'session-'+f.owner,credentialId:'fixture'}});return snapshots.get(f.owner);};
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review mail operation',exact:true});
 await expect(review.getByRole('button',{name:'Close mail review',exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(review.getByRole('button',{name:'Close receipt',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');await expect(review.getByRole('button',{name:'Close mail review',exact:true})).toBeFocused();
 if(clearing){await page.evaluate(()=>(window as any).ownerFixture.holdClear=true);await page.getByRole('button',{name:mode==='clear-delete'?'Review permanent draft deletion':'Close receipt',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).ownerFixture.releaseClear)).toBe('function');}
 else {await page.getByRole('button',{name:'Edit this Gmail draft',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).ownerFixture.release)).toBe('function');}
 if(switching){await page.evaluate(()=>{const f=(window as any).ownerFixture;f.owner='owner-b';f.grant='b';});await page.getByRole('button',{name:'Close mail review',exact:true}).last().click();await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));await expect(page.getByRole('dialog',{name:'Review mail operation'})).toContainText('receipt-b');await expect(page.getByRole('button',{name:'Mailbox b',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit this Gmail draft',exact:true})).toBeEnabled();}
 await page.evaluate(clearing=>{const f=(window as any).ownerFixture;(clearing?f.releaseClear:f.release)();},clearing);
 if(switching){await page.evaluate(()=>(window as any).ownerFixture.drain());expect(await page.evaluate(()=>Object.keys((window as any).ownerFixture.slots).filter(k=>k.startsWith('inbox-drafts:')))).toEqual([]);expect(await page.evaluate(()=>{const f=(window as any).ownerFixture;return f.slots[f.newKey];})).toEqual(await page.evaluate(()=>(window as any).ownerFixture.newRecord));expect(await page.evaluate(()=>(window as any).ownerFixture.dispatches)).toBe(0);expect(await page.evaluate(()=>(window as any).ownerFixture.prepares)).toBe(0);await expect(page.getByRole('dialog',{name:'Review mail operation'})).toBeVisible();if(!clearing)expect(await page.evaluate(()=>(window as any).ownerFixture.aborts)).toBe(1);}
 else{await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Private a');await expect.poll(()=>page.evaluate(()=>Object.keys((window as any).ownerFixture.slots).filter(k=>k.startsWith('inbox-drafts:')).length)).toBe(1);}
});
