import {installWorkflowListFixture,newWorkflow,workflowCard} from './workflow-navigation';
import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import { returnToApps } from './app-navigation';
import {test,expect as baseExpect,type Page} from '@playwright/test';
// With a second tab open on the same loaded machine, a tap's request has reached the fault layer later than
// the 5s default, so expectations wait up to 15s (as in the assistant-draft specs). What is expected is unchanged.
const expect=baseExpect.configure({timeout:15_000});
// Each test loads the development app, connects its profile and seeds a workflow (some reload or open a
// second tab). Under four workers on a loaded machine one load has taken 10-30s, past the 30s default
// for the whole test, so the timeout is explicit. No step, wait or assertion changes.
test.describe.configure({timeout:90_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
// MVP-32 interruption probes against the real typed-workflow protocol and the development agent store.
// A fault layer sits between the app's WorkflowProtocol and that store: it can lose a request before it
// arrives, lose only the response, hold a request, or answer with the agent's identity-bound refusal.
// Source/browser evidence only: no resident runtime, emulator or device is exercised here.
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
type Rule={method:'GET'|'POST';suffix:string;includes?:string;kind:'lost'|'lost-response'|'hold'|'refuse-typed'|'finished-on-cancel'|'no-record'|'legacy-status';times:number};
async function setup(page:Page){
 await page.goto('/?mode=dev&workflows=agent');await installWorkflowListFixture(page);
 await page.evaluate(async()=>{
  const {WorkflowProtocol,WorkflowHttpError}=await import('/src/runtime/workflow-protocol.ts');const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const f=(window as any).faults={calls:[] as any[],rules:[] as any[],release:null as null|(()=>void)};
  const original=c.getWorkflowClient.bind(c),wrapped=new WeakMap<object,any>();
  c.getWorkflowClient=()=>{const binding=original();if(!binding)return binding;let client=wrapped.get(binding.client);
   if(!client){const inner=binding.client as any;client=new WorkflowProtocol(async(path,body,signal)=>{
     const method=body===undefined?'GET':'POST';f.calls.push({path,method,body:body===undefined?undefined:structuredClone(body)});
     const rule=f.rules.find((r:any)=>r.method===method&&(r.includes?path.includes(r.includes):path.endsWith(r.suffix))&&r.times>0);
     if(rule){rule.times--;
      if(rule.kind==='lost')throw new TypeError('Failed to fetch');
      if(rule.kind==='lost-response'){await inner.request(path,body,signal);throw new TypeError('Failed to fetch');}
      // A wrong "no record" answer for a request the agent did admit, and an agent without submission identities.
      if(rule.kind==='no-record')return {submissionId:path.split('/').at(-1),execution:null};
      if(rule.kind==='legacy-status'){const {manualSubmissionProtocol:_,...legacy}=await inner.request(path,body,signal);return legacy;}
      if(rule.kind==='hold')await new Promise<void>(resolve=>{f.release=resolve;});
      if(rule.kind==='refuse-typed')throw new WorkflowHttpError(409,{error:'Typed workflow changed before editing',code:'WORKFLOW_TYPED_NOT_APPLIED',workflowId:decodeURIComponent(path.split('/').at(-2)!),mutationId:(body as any).mutationId,expectedVersionId:(body as any).expectedVersionId});
      if(rule.kind==='finished-on-cancel'){const id=decodeURIComponent(path.split('/').at(-2)!),current=await inner.request('/api/workflow/executions/'+encodeURIComponent(id),undefined,signal);return {execution:{...current.execution,status:'succeeded',finished:true,stoppedAt:new Date().toISOString(),output:'Finished before the cancellation arrived'}};}
     }
     return inner.request(path,body,signal);});wrapped.set(binding.client,client);}
   return {...binding,client};};
 });
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
}
const rule=(page:Page,value:Rule)=>page.evaluate(value=>{(window as any).faults.rules.push(value);},value);
const posts=(page:Page,suffix:string)=>page.evaluate(suffix=>(window as any).faults.calls.filter((call:any)=>call.method==='POST'&&call.path.endsWith(suffix)).map((call:any)=>call.body),suffix) as Promise<any[]>;
const stored=(page:Page)=>page.evaluate(async()=>{const data=await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'workflows',()=>({workflows:[],receipts:[],runs:[]})) as any;return {workflows:data.workflows||[],receipts:data.receipts||[],runs:data.runs||[]};}) as Promise<{workflows:any[];receipts:any[];runs:any[]}>;
const status=(page:Page)=>page.getByRole('status',{name:'Workflow run status',exact:true});
const runNow=(page:Page)=>page.getByRole('button',{name:'Run now',exact:true});
async function seed(page:Page,mode:'compose'|'phone'='compose'){return page.evaluate(async mode=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const {normalizePhoneSpec}=await import('/src/runtime/phone-workflow-authoring.ts');const signal=new AbortController().signal,client=c.getWorkflowClient()!.client,catalog=await client.phoneCatalog(signal);
  const spec=normalizePhoneSpec(mode==='phone'?{version:1,name:'Execution fixture',description:'Reviewed workflow',device:c.getWorkflowDeviceTarget()!,trigger:{kind:'manual'},steps:[{id:'read',kind:'Read',operation:'supplied_text',text:'pending text'},{id:'save',kind:'Write',operation:'save_note',source:'read',title:'Pending workflow note'}]}:{version:1,name:'Execution fixture',description:'Reviewed workflow',trigger:{kind:'manual'},steps:[{id:'read',kind:'Read',operation:'supplied_text',text:'alpha input'},{id:'write',kind:'Write',operation:'compose_draft',source:'read',prefix:'Before ',suffix:' after'}]});
  const validation=await client.validatePhone(spec,catalog,signal);return client.savePhone(spec,catalog,{mutationId:crypto.randomUUID(),specDigest:validation.specDigest,compilerRevision:catalog.compilerRevision},signal);},mode);}
