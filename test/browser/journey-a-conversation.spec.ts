import {openLegacyNotes} from './helpers/legacy-notes';
/*
 * Journey A (docs/mvp-completion-plan.md "A. Boot, authenticate and keep a conversation"), browser build.
 *
 * Evidence level: a pass is SOURCE/TEST evidence for the browser development profile only. It is not APK,
 * emulator, AOSP image, physical-device or real-integration evidence.
 *
 * Synthetic parts:
 *  - The agent is the on-device DEVELOPMENT profile (apps/app/src/browser/development-connection.ts): a local
 *    protocol fixture that answers every message with the saved scripted reply. No model, network or account.
 *  - The pending reply is produced by the harness holding the Web Lock of the development agent document, so the
 *    agent's own store cannot commit while Stop is pressed. Sending, Stop and recovery are the real rendered path.
 *
 * Native-only / not coverable here (not claimed):
 *  - Cold boot into Alpha HOME on a device, recovery/emergency routes, HOME role.
 *  - Cloud sign-in, agent selection/provisioning, remote pairing (real accounts).
 *  - Spoken requests on a physical microphone; network switch; process kill; token expiry/revocation.
 *  - A real agent that keeps working after Stop. Stop closes the stream, asks the agent to cancel (the development
 *    agent has no cancel route, so nothing is confirmed), says in the chat that the agent may still finish, and
 *    checks the agent's history exactly once about 15 s later. Here the development agent had not committed, so
 *    the check reports that the agent did not record the message. A real agent finishing after Stop, or
 *    confirming the cancel, is covered with a controlled transport in chat-continuity.spec.ts, not here.
 */
import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';
import {installCloudVoiceFixture} from './cloud-voice-fixture';

const AGENT_KEY='alpha.browser.agent.local.v1';
const AGENT_LOCK=JSON.stringify(['browser-document','alpha.browser.documents.v1',AGENT_KEY]);
const REPLY='Journey A scripted reply';
// Wording owned by apps/app/src/runtime/connection-ui.tsx (STOPPED_REPLY_NOTICE and the check's outcome).
const MAY_FINISH='The agent may still finish this reply. Alpha Phone will check once and show it here if it does.';
const NOT_RECORDED='The agent did not record the stopped message.';
/** Pass-through counter of reads of the development agent document; it changes no result. */
const countAgentReads=(page:Page)=>page.addInitScript(key=>{const w=window as any;w.agentReads=0;const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(query:any){if(query===key)w.agentReads++;return get.call(this,query);};},AGENT_KEY);
const agentReads=(page:Page)=>page.evaluate(()=>(window as any).agentReads as number);
const bubble=(page:Page,text:string)=>page.getByRole('button',{name:'Message actions: '+text,exact:true});
/** Read-only view of the development agent's persisted conversations. */
const agentDocument=(page:Page)=>page.evaluate(async key=>{
 const snapshot=await (await import('/src/browser/documents.ts')).browserDocuments.read(key);
 if(!snapshot?.raw)return null;
 const value=JSON.parse(JSON.parse(snapshot.raw).value);
 return value.conversations.map((c:any)=>({roles:c.messages.map((m:any)=>m.role),texts:c.messages.map((m:any)=>m.text),receipts:Object.entries(c.receipts).map(([id,r]:[string,any])=>({id,input:r.input,text:r.text}))}));
},AGENT_KEY);
async function openConnection(page:Page){
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Development connections'})).toBeVisible();
}

