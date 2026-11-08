import {newWorkflow} from './workflow-navigation';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,mode='normal'){
 await page.goto('/?mode=dev&workflows=agent');
 await page.evaluate(async mode=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');const {workflowSha}=await import('/src/runtime/workflow-device-contract.ts');
  const {normalizePhoneSpec}=await import('/src/runtime/phone-workflow-authoring.ts');
  const f=(window as any).generationFixture={mode,calls:[] as any[],release:null as any};const catalog=WorkflowProtocol.prototype.phoneCatalog,generate=WorkflowProtocol.prototype.generatePhone;
  WorkflowProtocol.prototype.phoneCatalog=async function(signal){return {...await catalog.call(this,signal),generationProtocol:1};};
  WorkflowProtocol.prototype.generatePhone=function(...args){const client=new WorkflowProtocol(async(path,body:any,_signal)=>{
   f.calls.push({path,body});if(f.mode==='delayed')await new Promise<void>(resolve=>f.release=resolve);
   const spec={version:1,name:'Generated synthetic draft',description:'Review before saving',trigger:{kind:'manual'},device:body.device,steps:[{id:'input',kind:'Read',operation:'supplied_text',text:'Synthetic generated input'},{id:'compose',kind:'Write',operation:'compose_draft',source:'input',prefix:'Reviewed: ',suffix:''}],...(f.mode==='invalid'?{source:'unexpected code'}:{})};
   const canonical=f.mode==='invalid'?spec:normalizePhoneSpec(spec);
   return {spec:canonical,specDigest:await workflowSha(canonical),catalogRevision:body.catalogRevision,compilerRevision:body.compilerRevision,active:false};
  });return generate.apply(client,args);};
 },mode);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);await page.getByRole('textbox',{name:'Workflow name',exact:true}).fill('Retained original draft');await page.getByRole('button',{name:/Describe it to/}).click();
}
const counts=(page:Page)=>page.evaluate(async()=>{const data=(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'workflows',()=>({workflows:[],receipts:[],runs:[]})));return {workflows:data.workflows.length,runs:(data.runs||[]).length,calls:(window as any).generationFixture.calls.length};});
test('generated draft requires review, local adoption and separate confirmed Save',async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await setup(page);await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('Read synthetic input then add a prefix');expect(await counts(page)).toEqual({workflows:0,runs:0,calls:0});
 await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toContainText('Synthetic generated input');await expect(page.getByLabel('Generated technical specification',{exact:true})).not.toHaveAttribute('open','');await page.getByLabel('Generated technical specification',{exact:true}).locator('summary').click();await expect(page.getByLabel('Generated workflow review',{exact:true})).toContainText('Synthetic generated input');await page.getByLabel('Generated technical specification',{exact:true}).locator('summary').click();await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');expect(await counts(page)).toEqual({workflows:0,runs:0,calls:1});
 await expect(page.getByRole('button',{name:'Save workflow',exact:true})).toBeDisabled();expect((await counts(page)).workflows).toBe(0);
 const use=page.getByRole('button',{name:'Use generated workflow draft',exact:true});await use.evaluate(el=>el.scrollIntoView({block:'center'}));expect(await use.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);await page.screenshot({path:info.outputPath('generated-review.png')});await use.click();
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Generated synthetic draft');expect((await counts(page)).workflows).toBe(0);
 await page.getByRole('button',{name:'Save workflow',exact:true}).click();await expect(page.getByLabel('Workflow save review')).toBeVisible();expect((await counts(page)).workflows).toBe(0);await page.getByRole('button',{name:'Save workflow',exact:true}).click();await expect.poll(async()=>(await counts(page)).workflows).toBe(1);expect((await counts(page)).runs).toBe(0);expect(await page.evaluate(async()=>(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'workflows',()=>({workflows:[],receipts:[],runs:[]}))).workflows[0].active)).toBe(false);
});
test('cancel and duplicate clicks cannot import a late generated draft',async({page})=>{
 await setup(page,'delayed');await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('Build a draft');const button=page.getByRole('button',{name:'Generate workflow draft',exact:true});await button.click();await expect.poll(async()=>(await counts(page)).calls).toBe(1);await expect(button).toBeDisabled();await button.dispatchEvent('click');expect((await counts(page)).calls).toBe(1);await page.getByRole('button',{name:'Cancel workflow generation',exact:true}).click();await page.evaluate(async()=>(window as any).generationFixture.release());await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');await expect(page.getByLabel('Generated workflow review')).toHaveCount(0);expect((await counts(page)).workflows).toBe(0);
 await page.getByRole('button',{name:/Describe it to/}).click();await page.evaluate(async()=>(window as any).generationFixture.mode='normal');await button.click();await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('A different request');await expect(page.getByLabel('Generated workflow review')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');
});
test('invalid generated output leaves the editable draft untouched',async({page})=>{
 await setup(page,'invalid');await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('Build a draft');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();await expect(page.getByText('Unsupported workflow field',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');await expect(page.getByRole('button',{name:'Use generated workflow draft',exact:true})).toHaveCount(0);expect((await counts(page)).workflows).toBe(0);
});
test('generation protocol rejects enrollment, scope, capability, digest and active-state changes',async({page})=>{
 await page.goto('/?mode=dev');const rejected=await page.evaluate(async()=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');const {workflowSha}=await import('/src/runtime/workflow-device-contract.ts');const {normalizePhoneSpec}=await import('/src/runtime/phone-workflow-authoring.ts');
  const device={installationId:'device',enrollmentId:'enrollment'},catalog={generationProtocol:1 as const,catalogRevision:'catalog',compilerRevision:'compiler',maximumSteps:32,maximumSpecBytes:65536,triggers:[{kind:'manual',available:true}],palette:[{kind:'Read',operations:[{id:'supplied_text',available:true},{id:'selected_notes',available:true}]},{kind:'Write',operations:[{id:'compose_draft',available:true}]}]},spec={version:1 as const,name:'Draft',description:'',trigger:{kind:'manual' as const},device,steps:[{id:'input',kind:'Read' as const,operation:'supplied_text',text:'Exact text'}]};let count=0;
  const canonical=normalizePhoneSpec(spec),valid={spec:canonical,specDigest:await workflowSha(canonical),catalogRevision:'catalog',compilerRevision:'compiler',active:false};await new WorkflowProtocol(async()=>valid).generatePhone('Request',catalog,['supplied_text'],new AbortController().signal,undefined,device);
  const cases=[{spec:{...spec,device:{...device,enrollmentId:'other'}}},{spec:{...spec,steps:[{id:'read',kind:'Read',operation:'selected_notes',notes:[{id:'invented',revision:'a'.repeat(64)}]}]}},{spec:{...spec,steps:[...spec.steps,{id:'write',kind:'Write',operation:'compose_draft',source:'input',prefix:'',suffix:''}]}},{specDigest:'0'.repeat(64)},{active:true},{catalogRevision:'other'},{compilerRevision:'other'}];
  for(const change of cases){const output={spec,specDigest:await workflowSha('spec' in change?change.spec:spec),catalogRevision:'catalog',compilerRevision:'compiler',active:false,...change};const client=new WorkflowProtocol(async()=>output);try{await client.generatePhone('Request',catalog,['supplied_text','selected_notes'],new AbortController().signal,undefined,device);}catch{count++;}}
  return count;
 });expect(rejected).toBe(7);
});
test('leaving during generation ignores the late response and restores the prior local draft',async({page})=>{
 await setup(page,'delayed');await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('Build a draft');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();await expect.poll(async()=>(await counts(page)).calls).toBe(1);await returnToApps(page);await page.evaluate(async()=>(window as any).generationFixture.release());await page.getByRole('button',{name:'Workflows',exact:true}).click();await newWorkflow(page);await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toHaveCount(0);expect((await counts(page)).workflows).toBe(0);
});

test('editing the request during generation discards its late response',async({page})=>{
 await setup(page,'delayed');const prompt=page.getByRole('textbox',{name:'Workflow request',exact:true});await prompt.fill('Original request');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();await expect.poll(async()=>(await counts(page)).calls).toBe(1);await prompt.fill('Changed request');await page.evaluate(async()=>(window as any).generationFixture.release());await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toHaveCount(0);await expect(prompt).toHaveValue('Changed request');await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retained original draft');await page.evaluate(async()=>(window as any).generationFixture.mode='normal');await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();await expect.poll(async()=>(await counts(page)).calls).toBe(2);expect(await page.evaluate(async()=>(window as any).generationFixture.calls[1].body.prompt)).toBe('Changed request');
});

for(const outcome of ['saved','failed','left'])test(`Generation waits for durable draft storage: ${outcome}`,async({page})=>{
 await setup(page);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{browserWorkflowDraftStore}=await import('/src/browser/workflow-drafts.ts'),{workflowSha}=await import('/src/runtime/workflow-device-contract.ts');
  const session=c.getSnapshot().session!,store=await browserWorkflowDraftStore(session),slot='workflow-draft:v1:'+await workflowSha([session.origin,session.ownerId,session.agentId]);
  (window as any).readGenerationDraft=async()=>{const {value}=await store.secureRead({slot});return value?JSON.parse(value).spec.name:null;};
 });
 await expect.poll(()=>page.evaluate(async()=>(window as any).readGenerationDraft())).toBe('Retained original draft');
 await page.evaluate(outcome=>{const request=navigator.locks.request.bind(navigator.locks);let held=false;navigator.locks.request=(async(name:any,...args:any[])=>{if(String(name).startsWith('["browser-document","alpha.browser.documents.v1","alpha.browser.workflow-draft:')&&!held){held=true;await new Promise<void>(resolve=>(window as any).releaseDraft=resolve);if(outcome==='failed')throw Error('Synthetic draft storage failure');}return (request as any)(name,...args);}) as any;},outcome);
 await page.getByRole('textbox',{name:'Workflow name',exact:true}).fill('Retain pending private draft');
 await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseDraft)).toBe('function');
 await page.getByRole('textbox',{name:'Workflow request',exact:true}).fill('Generate after storage');
 await page.getByRole('button',{name:'Generate workflow draft',exact:true}).click();
 expect((await counts(page)).calls).toBe(0);
 await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toBeVisible();
 if(outcome==='left')await returnToApps(page);
 await page.evaluate(async()=>(window as any).releaseDraft());
 if(outcome==='saved'){await expect(page.getByRole('region',{name:'Generated draft',exact:true})).toBeVisible();expect((await counts(page)).calls).toBe(1);}
 else if(outcome==='failed'){await expect(page.getByRole('textbox',{name:'Workflow name',exact:true})).toHaveValue('Retain pending private draft');await expect(page.getByText(/Resolve local draft storage|Synthetic draft storage failure/).first()).toBeVisible();expect((await counts(page)).calls).toBe(0);}
 else{await expect.poll(()=>page.evaluate(async()=>(window as any).readGenerationDraft())).toBe('Retain pending private draft');expect((await counts(page)).calls).toBe(0);}
});
