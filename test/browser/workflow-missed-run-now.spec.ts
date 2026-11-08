import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
// P-10 (#394): a typed workflow's scheduled time that passed while the agent was not running is
// recorded once as missed by the agent and never replayed. Its receipt says nothing ran and offers
// an explicit Run now, which returns to the workflow's own reviewed run confirmation and starts one
// new run. A synthetic agent in the page answers workflow routes; every request is recorded.
type FixtureOptions={kind?:'typed'|'generic'|'hosted';occurrence?:'missed'|'overlap'};
async function setup(page:Page,options:FixtureOptions={}){
 await page.goto('/?mode=dev&workflows=agent');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(async(options:FixtureOptions)=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const trigger={kind:'time',localTime:'07:30',timeZone:'UTC',days:[3]};
  const spec=JSON.stringify({version:1,name:'Morning',description:'',trigger,steps:[{id:'s0',kind:'Read',operation:'supplied_text',text:'Synthetic source text'},{id:'s1',kind:'Write',operation:'model_draft',source:'s0',instruction:'Draft a short digest'}]});
  const metadata=options.kind==='hosted'?{elizaPhoneWorkflowSpec:spec,elizaHostedDigestV1:'{}'}:options.kind==='generic'?{}:{elizaPhoneWorkflowSpec:spec};
  const flows:any={morning:{id:'morning',name:'Morning notes digest',description:'Reads selected notes and drafts a digest',active:true,versionId:'morning-v1',steps:[{label:'Read selected Notes'},{label:'Draft digest'}],metadata}};
  const scheduledAt='2026-10-28T07:30:00.000Z';
  const missed={id:'run-missed',workflowId:'morning',workflowVersionId:'morning-v1',status:'finished',startedAt:'2026-10-28T09:00:00Z',finished:true,stoppedAt:'2026-10-28T09:00:00Z',mode:'trigger',...((options.occurrence??'missed')==='missed'?{missedOccurrenceAt:scheduledAt}:{}),input:options.kind==='generic'||options.kind==='hosted'?{}:{typedSchedule:{scheduledAt,trigger,status:'ready',text:''}},output:{status:options.occurrence??'missed',scheduledAt,text:'Not run: synthetic scheduled occurrence'},events:[]};
  // The agent's workflow service writes missedOccurrenceAt when it records a missed occurrence; a generic
  // schedule's output alone never makes a run missed (see scripts/test-workflow-protocol.mjs, forged case).
  const runs:any={morning:[missed]};
  const w=window as any;w.agentRequests=[];
  const request=async(path:string,body:any)=>{
   w.agentRequests.push({path,method:body===undefined?'GET':'POST',body});
   if(path==='/api/automations')return {automations:Object.values(flows).map((flow:any)=>({id:'workflow:'+flow.id,type:'workflow',workflowId:flow.id,title:flow.name,description:flow.description,enabled:flow.active,status:flow.active?'active':'paused',schedules:[]}))};
   if(path==='/api/lifeops/reminders')return {reminders:[]};
   if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')return {tasks:[]};
   if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready',manualSubmissionProtocol:1,lifecycleMutationProtocol:1,typedScheduleProtocol:1};
   if(path==='/api/workflow/workflows')return {workflows:Object.values(flows)};
   let m=/^\/api\/workflow\/workflows\/([^/]+)(\/.*)?$/.exec(path);
   if(m){const flow=flows[m[1]],rest=m[2]||'';if(!flow)throw Error('unknown flow');
    if(rest==='')return flow;
    if(rest==='/executions')return {executions:runs[flow.id]};
    if(rest==='/run'){const run={id:'run-new-'+runs[flow.id].length,workflowId:flow.id,workflowVersionId:flow.versionId,status:'finished',startedAt:'2026-10-28T09:05:00Z',finished:true,stoppedAt:'2026-10-28T09:05:05Z',output:'Synthetic digest text',events:[]};runs[flow.id].unshift(run);return {submissionId:body.submissionId,execution:run};}
   }
   m=/^\/api\/workflow\/executions\/([^/]+)$/.exec(path);
   if(m){const run=(Object.values(runs).flat() as any[]).find(r=>r.id===m![1]);if(!run)throw Error('unknown run');return {execution:run};}
   throw Error('Unexpected synthetic route '+path);
  };
  const client=new WorkflowProtocol((path,body)=>request(path,body));const original=c.getWorkflowClient.bind(c);
  c.getWorkflowClient=()=>{const binding=original();return binding?{...binding,client}:binding;};
  const automations=c.getAutomationsClient.bind(c);c.getAutomationsClient=()=>{const binding=automations();return binding?{...binding,request:async(path,method)=>{if(method!=='GET')throw Error('Unexpected automation mutation');return request(path,undefined);}}:binding;};
 },options);
 await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();
}
const posts=(page:Page,suffix:string)=>page.evaluate(suffix=>(window as any).agentRequests.filter((r:any)=>r.method==='POST'&&r.path.endsWith(suffix)).length,suffix);