async function openFixture(page:Page){await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await workflowCard(page,'Execution fixture').click();await expect(runNow(page)).toBeVisible();}
async function reopenFixture(page:Page){await page.getByRole('button',{name:'Back to workflows',exact:true}).click();await workflowCard(page,'Execution fixture').click();await expect(runNow(page)).toBeVisible();}

test('repeated and rapid Run taps admit exactly one run',async({page})=>{
 await setup(page);await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'hold',times:1});
 // A double-tap is the review tap plus the confirm tap. Everything after it lands while the one request is in flight.
 await runNow(page).dblclick();await expect.poll(async()=>(await posts(page,'/run')).length).toBe(1);
 await page.evaluate(()=>{for(const button of document.querySelectorAll<HTMLElement>('button[aria-label="Run now"]'))for(let i=0;i<6;i++)button.click();});
 await page.waitForTimeout(500);expect(await posts(page,'/run')).toHaveLength(1);expect((await stored(page)).runs).toHaveLength(0);
 await page.evaluate(()=>(window as any).faults.release());await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
 expect(await posts(page,'/run')).toHaveLength(1);expect((await stored(page)).runs).toHaveLength(1);
});

test('a run request that never reached the agent is reported as not run and can be sent once more under the same identity',async({page})=>{
 await setup(page);const saved=await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'lost',times:1});
 await runNow(page).click();await runNow(page).click();await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 // Before the agent is asked, the phone neither retries nor offers a resend.
 await runNow(page).click();await runNow(page).click();await expect(page.getByText('Run outcome unknown. Refresh history; automatic retry is blocked.',{exact:true}).first()).toBeVisible();expect(await posts(page,'/run')).toHaveLength(1);expect((await stored(page)).runs).toHaveLength(0);
 // Reopening reads the exact submission receipt. The agent has none, so the disposition is explicit.
 await reopenFixture(page);await expect(status(page)).toHaveText('The agent has no run for your earlier request. Run now sends that same request again');expect(await posts(page,'/run')).toHaveLength(1);
 await runNow(page).click();await expect(status(page)).toHaveText('Tap Run now again to send your earlier request once more');await expect(page.getByText(/It keeps its original identity and can start at most one run/).first()).toBeVisible();expect(await posts(page,'/run')).toHaveLength(1);
 await runNow(page).click();await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
 const sent=await posts(page,'/run');expect(sent).toHaveLength(2);expect(sent[1].submissionId).toBe(sent[0].submissionId);expect(sent[1].expectedVersionId).toBe(saved.versionId);expect((await stored(page)).runs).toHaveLength(1);
 // The lock is released: a later run is a new, separately reviewed submission.
 await page.getByRole('button',{name:'Back to Execution fixture',exact:true}).click();await expect(status(page)).toHaveText('Paused on this agent');
 await runNow(page).click();await expect(status(page)).toHaveText('Tap Run now again to confirm');await runNow(page).click();await expect.poll(async()=>(await posts(page,'/run')).length).toBe(3);
 const all=await posts(page,'/run');expect(all[2].submissionId).not.toBe(all[0].submissionId);await expect.poll(async()=>(await stored(page)).runs.length).toBe(2);
});

