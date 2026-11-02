import {openLegacyNotes} from './helpers/legacy-notes';
import {returnToApps} from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
import {cloudNotesVoiceFixture,noPhysicalOrLocalVoice} from './cloud-notes-voice-fixture';
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
async function setup(page:Page,detent='sheet'){
 await cloudNotesVoiceFixture(page);await openLegacyNotes(page);await returnToApps(page);
 await page.evaluate(async detent=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{alphaClient}=await import('/src/runtime/alpha-client.ts'),{ViewNavigationClient}=await import('/src/runtime/view-navigation.ts'),{BrowserVoice}=await import('/src/browser/voice.ts'),{Component}=await import('/src/prototype/model.js');
  const w=window as any,f=w.ownedVoiceNavigation={room:crypto.randomUUID(),installationId:crypto.randomUUID(),session:{origin:'https://owned.invalid',ownerId:'synthetic-owner',agentId:'synthetic-agent',sessionId:'synthetic-session'},peak:0,target:'notes',claims:0,acks:0,inputs:[],requests:[],holdClaim:false,holdAck:false};
  const snapshot={...c.getSnapshot(),kind:'remote',open:false,busy:false,session:f.session};c.getSnapshot=()=>snapshot as any;
  c.prepareVoiceConversation=async signal=>{signal.throwIfAborted();return {conversationId:f.room,session:f.session,connectionEpoch:1};};
  c.voiceConversationCurrent=(binding,foreground=true)=>binding.connectionEpoch===1&&binding.conversationId===f.room&&JSON.stringify(binding.session)===JSON.stringify(f.session)&&(!foreground||!snapshot.open&&!document.hidden);
  const navigation=f.navigation=new ViewNavigationClient(async(path,body,signal)=>{signal.throwIfAborted();f.requests.push({path,body:structuredClone(body)});if(path.endsWith('interact-claim')){f.claims++;if(f.holdClaim)await new Promise<void>(resolve=>f.releaseClaim=resolve);return {claimId:'claim-'+(body as any).requestId};}f.acks++;if(f.holdAck)await new Promise<void>(resolve=>f.releaseAck=resolve);return {accepted:true};},()=>snapshot.session===f.session&&!snapshot.open,()=>alphaClient.getState().context);
  c.captureViewNavigation=context=>({client:navigation,attempt:navigation.capture(context)});
  const transport={session:f.session,send:async input=>{input.signal.throwIfAborted();if(input.channelType!=='VOICE_DM')throw Error('Only new voice turns expected');f.inputs.push({requestId:input.requestId,context:structuredClone(input.context),text:input.text,conversationId:input.expectedConversationId});const id=crypto.randomUUID(),viewId=f.target==='home'?'chat':f.target,values={mode:'show',viewId,viewPath:'/'+viewId,viewType:'gui',label:f.target,completedActionDelivered:true,completedActionHandoffId:id,navigationPrepared:true,navigationBinding:{clientId:navigation.clientId,requestId:id,viewId,viewType:'gui',installationId:f.installationId}};return {text:'Opened '+f.target+'.',messageId:crypto.randomUUID(),userMessageId:crypto.randomUUID(),messageBinding:{conversationId:f.room,session:f.session},actionResults:[{actionName:'VIEWS_SHOW',success:true,values}]};},execute:async()=>{throw Error('No approval or device action is admitted');}};
  BrowserVoice.prototype.getRecordingMetrics=async function(input){f.mediaDriver=this;if(f.peak>0)(f.speechSamples??=[]).push(performance.now());return {recordingId:input.recordingId,peak:f.peak};};
  BrowserVoice.prototype.synthesize=async(input:any)=>{(window as any).cloudNotesVoice.syntheses++;if(f.holdSynthesis)await new Promise<void>(resolve=>f.releaseSynthesis=resolve);return {playbackId:crypto.randomUUID()};};
  BrowserVoice.prototype.play=async function(input:any){f.playAdmissions=(f.playAdmissions||0)+1;f.finishPlayback=()=>void (this as any).notifyListeners('playbackEnded',input);};
  const send=Component.prototype.sendVoiceTurn;Component.prototype.sendVoiceTurn=async function(input:any){try{return await send.call(this,input);}catch(error:any){f.error={message:String(error),stack:error.stack};throw error;}};
  const original=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return original.call(this);};c.close();alphaClient.attachVerifiedTransport(transport);
 },detent);
 await expect.poll(()=>page.evaluate(()=>!!(window as any).ownedVoiceNavigation.shell)).toBe(true);
 await page.evaluate(detent=>new Promise<void>(resolve=>{const f=(window as any).ownedVoiceNavigation;f.seed=crypto.randomUUID();const row={id:f.seed,from:'user',text:'Retained target'};f.shell.messageReplyTarget={messageId:f.seed,from:'user',text:row.text,conversationId:f.room,session:f.session};f.shell.messageEditTarget={...f.shell.messageReplyTarget};f.reply=f.shell.messageReplyTarget;f.edit=f.shell.messageEditTarget;f.shell.setState({chat:detent,draft:'Retained unsent draft',msgs:[row]},()=>{f.notes=JSON.stringify(f.shell.notesStore.list);f.notesRaw=f.shell.notesStore.raw;resolve();});}),detent);
 await page.evaluate(()=>(window as any).ownedVoiceNavigation.shell.startVoice());await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
}
async function utterance(page:Page,target='notes'){await page.evaluate(target=>{const f=(window as any).ownedVoiceNavigation;f.target=target;(window as any).cloudNotesVoice.transcript='Please open '+target+'.';f.speechSamples=[];f.peak=.25;},target);await expect.poll(()=>page.evaluate(()=>{const samples=(window as any).ownedVoiceNavigation.speechSamples;return samples.length>=3?samples.at(-1)-samples[0]:0;}),{timeout:15000}).toBeGreaterThanOrEqual(950);await page.evaluate(()=>(window as any).ownedVoiceNavigation.peak=0);}
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus)await info.attach('closed-source-debug',{body:JSON.stringify(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation;return {error:f?.error,inputs:f?.inputs,requests:f?.requests,state:f?.shell?.S(),cloud:(window as any).cloudNotesVoice};})),contentType:'application/json'});});
for(const detent of ['sheet','full'])test(`canonical own Notes Calendar Home navigation keeps ${detent} voice through matching speech and rearm`,async({page},info)=>{
 await setup(page,detent);const originalContexts:any[]=[];
 for(const [index,target] of ['notes','calendar','home'].entries()){
  await utterance(page,target);await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');await expect(voice(page).getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-active-view',target);
  const observed=await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation;return {chat:f.shell.S().chat,toast:f.shell.S().toast,claims:f.claims,acks:f.acks,draft:f.shell.S().draft,reply:f.shell.messageReplyTarget===f.reply,edit:f.shell.messageEditTarget===f.edit,notes:JSON.stringify(f.shell.notesStore.list)===f.notes&&f.shell.notesStore.raw===f.notesRaw,inputs:f.inputs,requests:f.requests,starts:(window as any).cloudNotesVoice.starts};});
  expect(observed).toMatchObject({chat:detent,toast:'',claims:index+1,acks:index+1,draft:'Retained unsent draft',reply:true,edit:true,notes:true,starts:index+1});expect(observed.inputs[index].context.view).toBe(index===0?'home':['notes','calendar'][index-1]);expect(observed.inputs.every((input:any)=>input.conversationId===observed.inputs[0].conversationId)).toBe(true);const claim=observed.requests[index*2],ack=observed.requests[index*2+1];expect(claim.path).toBe('/api/views/interact-claim');expect(ack.path).toBe('/api/views/interact-result');expect(ack.body).toMatchObject({...claim.body,success:true,result:{switched:true}});originalContexts.push(observed.inputs[index].context);expect(observed.inputs.map((input:any)=>input.context)).toEqual(originalContexts);
  await page.screenshot({path:info.outputPath(target+'-'+detent+'.png'),animations:'disabled'});await page.evaluate(()=>(window as any).ownedVoiceNavigation.finishPlayback());await expect(voice(page)).toHaveAttribute('data-voice-state','listening');if(index<2)await page.waitForTimeout(1600);
 }
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);await noPhysicalOrLocalVoice(page);
});
for(const stage of ['claim','ack'])test(`Stop while ${stage} is held retires own navigation without speech or rearm`,async({page},info)=>{await setup(page);await page.evaluate(stage=>{(window as any).ownedVoiceNavigation[stage==='claim'?'holdClaim':'holdAck']=true;},stage);await utterance(page);await expect.poll(()=>page.evaluate(stage=>(window as any).ownedVoiceNavigation[stage==='claim'?'claims':'acks'],stage)).toBe(1);await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await page.evaluate(stage=>(window as any).ownedVoiceNavigation[stage==='claim'?'releaseClaim':'releaseAck'](),stage);await page.waitForTimeout(400);expect(await page.evaluate(()=>({speech:(window as any).cloudNotesVoice.syntheses,starts:(window as any).cloudNotesVoice.starts,acks:(window as any).ownedVoiceNavigation.acks}))).toEqual({speech:0,starts:1,acks:stage==='claim'?0:1});await noPhysicalOrLocalVoice(page);});
for(const change of ['user-navigation','account','selection'])test(`held ACK refuses voice continuation after ${change}`,async({page})=>{await setup(page);await page.evaluate(()=>(window as any).ownedVoiceNavigation.holdAck=true);await utterance(page);await expect.poll(()=>page.evaluate(()=>(window as any).ownedVoiceNavigation.acks)).toBe(1);await page.evaluate(async change=>{const f=(window as any).ownedVoiceNavigation;if(change==='user-navigation')f.shell.openView('calendar');else if(change==='account'){(window as any).cloudNotesVoice.owner='replacement';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();}else{const {alphaClient}=await import('/src/runtime/alpha-client.ts');alphaClient.setViewContext({...alphaClient.getState().context,selectedObject:{kind:'note',id:'new-user-selection',revision:'2'}});}f.releaseAck();},change);await page.waitForTimeout(400);expect(await page.evaluate(()=>({speech:(window as any).cloudNotesVoice.syntheses,starts:(window as any).cloudNotesVoice.starts}))).toEqual({speech:0,starts:1});await noPhysicalOrLocalVoice(page);});

