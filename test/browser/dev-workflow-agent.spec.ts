import { openLegacyNotes } from './helpers/legacy-notes';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
const run=(page:Page)=>page.evaluate(()=>(Object.values(JSON.parse(localStorage.getItem('alpha.dev.app.workflows')!).localRuns) as any[])[0]);
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[{id:971,name:'Agent summary',on:true,trig:{kind:'time',days:'Every day',t:8},steps:[{k:'Read',t:'Contacts',apps:['Contacts']},{k:'Write',t:'A short summary',apps:[]},{k:'Write',t:'A note in Notes',apps:['Notes']}],runs:[]}],localRuns:{}}));});await page.goto('/?mode=dev');await openLegacyNotes(page);await returnToApps(page);await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByText('Agent summary',{exact:true}).click();});
async function attach(page:Page){await page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');const w=window as any;w.generation={calls:[],executions:0};alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},send:input=>{w.generation.calls.push({text:input.text,context:input.context});w.generation.signal=input.signal;return new Promise(resolve=>w.generation.finish=resolve);},execute:async()=>{w.generation.executions++;throw Error('Unexpected execution');}});});}
async function begin(page:Page){await attach(page);await page.getByRole('button',{name:'Run now',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).generation.calls.length)).toBe(1);}
test('connected Write uses actual returned text as the next Notes step input',async({page})=>{await begin(page);expect((await run(page)).cursor).toBe(1);await expect(page.getByRole('dialog',{name:'Workflow step result'})).toHaveCount(0);const prompt=await page.evaluate(()=>(window as any).generation.calls[0]);expect(prompt.text).toContain('A short summary');expect(prompt.text).toContain('Maya');expect(prompt.context.view).toBe('workflows');await page.evaluate(()=>(window as any).generation.finish({text:'Actual transport summary'}));await expect.poll(async()=>(await run(page))?.status).toBe('ok');const saved=await run(page);expect(saved.out).toBe('Actual transport summary');expect(await page.evaluate(async id=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.find((note:any)=>note.id===id+'-2')?.body,saved.id)).toBe('Actual transport summary');expect(await page.evaluate(()=>(window as any).generation.executions)).toBe(0);});
test('cancelling generation aborts only its owned request and late text creates no note',async({page})=>{await begin(page);await page.getByRole('button',{name:'Cancel run',exact:true}).click();await expect.poll(async()=>(await run(page))?.status).toBe('cancelled');expect(await page.evaluate(()=>(window as any).generation.signal.aborted)).toBe(true);await page.evaluate(()=>(window as any).generation.finish({text:'Late result'}));expect((await run(page)).cursor).toBe(1);expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.some((note:any)=>note.body==='Late result'))).toBe(false);});
for(const kind of ['empty','oversize','proposal'] as const)test(`generation rejects ${kind} without saving a result`,async({page})=>{await begin(page);await page.evaluate(kind=>{const w=window as any;w.generation.finish(kind==='empty'?{text:''}:kind==='oversize'?{text:'x'.repeat(16001)}:{text:'Would execute',proposals:[{id:'forbidden',title:'Write',description:'Write',expiresAt:Date.now()+60000,contextRevision:w.generation.calls[0].context.revision}]});},kind);await expect.poll(async()=>(await run(page))?.status).toBe('fail');expect((await run(page)).cursor).toBe(1);expect(await page.evaluate(()=>(window as any).generation.executions)).toBe(0);const blocked=await page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');try{await alphaClient.approve('forbidden');return false;}catch{return true;}});expect(blocked).toBe(true);});
test('HOME invalidates generation and prevents a subsequent Notes effect',async({page})=>{await begin(page);await returnToApps(page);await expect.poll(()=>page.evaluate(()=>(window as any).generation.signal.aborted)).toBe(true);await page.evaluate(()=>(window as any).generation.finish({text:'Wrong screen'}));await expect.poll(async()=>(await run(page))?.status).toBe('fail');expect((await run(page)).cursor).toBe(1);});
test('busy generation cannot cancel another consumer when its own signal aborts',async({page})=>{const result=await page.evaluate(async()=>{const {AlphaClient}=await import('/src/runtime/alpha-client.ts');const client=new AlphaClient();let release!:Function,firstSignal!:AbortSignal;client.attachVerifiedTransport({session:{ownerId:'owner',agentId:'agent',sessionId:'session',origin:'https://fixture.example'},send:input=>{firstSignal=input.signal;return new Promise(resolve=>release=resolve);},execute:async()=>{throw Error('No actions');}});const first=client.send('Existing chat');const abort=new AbortController();let busy=false;try{await client.generateWorkflowText('Summary','Input',abort.signal);}catch(error){busy=(error as any).code==='busy';}abort.abort();const unaffected=!firstSignal.aborted;release({text:'Chat answer'});return {busy,unaffected,reply:(await first).text};});expect(result).toEqual({busy:true,unaffected:true,reply:'Chat answer'});});
test('workflow edits during generation cannot accept its old instruction result',async({page})=>{
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const original=Component.prototype.api;Component.prototype.api=function(key:string){const api=original.call(this,key);if(key==='workflows')(window as any).workflowApi=api;return api;};});await begin(page);
 await page.evaluate(()=>{const api=(window as any).workflowApi;api.setView('workflows',{flows:api.get('workflows').flows.map((flow:any)=>({...flow,steps:flow.steps.map((step:any,index:number)=>index===1?{...step,t:'Changed instruction'}:step)}))});(window as any).generation.finish({text:'Old instruction answer'});});await expect.poll(async()=>(await run(page))?.status).toBe('fail');expect((await run(page)).cursor).toBe(1);expect((await run(page)).sum).toContain('Workflow changed');
});
test('external storage edits are preserved when generation finishes',async({page})=>{
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const original=Component.prototype.api;Component.prototype.api=function(key:string){const api=original.call(this,key);if(key==='workflows')(window as any).workflowApi=api;return api;};});
 await begin(page);
 const external=await page.evaluate(()=>{const key='alpha.dev.app.workflows',state=JSON.parse(localStorage.getItem(key)!);state.flows[0].steps[1].t='External instruction';const raw=JSON.stringify(state);localStorage.setItem(key,raw);(window as any).generation.finish({text:'Old instruction answer'});return raw;});
 await expect(page.getByRole('button',{name:'Run now',exact:true})).toBeVisible();
 // Trigger polling can replace the transient toast. The run must retain its recovery guidance.
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>page.evaluate(()=>(window as any).workflowApi.get('workflows').localTriggerError)).toBe('Development app save failed.');
 await page.evaluate(()=>(window as any).workflowApi.toast('Unrelated status'));
 await expect(page.getByRole('status',{name:'Workflow run status',exact:true})).toHaveText('Run state could not be saved. Reload to inspect its last saved step.');
 expect(await page.evaluate(()=>localStorage.getItem('alpha.dev.app.workflows'))).toBe(external);
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.some((note:any)=>note.body==='Old instruction answer'))).toBe(false);
});