test('journey A: boot, connect, converse across apps, stop a reply, reload and recover one result per accepted request',async({page})=>{
 test.setTimeout(240_000);
 const external:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().includes('127.0.0.1')&&!r.url().includes('localhost'))external.push(r.url());});

 // 1. Boot: fresh storage lands on Home with a typed and a talk entry point, and no agent.
 await countAgentReads(page);
 await page.goto('/?mode=dev');
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 const ask=page.getByRole('textbox',{name:'Ask Alpha',exact:true}),message=page.getByRole('textbox',{name:'Message Alpha',exact:true});
 await expect(ask).toBeVisible();
 await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeVisible();

 // 1b. Composer draft around a failed send: with no agent nothing is sent and the text returns to the composer.
 await ask.fill('Journey A unsent draft');await ask.press('Enter');
 await expect(message).toHaveValue('Journey A unsent draft');
 // The text simply comes back: no line under the composer and no toast (owner, 2026-11-03).
 await expect(page.getByRole('status',{name:'Assistant draft status'})).toHaveCount(0);
 await expect(page.getByText('Your message is back in the composer')).toHaveCount(0);
 await expect(bubble(page,'Journey A unsent draft')).toHaveCount(0);
 expect(await agentDocument(page)).toBeNull();
 await message.fill('');
 await returnToApps(page);

 // 2. Connection choice: Settings -> Agent connection, save a scripted reply and connect the development profile.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('button',{name:'Agent connection',exact:true})).toContainText('Offline');
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Development connections'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('textbox',{name:'Scripted reply'}).fill(REPLY);
 await dialog.getByRole('button',{name:'Save development reply'}).click();
 await expect(page.getByRole('status').filter({hasText:'Development reply saved.'})).toBeVisible();
 await dialog.getByRole('button',{name:'Connect development profile'}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Agent connection',exact:true})).toContainText('On-device agent · development');
 await returnToApps(page);

 // 3. Typed conversation from Home.
 await ask.fill('Journey A first request');await ask.press('Enter');
 await expect(bubble(page,'Journey A first request')).toHaveCount(1);
 await expect(bubble(page,REPLY)).toHaveCount(1);

 // 4. Switch Notes / Calendar / Browser: the same conversation is retained and continues.
 for(const app of ['Notes','Calendar','Browser']){
  await returnToApps(page);
  await page.getByRole('button',{name:app,exact:true}).click();
  const region=page.getByRole('region',{name:app,exact:true});
  await expect(region).toBeVisible();
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  await expect(bubble(page,'Journey A first request')).toHaveCount(1);
  if(app==='Notes'){
   await message.fill('Journey A second request');await message.press('Enter');
   await expect(bubble(page,'Journey A second request')).toHaveCount(1);
   await expect(bubble(page,REPLY)).toHaveCount(2);
  }else{
   await expect(bubble(page,'Journey A second request')).toHaveCount(1);
   await expect(bubble(page,REPLY)).toHaveCount(2);
  }
  if(app==='Calendar'){
   // 5. Cancel a pending reply. The harness holds the agent document lock so the reply cannot be committed yet.
   await page.evaluate(async name=>{await new Promise<void>(ready=>{void navigator.locks.request(name,async()=>{ready();await new Promise<void>(release=>(window as any).releaseAgent=release);});});},AGENT_LOCK);
   await message.fill('Journey A cancelled request');await message.press('Enter');
   await expect(bubble(page,'Journey A cancelled request')).toHaveCount(1);
   const stop=page.getByRole('button',{name:'Stop reply',exact:true});
   await expect(stop).toBeVisible();
   await stop.click();
   await expect(stop).toHaveCount(0);
   const conversation=page.locator('[data-alpha-layer="conversation"]');
   // Honest in-chat state, shown exactly once: no claim that the agent stopped or that nothing happened,
   // and no second "may have reached the agent" bubble beside it.
   await expect(conversation.getByText(MAY_FINISH,{exact:true})).toHaveCount(1);
   await expect(conversation.getByText('Request cancelled. A dispatched action may still need status reconciliation.',{exact:true})).toHaveCount(0);
   await expect(bubble(page,'Your message may have reached the agent. Check before sending it again.')).toHaveCount(0);
   await expect(conversation.getByText('The agent stopped this reply.',{exact:true})).toHaveCount(0);
   // While the single check is pending there is nothing to press: the check is automatic.
   await expect(page.getByRole('button',{name:/^Check saved conversation/})).toHaveCount(0);
   await expect(bubble(page,'Journey A cancelled request')).toHaveCount(1);
   await expect(bubble(page,REPLY)).toHaveCount(2);
   // The cancelled text is not returned to the composer (it was dispatched; never a blind resend).
   await expect(message).toHaveValue('');
   const readsAtStop=await agentReads(page);
   await page.evaluate(()=>(window as any).releaseAgent());
   await page.evaluate(name=>navigator.locks.request(name,()=>{}),AGENT_LOCK);
   // The development agent never committed the cancelled request, and it does not arrive late.
   const afterStop=await agentDocument(page);
   expect(afterStop).toHaveLength(1);
   expect(afterStop![0].roles).toEqual(['user','assistant','user','assistant']);
   expect(afterStop![0].texts.some((t:string)=>t.includes('Journey A cancelled request'))).toBe(false);
   // The one automatic check (about 15 s after Stop) reads the agent's own history and reports what it holds:
   // the agent has no record of the stopped message. The pending notice is replaced, not added to.
   await expect(conversation.getByText(NOT_RECORDED,{exact:true})).toHaveCount(1,{timeout:60_000});
   await expect(conversation.getByText(MAY_FINISH,{exact:true})).toHaveCount(0);
   await expect(page.getByRole('button',{name:/^Check saved conversation/})).toHaveCount(0);
   await expect(bubble(page,'Journey A cancelled request')).toHaveCount(1);
   await expect(bubble(page,REPLY)).toHaveCount(2);
   await expect(message).toHaveValue('');
   const readsAfterCheck=await agentReads(page);
   expect(readsAfterCheck).toBeGreaterThan(readsAtStop);
   // Exactly once: for longer than another check interval nothing reads the agent again, the outcome stands,
   // and the check wrote and sent nothing.
   await page.waitForTimeout(20_000);
   expect(await agentReads(page)).toBe(readsAfterCheck);
   await expect(conversation.getByText(NOT_RECORDED,{exact:true})).toHaveCount(1);
   await expect(conversation.getByText(MAY_FINISH,{exact:true})).toHaveCount(0);
   expect(await agentDocument(page)).toEqual(afterStop);
   // The Check saved conversation card, the user's explicit re-read of the agent's history, was removed, so
   // there is nothing to press: the stopped request stays in this transcript beside the outcome until step 8
   // restores the agent's own copy.
   await expect(page.getByRole('button',{name:/^Check saved conversation/})).toHaveCount(0);
   await expect(bubble(page,'Journey A cancelled request')).toHaveCount(1);
  }
 }

 // 6. The conversation still accepts a request after the cancellation.
 await returnToApps(page);
 await ask.fill('Journey A third request');await ask.press('Enter');
 await expect(bubble(page,'Journey A third request')).toHaveCount(1);
 await expect(bubble(page,REPLY)).toHaveCount(3);

 // 7. Reload (browser stand-in for restart). The selection survives; the visible chat is not restored by itself.
 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(message).toBeVisible();
 await expect(bubble(page,REPLY)).toHaveCount(0);
 await returnToApps(page);
 await openConnection(page);
 await expect(page.getByRole('dialog',{name:'Development connections'}).getByText('On-device agent · development',{exact:true}).last()).toBeVisible();
 await page.getByRole('button',{name:'Load conversations'}).click();
 await expect(page.getByRole('button',{name:'Restore conversation'})).toHaveCount(1);
 await page.getByRole('button',{name:'Restore conversation'}).click();

 // 8. Exactly one result per accepted request, none for the cancelled one, in the UI and in the agent's store.
 for(const text of ['Journey A first request','Journey A second request','Journey A third request'])await expect(bubble(page,text)).toHaveCount(1);
 await expect(bubble(page,REPLY)).toHaveCount(3);
 await expect(bubble(page,'Journey A cancelled request')).toHaveCount(0);
 const stored=await agentDocument(page);
 expect(stored).toHaveLength(1);
 expect(stored![0].roles).toEqual(['user','assistant','user','assistant','user','assistant']);
 expect(stored![0].receipts).toHaveLength(3);
 expect(new Set(stored![0].receipts.map((r:any)=>r.id)).size).toBe(3);
 for(const text of ['Journey A first request','Journey A second request','Journey A third request']){
  expect(stored![0].receipts.filter((r:any)=>r.input.endsWith('[USER MESSAGE]\n'+text)&&r.text===REPLY)).toHaveLength(1);
  expect(stored![0].texts.filter((t:string)=>t.endsWith('[USER MESSAGE]\n'+text))).toHaveLength(1);
 }
 expect(stored![0].texts.filter((t:string)=>t===REPLY)).toHaveLength(3);
 expect(stored![0].texts.some((t:string)=>t.includes('Journey A cancelled request')||t.includes('Journey A unsent draft'))).toBe(false);
 expect(external).toEqual([]);
});