test('a run whose response was lost is matched to its one execution without another request, across a reload',async({page})=>{
 await setup(page);await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'lost-response',times:1});
 await runNow(page).click();await runNow(page).click();await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');expect((await stored(page)).runs).toHaveLength(1);
 // Restart between admission and the receipt reaching the phone.
 await page.reload();await setup(page);await openFixture(page);
 await expect(page.getByRole('button',{name:/succeeded execution/})).toHaveCount(1);await expect(status(page)).toHaveText('Paused on this agent');
 expect(await posts(page,'/run')).toHaveLength(0);expect((await stored(page)).runs).toHaveLength(1);
 await page.getByRole('button',{name:/succeeded execution/}).click();await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
});

test('an unaccepted run request for a workflow that has since changed is closed as not run instead of blocking forever',async({page})=>{
 await setup(page);const saved=await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'lost',times:1});
 await runNow(page).click();await runNow(page).click();await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 // The workflow is changed elsewhere (another tab or device), giving it a new version.
 await page.evaluate(async saved=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.getWorkflowClient()!.client.changeMetadata(saved.workflowId,saved.versionId,'Execution fixture','Changed elsewhere',new AbortController().signal,()=>{});},saved);
 await reopenFixture(page);await expect(page.getByText(/Your earlier run request was never accepted, and this workflow has changed since/).first()).toBeVisible();
 await expect(status(page)).toHaveText('Paused on this agent');expect(await posts(page,'/run')).toHaveLength(1);expect((await stored(page)).runs).toHaveLength(0);
 await runNow(page).click();await runNow(page).click();await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
 const sent=await posts(page,'/run');expect(sent).toHaveLength(2);expect(sent[1].submissionId).not.toBe(sent[0].submissionId);expect(sent[1].expectedVersionId).not.toBe(saved.versionId);expect((await stored(page)).runs).toHaveLength(1);
});

test('a wrong "no run" answer cannot start a second run: the confirmed resend returns the one execution already admitted',async({page})=>{
 await setup(page);const saved=await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'lost-response',times:1});
 await runNow(page).click();await runNow(page).click();await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 const first=(await stored(page)).runs;expect(first).toHaveLength(1);
 // The agent admitted the run, yet both receipt reads (on reopen and just before the resend) wrongly report none.
 await rule(page,{method:'GET',suffix:'',includes:'/submissions/',kind:'no-record',times:2});
 await reopenFixture(page);await expect(status(page)).toHaveText('The agent has no run for your earlier request. Run now sends that same request again');
 await runNow(page).click();await runNow(page).click();await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
 const sent=await posts(page,'/run');expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);expect(sent[1].expectedVersionId).toBe(saved.versionId);
 const after=(await stored(page)).runs;expect(after).toHaveLength(1);expect(after[0].id).toBe(first[0].id);
 await page.getByRole('button',{name:'Back to Execution fixture',exact:true}).click();await expect(status(page)).toHaveText('Paused on this agent');await expect(page.getByRole('button',{name:/succeeded execution/})).toHaveCount(1);
});

