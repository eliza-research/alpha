import {test,expect as baseExpect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
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
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!sessionStorage.getItem('draft-test-init')){localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));sessionStorage.setItem('draft-test-init','1');}});await page.goto('/');});
const composer=(page:any)=>page.getByRole('textbox',{name:'Ask Alpha',exact:true});
const status=(page:any)=>page.getByRole('status',{name:'Assistant draft status',exact:true});
async function saved(page:any){
 const text=await composer(page).inputValue();
 await expect.poll(()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const binding=await c.assistantDraftBinding(new AbortController().signal);return (await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding)).read())?.text||'';})).toBe(text);
 await expect(status(page)).toHaveCount(0);
}
test('an unsent multiline draft survives reload and clearing stays cleared',async({page})=>{
 await composer(page).fill('Remember this\nwithout sending');await saved(page);await page.reload();await expect(composer(page)).toHaveValue('Remember this\nwithout sending');// Successful restore stays quiet; the exact composer value above proves restoration.
 await expect(status(page)).toHaveCount(0);await composer(page).fill('');await saved(page);await page.reload();await expect(composer(page)).toHaveValue('');
});
test('another tab cannot replace a draft silently and recovery retains the current text',async({page,context},info)=>{
 const other=await context.newPage();await other.goto(page.url());await expect(composer(other)).toBeEnabled();await composer(page).fill('First window');await saved(page);await composer(other).fill('Second window');await expect(status(other)).toContainText('Review the saved copy');await expect(composer(other)).toHaveValue('Second window');await expect(other.getByText('Saved copy: First window',{exact:true})).toBeVisible();await other.screenshot({path:info.outputPath('assistant-draft-conflict.png'),animations:'disabled'});
 await other.getByRole('button',{name:'Replace saved draft with this text',exact:true}).click();await saved(other);await page.reload();await expect(composer(page)).toHaveValue('Second window');
});
test('failed autosave keeps editable text and explicit retry can save it',async({page})=>{
 await expect(composer(page)).toBeEnabled();await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;(window as any).restoreDraftPut=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='documents')throw new DOMException('Full','QuotaExceededError');return put.apply(this,args as any);};});
 await composer(page).fill('Keep this text');await expect(status(page)).toContainText('Draft was not saved');await expect(composer(page)).toHaveValue('Keep this text');await page.evaluate(()=>(window as any).restoreDraftPut());await page.getByRole('button',{name:'Replace saved draft with this text',exact:true}).click();await saved(page);await page.reload();await expect(composer(page)).toHaveValue('Keep this text');
});
test('Send clears the retained draft and dispatches only the reviewed text once',async({page})=>{
 await page.goto('/?mode=dev');await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');(window as any).sendDraftBinding=await c.assistantDraftBinding(new AbortController().signal);const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');(window as any).draftRequests=[];LocalAgentProtocol.prototype.send=async(_id,text)=>{(window as any).draftRequests.push(text);return {text:'Received'};};});
 await composer(page).fill('Reviewed draft');await saved(page);await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftRequests.length)).toBe(1);// The draft is kept until the dispatch is confirmed, then cleared once.
 await expect.poll(()=>page.evaluate(async()=>(await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore((window as any).sendDraftBinding)).read())?.text)).toBe('');await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('');
});

test('connection changes restore only that connection draft and retain the offline copy',async({page})=>{
 await page.goto('/?mode=dev');await composer(page).fill('Offline draft');await saved(page);await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Fixture did not connect');});await expect(composer(page)).toHaveValue('');await composer(page).fill('Connected draft');await saved(page);await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});await expect(composer(page)).toHaveValue('Offline draft');await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.startDevelopment('local');});await expect(composer(page)).toHaveValue('Connected draft');
});

test('damaged draft recovery backs up saved bytes and current text before a reviewed reset',async({page})=>{
 await page.evaluate(async()=>{const binding=JSON.stringify(['offline']),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');const {BrowserJsonDomainDocument}=await import('/src/browser/json-domain-document.ts');await new BrowserJsonDomainDocument('alpha.browser.assistant-draft:v1:'+hash).editJson(()=>({damaged:'retained'}));});await page.reload();await expect(status(page)).toContainText('could not be read');await composer(page).fill('Current unsaved text');await page.getByRole('button',{name:'Recover assistant draft',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Assistant draft recovery'});const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download assistant draft backup',exact:true}).click();const file=await download;const backup=JSON.parse(await readFile((await file.path())!,'utf8'));expect(backup.currentDraft).toBe('Current unsaved text');expect(backup.saved).toContain('damaged');await dialog.getByRole('button',{name:'Reset app assistant draft',exact:true}).click();// The confirmed reset reloads the app (domain-recovery.ts); wait for that load and the reloaded
 // composer rather than racing the old page's teardown.
 await Promise.all([page.waitForEvent('load',{timeout:60_000}),dialog.getByRole('button',{name:'Confirm assistant draft reset',exact:true}).click()]);await expect(dialog).toHaveCount(0);await expect(composer(page)).toBeVisible({timeout:30_000});await expect(composer(page)).toHaveValue('');await composer(page).fill('Usable again');await saved(page);
});

for(const initial of ['first',''])test(`a different tab restart selection cannot move the current draft: ${initial||'new conversation'}`,async({page})=>{
 await page.goto('/?mode=dev');await page.evaluate(async(initial)=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.initialize();const {developmentIdentity}=await import('/src/browser/development-identity.ts');const {LocalAgentProtocol}=await import('/src/runtime/local-agent.ts');const identity=developmentIdentity('local'),key=JSON.stringify([new LocalAgentProtocol().origin,identity.ownerId,identity.agentId]);const choices=await import('/src/runtime/conversation-selection.ts');if(initial)await choices.selectConversation(key,await choices.captureConversationChoice(key),initial,new AbortController().signal,()=>{});await c.startDevelopment('local');if(!c.getSnapshot().session)throw Error('Fixture did not connect');await c.assistantDraftBinding(new AbortController().signal);await choices.selectConversation(key,await choices.captureConversationChoice(key),'other-tab',new AbortController().signal,()=>{});LocalAgentProtocol.prototype.send=async id=>{(window as any).draftTarget=id;return {text:'Received'};};},initial);
 await composer(page).fill('Stay in this conversation');await saved(page);await composer(page).press('Enter');await expect.poll(()=>page.evaluate(()=>(window as any).draftTarget||'')).not.toBe('');const target=await page.evaluate(()=>(window as any).draftTarget);expect(target).not.toBe('other-tab');if(initial)expect(target).toBe(initial);
});
