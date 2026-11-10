import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import {openLegacyNotes} from './helpers/legacy-notes';
import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
test.setTimeout(60000);
const transcript='Water the plants.\nReview the irrigation schedule.';
async function notes(page:Page){return page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records);}
async function setup(page:Page,actions=false){
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.goto('/?mode=dev&tools=1',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Settings',exact:true}).click();await openConnectionDiagnostics(page);await page.getByRole('button',{name:'Connect development profile'}).click();await returnToApps(page);await openLegacyNotes(page);await page.getByRole('button',{name:'New note',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Meeting recording');await page.getByRole('textbox',{name:'Note',exact:true}).fill(transcript);await expect.poll(async()=>(await notes(page))[0]?.body).toBe(transcript);
 await page.evaluate(async({transcript,actions})=>{const store=JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!),note=store.records[0];const bytes=new Uint8Array(3244),v=new DataView(bytes.buffer);for(const [offset,text]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,3200,true);const{retainAudio}=await import('/src/browser/note-audio-store.ts');note.audio=await retainAudio('question-audio',note.id,transcript,{blob:new Blob([bytes],{type:'audio/wav'}),durationMs:100});Object.assign(note,{kind:'voice',dur:0.1,summary:actions?['Reviewed meeting summary']:[],actions:actions?[{t:'Water the plants',done:false},{t:'Already handled',done:true}]:[],onCal:actions,lines:[{s:'me',at:0,t:transcript}]});(await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.compareExchange((await (await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.read())!,JSON.stringify(store)));}, {transcript,actions});await page.reload({waitUntil:'domcontentloaded'});await openLegacyNotes(page);await page.getByRole('button',{name:'Open Meeting recording',exact:true}).click();
}

// The owner removed the transcript-review/summary wizard. The current flow attaches
// the selected recording to a normal chat draft; sending remains a separate action.
const attachment=(page:Page)=>page.getByRole('group',{name:'Attached transcript',exact:true});
const draft=(page:Page)=>page.locator('textarea[data-alpha-composer]:visible').first();
async function captureSends(page:Page){
 await page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');const send=alphaClient.send.bind(alphaClient);(window as any).recordingRequests=[];alphaClient.send=async(...args:any[])=>{(window as any).recordingRequests.push({text:args[0],context:structuredClone(alphaClient.getState().context)});return send(...args);};});
}
const sentCount=(page:Page)=>page.evaluate(()=>(window as any).recordingRequests.length);
async function attach(page:Page){
 await page.getByRole('button',{name:'Ask Alpha about this transcript',exact:true}).click();
 await expect(attachment(page)).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Ask about selected content',exact:true})).toHaveCount(0);
}
async function sendAttached(page:Page){
 await attach(page);await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByText('Development reply. Edit this response in Agent connection.',{exact:true})).toBeVisible();
 await expect(attachment(page)).toHaveCount(0);
}

test('the transcript selects and copies its full text without sending or changing the recording',async({page})=>{
 await page.addInitScript(()=>{(window as any).copiedTranscripts=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).copiedTranscripts.push(text);}}});});
 await setup(page);await captureSends(page);const before=await notes(page);
 const text=page.locator('[data-alpha-note-transcript]'),ask=page.getByRole('button',{name:'Ask Alpha about this transcript',exact:true});
 await expect(text).toHaveText(transcript);await expect(ask).toHaveText('Ask Alpha');await expect(ask.locator('.alpha-compute-mark')).toHaveCount(1);
 expect(await text.evaluate(el=>getComputedStyle(el).userSelect)).toBe('text');
 await text.dblclick();await expect.poll(()=>page.evaluate(()=>window.getSelection()?.toString()??'')).not.toBe('');
 expect(await page.evaluate(()=>(window as any).copiedTranscripts)).toEqual([]);expect(await sentCount(page)).toBe(0);
 await page.getByRole('button',{name:'Copy text',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).copiedTranscripts)).toEqual([transcript]);
 expect(await sentCount(page)).toBe(0);expect(await notes(page)).toEqual(before);
});

