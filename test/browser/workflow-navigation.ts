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
   (window as any).workflowMetadataFixtureCalls.push({path,method});signal.throwIfAborted();if(method!=='GET'||body!==undefined)throw Error('This fixture supplies read-only automation metadata.');
   const current=()=>{signal.throwIfAborted();if(c.getWorkflowClient()?.sessionId!==workflow.sessionId)throw new DOMException('Workflow fixture owner changed','AbortError');};
   current();let result;
   if(path==='/api/automations'){
    const rows=await workflow.client.list(signal);current();
    result={automations:rows.filter(row=>!row.removed).map(row=>({id:'workflow:'+row.id,type:'workflow',workflowId:row.id,title:row.name,description:row.description,enabled:row.active,status:row.active?'active':'paused',schedules:[]}))};
   }else if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')result={tasks:[]};
   else if(path==='/api/lifeops/reminders')result={reminders:[]};
   else throw Error('Unexpected fixture metadata route: '+path);
   current();return result;
  }};
 };
});}
export const workflowCard=(page:Page,title:string)=>page.locator('[data-alpha-subview="workflows-list"]').getByRole('button').filter({has:page.getByText(title,{exact:true})});
export async function newWorkflow(page:Page){
 await page.getByRole('button',{name:'New automation',exact:true}).click();
 const choices=page.getByRole('region',{name:'Add to Workflows',exact:true});
 await choices.getByRole('button',{name:'More options',exact:true}).click();
 await choices.getByRole('button',{name:/^Build step by step/}).click();
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toBeEditable();
}
