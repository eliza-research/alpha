import {test,expect,type Page} from '@playwright/test';
import {guardCalendarFixture} from './calendar-draft-readiness';
import {installWorkflowListFixture} from './workflow-navigation';

async function savedState(page:Page){
 return page.evaluate(async()=>{
  const {readExecutionPart}=await import('/src/browser/development-execution-document.ts');
  return readExecutionPart({namespace:'local'} as any,'workflows',()=>({workflows:[],receipts:[],runs:[]}));
 });
}

test('a fresh Workflows visit reaches the sole removed workflow and restores it only after review',async({context,page})=>{
 await guardCalendarFixture(context);
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.goto('/?mode=dev&workflows=agent');
 await installWorkflowListFixture(page);
 const seeded=await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  await c.initialize();await c.startDevelopment('local');
  const client=c.getWorkflowClient()!.client,signal=new AbortController().signal,catalog=await client.phoneCatalog(signal);
  const spec={version:1 as const,name:'Sole removed workflow',description:'Retained read-only execution',trigger:{kind:'manual' as const},steps:[
   {id:'read',kind:'Read' as const,operation:'supplied_text',text:'Retained source'},
   {id:'draft',kind:'Write' as const,operation:'compose_draft',source:'read',prefix:'Saved: ',suffix:''},
  ]};
  const validation=await client.validatePhone(spec,catalog,signal);
  const saved=await client.savePhone(spec,catalog,{mutationId:crypto.randomUUID(),specDigest:validation.specDigest,compilerRevision:catalog.compilerRevision},signal);
  const run=await client.run(saved.workflowId,saved.versionId,signal);
  await client.lifecycle(saved.workflowId,saved.versionId,'remove',signal,()=>{});
  return {workflowId:saved.workflowId,versionId:saved.versionId,runId:run.id};
 });
 const before=await savedState(page);
 expect(before.workflows).toHaveLength(1);expect(before.workflows[0].removed).toBe(true);
 expect(before.runs.map((run:any)=>run.id)).toEqual([seeded.runId]);

 await page.reload();await installWorkflowListFixture(page);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();
 await expect(page.getByText('No workflows yet',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Workflows options',exact:true}).click();
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 await page.getByRole('button',{name:/^Sole removed workflow/}).click();
 const confirmation=page.getByRole('dialog',{name:'Recover 1 item?',exact:true});
 await expect(confirmation).toBeVisible();
 expect(await savedState(page)).toEqual(before);
 await confirmation.getByRole('button',{name:'No',exact:true}).click();
 await expect(confirmation).toHaveCount(0);
 expect(await savedState(page)).toEqual(before);
 await page.getByRole('button',{name:/^Sole removed workflow/}).click();
 await confirmation.getByRole('button',{name:'Yes',exact:true}).click();
 await expect.poll(async()=>{const saved=await savedState(page);return {removed:saved.workflows[0].removed,active:saved.workflows[0].active};}).toEqual({removed:false,active:false});
 await expect(confirmation).toHaveCount(0);
 await page.getByRole('button',{name:'Back to workflows',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Sole removed workflow/})).toBeVisible();
 const restored=await savedState(page);
 expect(restored.workflows[0].removed).toBe(false);expect(restored.workflows[0].active).toBe(false);
 expect(restored.runs.map((run:any)=>({id:run.id,versionId:run.workflowVersionId}))).toEqual([{id:seeded.runId,versionId:seeded.versionId}]);
 expect(restored.runs).toEqual(before.runs);
});