test('a transcript attachment prefills an editable question without sending or changing the recording',async({page})=>{
 await setup(page);await captureSends(page);const before=await notes(page);
 await attach(page);await expect(draft(page)).toHaveValue('Summarize this for me');
 await expect(attachment(page)).toContainText('Meeting recording');await expect(attachment(page)).not.toContainText(transcript);
 expect(await sentCount(page)).toBe(0);expect(await notes(page)).toEqual(before);
 await draft(page).fill('What should I do next?');await attachment(page).getByRole('button',{name:'Remove transcript',exact:true}).click();
 await expect(attachment(page)).toHaveCount(0);await expect(draft(page)).toHaveValue('What should I do next?');expect(await notes(page)).toEqual(before);
});

test('Send keeps the compact transcript with its message and leaves the original recording unchanged',async({page})=>{
 await setup(page,true);await captureSends(page);const before=await notes(page);
 await expect(page.getByRole('button',{name:/^(Review reminder|Review event|Review transcript with Alpha)/})).toHaveCount(0);
 await sendAttached(page);expect(await sentCount(page)).toBe(1);
 const sent=page.locator('[aria-label="Sent transcript"]');await expect(sent).toHaveCount(1);await expect(sent).toContainText('Meeting recording');
 await expect(sent.locator('..').locator('[data-alpha-message-text]')).toHaveText('Summarize this for me');
 const request=await page.evaluate(()=>(window as any).recordingRequests[0]);expect(request.text).toContain('Use the transcript of the selected voice note');expect(request.context.view).toBe('notes');expect(request.context.selectedObject.id).toBe(before[0].id);
 expect(await notes(page)).toEqual(before);await expect(page.getByRole('dialog',{name:'Review recording summary',exact:true})).toHaveCount(0);
});

test('reloading restores the transcript attachment on the sent message',async({page},info)=>{
 await setup(page);await captureSends(page);const before=await notes(page);await sendAttached(page);
 await page.reload();
 await expect.poll(()=>page.evaluate(async()=>{const state=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();return {ready:state.startupResolved,messages:state.history?.messages.length,error:state.historyError};}),{timeout:20000}).toMatchObject({ready:true,messages:2});
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 const sent=page.locator('[aria-label="Sent transcript"]');await expect(sent).toHaveCount(1);await expect(sent).toContainText('Meeting recording');
 await expect(sent.locator('..').locator('[data-alpha-message-text]')).toHaveText('Summarize this for me');
 await expect(attachment(page)).toHaveCount(0);expect(await notes(page)).toEqual(before);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(sent).toBeInViewport();
 await page.screenshot({path:info.outputPath('restored-transcript.png')});
});

test('changing the recording before Send refuses the stale attachment',async({page})=>{
 await setup(page);await captureSends(page);await attach(page);
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Changed recording');
 await expect.poll(async()=>(await notes(page))[0].title).toBe('Changed recording');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByText('The recording changed. Remove the transcript or attach it again.',{exact:true})).toBeVisible();
 expect(await sentCount(page)).toBe(0);expect((await notes(page))[0].body).toBe(transcript);
});

test('switching away from the connection retires the draft attachment without changing its recording',async({page})=>{
 await setup(page);await captureSends(page);const before=await notes(page);await attach(page);
 await page.evaluate(async()=>{await(await import('/src/runtime/connection-ui.tsx')).connectionController.offline();});
 await expect(attachment(page)).toHaveCount(0);expect(await sentCount(page)).toBe(0);expect(await notes(page)).toEqual(before);
});

test('an unsent refusal retains the transcript and question for an explicit retry',async({page})=>{
 await setup(page);await captureSends(page);const before=await notes(page);await attach(page);
 await page.evaluate(async()=>{const {alphaClient,AlphaClientError}=await import('/src/runtime/alpha-client.ts');alphaClient.send=async()=>{(window as any).recordingRequests.push({refused:true});throw new AlphaClientError('busy','Controlled send refusal');};});
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(draft(page)).toHaveValue('Summarize this for me');await expect(attachment(page)).toBeVisible();
 await expect(page.locator('[aria-label="Sent transcript"]')).toHaveCount(0);expect(await sentCount(page)).toBe(1);expect(await notes(page)).toEqual(before);
});
