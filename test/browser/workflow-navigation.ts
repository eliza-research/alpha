import {expect,type Page} from '@playwright/test';

/** Closed canonical read projection over the existing development workflow store.
 * Typed edits/runs/phone reviews still use the real WorkflowProtocol and its receipts. */
export async function installWorkflowListFixture(page:Page){await page.evaluate(async()=>{
 const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
 const original=c.getAutomationsClient.bind(c);(window as any).workflowMetadataFixtureCalls=[];
 c.getAutomationsClient=()=>{
  const admitted=original(),workflow=c.getWorkflowClient();
  if(!admitted||!workflow||admitted.sessionId!==workflow.sessionId)return null;
  return {...admitted,request:async(path,method,body,signal)=>{
   (window as any).workflowMetadataFixtureCalls.push({path,method});signal.throwIfAborted();
   // Typed lifecycle requests use the same development protocol and receipts as the editor.
   if(path.startsWith('/api/workflow/'))return (workflow.client as any).request(path,body,signal);
   if(method!=='GET'||body!==undefined)throw Error('This fixture supplies read-only automation metadata.');
   if(path==='/api/triggers?removed=1')return {recovery:true,triggers:[]};
   const current=()=>{signal.throwIfAborted();if(c.getWorkflowClient()?.sessionId!==workflow.sessionId)throw new DOMException('Workflow fixture owner changed','AbortError');};
   current();let result;
   if(path==='/api/automations'){
    const rows=await workflow.client.list(signal);current();
    result={automations:rows.filter(row=>!row.removed).map(row=>({id:'workflow:'+row.id,type:'workflow',workflowId:row.id,title:row.name,description:row.description,enabled:row.active,status:row.active?'active':'paused',schedules:[]}))};
   }else if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')result={tasks:[]};
   else if(path==='/api/lifeops/reminders')result={reminders:[]};
   else if(path==='/api/lifeops/definitions')result={definitions:[]};
   else throw Error('Unexpected fixture metadata route: '+path);
   current();return result;
  }};
 };
});}
export const workflowCard=(page:Page,title:string)=>page.locator('[data-alpha-subview="workflows-list"]').getByRole('button').filter({has:page.getByText(title,{exact:true})});
/** Retained authoring contracts remain testable after their creation shortcuts were removed. */
export async function retainedWorkflowAction(page:Page,kind:'createWorkflow'|'describe'|'discard'|'description',text=''){
 await page.evaluate(({kind,text})=>{
  const root=document.getElementById('root') as any;
  const key=Object.keys(root).find(name=>name.startsWith('__reactContainer$'));
  if(!key)throw Error('Phone shell is unavailable');
  const pending=[root[key]];
  while(pending.length){
   const fiber=pending.pop(),shell=fiber?.stateNode;
   if(typeof shell?.renderVals==='function'&&shell.S?.().view==='workflows'){
    const view=shell.renderVals().workflows;
    const action=kind==='createWorkflow'?(view.automation?.createWorkflow??view.newFlow):view.b?.[kind==='description'?'onDescription':kind];
    if(typeof action!=='function')throw Error('Retained workflow action is unavailable');
    if(kind==='description')action({target:{value:text}});else action();
    return;
   }
   if(fiber?.sibling)pending.push(fiber.sibling);
   if(fiber?.child)pending.push(fiber.child);
  }
  throw Error('Open Workflows first');
 },{kind,text});
}
export async function newWorkflow(page:Page){
 await page.getByRole('button',{name:'New automation',exact:true}).click();
 await expect(page.getByRole('region',{name:'Add to Workflows',exact:true})).toBeVisible();
 await retainedWorkflowAction(page,'createWorkflow');
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toBeEditable();
}
export async function describeWorkflow(page:Page){
 await retainedWorkflowAction(page,'describe');
}
