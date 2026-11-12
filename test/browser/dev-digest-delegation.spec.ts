import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import {test,expect,type Page} from '@playwright/test';
const panel=(page:Page)=>page.getByRole('dialog',{name:'Scheduled digests',exact:true});
async function setup(page:Page){await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await openConnectionDiagnostics(page);await page.getByRole('button',{name:'Connect development profile'}).click();await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await panel(page).getByText('Live Google',{exact:true}).click();await panel(page).getByText('Connect Cloud for scheduled reads',{exact:true}).click();}
test('local authorization review survives reload and revocation disables its sources',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});await setup(page);await panel(page).getByRole('button',{name:'Review Cloud read access',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Approve browser read access',exact:true})).toBeVisible();await page.reload();await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await panel(page).getByText('Live Google',{exact:true}).click();await panel(page).getByRole('button',{name:'Approve browser read access',exact:true}).click();await expect(panel(page).getByText('Cloud read access is connected. Choose its account and source below.',{exact:true})).toBeVisible();await panel(page).getByRole('combobox',{name:'Google account',exact:true}).selectOption({label:'Browser Cloud read grant'});await panel(page).getByRole('button',{name:'Review live source',exact:true}).click();await panel(page).getByRole('button',{name:'Confirm',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Review morning schedule',exact:true})).toBeVisible();await panel(page).getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});await panel(page).getByLabel('Time zone',{exact:true}).fill('UTC');await panel(page).getByLabel('Morning',{exact:true}).fill('12:01');await panel(page).getByRole('button',{name:'Review morning schedule',exact:true}).click();await panel(page).getByRole('button',{name:'Confirm',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Review morning schedule',exact:true})).toBeVisible();await page.evaluate(async()=>localStorage.setItem('alpha.dev.app.inbox',JSON.stringify({mails:[{id:'grant-mail',subj:'Granted source result',receivedAt:Date.now(),snippet:'Read under reviewed grant'}]})));await page.clock.runFor(60000);await panel(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel(page).getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toBeVisible();await expect(panel(page).locator('article details pre')).toBeHidden();await panel(page).locator('summary[aria-label="Execution details"]').click();await expect(panel(page).locator('article details pre')).toContainText('Granted source result');
 // Give the mounted picker the native descriptor shape, with two sources on
 // distinct connection IDs of the same grant and one source on another grant.
 await page.evaluate(async()=>{
  const {HostedDigestProtocol}=await import('/src/runtime/hosted-digests.ts');
  const originalSources=HostedDigestProtocol.prototype.sources;
  const originalAccounts=HostedDigestProtocol.prototype.liveAccounts;
  const originalDelegation=HostedDigestProtocol.prototype.delegation;
  const fixture={newSource:false,holdNext:false,releaseImpact:undefined as (()=>void)|undefined,revokedGrants:[] as unknown[]};
  (window as any).removalFixture=fixture;
  HostedDigestProtocol.prototype.liveAccounts=async function(signal){
   const result=await originalAccounts.call(this,signal);
   return {accounts:result.accounts.map(account=>account.accountId.startsWith('cloud:')?{...account,accountId:account.accountId+':connection-a'}:account)};
  };
  HostedDigestProtocol.prototype.sources=async function(signal){
   const hold=fixture.holdNext;fixture.holdNext=false;
   const sources=await originalSources.call(this,signal);
   if(hold)await new Promise<void>(resolve=>{fixture.releaseImpact=resolve;});
   const selected=sources.find(source=>source.live?.provider==='google');
   const live=selected?.live;
   if(!selected||live?.provider!=='google')return sources;
   return [...sources.map(source=>source===selected?{...source,live:{...live,accountId:live.accountId+':connection-a'}}:source),
    {...selected,id:'sibling-source',label:'Same grant, second connection',live:{...live,accountId:live.accountId+':connection-b'}},
    {...selected,id:'unrelated-source',label:'Unrelated grant',live:{...live,accountId:'cloud:other-grant:connection-c'}},
    ...(fixture.newSource?[{...selected,id:'new-reviewed-fixture-source',label:'Another source added during review'}]:[]),
   ];
  };
  HostedDigestProtocol.prototype.delegation=async function(route,body,signal){
   if(route==='revoke')fixture.revokedGrants.push(body.grantId);
   return originalDelegation.call(this,route,body,signal);
  };
 });
 const liveGoogle=panel(page).getByText('Live Google',{exact:true});
 await liveGoogle.click();
 await panel(page).getByRole('button',{name:'Refresh connected accounts',exact:true}).click();
 const account=panel(page).getByRole('combobox',{name:'Google account',exact:true});
 await account.selectOption({label:'Browser Cloud read grant'});
 await expect(account).toHaveValue(/:connection-a$/);
 const reviewRemoval=panel(page).getByRole('button',{name:'Review Google access removal',exact:true});
 const removal=panel(page).getByRole('region',{name:'Remove Google access',exact:true});
 const calls=()=>page.evaluate(()=>(window as any).removalFixture.revokedGrants);
 await reviewRemoval.click();
 await expect(removal).toContainText('Browser Cloud read grant · Inbox');
 await expect(removal).toContainText('Same grant, second connection');
 await expect(removal).not.toContainText('Unrelated grant');
 await expect(removal).toContainText('Morning at 12:01 (UTC)');
 await removal.getByRole('button',{name:'Cancel removal',exact:true}).click();
 await expect(removal).toHaveCount(0);
 expect(await calls()).toEqual([]);

 await reviewRemoval.click();
 await expect(removal).toContainText('Same grant, second connection');
 const confirmRemoval=removal.getByRole('button',{name:'Confirm removal',exact:true});
 await confirmRemoval.evaluate(button=>button.addEventListener('click',()=>{
  (window as any).removalFixture.holdNext=true;
 },{capture:true,once:true}));
 await confirmRemoval.click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).removalFixture.releaseImpact)).toBe('function');
 await liveGoogle.evaluate(element=>{(element as HTMLElement).click();(element as HTMLElement).click();});
 await expect(removal).toHaveCount(0);
 await page.evaluate(()=>{(window as any).removalFixture.releaseImpact();});
 await expect(reviewRemoval).toBeEnabled();
 expect(await calls()).toEqual([]);

 await reviewRemoval.click();
 await expect(removal).toContainText('Same grant, second connection');
 await page.evaluate(()=>{(window as any).removalFixture.newSource=true;});
 await removal.getByRole('button',{name:'Confirm removal',exact:true}).click();
 await expect(panel(page).getByText('Sources or schedules changed. Review the updated list.',{exact:true})).toBeVisible();
 await expect(removal).toContainText('Another source added during review');
 const stillGranted=await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).delegation.grants[0].revoked);
 expect(stillGranted).not.toBe(true);
 await removal.getByRole('button',{name:'Confirm removal',exact:true}).click();
 await expect(panel(page).getByText('Removed',{exact:true})).toBeVisible();const state=await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))));expect(state.delegation.grants).toHaveLength(1);expect(await calls()).toEqual([state.delegation.grants[0].id]);expect(state.delegation.grants[0].revoked).toBe(true);expect(state.sources[0].revoked).toBe(true);expect(state.results).toHaveLength(1);expect(state.results[0].source.live.accountId).toBe('cloud:'+state.delegation.grants[0].id);
});
test('revocation Cloud has not confirmed disables reads and keeps the grant for retry',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {HostedDigestProtocol}=await import('/src/runtime/hosted-digests.ts'),original=HostedDigestProtocol.prototype.delegation;HostedDigestProtocol.prototype.delegation=async function(path,body,signal){const result=await original.call(this,path,body,signal);return path==='revoke'?{...result,remoteRevocation:'retry_required'}:result;};});await panel(page).getByRole('button',{name:'Review Cloud read access',exact:true}).click();await panel(page).getByRole('button',{name:'Approve browser read access',exact:true}).click();await expect(panel(page).getByText('Cloud read access is connected. Choose its account and source below.',{exact:true})).toBeVisible();await panel(page).getByRole('combobox',{name:'Google account',exact:true}).selectOption({label:'Browser Cloud read grant'});await panel(page).getByRole('button',{name:'Review Cloud read grant removal',exact:true}).click();
 const removal=panel(page).getByRole('region',{name:'Remove Google access',exact:true});
 await expect(removal).toContainText('No saved sources use this access.');
 await removal.getByRole('button',{name:'Confirm removal',exact:true}).click();
 await expect(panel(page).getByText('Cloud disconnect pending.',{exact:true})).toBeVisible();
 await expect(panel(page).getByRole('button',{name:'Review Google access removal',exact:true})).toBeEnabled();expect(await panel(page).getByRole('combobox',{name:'Google account',exact:true}).inputValue()).toMatch(/^cloud:/);
});
test('cancelling local read authorization creates no grant',async({page})=>{await setup(page);await panel(page).getByRole('button',{name:'Review Cloud read access',exact:true}).click();await panel(page).getByRole('button',{name:'Cancel authorization',exact:true}).click();await expect(panel(page).getByText('Authorization cancelled.',{exact:true})).toBeVisible();expect(await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).delegation.grants)).toEqual([]);});
test('lost completion response recovers the original grant after reload',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {HostedDigestProtocol}=await import('/src/runtime/hosted-digests.ts'),original=HostedDigestProtocol.prototype.delegation;HostedDigestProtocol.prototype.delegation=async function(path,body,signal){const result=await original.call(this,path,body,signal);if(path==='complete')throw Error('Lost completion response');return result;};});await panel(page).getByRole('button',{name:'Review Cloud read access',exact:true}).click();await panel(page).getByRole('button',{name:'Approve browser read access',exact:true}).click();await expect(panel(page).getByText('The request is saved. Retry it to recover the exact authorization.',{exact:true})).toBeVisible();const first=await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).delegation.grants);expect(first).toHaveLength(1);await page.reload();await page.evaluate(async()=>window.dispatchEvent(new Event('alpha:hosted-digests')));await panel(page).getByText('Live Google',{exact:true}).click();await expect(panel(page).getByText('Cloud read access is connected. Choose its account and source below.',{exact:true})).toBeVisible();expect(await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).delegation.grants)).toEqual(first);
});
test('expired authorization cannot grant and retired connection cannot complete a pending review',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:00Z')});await setup(page);await panel(page).getByRole('button',{name:'Review Cloud read access',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Approve browser read access',exact:true})).toBeEnabled();await page.clock.setFixedTime(new Date('2026-10-03T12:11:00Z'));await panel(page).getByRole('button',{name:'Check authorization status',exact:true}).click();await expect(panel(page).getByText('Authorization expired or was cancelled. Start a new review.',{exact:true})).toBeVisible();expect(await page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))).delegation.grants)).toEqual([]);
 const refused=await page.evaluate(async()=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts'),identity=developmentIdentity('local');const started:any=await request(identity,'/api/workflow/hosted/cloud-delegation/start',{mutationId:crypto.randomUUID(),kinds:['email'],confirmed:true});localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'remote'}));try{await request(identity,'/api/workflow/hosted/cloud-delegation/complete',{state:started.state,confirmed:true});return false;}catch{return true;}});expect(refused).toBe(true);
});