test('a missed scheduled time says nothing ran and offers Run now only through the reviewed run confirmation',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Morning notes digest',{exact:true}).first().click();
 await page.getByRole('button',{name:'Missed — did not run execution',exact:true}).click();await page.getByText('Execution details',{exact:true}).click();
 await expect(page.getByText(/nothing ran at this scheduled time: the phone or agent was off, or Android delayed the run past its start window\. It is never run later/)).toBeVisible();
 await page.waitForTimeout(500);expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Back to workflow to review and start one new run now',exact:true}).click();
 await expect(page.getByText(/Review the steps, then tap Run now again to start this workflow once/).first()).toBeVisible();expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Run now',exact:true}).click();await expect.poll(()=>posts(page,'/run')).toBe(1);
 const sent=await page.evaluate(()=>(window as any).agentRequests.find((r:any)=>r.path.endsWith('/run')).body);expect(sent.expectedVersionId).toBe('morning-v1');
 await expect(page.getByText('Synthetic digest text',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to Morning notes digest',exact:true}).click();
 // The missed record stays in history as not run; the new run is separate.
 await expect(page.getByRole('button',{name:'Missed — did not run execution',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'finished execution',exact:true})).toBeVisible();expect(await posts(page,'/run')).toBe(1);
});


test('a missed-run action starts a fresh confirmation even after Run now was already armed',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Morning notes digest',{exact:true}).first().click();
 // Arm an ordinary run, then choose to inspect the missed occurrence instead.
 await page.getByRole('button',{name:'Run now',exact:true}).click();
 await expect(page.getByText(/Review the steps, then tap Run now again to start this workflow once/).first()).toBeVisible();
 expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Missed — did not run execution',exact:true}).click();
 await page.getByRole('button',{name:'Back to workflow to review and start one new run now',exact:true}).click();
 await expect(page.getByText(/Review the steps, then tap Run now again to start this workflow once/).first()).toBeVisible();
 // Merely leaving the receipt must not reuse the earlier confirmation or submit anything.
 expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Run now',exact:true}).click();
 await expect.poll(()=>posts(page,'/run')).toBe(1);
});

for(const fixture of [
 {kind:'hosted',occurrence:'missed'},
 {kind:'generic',occurrence:'missed'},
 {kind:'typed',occurrence:'overlap'},
] as const)test(`${fixture.kind} ${fixture.occurrence} receipt does not offer the typed missed-run action`,async({page})=>{
 await setup(page,fixture);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Morning notes digest',{exact:true}).first().click();
 const label=fixture.occurrence==='overlap'?'Skipped — an earlier run was still active execution':'Missed — did not run execution';
 await page.getByRole('button',{name:label,exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to workflow',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Back to workflow to review and start one new run now',exact:true})).toHaveCount(0);
 if(fixture.occurrence==='missed'){await page.getByText('Execution details',{exact:true}).click();await expect(page.getByText(/nothing ran at this scheduled time: .* It is never run later\./)).toBeVisible();await expect(page.getByText(/Use Run now to start it once/)).toHaveCount(0);}
 if(fixture.kind==='hosted')await expect(page.getByText(/This digest runs again only at its next scheduled occurrence/)).toBeVisible();
 expect(await posts(page,'/run')).toBe(0);
});
