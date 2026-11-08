import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
// A synthetic agent in the page answers workflow routes. Interrupted runs carry upstream
// plugin-workflow `reconciliation: {state:'outcome-unknown'}`; every request is recorded.
async function setup(page:Page){
 await page.goto('/?mode=dev&workflows=agent');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(async()=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const spec=(operations:string[])=>JSON.stringify({version:1,name:'x',description:'',trigger:{kind:'manual'},steps:operations.map((operation,i)=>({id:'s'+i,kind:i?'Write':'Read',operation}))});
  const flows:any={
   digest:{id:'digest',name:'Morning notes digest',description:'Reads selected notes and drafts a digest',active:false,versionId:'digest-v1',steps:[{label:'Read selected Notes'},{label:'Draft digest'}],metadata:{elizaPhoneWorkflowSpec:spec(['selected_notes','model_draft'])}},
   effect:{id:'effect',name:'Save agenda note',description:'Drafts and saves a note',active:false,versionId:'effect-v1',steps:[{label:'Read selected Notes'},{label:'Save a note'}],metadata:{elizaPhoneWorkflowSpec:spec(['selected_notes','save_note'])}},
   hosted:{id:'hosted',name:'Scheduled hosted digest',description:'Agent schedule',active:true,versionId:'hosted-v1',steps:[{label:'Digest'}],metadata:{elizaHostedDigestV1:'{}'}},
  };
  const interrupted=(id:string,workflowId:string,versionId:string)=>({id,workflowId,workflowVersionId:versionId,status:'running',startedAt:'2026-10-04T07:00:00Z',finished:false,stoppedAt:null,error:{message:'Workflow worker exited before reporting a result; outcome unknown'},reconciliation:{state:'outcome-unknown',message:'Workflow worker exited before reporting a result; outcome unknown'},events:[]});
  const runs:any={digest:[interrupted('run-digest','digest','digest-v1')],effect:[interrupted('run-effect','effect','effect-v1')],hosted:[interrupted('run-hosted','hosted','hosted-v1')]};
  const w=window as any;w.agentRequests=[];
  const request=async(path:string,body:any)=>{
   w.agentRequests.push({path,method:body===undefined?'GET':'POST',body});
   if(path==='/api/automations')return {automations:Object.values(flows).filter((flow:any)=>!flow.removed).map((flow:any)=>({id:'workflow:'+flow.id,type:'workflow',workflowId:flow.id,title:flow.name,description:flow.description,enabled:flow.active,status:flow.active?'active':'paused',schedules:[]}))};
   if(path==='/api/lifeops/reminders')return {reminders:[]};
   if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')return {tasks:[]};
   if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready',manualSubmissionProtocol:1,lifecycleMutationProtocol:1};
   if(path==='/api/workflow/workflows')return {workflows:Object.values(flows)};
   let m=/^\/api\/workflow\/workflows\/([^/]+)(\/.*)?$/.exec(path);
   if(m){const flow=flows[m[1]],rest=m[2]||'';if(!flow)throw Error('unknown flow');
    if(rest==='')return flow;
    if(rest==='/executions')return {executions:runs[flow.id]};
    if(rest==='/run'){const run={id:'run-new-'+runs[flow.id].length,workflowId:flow.id,workflowVersionId:flow.versionId,status:'finished',startedAt:'2026-10-04T08:00:00Z',finished:true,stoppedAt:'2026-10-04T08:00:05Z',output:'Synthetic digest text',events:[]};runs[flow.id].unshift(run);return {submissionId:body.submissionId,execution:run};}
    if(rest==='/lifecycle'){flows[flow.id]={...flow,removed:true,triggerCleanup:'pending',versionId:flow.versionId+'-removed'};return {mutationId:body.mutationId,receipt:{workflowId:flow.id,previousVersionId:flow.versionId,versionId:flow.versionId+'-removed',mutationId:body.mutationId,operation:body.operation,appliedAt:'2026-10-04T08:10:00Z'}};}
   }
   m=/^\/api\/workflow\/executions\/([^/]+)(\/cancel)?$/.exec(path);
   if(m){const all=Object.values(runs).flat() as any[],index=all.findIndex(r=>r.id===m![1]);if(index<0)throw Error('unknown run');let run=all[index];
    if(m[2]){run=Object.assign(run,{status:'cancelled',finished:true,stoppedAt:'2026-10-04T08:05:00Z'});}
    return {execution:run};}
   throw Error('Unexpected synthetic route '+path);
  };
  const client=new WorkflowProtocol((path,body)=>request(path,body));const original=c.getWorkflowClient.bind(c);
  c.getWorkflowClient=()=>{const binding=original();return binding?{...binding,client}:binding;};
  const automations=c.getAutomationsClient.bind(c);c.getAutomationsClient=()=>{const binding=automations();return binding?{...binding,request:async(path,method)=>{if(method!=='GET')throw Error('Unexpected automation mutation');return request(path,undefined);}}:binding;};
 });
 await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();
}
const posts=(page:Page,suffix:string)=>page.evaluate(suffix=>(window as any).agentRequests.filter((r:any)=>r.method==='POST'&&r.path.endsWith(suffix)).length,suffix);
const status=(page:Page)=>page.getByRole('status',{name:'Workflow run status',exact:true});

