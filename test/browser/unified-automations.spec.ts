import {test,expect,type Page} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
import {returnToApps} from './app-navigation';

async function filterType(page:Page,type:string){await page.getByRole('button',{name:'Filter workflows',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Filter workflows',exact:true});await dialog.getByRole('radio',{name:type,exact:true}).click();await dialog.getByRole('button',{name:'Show workflows',exact:true}).click();}

/** Fresh browser context and synthetic canonical API only. No provider or native effects. */
async function setup(page:Page){
 const calls:Array<{path:string;method:string;body:any}>=[];
 const trigger={id:'prompt',displayName:'Document review',instructions:'Review the supplied text only.',enabled:false,triggerType:'cron',cronExpression:'0 9 * * 1',timezone:'UTC'};
 const flow={id:'flow',name:'Reviewed workflow',description:'Existing typed workflow',active:false,versionId:'version',steps:[]};
 let created:any=null;
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.route('**/__unified_api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace('/__unified_api','')+new URL(request.url()).search,method=request.method(),body=request.postDataJSON();calls.push({path,method,body});
  let result:any={};
  if(path==='/api/automations')result={automations:[{id:'workflow:flow',type:'workflow',title:flow.name,description:flow.description,status:'paused',enabled:false,workflowId:'flow',schedules:[]},...[trigger,...(created?[created]:[])].map(row=>({id:'trigger:'+row.id,type:'coordinator_text',title:row.displayName,description:row.instructions,status:row.enabled?'active':'paused',enabled:row.enabled,triggerId:row.id,schedules:[row]}))]};
  else if(path==='/api/lifeops/scheduled-tasks?ownerVisibleOnly=1')result={tasks:[{taskId:'weekly',kind:'recap',promptInstructions:'Run only when requested.',trigger:{kind:'manual'},state:{status:'scheduled'},source:'default_pack',ownerVisible:true,metadata:{recordKey:'weekly-review'}}]};
  else if(path==='/api/lifeops/reminders')result={reminders:[{definition:{id:'reminder',title:'Check the draft',description:'',status:'active',timezone:'UTC',cadence:{kind:'once',dueAt:'2026-12-01T10:00:00Z'}},occurrence:{id:'occurrence'}}]};
  else if(path==='/api/triggers'&&method==='POST'){created={id:'created',...body};result={trigger:created};}
  else if(path==='/api/triggers/prompt'&&method==='PUT'){Object.assign(trigger,body);result={trigger};}
  else if(path==='/api/triggers/prompt')result={trigger};
  else if(path.endsWith('/runs'))result={runs:[]};
  else if(path==='/api/workflow/status')result={engine:'smthrs',status:'ready',manualSubmissionProtocol:1,metadataMutationProtocol:1,lifecycleMutationProtocol:1};
  else if(path==='/api/workflow/workflows')result={workflows:[flow]};
  else if(path==='/api/workflow/removed-workflows')result={workflows:[]};
  else if(path==='/api/workflow/workflows/flow/executions')result={executions:[]};
  else if(path==='/api/workflow/workflows/flow')result=flow;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/?mode=dev&workflows=agent');await openBrowserCalendar(page);await returnToApps(page);
 await page.evaluate(async()=>{
  const {connectionController:connection}=await import('/src/runtime/connection-ui.tsx');
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');
  const session={sessionId:'synthetic-session',ownerId:'synthetic-owner',origin:'https://synthetic.invalid',agentId:'synthetic-agent'};
  const snapshot={...connection.getSnapshot(),session,open:false};
  const request=async(path:string,method:string,body:unknown,signal:AbortSignal)=>{const response=await fetch('/__unified_api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-owner'},body:body===undefined?undefined:JSON.stringify(body),signal});if(!response.ok)throw Object.assign(Error('Synthetic response failed'),{status:response.status});return response.json();};
  connection.getSnapshot=()=>snapshot;
  connection.getAutomationsClient=()=>({sessionId:session.sessionId,request});
  connection.getWorkflowClient=()=>({sessionId:session.sessionId,client:new WorkflowProtocol((path,body,signal)=>request(path,body===undefined?'GET':'POST',body,signal))});
 });
 await page.getByRole('button',{name:'Workflows',exact:true}).click();
 await expect(page.locator('[data-alpha-layer=app]').getByText('Document review',{exact:true})).toBeVisible();
 await expect(page.locator('[data-alpha-layer=app]')).toHaveCSS('opacity','1');
 return calls;
}

test('Alpha unified list, filters, paused authoring and explicit owner review use canonical contracts',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const calls=await setup(page);
 await expect(page.locator('[data-alpha-layer=app]').getByText('Check the draft',{exact:true})).toBeVisible();await expect(page.locator('[data-alpha-layer=app]').getByText('Weekly review',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('unified-mobile.png')});
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:testInfo.outputPath('unified-desktop.png')});await page.setViewportSize({width:390,height:844});
 await filterType(page,'Schedules');await expect(page.locator('[data-alpha-layer=app]').getByText('Weekly review',{exact:true})).toBeVisible();await expect(page.locator('[data-alpha-layer=app]').getByText('Document review',{exact:true})).toBeHidden();
 await filterType(page,'Reminders');await expect(page.locator('[data-alpha-layer=app]').getByText('Check the draft',{exact:true})).toBeVisible();await expect(page.locator('[data-alpha-layer=app]').getByText('Weekly review',{exact:true})).toBeHidden();
 await filterType(page,'All types');await page.getByRole('button',{name:'New automation',exact:true}).click();await page.getByRole('button',{name:/^Automation/,exact:false}).click();
 await page.getByLabel('What should Alpha do?',{exact:true}).fill('Use only text explicitly supplied in this prompt.');await page.getByRole('button',{name:'More options',exact:true}).click();await page.getByLabel('Name (optional)',{exact:true}).fill('Paused source review');
 await page.screenshot({path:testInfo.outputPath('prompt-editor.png')});await page.getByRole('button',{name:'Save automation',exact:true}).click();await expect(page.locator('[data-alpha-layer=app]').getByText('Paused source review',{exact:true})).toBeVisible();
 const created=calls.find(call=>call.path==='/api/triggers'&&call.method==='POST');expect(created?.body.enabled).toBe(false);expect(calls.filter(call=>call.path.endsWith('/execute')||call.path.endsWith('/fire'))).toHaveLength(0);
 await page.locator('[data-alpha-layer=app]').getByText('Document review',{exact:true}).click();await page.getByRole('button',{name:'Enable',exact:true}).click();expect(calls.filter(call=>call.method==='PUT')).toHaveLength(0);await page.getByRole('button',{name:'Confirm Enable',exact:true}).click();await expect(page.locator('[data-alpha-subview=automations-detail]').getByText('Saved on this agent.',{exact:true})).toBeVisible();await expect(page.locator('[data-alpha-subview=workflows-list]')).toHaveAttribute('inert','');expect(calls.filter(call=>call.path==='/api/triggers/prompt'&&call.method==='PUT')).toHaveLength(1);
 await page.getByRole('button',{name:'Back to automations',exact:true}).click();await page.locator('[data-alpha-subview=workflows-list]').getByText('Reviewed workflow',{exact:true}).click();await expect(page.getByRole('heading',{name:'Reviewed workflow',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to workflows',exact:true}).click();
 await page.getByRole('button',{name:'New automation',exact:true}).click();await page.getByRole('button',{name:'More options',exact:true}).click();await page.getByRole('button',{name:'Reminder on this phone',exact:false}).click();await expect(page.getByRole('button',{name:'Reminders',exact:true})).toBeVisible();expect(calls.filter(call=>call.path==='/api/lifeops/definitions')).toHaveLength(0);
 expect(errors).toEqual([]);
});

test('missing server capability is an explicit source state, not a healthy empty automation list',async({page})=>{
 const calls=await setup(page);await page.route('**/__unified_api/api/lifeops/reminders',route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));await page.getByRole('button',{name:'Filter workflows',exact:true}).click();await page.getByRole('dialog',{name:'Filter workflows',exact:true}).getByRole('button',{name:'Refresh list',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Agent reminders are not available on this agent.');await expect(page.locator('[data-alpha-layer=app]').getByText('Document review',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New automation',exact:true}).click();await expect(page.getByRole('button',{name:/^Reminder(?! on this phone)/,exact:false})).toBeDisabled();await expect(page.getByRole('button',{name:/^Reminder(?! on this phone)/,exact:false})).toContainText('not available on this agent');await expect(page.getByRole('button',{name:/^Automation/,exact:false})).toBeEnabled();await page.getByRole('button',{name:'More options',exact:true}).click();await expect(page.getByRole('button',{name:'Reminder on this phone',exact:false})).toBeEnabled();expect(calls.filter(call=>call.method!=='GET')).toHaveLength(0);
});