test('Stop after accepted own ACK while TTS preparation is held admits no playback or rearm',async({page})=>{await setup(page);await page.evaluate(()=>(window as any).ownedVoiceNavigation.holdSynthesis=true);await utterance(page);await expect.poll(()=>page.evaluate(()=>typeof(window as any).ownedVoiceNavigation.releaseSynthesis)).toBe('function');await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');await expect(voice(page)).toHaveAttribute('data-voice-state','preparing-speech');expect(await page.evaluate(()=>(window as any).ownedVoiceNavigation.acks)).toBe(1);await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await page.evaluate(()=>(window as any).ownedVoiceNavigation.releaseSynthesis());await page.waitForTimeout(400);expect(await page.evaluate(()=>({plays:(window as any).ownedVoiceNavigation.playAdmissions||0,starts:(window as any).cloudNotesVoice.starts}))).toEqual({plays:0,starts:1});await noPhysicalOrLocalVoice(page);});

// These probes keep the real batch coordinator, Alpha sendVoiceTurn and navigation
// handshake. Only the closed media/Cloud transport ports are synthetic.
test('empty ASR stops without a turn and explicit restart sends the next spoken navigation exactly once',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).cloudNotesVoice.empty=true);
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','error');
 expect(await page.evaluate(()=>(window as any).cloudNotesVoice.active)).toBe(null);
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {inputs:f.inputs.length,claims:f.claims,acks:f.acks,speech:c.syntheses,uploads:c.uploads};})).toEqual({inputs:0,claims:0,acks:0,speech:0,uploads:1});
 await page.evaluate(()=>(window as any).cloudNotesVoice.empty=false);await page.getByRole('button',{name:'Try voice again',exact:true}).click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 expect(await page.evaluate(()=>(window as any).ownedVoiceNavigation.inputs.length)).toBe(0);
 await utterance(page,'calendar');
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {inputs:f.inputs.length,claims:f.claims,acks:f.acks,speech:c.syntheses,uploads:c.uploads,draft:f.shell.S().draft};})).toEqual({inputs:1,claims:1,acks:1,speech:1,uploads:2,draft:'Retained unsent draft'});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noPhysicalOrLocalVoice(page);
});