test('side-effecting workflow: interrupted run is shown as outcome unknown, never replayed, and blocks new runs until cancelled',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Save agenda note',{exact:true}).first().click();
 await expect(status(page)).toHaveText('An earlier run was interrupted — outcome unknown. New runs stay blocked until you cancel it');
 const history=page.getByRole('button',{name:'Interrupted — outcome unknown execution',exact:true});await expect(history).toBeVisible();
 await page.getByRole('button',{name:'Run now',exact:true}).click();await page.getByRole('button',{name:'Run now',exact:true}).click();
 await expect(page.getByText(/An interrupted run of this workflow has an unknown outcome/).first()).toBeVisible();expect(await posts(page,'/run')).toBe(0);
 await history.click();await page.getByText('Execution details',{exact:true}).click();await expect(page.getByText('Interrupted — outcome unknown',{exact:true}).first()).toBeVisible();await expect(page.getByText(/The agent did not replay it and this phone will not retry it/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Run this read-only workflow again as a new run'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel execution',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Refresh execution receipt',exact:true}).click();await page.waitForTimeout(1000);await expect(page.getByText('Interrupted — outcome unknown',{exact:true}).first()).toBeVisible();
 expect(await posts(page,'/run')).toBe(0);expect(await posts(page,'/cancel')).toBe(0);
 await page.getByRole('button',{name:'Back to Save agenda note',exact:true}).click();
 // Removal: upstream refuses while the run is unfinished, so the explicit acknowledgement is a confirmed cancellation.
 await page.getByRole('button',{name:'Remove workflow',exact:true}).click();await expect(page.getByText(/1 interrupted run has an unknown outcome\. The agent keeps this workflow until each is explicitly cancelled/)).toBeVisible();expect(await posts(page,'/cancel')).toBe(0);
 await page.getByRole('button',{name:'Cancel interrupted runs',exact:true}).click();await expect.poll(()=>posts(page,'/cancel')).toBe(1);await expect(page.getByText(/Interrupted runs cancelled; their earlier outcome remains unknown/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'cancelled · after an interrupted, unknown outcome execution',exact:true})).toBeVisible();expect(await posts(page,'/lifecycle')).toBe(0);
 await page.getByRole('button',{name:'Remove workflow',exact:true}).click();await expect(page.getByText('Remove workflow; keep execution history. Future runs are blocked. This does not undo completed effects.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remove workflow; keep execution history',exact:true}).click();await expect.poll(()=>posts(page,'/lifecycle')).toBe(1);expect(await posts(page,'/run')).toBe(0);
});

test('read-only digest: Run again is explicit, confirmed and creates a new run ID without replaying the interrupted one',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Morning notes digest',{exact:true}).first().click();
 await expect(status(page)).toHaveText('An earlier run was interrupted — outcome unknown. Open it to run these read-only steps again');
 await page.getByRole('button',{name:'Interrupted — outcome unknown execution',exact:true}).click();await page.getByText('Execution details',{exact:true}).click();await expect(page.getByText(/The agent did not replay it/)).toBeVisible();
 await page.waitForTimeout(1000);expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Run this read-only workflow again as a new run',exact:true}).click();await expect(page.getByText(/Run again starts a new, separate run of these read-only steps/).first()).toBeVisible();expect(await posts(page,'/run')).toBe(0);
 await page.getByRole('button',{name:'Confirm new run of this read-only workflow',exact:true}).click();await expect.poll(()=>posts(page,'/run')).toBe(1);
 await expect(page.getByText('Synthetic digest text',{exact:true})).toBeVisible();
 const sent=await page.evaluate(()=>(window as any).agentRequests.find((r:any)=>r.path.endsWith('/run')).body);expect(sent.expectedVersionId).toBe('digest-v1');expect(sent.submissionId).toMatch(/^[0-9a-f-]{36}$/);
 await page.getByRole('button',{name:'Back to Morning notes digest',exact:true}).click();
 await expect(page.getByRole('button',{name:'finished execution',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Interrupted — outcome unknown execution',exact:true})).toBeVisible();
 expect(await posts(page,'/cancel')).toBe(0);expect(await posts(page,'/run')).toBe(1);
});

test('hosted digest: interrupted occurrence is not replayable from the phone',async({page})=>{
 await setup(page);await page.getByRole('region',{name:'Workflows',exact:true}).getByText('Scheduled hosted digest',{exact:true}).first().click();await page.getByRole('button',{name:'Interrupted — outcome unknown execution',exact:true}).click();
 await expect(page.getByRole('button',{name:'Run this read-only workflow again as a new run',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel execution',exact:true})).toBeVisible();expect(await posts(page,'/run')).toBe(0);
});
