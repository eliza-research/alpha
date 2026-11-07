import {test,expect,type Page} from '@playwright/test';
const selection='alpha.connection.selection.v1',service='alpha.connection.cloud-service.v1';
test.beforeEach(async({context})=>context.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}))));
// Disclosed identity boundary fixture: no provider request or credential collection.
async function identity(page:Page,held=false){await page.evaluate(held=>{
 const w=window as any;
 // Keep the fixture's async setup rooted while CDP awaits its promise.
 w.preferenceFixtureSetup=(async()=>{
 const {CloudProtocol}=await import('/src/runtime/cloud-protocol.ts');
 // Personal setup is development-only hosted-agent code (#406) and lives on the development subclass.
 const {DevelopmentCloudAgentProtocol}=await import('/src/runtime/development-cloud-agents.ts');
 const {cloudCredentialStore}=await import('/src/runtime/native-connection.ts');
 const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
 w.preferenceFixture={calls:0};
 cloudCredentialStore.read=async()=>({credentialId:'fixture-generation',token:'synthetic-noncredential'});
 CloudProtocol.prototype.identity=async function(signal:AbortSignal){w.preferenceFixture.calls++;w.preferenceFixture.signal=signal;if(held)await new Promise<void>(resolve=>w.preferenceFixture.release=resolve);return {userId:'fixture-owner'};};
 DevelopmentCloudAgentProtocol.prototype.personal=async()=>{throw Error('Fixture does not authorize personal setup');};
 w.preferenceFixture.pending=c.cloudList('production');
 })();
 return w.preferenceFixtureSetup;
},held);}
for(const changed of ['selection','service','clear'] as const)test(`normal browser ${changed} change cancels delayed identity without adopting it`,async({page,context})=>{
 await page.goto('/');const other=await context.newPage();await other.goto('/');await identity(page,true);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).preferenceFixture.release)).toBe('function');
 await other.evaluate(({changed,selection,service})=>{if(changed==='clear')localStorage.clear();else localStorage.setItem(changed==='selection'?selection:service,changed==='selection'?JSON.stringify({kind:'none'}):'staging');},{changed,selection,service});
 await expect.poll(()=>page.evaluate(()=>(window as any).preferenceFixture.signal.aborted)).toBe(true);
 expect(await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const f=(window as any).preferenceFixture;f.release();await f.pending;return {account:c.getCloudClient(),busy:c.getSnapshot().busy,open:c.getSnapshot().open,calls:f.calls};})).toEqual({account:null,busy:false,open:false,calls:1});
 expect(await page.evaluate(service=>localStorage.getItem(service),service)).toBe(changed==='service'?'staging':null);
});
for(const changed of ['service','offline','target'] as const)test(`normal browser ${changed} preference respects independent Cloud service ownership`,async({page,context})=>{
 await page.goto('/');const other=await context.newPage();await other.goto('/');await identity(page);
 await page.evaluate(async()=>{await(window as any).preferenceFixture.pending;});
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getCloudEnvironment())).toBe('production');
 await other.evaluate(({changed,selection,service})=>localStorage.setItem(changed==='service'?service:selection,changed==='service'?'staging':JSON.stringify({kind:changed==='offline'?'offline':'none'})),{changed,selection,service});
 // Offline was also the initial saved target; create a distinct prior preference
 // so the explicit offline choice emits a real storage event.
 if(changed==='offline')await other.evaluate(selection=>{localStorage.setItem(selection,JSON.stringify({kind:'none'}));localStorage.setItem(selection,JSON.stringify({kind:'offline'}));},selection);
 if(changed==='target')await expect(page.getByRole('dialog',{name:'Agent',exact:true})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getCloudEnvironment())).toBe(changed==='target'?'production':null);
 expect(await page.evaluate(()=>(window as any).preferenceFixture.calls)).toBe(1);
});
