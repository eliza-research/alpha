import {newWorkflow} from './workflow-navigation';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
// Synthetic agent: generation requests are recorded and answered locally; nothing leaves the browser.
async function setup(page:Page){
 await page.goto('/?mode=dev&workflows=agent');
 await page.evaluate(async()=>{
  const {WorkflowProtocol,WorkflowHttpError}=await import('/src/runtime/workflow-protocol.ts');const {workflowSha}=await import('/src/runtime/workflow-device-contract.ts');const {normalizePhoneSpec}=await import('/src/runtime/phone-workflow-authoring.ts');
  const f=(window as any).scopeFixture={mode:'normal',calls:[] as any[]};const catalog=WorkflowProtocol.prototype.phoneCatalog,generate=WorkflowProtocol.prototype.generatePhone;
  WorkflowProtocol.prototype.phoneCatalog=async function(signal){return {...await catalog.call(this,signal),generationProtocol:1};};
  WorkflowProtocol.prototype.generatePhone=function(...args){const client=new WorkflowProtocol(async(path,body:any)=>{
   f.calls.push({path,body});
   if(f.mode==='clarify')throw new WorkflowHttpError(422,{error:'Workflow needs clarification: Which calendar range should the digest read?'});
   const spec=normalizePhoneSpec({version:1,name:'Generated calendar digest',description:'Review before saving',trigger:{kind:'manual'},device:body.device,steps:[{id:'input',kind:'Read',operation:'supplied_text',text:'Synthetic agenda text'},{id:'compose',kind:'Write',operation:'compose_draft',source:'input',prefix:'Agenda: ',suffix:''}]});
   return {spec,specDigest:await workflowSha(spec),catalogRevision:body.catalogRevision,compilerRevision:body.compilerRevision,active:false};
  });return generate.apply(client,args);};
 });
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);await page.getByRole('textbox',{name:'Workflow name',exact:true}).fill('Retained original draft');await page.getByRole('button',{name:/Describe it to/}).click();
}
const calls=(page:Page)=>page.evaluate(()=>(window as any).scopeFixture.calls.length);

for(const [prompt,reason] of [['Call Maya every morning with my agenda','place or answer phone calls'],['Text Sam my calendar every evening','send text messages'],['Pay my rent on the first of the month','make payments or move money'],['Add everyone from my notes to my contacts','read or change Contacts'],['Run this python script every hour','run arbitrary code'],['Email the summary to the team','send email to recipients you have not named']] as const)
 test(`unsupported scope is refused before generation: ${reason}`,async({page})=>{
  await setup(page);await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill(prompt);await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();
  const shown=page.locator('[role=status]').filter({hasText:'Workflows can’t '+reason});await expect(shown).toBeVisible();await expect(shown).toContainText('Nothing was sent to the agent');await expect(shown).toContainText('Read supplied text');
  expect(await calls(page)).toBe(0);
  await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Workflow request',exact:true})).toHaveValue(prompt);await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');
 });

test('a 422 clarification is shown and the draft and request are kept; a supported prompt still generates',async({page})=>{
 await setup(page);const prompt=page.getByRole('textbox',{name:'Workflow request',exact:true});
 await page.evaluate(()=>(window as any).scopeFixture.mode='clarify');await prompt.fill('Make a digest from my calendar');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();
 await expect(page.locator('[role=status]').filter({hasText:'Workflow needs clarification: Which calendar range should the digest read?'})).toBeVisible();expect(await calls(page)).toBe(1);
 await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toHaveCount(0);await expect(prompt).toHaveValue('Make a digest from my calendar');await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');
 await page.evaluate(()=>(window as any).scopeFixture.mode='normal');await prompt.fill('Read my calendar for today and draft an agenda note');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();
 await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toContainText('Synthetic agenda text');expect(await calls(page)).toBe(2);
 expect(await page.evaluate(()=>(window as any).scopeFixture.calls.map((c:any)=>c.path))).toEqual(['/api/workflow/phone/generate','/api/workflow/phone/generate']);
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');
});