test('a run admitted before the workflow changed is matched to its execution, never closed as not run',async({page})=>{
 await setup(page);const saved=await seed(page);await openFixture(page);await rule(page,{method:'POST',suffix:'/run',kind:'lost-response',times:1});
 await runNow(page).click();await runNow(page).click();await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');expect((await stored(page)).runs).toHaveLength(1);
 await page.evaluate(async saved=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.getWorkflowClient()!.client.changeMetadata(saved.workflowId,saved.versionId,'Execution fixture','Changed after admission',new AbortController().signal,()=>{});},saved);
 await page.evaluate(()=>{(window as any).faults.calls.length=0;});await reopenFixture(page);
 await expect(page.getByText('Prior submission matched its exact execution receipt.',{exact:true}).first()).toBeVisible();await expect(page.getByText(/Nothing ran/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:/succeeded execution/})).toHaveCount(1);expect(await posts(page,'/run')).toHaveLength(0);expect((await stored(page)).runs).toHaveLength(1);
 // The "not run" closure rests on reading the current version before asking for the receipt: a request that
 // was still in flight at the receipt read can then no longer be admitted for the version it names.
 const order=await page.evaluate(()=>(window as any).faults.calls.filter((call:any)=>call.method==='GET').map((call:any)=>call.path as string));
 const receiptRead=order.findIndex((path:string)=>path.includes('/submissions/')),detailRead=order.findIndex((path:string)=>/\/api\/workflow\/workflows\/[a-f0-9-]+$/.test(path));
 expect(detailRead).toBeGreaterThanOrEqual(0);expect(receiptRead).toBeGreaterThan(detailRead);expect(order.slice(receiptRead+1).some((path:string)=>/\/api\/workflow\/workflows\/[a-f0-9-]+$/.test(path))).toBe(false);
});

