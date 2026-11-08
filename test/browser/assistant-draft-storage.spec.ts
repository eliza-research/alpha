import {test,expect as baseExpect} from '@playwright/test';
// Every test here loads the whole development app at least once (several reload it, open a second tab
// or connect a profile), and the composer's saved draft is restored from IndexedDB after each load.
// Under four workers on a loaded machine a load has taken 10-30s and a restore more than the 5s
// default, so the timeouts are explicit: 90s per test, 15s per expectation. What is expected is
// unchanged; only how long the page may take to get there.
test.describe.configure({timeout:90_000});
const expect=baseExpect.configure({timeout:15_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('draft text survives restart and remains isolated by full binding',async({page})=>{
 await page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');await(await assistantDraftStore('owner-agent-conversation')).save(null,'First line\nSecond line');});await page.reload();
 expect(await page.evaluate(async()=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');return {same:(await(await assistantDraftStore('owner-agent-conversation')).read())?.text,other:await(await assistantDraftStore('owner-agent-other')).read()};})).toEqual({same:'First line\nSecond line',other:null});
});
test('competing windows cannot overwrite a draft admitted with the same receipt',async({page,context})=>{
 const other=await context.newPage();await other.goto(page.url());const write=(p:any,text:string)=>p.evaluate(async(text:string)=>{const {assistantDraftStore}=await import('/src/runtime/assistant-draft-store.ts');try{await(await assistantDraftStore('shared-binding')).save(null,text);return true;}catch{return false;}},text);
 const result=await Promise.all([write(page,'Window A'),write(other,'Window B')]);expect(result.filter(Boolean)).toHaveLength(1);const text=await page.evaluate(async()=>(await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore('shared-binding')).read())?.text);expect(['Window A','Window B']).toContain(text);
});
test('clearing does not make an old empty receipt valid again',async({page})=>{
 expect(await page.evaluate(async()=>{const store=await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore('clear-binding'),first=await store.save(null,'Draft');await store.save(first,'');let refused=false;try{await store.save(null,'Stale');}catch{refused=true;}return {refused,text:(await store.read())?.text};})).toEqual({refused:true,text:''});
});
test('an aborted save leaves the retained draft unchanged',async({page})=>{
 expect(await page.evaluate(async()=>{const store=await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore('cancel-binding'),first=await store.save(null,'Keep');const cancel=new AbortController();cancel.abort();let refused=false;try{await store.save(first,'Lost',cancel.signal);}catch{refused=true;}return {refused,text:(await store.read())?.text};})).toEqual({refused:true,text:'Keep'});
});
test('connection draft binding follows verified conversation selection and separates offline text',async({page})=>{
 await page.goto('/?mode=dev');
 expect(await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();const offline=await c.assistantDraftBinding(new AbortController().signal);await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Development fixture did not connect: '+c.getSnapshot().error);const before=await c.assistantDraftBinding(new AbortController().signal);const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');LocalAgentProtocol.prototype.listConversations=async()=>[{id:'selected',title:'Selected'}];LocalAgentProtocol.prototype.messages=async()=>({messages:[]});await c.restoreHistory('selected');const after=await c.assistantDraftBinding(new AbortController().signal);await c.offline();return {different:before!==after,selected:JSON.parse(after).at(-1),offline:offline===await c.assistantDraftBinding(new AbortController().signal),separate:offline!==after};})).toEqual({different:true,selected:'selected',offline:true,separate:true});
});
for(const scenario of ['reset','competing-write','abort','unreadable'] as const)test(`native draft recovery bridge contract: ${scenario}`,async({page})=>{
 const result=await page.evaluate(async scenario=>{
  const {nativeAssistantDraftRecovery}=await import('/src/runtime/native-assistant-draft-recovery.ts');
  const original=' { "version": 17, "text": "Keep this draft" }\n';let raw=original,writes=0;
  const recovery=nativeAssistantDraftRecovery('native-owner-conversation',{read:async()=>{if(scenario==='unreadable')throw Error('Secure storage read failed');return raw;},compareExchange:async(expected,value)=>{writes++;if(raw!==expected)return {status:'conflict'};raw=value;return {status:'saved'};}});
  let refused=false,exact=false,empty=false,reused=false;
  try{const captured=await recovery.capture();exact=captured.raw===original;if(scenario==='competing-write')raw='newer draft';const cancel=new AbortController();if(scenario==='abort')cancel.abort();await recovery.reset({...captured,raw:'UI backup wrapper'},cancel.signal);empty=JSON.parse(raw).text==='';try{await recovery.reset(captured);}catch{reused=true;}}catch{refused=true;}
  return {refused,exact,empty,reused,writes,unchanged:raw===original,newer:raw==='newer draft'};
 },scenario);
 if(scenario==='reset')expect(result).toMatchObject({refused:false,exact:true,empty:true,reused:true,writes:1});
 else if(scenario==='competing-write')expect(result).toMatchObject({refused:true,exact:true,newer:true,writes:1});
 else expect(result).toMatchObject({refused:true,unchanged:true,writes:0});
});
test('explicit development fixture native recovery backup passes exact UTF-8 bytes to reviewed document export',async({page})=>{
 expect(await page.evaluate(async()=>{
  const {saveNativeRecoveryBackup}=await import('/src/runtime/native-recovery-backup.ts');let input:any;
  const raw=JSON.stringify({saved:' { "text": "🙂 draft" }\n',currentDraft:'Current\nline'});
  const message=await saveNativeRecoveryBackup(raw,'Alpha-assistant-draft-recovery.txt',new AbortController().signal,{saveReviewed:async value=>{input=value;return {status:'saved',message:'unused'};}});
  const bytes=Uint8Array.from(atob(input.dataBase64),n=>n.charCodeAt(0)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const cancel=new AbortController();cancel.abort();let cancelled=false;try{await saveNativeRecoveryBackup(raw,'backup.txt',cancel.signal,{saveReviewed:async()=>{throw Error('Must not dispatch');}});}catch(e){cancelled=(e as Error).name==='AbortError';}
  return {text:new TextDecoder().decode(bytes)===raw,hash:input.sha256===digest,reviewed:input.reviewed,mime:input.mimeType,message,cancelled};
 })).toEqual({text:true,hash:true,reviewed:true,mime:'text/plain',message:'Backup saved and exact bytes verified.',cancelled:true});
});
test('device draft recovery requires a separate reset confirmation and keeps saved text on close',async({page})=>{
 await page.evaluate(async()=>{
  const {nativeAssistantDraftRecovery}=await import('/src/runtime/native-assistant-draft-recovery.ts');const {openDomainRecovery}=await import('/src/browser/domain-recovery.ts');
  sessionStorage.setItem('native-draft-fixture',' {"text":"Retained","version":19} ');
  const recovery=nativeAssistantDraftRecovery('dialog-native-binding',{read:async()=>sessionStorage.getItem('native-draft-fixture'),compareExchange:async(expected,value)=>{if(sessionStorage.getItem('native-draft-fixture')!==expected)return {status:'conflict'};sessionStorage.setItem('native-draft-fixture',value);return {status:'saved'};}});
  (window as any).openNativeDraftRecovery=()=>openDomainRecovery(recovery,'assistant draft','Assistant draft recovery','Save a backup before resetting.',undefined,undefined,'device');(window as any).openNativeDraftRecovery();
 });
 const dialog=page.getByRole('dialog',{name:'Assistant draft recovery'});await dialog.getByRole('button',{name:'Reset device assistant draft',exact:true}).click();
 expect(await page.evaluate(()=>sessionStorage.getItem('native-draft-fixture'))).toContain('Retained');
 await dialog.getByRole('button',{name:'Close recovery'}).click();expect(await page.evaluate(()=>sessionStorage.getItem('native-draft-fixture'))).toContain('Retained');
 await page.evaluate(()=>(window as any).openNativeDraftRecovery());await dialog.getByRole('button',{name:'Reset device assistant draft',exact:true}).click();
 await Promise.all([page.waitForEvent('load'),dialog.getByRole('button',{name:'Confirm assistant draft reset',exact:true}).click()]);
 expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('native-draft-fixture')!).text)).toBe('');
});