test('long workflow instructions remain within the phone width',async({page})=>{
 await page.addInitScript(()=>{const key='alpha.dev.app.workflows',state=JSON.parse(localStorage.getItem(key)!);state.flows[0].steps[1].t='X'.repeat(512);localStorage.setItem(key,JSON.stringify(state));});await page.reload();await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByText('Agent summary',{exact:true}).click();const instruction=page.getByText('X'.repeat(512),{exact:true});const box=await instruction.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(412);expect(await instruction.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});

test('external edit warning survives a scheduler storage refusal',async({page})=>{
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const original=Component.prototype.api;Component.prototype.api=function(key:string){const api=original.call(this,key);if(key==='workflows')(window as any).workflowApi=api;return api;};});
 await begin(page);
 await page.evaluate(()=>{const api=(window as any).workflowApi;api.setView('workflows',{flows:[...api.get('workflows').flows,{id:999,name:'Other workflow',on:false,trig:{kind:'time',days:'Every day',t:9},steps:[],runs:[]}]});});
 const external=await page.evaluate(()=>{
  const key='alpha.dev.app.workflows',state=JSON.parse(localStorage.getItem(key)!);
  state.flows[0].steps[1].t='External instruction';state.triggerState={cursors:[],queue:[]};
  const raw=JSON.stringify(state);localStorage.setItem(key,raw);
  (window as any).generation.finish({text:'Old instruction answer'});return raw;
 });
 await expect(page.getByRole('button',{name:'Run now',exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>page.evaluate(()=>(window as any).workflowApi.get('workflows').localTriggerError)).toBe('Development app save failed.');
 await expect(page.getByText('Run state could not be saved. Reload to inspect its last saved step.',{exact:true})).toBeVisible();
 // Another workflow must not inherit this run's recovery warning.
 await page.evaluate(()=>{const api=(window as any).workflowApi;api.setView('workflows',{open:999});});
 await expect(page.getByRole('heading',{name:'Other workflow',exact:true})).toBeVisible();
 await expect(page.getByText('Run state could not be saved. Reload to inspect its last saved step.',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{const api=(window as any).workflowApi;api.setView('workflows',{open:971});});
 await expect(page.getByText('Run state could not be saved. Reload to inspect its last saved step.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('alpha.dev.app.workflows'))).toBe(external);
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.some((note:any)=>note.body==='Old instruction answer'))).toBe(false);
});

test('concurrent run refusals retain both workflow recovery messages',async({page})=>{
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const original=Component.prototype.api;Component.prototype.api=function(key:string){const api=original.call(this,key);if(key==='workflows')(window as any).workflowApi=api;return api;};});
 await begin(page);
 await page.evaluate(()=>{const api=(window as any).workflowApi;api.setView('workflows',{flows:[...api.get('workflows').flows,{id:999,name:'Other workflow',on:false,trig:{kind:'time',days:'Every day',t:9},steps:[],runs:[]}]});});
 const external=await page.evaluate(async()=>{
  const {VIEWS}=await import('/src/prototype/model.js');const api=(window as any).workflowApi;
  const key='alpha.dev.app.workflows',state=JSON.parse(localStorage.getItem(key)!);state.flows[0].steps[1].t='External instruction';const raw=JSON.stringify(state);localStorage.setItem(key,raw);
  // Invoke the real second workflow's Run handler before React can commit its error.
  VIEWS.workflows.render({...api.get('workflows'),open:999},api).fd.run();
  (window as any).generation.finish({text:'Old instruction answer'});return raw;
 });
 await expect.poll(()=>page.evaluate(()=>Object.keys((window as any).workflowApi.get('workflows').localRunErrors||{}).sort())).toEqual(['971','999']);
 const first=await page.evaluate(()=>(window as any).workflowApi.get('workflows').localRunErrors);
 expect(first['971'].runId).not.toBe(first['999'].runId);
 for(const id of [971,999]){
  await page.evaluate(id=>(window as any).workflowApi.setView('workflows',{open:id}),id);
  await expect(page.getByText('Run state could not be saved. Reload to inspect its last saved step.',{exact:true})).toBeVisible();
 }
 expect(await page.evaluate(()=>localStorage.getItem('alpha.dev.app.workflows'))).toBe(external);
 expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.some((note:any)=>note.body==='Old instruction answer'))).toBe(false);
});