// Journey hardening (docs/core-loop-audit.md, work order 14): journey A had no declined action.
// The proposal is authored through the development "Action JSON" control (no model decides it);
// the card, Decline and the read-back are the real rendered path.
test('journey A: a proposed phone action is declined from the conversation and nothing runs, before or after a reload',async({page})=>{
 test.setTimeout(120_000);
 const notes=()=>page.evaluate(async()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records as any[]);
 const actions=()=>page.evaluate(async()=>(await (await import('/src/browser/development-execution-document.ts')).readExecutionPart({namespace:'local'} as any,'actions',()=>({proposals:[],journal:[]}))) as any);
 await page.goto('/?mode=dev');await openLegacyNotes(page);await returnToApps(page);
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 const ask=page.getByRole('textbox',{name:'Ask Alpha',exact:true}),conversation=page.locator('[data-alpha-layer="conversation"]');
 await openConnection(page);
 const dialog=page.getByRole('dialog',{name:'Development connections'});
 await dialog.getByRole('textbox',{name:'Scripted reply'}).fill(REPLY);
 await dialog.getByRole('button',{name:'Save development reply'}).click();
 await dialog.getByRole('button',{name:'Connect development profile'}).click();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 await dialog.getByText('Development device actions',{exact:true}).click();
 await dialog.getByRole('textbox',{name:'Action JSON'}).fill(JSON.stringify({type:'create_note',title:'Journey A declined note',body:'Must never be saved'}));
 await dialog.getByRole('button',{name:'Queue action for review'}).click();
 await expect(dialog.getByText('Action queued. Send a chat message to review it on the current screen.',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close connection settings'}).click();
 await returnToApps(page);

 await ask.fill('Journey A request with a proposal');await ask.press('Enter');
 await expect(bubble(page,'Journey A request with a proposal')).toHaveCount(1);
 await expect(bubble(page,REPLY)).toHaveCount(1);
 const approve=page.getByRole('button',{name:/^Create note/}),decline=page.getByRole('button',{name:/^Cancel Keep things as they are\./});
 await expect(approve).toHaveCount(1);
 // The exact content is shown for review and nothing has run.
 await expect(conversation).toContainText('“Journey A declined note”');
 await expect(conversation).toContainText('Must never be saved');
 expect(await notes()).toEqual([]);
 await decline.dblclick();
 await expect(conversation.getByText('Declined. No phone action was performed.',{exact:true})).toHaveCount(1);
 await expect(approve).toHaveCount(0);
 await expect(decline).toHaveCount(0);
 expect(await notes()).toEqual([]);
 let state=await actions();
 expect(state.proposals.map((p:any)=>[p.payload.operation.type,p.state,p.receipt??null])).toEqual([['create_note','rejected',null]]);
 expect(state.journal).toEqual([]);
 // The conversation continues: one reply per accepted request, and the declined action stays declined.
 await conversation.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Journey A request after declining');
 await conversation.getByRole('textbox',{name:'Message Alpha',exact:true}).press('Enter');
 await expect(bubble(page,REPLY)).toHaveCount(2);
 await expect(approve).toHaveCount(0);

 await page.reload();
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 await openLegacyNotes(page);
 await expect(page.getByRole('button',{name:'Open Journey A declined note',exact:true})).toHaveCount(0);
 expect(await notes()).toEqual([]);
 state=await actions();
 expect(state.proposals.map((p:any)=>p.state)).toEqual(['rejected']);
 expect(state.journal).toEqual([]);
});

// Journey hardening (docs/core-loop-audit.md, work order 14): journey A had no spoken request.
// Synthetic boundaries only: the microphone is a Web Audio oscillator (the browser's real recorder
// and the product's own voice-activity detection hear it), Cloud transcription is the closed
// fixture returning a fixed string, and speech output is recorded instead of played. The turn is
// sent to, stored by and answered by the development agent through the real voice-turn path.
// Not provable here: a person's voice, recognition quality, audible playback, barge-in.
test('journey A: a spoken request is transcribed, sent once, answered once and read back, and silence sends nothing',async({page})=>{
 test.setTimeout(180_000);
 const SPOKEN='Journey A spoken request';
 const cloud=()=>page.evaluate(()=>{const f=(window as any).cloudVoiceFixture;return {transcriptions:f.transcriptions.length as number,speech:f.speech.map((s:any)=>s.text) as string[]};});
 await page.goto('/?mode=dev');
 await expect(page.getByRole('region',{name:'Home'})).toBeVisible();
 // The Cloud voice fixture replaces the controller's account getters without publishing a connection
 // update. It is installed before the agent connects, so every later update carries one unchanged
 // account. Installed after connecting, the first update after Talk (the conversation the voice start
 // selects) read as an account change and ended the conversation whenever it arrived after voice had
 // started, which it did on every hosted run.
 await installCloudVoiceFixture(page,SPOKEN,true);
 await openConnection(page);
 const dialog=page.getByRole('dialog',{name:'Development connections'});
 await dialog.getByRole('textbox',{name:'Scripted reply'}).fill(REPLY);
 await dialog.getByRole('button',{name:'Save development reply'}).click();
 await dialog.getByRole('button',{name:'Connect development profile'}).click();
 await expect(dialog).toHaveCount(0);
 await returnToApps(page);
 await page.bringToFront();
 await page.evaluate(()=>{
  const w=window as any;w.speechFixture={spoken:[],current:null};
  const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=0;osc.connect(gain);osc.start();
  document.addEventListener('click',()=>{void ctx.resume();},{once:true,capture:true});
  // Each capture gets its own stream, as a real microphone does: the recorder stops the tracks it was given.
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const sink=ctx.createMediaStreamDestination();gain.connect(sink);w.mic.opened++;return sink.stream;}},configurable:true});w.mic={ctx,osc,gain,opened:0};
 });

 // One press of Talk on Home opens the conversation and starts listening. Nothing is sent by opening it.
 const voice=page.getByRole('region',{name:'Voice conversation',exact:true}),talk=page.getByRole('button',{name:'Talk',exact:true});
 await expect(talk).toHaveCount(1);
 await talk.click();
 await expect(voice).toHaveAttribute('data-voice-state','listening',{timeout:30_000});
 await expect(voice).toContainText('Speech is transcribed with Eliza Cloud and sent to this conversation');
 // Silence: the microphone is open and nothing is transcribed or sent.
 await page.waitForTimeout(2500);
 expect(await cloud()).toEqual({transcriptions:0,speech:[]});
 // Starting voice binds one conversation; it holds no message.
 expect(await agentDocument(page)).toEqual([{roles:[],texts:[],receipts:[]}]);

 // "Speak" for about a second, then pause.
 await page.evaluate(()=>{(window as any).mic.gain.gain.value=.6;});
 await page.waitForTimeout(1300);
 await page.evaluate(()=>{(window as any).mic.gain.gain.value=0;});
 await expect(voice).toHaveAttribute('data-voice-state','speaking',{timeout:30_000});
 // The transcript and the matching reply are shown; the reply, and only the reply, is spoken.
 await expect(bubble(page,SPOKEN)).toBeVisible();
 await expect(bubble(page,REPLY)).toBeVisible();
 expect(await cloud()).toEqual({transcriptions:1,speech:[REPLY]});
 let stored=await agentDocument(page);
 expect(stored).toHaveLength(1);
 expect(stored![0].roles).toEqual(['user','assistant']);
 expect(stored![0].texts[0].endsWith('[USER MESSAGE]\n'+SPOKEN)).toBe(true);
 expect(stored![0].receipts).toHaveLength(1);

 // Playback ends: the microphone opens again, and a silent pause sends nothing more.
 await page.evaluate(()=>(window as any).speechFixture.current.onend());
 await expect(voice).toHaveAttribute('data-voice-state','listening',{timeout:30_000});
 await page.waitForTimeout(2500);
 expect(await cloud()).toEqual({transcriptions:1,speech:[REPLY]});
 expect(await agentDocument(page)).toEqual(stored);

 // Stop retires voice while keeping the conversation visible. Explicitly minimizing
 // and reopening it retains the same accepted turn exactly once.
 await voice.getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 await expect(voice).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await expect(page.getByRole('group',{name:'Assistant controls',exact:true})).toBeVisible();
 await expect(bubble(page,SPOKEN)).toHaveCount(0);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(bubble(page,SPOKEN)).toHaveCount(1);
 await expect(bubble(page,REPLY)).toHaveCount(1);
 // A typed request continues the same conversation.
 const message=page.getByRole('textbox',{name:'Message Alpha',exact:true});
 await message.fill('Journey A typed after speaking');await message.press('Enter');
 await expect(bubble(page,REPLY)).toHaveCount(2);
 stored=await agentDocument(page);
 expect(stored).toHaveLength(1);
 expect(stored![0].roles).toEqual(['user','assistant','user','assistant']);
 expect(stored![0].texts.filter((t:string)=>t.endsWith('[USER MESSAGE]\n'+SPOKEN))).toHaveLength(1);
 expect(await cloud()).toEqual({transcriptions:1,speech:[REPLY]});
 await page.evaluate(async()=>{const {osc,ctx}=(window as any).mic;osc.stop();await ctx.close();});
});