test('an agent without submission identities never offers a resend: the request stays blocked',async({page})=>{
 await setup(page);await seed(page);await rule(page,{method:'GET',suffix:'/api/workflow/status',kind:'legacy-status',times:10000});await openFixture(page);
 await rule(page,{method:'POST',suffix:'/run',kind:'lost',times:1});await runNow(page).click();await runNow(page).click();
 await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 const sent=await posts(page,'/run');expect(sent).toHaveLength(1);expect(sent[0]).not.toHaveProperty('submissionId');
 await reopenFixture(page);await expect(status(page)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 await runNow(page).click();await runNow(page).click();await page.waitForTimeout(400);
 expect(await posts(page,'/run')).toHaveLength(1);expect((await page.evaluate(()=>(window as any).faults.calls.filter((call:any)=>call.path.includes('/submissions/')).length))).toBe(0);expect((await stored(page)).runs).toHaveLength(0);
});

test('a run request held in one tab blocks a second tab from submitting another',async({page})=>{
 await setup(page);await seed(page);await openFixture(page);
 const other=await page.context().newPage();await guardNoMedia(other.context());await setup(other);await openFixture(other);
 await rule(page,{method:'POST',suffix:'/run',kind:'hold',times:1});await runNow(page).dblclick();await expect.poll(async()=>(await posts(page,'/run')).length).toBe(1);
 // The second tab sees the retained request and refuses to add its own.
 await expect(status(other)).toHaveText('Prior run outcome unknown — inspect history; repeat submission blocked');
 await runNow(other).click();await runNow(other).click();await other.waitForTimeout(400);expect(await posts(other,'/run')).toHaveLength(0);
 await page.evaluate(()=>(window as any).faults.release());await expect(page.getByText('Before alpha input after',{exact:true})).toBeVisible();
 await expect(status(other)).toHaveText('Paused on this agent');expect((await stored(page)).runs).toHaveLength(1);await other.close();
});

test('a cancellation that loses the race to completion shows the terminal result, not a cancellation',async({page})=>{
 await setup(page);await seed(page,'phone');await openFixture(page);await runNow(page).click();await runNow(page).click();
 await expect(page.getByRole('button',{name:'Cancel execution',exact:true})).toBeVisible();await rule(page,{method:'POST',suffix:'/cancel',kind:'finished-on-cancel',times:1});
 await page.getByRole('button',{name:'Cancel execution',exact:true}).click();await page.getByRole('button',{name:'Confirm execution cancellation',exact:true}).click();
 await expect(page.getByText('Terminal execution receipt received.',{exact:true}).first()).toBeVisible();await expect(page.getByText('Finished before the cancellation arrived',{exact:true})).toBeVisible();
 await expect(page.getByText('succeeded',{exact:true}).first()).toBeVisible();await expect(page.getByText(/^cancelled$/)).toHaveCount(0);await page.getByRole('group',{name:'Workflow execution details',exact:true}).locator('summary').click();await expect(page.getByText('Terminal execution reported by agent',{exact:true})).toBeVisible();
 // A finished receipt offers no cancellation and no automatic rerun.
 await expect(page.getByRole('button',{name:'Cancel execution',exact:true})).toHaveCount(0);expect(await posts(page,'/cancel')).toHaveLength(1);expect(await posts(page,'/run')).toHaveLength(1);
});

test('a new-workflow save that never reached the agent can be sent again once and creates one workflow',async({page})=>{
 await setup(page);await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);
 await page.getByRole('textbox',{name:'Workflow name',exact:true}).fill('Recovered save');await page.getByRole('button',{name:'Add Read step',exact:true}).click();await page.getByRole('textbox',{name:'Text supplied to workflow',exact:true}).fill('Reviewed input');await page.getByRole('button',{name:'Done',exact:true}).click();
 await rule(page,{method:'POST',suffix:'/api/workflow/phone/workflows',kind:'lost',times:1});
 await page.getByRole('button',{name:'Save workflow',exact:true}).click();await expect(page.getByText(/Review this full specification/)).toBeVisible();await page.getByRole('button',{name:'Save workflow',exact:true}).click();
 const builder=page.locator('[role=status]').filter({hasText:/Save outcome unknown|agent has no record|Confirm exact resend/});
 await expect(builder).toContainText('Save outcome unknown. Refresh the exact save receipt.');await expect(page.getByRole('button',{name:'Send exact save again',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Discard local draft',exact:true})).toHaveCount(0);
 // The draft stays locked across a reload; the resend is offered only after the agent reports no record.
 await page.reload();await setup(page);await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);
 await expect(builder).toContainText('Save outcome unknown. Refresh its exact receipt; another save is blocked.');await expect(page.getByRole('button',{name:'Send exact save again',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Refresh save receipt',exact:true}).click();await expect(builder).toContainText('The agent has no record of this save, so it may never have arrived. No new request was sent.');expect(await posts(page,'/api/workflow/phone/workflows')).toHaveLength(0);
 await page.getByRole('button',{name:'Send exact save again',exact:true}).click();await expect(builder).toContainText('Tap Confirm exact resend');expect(await posts(page,'/api/workflow/phone/workflows')).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm exact resend',exact:true}).click();await expect(page.getByRole('heading',{name:'Recovered save',exact:true})).toBeVisible();await expect(runNow(page)).toBeVisible();
 const sent=await posts(page,'/api/workflow/phone/workflows');expect(sent).toHaveLength(1);const data=await stored(page);expect(data.workflows.map(row=>row.name)).toEqual(['Recovered save']);expect(data.receipts).toHaveLength(1);expect(data.receipts[0].mutationId??data.receipts[0].id??sent[0].mutationId).toBe(sent[0].mutationId);expect(data.workflows[0].active).toBe(false);
 // The local draft is gone: New workflow starts clean.
 await page.getByRole('button',{name:'Back to workflows',exact:true}).click();await newWorkflow(page);await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('New workflow');
});

test('an edit the agent refused because the workflow changed saves nothing and unlocks the draft',async({page})=>{
 await setup(page);await seed(page);await openFixture(page);await page.getByRole('button',{name:'Change',exact:true}).click();await expect(page.getByRole('button',{name:'Add Read step',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Workflow name',exact:true}).fill('Edited too late');await rule(page,{method:'POST',suffix:'/phone-spec',kind:'refuse-typed',times:1});
 await page.getByRole('button',{name:'Save workflow',exact:true}).click();await expect(page.getByLabel('Workflow save review',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save workflow',exact:true}).click();
 await expect(page.locator('[role=status]').filter({hasText:'This workflow changed on the agent before your edit was saved. Nothing was saved.'})).toBeVisible();
 // A known refusal is not an unknown outcome: no receipt to wait for, and the draft can be edited or discarded.
 await expect(page.getByRole('button',{name:'Refresh save receipt',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Send exact save again',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Discard local draft',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Edited too late');expect(await posts(page,'/phone-spec')).toHaveLength(1);
 expect((await stored(page)).workflows.map(row=>row.name)).toEqual(['Execution fixture']);
 await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Discard local draft',exact:true}).click();
 await page.getByRole('button',{name:'Change',exact:true}).click();await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Execution fixture');
});

test('a typed workflow is presented as manual-trigger only: no schedule is offered, implied or enabled',async({page})=>{
 await setup(page);await seed(page);await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();
 // Creation: the workflow entry says it runs when started; the editor's only trigger is the explicit Run.
 await page.getByRole('button',{name:'New automation',exact:true}).click();await page.getByRole('region',{name:'Add to Workflows',exact:true}).getByRole('button',{name:'More options',exact:true}).click();await expect(page.getByRole('region',{name:'Add to Workflows',exact:true}).getByRole('button',{name:/^Build step by step/})).toContainText('Runs only when you start it');
 await page.getByRole('region',{name:'Add to Workflows',exact:true}).getByRole('button',{name:/^Build step by step/}).click();await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toBeEditable();
 await expect(page.getByText('Only when you explicitly choose Run now',{exact:true})).toBeVisible();await expect(page.getByText('Build a manual workflow. It will be saved paused.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit When step',exact:true}).click();await expect(page.getByText('Run manually after reviewing the workflow',{exact:true})).toBeVisible();
 for(const trigger of ['Time trigger','Event trigger','Place trigger','Message trigger','Email trigger'])await expect(page.getByRole('button',{name:trigger,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Close step editor',exact:true}).click();
 // The stored catalog and saved definition carry a manual trigger and nothing else.
 const facts=await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const client=c.getWorkflowClient()!.client,signal=new AbortController().signal,catalog=await client.phoneCatalog(signal),flows=await client.list(signal);return {triggers:catalog.triggers.filter(row=>row.available).map(row=>row.kind),saved:flows.map(flow=>(flow.phoneSpec as any)?.trigger)};});
 expect(facts).toEqual({triggers:['manual'],saved:[{kind:'manual'}]});
 // Enabling: the confirmation names the manual trigger instead of promising scheduled runs.
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back')));await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await workflowCard(page,'Execution fixture').click();await expect(runNow(page)).toBeVisible();
 const toggle=page.getByRole('button',{name:'Turn Execution fixture on or off',exact:true});await toggle.click();
 await expect(status(page)).toHaveText('Tap the switch again to enable. Manual runs only; no schedule');await expect(page.getByText('This workflow has no schedule. It runs only when you tap Run now. Review the steps, then tap the switch again to enable it.',{exact:true}).first()).toBeVisible();
 await expect(page.getByText(/scheduled runs/)).toHaveCount(0);await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(status(page)).toHaveText('Enabled on this agent');
 // Enabled is not a schedule: nothing runs until Run now is reviewed and confirmed.
 await page.waitForTimeout(1500);expect(await posts(page,'/run')).toHaveLength(0);expect((await stored(page)).runs).toHaveLength(0);
});

test('editing while a run awaits approval leaves that run on its reviewed version and blocks removal until it is cancelled',async({page})=>{
 await setup(page);const saved=await seed(page,'phone');await openFixture(page);await runNow(page).click();await runNow(page).click();
 await expect(page.getByRole('button',{name:'Cancel execution',exact:true})).toBeVisible();await expect(page.getByText('waiting-approval',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Back to Execution fixture',exact:true}).click();
 await page.getByRole('button',{name:'Change',exact:true}).click();await expect(page.getByText('An execution of this workflow is still in progress. Changes apply to new runs only; that execution keeps the steps it started with.',{exact:true}).first()).toBeVisible();
 await page.locator('[data-alpha-subview="workflows-builder"] summary').filter({hasText:'More options'}).click();await page.getByRole('textbox',{name:'Workflow description',exact:true}).fill('Edited during a pending run');await page.getByRole('button',{name:'Save workflow',exact:true}).click();await expect(page.getByLabel('Workflow save review',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save workflow',exact:true}).click();
 await expect(page.getByText('Edited during a pending run',{exact:true})).toBeVisible();await expect(runNow(page)).toBeVisible();
 // One workflow at a new version; the waiting run is untouched and nothing new was started by the edit.
 const data=await stored(page);expect(data.workflows).toHaveLength(1);expect(data.workflows[0].versionId).not.toBe(saved.versionId);expect(data.runs.map(run=>[run.workflowVersionId,run.finished])).toEqual([[saved.versionId,false]]);expect(await posts(page,'/run')).toHaveLength(1);
 await page.getByRole('button',{name:'waiting-approval execution',exact:true}).click();await page.locator('.workflow-run-details[aria-label="Workflow execution details"] > summary').click();await expect(page.getByText('This execution uses an earlier version of the workflow. Later changes do not apply to it.',{exact:true})).toBeVisible();await expect(page.getByText(saved.versionId,{exact:true})).toBeVisible();
 // Removal is refused while it is unfinished; the explicit disposition is cancelling that exact run.
 await page.getByRole('button',{name:'Back to Execution fixture',exact:true}).click();await page.getByRole('button',{name:'Remove workflow',exact:true}).click();
 await expect(page.getByText('Open each ongoing execution below and cancel it explicitly before removing this workflow.',{exact:true}).first()).toBeVisible();expect(await posts(page,'/lifecycle')).toHaveLength(0);
 await page.getByRole('button',{name:'waiting-approval execution',exact:true}).click();await page.getByRole('button',{name:'Cancel execution',exact:true}).click();await page.getByRole('button',{name:'Confirm execution cancellation',exact:true}).click();
 await expect.poll(async()=>(await stored(page)).runs.map(run=>run.finished)).toEqual([true]);
 const notes=await page.evaluate(async()=>(await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.read())?.raw||'');expect(notes).not.toContain('Pending workflow note');
 await page.getByRole('button',{name:'Back to Execution fixture',exact:true}).click();await page.getByRole('button',{name:'Remove workflow',exact:true}).click();
 await expect(page.getByText('Remove workflow; keep execution history. Future runs are blocked. This does not undo completed effects.',{exact:true})).toBeVisible();expect(await posts(page,'/run')).toHaveLength(1);
});

test('assistant suggestion chips never offer a scheduled workflow',async({page})=>{
 // The reference model still carries the design prototype's "Every weekday at 6, …" chip text. The connected
 // product replaces every chip list, on Home and inside Workflows, with operations that exist.
 await setup(page);
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const values=Component.prototype.renderVals,seen=(window as any).chipLists={} as Record<string,string[]>;Component.prototype.renderVals=function(){const out=values.call(this);seen[this.S().view||'home']=(out.sugg||[]).map((chip:any)=>String(chip.label));return out;};});
 await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back')));await returnToApps(page);
 const lists=await page.evaluate(()=>(window as any).chipLists as Record<string,string[]>);
 expect(Object.keys(lists)).toEqual(expect.arrayContaining(['home','workflows']));
 for(const [view,chips] of Object.entries(lists)){expect(chips.length,view).toBeGreaterThan(0);for(const chip of chips)expect(chip,view).not.toMatch(/every\s+(week)?day|weekdays|every\s+(morning|evening|week|hour)|daily|schedul|automat|recurring/i);}
 expect(lists.workflows).toEqual(['Create a note','Set a reminder','Open Calendar']);expect(lists.home).toEqual(['Create a note','Set a reminder','Open Calendar']);
});