test('billing failure requires explicit restart and does not replay the failed utterance',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).cloudNotesVoice.billing=true);await utterance(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','error');// Failure text stays quiet; the explicit restart is what the owner gets.
 await expect(voice(page)).not.toContainText('billing');await expect(page.getByRole('button',{name:'Try voice again',exact:true})).toBeVisible();
 await page.waitForTimeout(1000);
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {inputs:f.inputs.length,starts:c.starts,speech:c.syntheses,uploads:c.uploads,active:c.active};})).toEqual({inputs:0,starts:1,speech:0,uploads:1,active:null});
 await page.evaluate(()=>(window as any).cloudNotesVoice.billing=false);await page.getByRole('button',{name:'Try voice again',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 expect(await page.evaluate(()=>(window as any).ownedVoiceNavigation.inputs.length)).toBe(0);
 await utterance(page,'notes');await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {inputs:f.inputs.length,claims:f.claims,acks:f.acks,speech:c.syntheses,uploads:c.uploads};})).toEqual({inputs:1,claims:1,acks:1,speech:1,uploads:2});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noPhysicalOrLocalVoice(page);
});

for(const retirement of ['stop','account'])test(`late held ASR after ${retirement} admits no navigation, send or media rearm`,async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).cloudNotesVoice.hold=true);await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','transcribing');
 if(retirement==='stop')await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 else await page.evaluate(async()=>{(window as any).cloudNotesVoice.owner='replacement';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});
 await expect(voice(page)).toHaveCount(0);await page.evaluate(()=>(window as any).cloudNotesVoice.release());await page.waitForTimeout(700);
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {inputs:f.inputs.length,claims:f.claims,acks:f.acks,starts:c.starts,speech:c.syntheses,draft:f.shell.S().draft};})).toEqual({inputs:0,claims:0,acks:0,starts:1,speech:0,draft:'Retained unsent draft'});await noPhysicalOrLocalVoice(page);
});


