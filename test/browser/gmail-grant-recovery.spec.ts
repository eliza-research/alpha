import {test,expect} from '@playwright/test';
for(const reason of ['disconnected','scope-revoked'] as const)test(`Gmail same-ID ${reason} clears read availability and recovers explicitly`,async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');s.read=async()=>null;
  const w=window as any;w.gmailGrantFixture={connected:true,triage:true,reads:0,oauth:0};
  const client={gmailAccounts:async()=>[{connectionId:'same-grant',label:'Fixture mailbox',configured:true,connected:w.gmailGrantFixture.connected,grantedCapabilities:w.gmailGrantFixture.triage?['google.gmail.triage']:[]}],gmailSearch:async()=>{w.gmailGrantFixture.reads++;return {messages:[],syncedAt:'fixture-revision'};},initiateGmail:async()=>{w.gmailGrantFixture.oauth++;throw Error('No live OAuth in fixture');}};
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture-only'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud',credentialId:'fixture-only'}};c.getSnapshot=()=>snapshot as any;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 // Opening Inbox loads the connected account once, without another tap.
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(1);
 await page.evaluate(reason=>{const f=(window as any).gmailGrantFixture;if(reason==='disconnected')f.connected=false;else f.triage=false;},reason);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Fixture mailbox',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).gmailGrantFixture)).toMatchObject({reads:1,oauth:0});
 await page.evaluate(()=>{const f=(window as any).gmailGrantFixture;f.connected=true;f.triage=true;});
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(2);
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).gmailGrantFixture.reads)).toBe(3);
 expect(await page.evaluate(()=>(window as any).gmailGrantFixture.oauth)).toBe(0);
});

// Recovery after a revoked grant (docs/flow-redesign-2026-11). Reconnect Gmail starts Google's
// consent at once: one request for Gmail changes and Calendar together, handed to the system
// browser handoff (AlphaConnection.openExternal, stubbed at the Capacitor bridge). Coming back to
// Alpha re-reads the grant and the mailbox with no "Check" button. Google, OAuth and Eliza Cloud are
// not involved and no URL is opened for real.
test('Reconnect Gmail starts Google directly, asks once for everything and refreshes on return',async({page})=>{
 const AUTH='https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=synthetic';
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=(window as any).handoffFixture={opened:[] as string[],cancels:0};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  (window as any).Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureRemove','secureCompareExchange','openExternal'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin!=='AlphaConnection')throw Error('Unexpected fixture native plugin');
   if(method==='secureRead')return {value:null};if(method==='secureCompareExchange')return {status:'saved'};if(method==='secureWrite'||method==='secureRemove')return {};
   if(method==='cancel'){f.cancels++;return {};}
   if(method==='openExternal'){f.opened.push(input.url);return {};}
   throw Error('No network in fixture');
  }};
 });
 await page.goto('/');
 await page.evaluate(async AUTH=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {CloudProtocolError}=await import('/src/runtime/cloud-protocol.ts');
  const w=window as any,f=w.handoffFixture;Object.assign(f,{reads:0,lists:0,initiates:[] as unknown[],revokeNext:true});
  const client={gmailAccounts:async()=>{f.lists++;return [{connectionId:'grant-1',label:'Fixture mailbox',configured:true,connected:true,grantedCapabilities:['google.gmail.triage','google.gmail.send']}];},
   gmailSearch:async()=>{f.reads++;if(f.revokeNext){f.revokeNext=false;throw new CloudProtocolError('http',409);}return {messages:[],syncedAt:'fixture-revision',nextPageToken:null};},
   initiateGoogle:async(_signal:AbortSignal,calendar:string,gmail:string,redirect?:string)=>{f.initiates.push([calendar,gmail,redirect??null]);return AUTH;},
   initiateGmail:async()=>{throw Error('Gmail authorization goes through the shared Google connect');},
   disconnectGmail:async()=>{throw Error('Not disconnected in this fixture');}};
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture-only'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',organizationId:'fixture-org',sessionId:'fixture-cloud',credentialId:'fixture-only'}};c.getSnapshot=()=>snapshot as any;
 },AUTH);
 const f=()=>page.evaluate(()=>(window as any).handoffFixture);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 // The first read finds the grant revoked; Reconnect is offered and nothing retries on its own.
 const reconnect=page.getByRole('button',{name:'Reconnect Gmail',exact:true});
 await expect(reconnect).toBeVisible();
 expect((await f()).reads).toBe(1);
 await reconnect.click();
 // No Google accounts panel: Google's consent opens at once, asking for everything in one step.
 await expect.poll(async()=>(await f()).opened).toEqual([AUTH]);
 await expect(page.getByRole('dialog',{name:'Google accounts',exact:true})).toHaveCount(0);
 expect((await f()).initiates).toEqual([['write','modify',null]]);
 expect((await f()).reads,'nothing is read while Google is in front').toBe(1);
 // The owner comes back to Alpha (the browser goes away): the grant and mailbox are read again.
 await page.evaluate(()=>{let hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'));hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(async()=>(await f()).reads).toBeGreaterThan(1);
 await expect(reconnect).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Check Google connections',exact:true})).toHaveCount(0);
 expect((await f()).initiates.length).toBe(1);
});
