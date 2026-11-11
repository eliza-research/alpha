import {test,expect,type Page} from '@playwright/test';
import {guardCalendarFixture} from './calendar-draft-readiness';
import {installWorkflowListFixture,workflowCard} from './workflow-navigation';

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
 await page.getByRole('button',{name:/^Removed workflows\b/}).click();
 await workflowCard(page,'Sole removed workflow').click();
 await expect(page.getByRole('status',{name:'Workflow run status',exact:true})).toHaveText('Removed');
 await expect(page.getByRole('button',{name:'succeeded execution',exact:true})).toBeVisible();
 expect(await savedState(page)).toEqual(before);

 await page.getByRole('button',{name:'Restore workflow',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm restore',exact:true})).toBeVisible();
 expect(await savedState(page)).toEqual(before);
 await page.getByRole('button',{name:'Confirm restore',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove workflow',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Turn Sole removed workflow on or off',exact:true})).toHaveAttribute('aria-pressed','false');
 const restored=await savedState(page);
 expect(restored.workflows[0].removed).toBe(false);expect(restored.workflows[0].active).toBe(false);
 expect(restored.runs.map((run:any)=>({id:run.id,versionId:run.workflowVersionId}))).toEqual([{id:seeded.runId,versionId:seeded.versionId}]);
 expect(restored.runs).toEqual(before.runs);
});