test('idle capture expiry and stale stop callbacks neither upload silence nor end the replacement capture',async({page})=>{
 await setup(page);
 await expect.poll(()=>page.evaluate(()=>!!(window as any).ownedVoiceNavigation.mediaDriver&&(window as any).cloudNotesVoice.active!==null)).toBe(true);
 const old=await page.evaluate(async()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;const recordingId=c.active;await f.mediaDriver.notifyListeners('recordingStopped',{recordingId,durationMs:59000});return recordingId;});
 await expect.poll(()=>page.evaluate(()=>(window as any).cloudNotesVoice.starts)).toBe(2);await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await page.evaluate(async recordingId=>{const f=(window as any).ownedVoiceNavigation;await f.mediaDriver.notifyListeners('recordingStopped',{recordingId,durationMs:59000});},old);await page.waitForTimeout(500);
 expect(await page.evaluate(()=>{const f=(window as any).ownedVoiceNavigation,c=(window as any).cloudNotesVoice;return {starts:c.starts,uploads:c.uploads,inputs:f.inputs.length,claims:f.claims,speech:c.syntheses};})).toEqual({starts:2,uploads:0,inputs:0,claims:0,speech:0});
 await utterance(page,'calendar');await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await page.evaluate(()=>(window as any).ownedVoiceNavigation.inputs.length)).toBe(1);
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noPhysicalOrLocalVoice(page);
});
