import {test,expect,type Page} from '@playwright/test';
import {preloadPageModules} from './helpers/page-modules';

const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
async function setup(page:Page,signed=true,theme='light'){
 await page.route('https://**/*',route=>route.abort());
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=(window as any).chatVoiceFixture={owner:'a',starts:0,stops:0,uploads:0,cancels:0,media:0,playback:0,localProbes:0,active:null,holdStart:false,holdTranscript:false,peak:0,sends:0,speech:0};
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{f.media++;throw Error('This test forbids microphone access');};
 });
 await page.goto('/?theme='+theme);
 await expect(page.locator('textarea[data-alpha-composer]')).toBeEnabled();
 await preloadPageModules(page,['/src/browser/voice.ts','/src/runtime/connection-ui.tsx','/src/prototype/model.js','/src/runtime/voice-selection.ts','/src/runtime/voice-timing.ts','/src/runtime/diagnostics-export.ts']);
 await page.evaluate(async signed=>{
  const {BrowserVoice}=await import('/src/browser/voice.ts'),{connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{Component}=await import('/src/prototype/model.js');
  const f=(window as any).chatVoiceFixture;
  const snapshot={...c.getSnapshot(),open:false,busy:false,session:{origin:'https://owned.invalid',ownerId:'owner',agentId:'agent',sessionId:'synthetic-agent'}};c.getSnapshot=()=>snapshot as any;
  c.getCloudEnvironment=()=>signed?'production':null;c.getCloudClient=()=>signed?({sessionId:'synthetic-cloud-'+f.owner,credentialId:'synthetic-credential-'+f.owner,client:{}} as any):null;
  BrowserVoice.prototype.startRecording=async()=>{const index=++f.starts;if(f.holdStart&&index===1)await new Promise<void>(resolve=>f.releaseStart=resolve);f.active='synthetic-clip-'+index;return {recordingId:f.active,maxDurationMs:59000};};
  BrowserVoice.prototype.getRecordingMetrics=async(input:any)=>({recordingId:input.recordingId,peak:f.peak});
  BrowserVoice.prototype.stopRecording=async()=>{f.stops++;f.active=null;return {recordingId:'synthetic-clip-'+f.starts,durationMs:1000};};
  BrowserVoice.prototype.cancelRecording=async()=>{f.cancels++;f.active=null;};
  BrowserVoice.prototype.transcribeRecording=async input=>{f.uploads++;f.transcription=input;if(f.holdTranscript)await new Promise<void>(resolve=>f.releaseTranscript=resolve);return {text:'Synthetic Cloud transcript',local:false};};
  BrowserVoice.prototype.localSpeechStatus=async()=>{f.localProbes++;throw Error('This test forbids local speech preparation');};
  BrowserVoice.prototype.transcribeLocalRecording=async()=>{throw Error('This test forbids local transcription');};
  BrowserVoice.prototype.synthesize=async(input:any)=>{f.speech++;return {playbackId:'synthetic-'+input.requestId};};
  BrowserVoice.prototype.play=async function(input:any){f.playback++;f.finishPlayback=()=>{void (this as any).notifyListeners('playbackEnded',input);};};
  BrowserVoice.prototype.cancel=async()=>{};
  BrowserVoice.prototype.stopPlayback=async()=>{};
  Component.prototype.prepareVoiceConversation=async function(signal:any){signal.throwIfAborted();return {binding:{conversationId:'synthetic-room',session:{sessionId:'synthetic-agent'},connectionEpoch:1},context:{view:this.S().view||'home',revision:1,sensitive:false}};};
  Component.prototype.voiceConversationCurrent=()=>true;
  Component.prototype.voiceConversationContext=function(){return {view:this.S().view||'home',revision:1,sensitive:false};};
  Component.prototype.sendVoiceTurn=async(input:any)=>{input.signal.throwIfAborted();input.assertCurrent();f.sends++;f.sent=input.text;return {requestId:input.turnId,conversationId:'synthetic-room',userMessageId:'user-'+f.sends,assistantMessageId:'assistant-'+f.sends,text:'Synthetic matching reply.',complete:true};};
  const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};c.close();
 },signed);
 await expect.poll(()=>page.evaluate(()=>!!(window as any).chatVoiceFixture.shell)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).chatVoiceFixture.shell.swallowed())).toBe(false);
}
async function utterance(page:Page){await page.evaluate(()=>(window as any).chatVoiceFixture.peak=.25);await page.waitForTimeout(950);await page.evaluate(()=>(window as any).chatVoiceFixture.peak=0);}
async function noMedia(page:Page){expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {media:f.media,local:f.localProbes};})).toEqual({media:0,local:0});}

test('unsigned chat voice stays in Home and offers only explicit Cloud sign-in',async({page},info)=>{
 await setup(page,false);await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await expect(page.getByRole('button',{name:'Connect Eliza Cloud',exact:true})).toBeEnabled();await expect(voice(page).getByRole('button',{name:'Microphone off',exact:true})).toBeDisabled();await expect(voice(page).getByRole('button',{name:'Stop voice conversation',exact:true})).toBeEnabled();expect(await page.evaluate(()=>(window as any).chatVoiceFixture.starts)).toBe(0);await expect(page.locator('[data-alpha-subview="notes-recording"]')).toHaveCount(0);await expect(page.locator('[data-alpha-transcript]')).toBeVisible();await expect(page.locator('textarea[data-alpha-composer]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('unsigned-stop-microphone-off.png'),animations:'disabled'});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);await expect(page.locator('[data-alpha-layer="conversation"]')).toBeVisible();await expect(page.locator('textarea[data-alpha-composer]')).toBeVisible();expect(await page.evaluate(()=>(window as any).chatVoiceFixture.starts)).toBe(0);await noMedia(page);
});

test('ongoing Cloud conversation stays in Calendar, sends only new speech and preserves the saved draft and Notes',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.evaluate(()=>new Promise<void>(resolve=>{const f=(window as any).chatVoiceFixture;f.shell.setState({chat:'hidden',draft:'Existing unsent draft'},()=>{f.notes=JSON.stringify(f.shell.vget('notes'));resolve();});}));
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(page.locator('[data-alpha-pill-voice]')).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as any).chatVoiceFixture.shell.swallowed())).toBe(false);await page.locator('[data-alpha-pill-voice]').getByRole('button',{name:'Open conversation',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');await expect(voice(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveCount(0);await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {notes:JSON.stringify(f.shell.vget('notes'))===f.notes,draft:f.shell.S().draft,starts:f.starts,uploads:f.uploads,sends:f.sends,sent:f.sent,speech:f.speech};})).toEqual({notes:true,draft:'Existing unsent draft',starts:1,uploads:1,sends:1,sent:'Synthetic Cloud transcript',speech:1});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);expect(await page.evaluate(()=>(window as any).chatVoiceFixture.shell.S().draft)).toBe('Existing unsent draft');await noMedia(page);
});
test('the recorded-clip conversation shows no interruption notice and records its batch path',async({page})=>{
 await setup(page);await page.evaluate(()=>{const f=(window as any).chatVoiceFixture,toast=f.shell.toast.bind(f.shell);f.toasts=[];f.shell.toast=(message:string,...rest:unknown[])=>{f.toasts.push(message);return toast(message,...rest);};});
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).chatVoiceFixture.toasts)).toEqual([]);
 const paths=await page.evaluate(async()=>{const timing=await import('/src/runtime/voice-timing.ts'),{buildDiagnostics}=await import('/src/runtime/diagnostics-export.ts');
  const records=timing.voiceTimingRecords().filter((r:any)=>r.entry==='conversation');
  return {live:records.map((r:any)=>r.live),paths:buildDiagnostics({voiceTiming:JSON.parse(timing.exportVoiceTiming())}).voiceTiming.records.filter((r:any)=>r.entry==='conversation').map((r:any)=>r.path)};});
 expect(paths.live[0]).toEqual({mode:'batch',partials:0});expect(paths.paths[0]).toBe('batch');
 await noMedia(page);
});
test('the default send policy is auto-send: a finished transcript is sent with no review step',async({page})=>{
 await setup(page);expect(await page.evaluate(async()=>(await import('/src/runtime/voice-selection.ts')).voiceSendPolicy())).toBe('auto-send');
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await expect(voice(page)).toContainText('sent to this conversation');
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 await expect(voice(page).getByRole('button',{name:'Send voice message',exact:true})).toHaveCount(0);await expect(voice(page).getByRole('textbox',{name:'Review transcript',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {sends:f.sends,sent:f.sent};})).toEqual({sends:1,sent:'Synthetic Cloud transcript'});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noMedia(page);
});
test('the review send policy holds each transcript for an edited Send or a Discard that sends nothing',async({page})=>{
 await setup(page);expect(await page.evaluate(async()=>(await import('/src/runtime/voice-selection.ts')).setVoiceSendPolicyForTests('review'))).toBe(true);
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await expect(voice(page)).toContainText('shown to you before anything is sent');
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','review');
 await expect(voice(page).getByRole('button',{name:'Stop voice conversation',exact:true})).toBeEnabled();await expect(voice(page).getByRole('button',{name:'Microphone off',exact:true})).toBeDisabled();
 const review=voice(page).getByRole('textbox',{name:'Review transcript',exact:true});await expect(review).toHaveValue('Synthetic Cloud transcript');await expect(voice(page)).toContainText('Nothing has been sent.');
 expect(await page.evaluate(()=>(window as any).chatVoiceFixture.sends)).toBe(0);
 await review.fill('   ');await expect(voice(page).getByRole('button',{name:'Send voice message',exact:true})).toBeDisabled();
 await review.fill('Edited Cloud words');await voice(page).getByRole('button',{name:'Send voice message',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {sends:f.sends,sent:f.sent};})).toEqual({sends:1,sent:'Edited Cloud words'});
 await page.evaluate(()=>(window as any).chatVoiceFixture.finishPlayback());await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','review');await voice(page).getByRole('button',{name:'Discard voice message',exact:true}).click();
 await expect(voice(page)).toHaveCount(0);await expect(page.locator('textarea[data-alpha-composer]')).toBeVisible();
 expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {sends:f.sends,uploads:f.uploads,active:f.active};})).toEqual({sends:1,uploads:2,active:null});await noMedia(page);
});
test('minimize returns the same owned capture to compact pill; explicit Stop retires media',async({page})=>{await setup(page);await page.evaluate(()=>(window as any).chatVoiceFixture.shell.setState({chat:'hidden',draft:'Keep this draft'}));await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(page.locator('[data-alpha-pill-voice]')).toBeVisible();expect(await page.evaluate(()=>(window as any).chatVoiceFixture.shell.S().chat)).toBe('hidden');await expect.poll(()=>page.evaluate(()=>(window as any).chatVoiceFixture.shell.swallowed())).toBe(false);await page.locator('[data-alpha-pill-voice]').getByRole('button',{name:'Open conversation',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await expect(page.locator('[data-alpha-pill-voice]')).toBeVisible();expect(await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;return {chat:f.shell.S().chat,draft:f.shell.S().draft,active:f.active,starts:f.starts,sends:f.sends};})).toEqual({chat:'hidden',draft:'Keep this draft',active:'synthetic-clip-1',starts:1,sends:0});await page.locator('[data-alpha-pill-voice]').getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).chatVoiceFixture.active)).toBe(null);await expect(page.locator('[data-alpha-pill-voice]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).chatVoiceFixture.starts)).toBe(1);await noMedia(page);});
test('account change discards held ASR and never resumes it',async({page})=>{await setup(page);await page.evaluate(()=>(window as any).chatVoiceFixture.holdTranscript=true);await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','transcribing');await page.evaluate(async()=>{const f=(window as any).chatVoiceFixture;f.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});await expect(voice(page)).toHaveCount(0);await page.evaluate(()=>(window as any).chatVoiceFixture.releaseTranscript());expect(await page.evaluate(()=>(window as any).chatVoiceFixture.sends)).toBe(0);await noMedia(page);});

for(const theme of ['light','dark'])test(`compact chat header and voice controls retain half/full geometry: ${theme}`,async({page},info)=>{
 await setup(page,true,theme);await page.getByRole('button',{name:'Talk',exact:true}).click();
 for(const detent of ['half','full']){
  if(detent==='full')await page.getByRole('button',{name:'Expand chat',exact:true}).click();
  await page.locator('[data-alpha-layer="conversation"]').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const geometry=await page.evaluate(()=>{const panel=document.querySelector('[data-alpha-layer="conversation"]')!.getBoundingClientRect(),brand=document.querySelector('[data-alpha-chat-home]')!.getBoundingClientRect(),grab=document.querySelector('[aria-label="Resize chat"]')!.getBoundingClientRect(),header=document.querySelector('[data-alpha-chat-header]')!.getBoundingClientRect(),controls=document.querySelector('[data-alpha-chat-controls]')!.getBoundingClientRect(),mark=document.querySelector('[aria-label="Resize chat"] span')!.getBoundingClientRect(),primary=document.querySelector('[data-alpha-chat-recorder] button[aria-label="Stop voice conversation"]')!.getBoundingClientRect();return {brandOffset:brand.top-panel.top,brandHeight:brand.height,grabHeight:grab.height,grabWidth:grab.width,center:Math.abs((grab.left+grab.right)/2-(panel.left+panel.right)/2),markOffset:mark.top-panel.top,disjoint:brand.right<=grab.left+.5&&grab.right<=controls.left+.5,primaryFits:primary.bottom<=panel.bottom&&primary.left>=panel.left&&primary.right<=panel.right,headerHeight:header.height};});
  expect(geometry.brandOffset).toBeLessThanOrEqual(8);expect(geometry.markOffset).toBeLessThanOrEqual(14);expect(geometry.center).toBeLessThan(1);expect(geometry).toMatchObject({brandHeight:44,grabHeight:44,grabWidth:44,disjoint:true,primaryFits:true,headerHeight:48});
  await page.screenshot({path:info.outputPath('chat-voice-'+theme+'-'+detent+'.png'),animations:'disabled'});
 }
 await page.getByRole('button',{name:'Minimize chat',exact:true}).click();await noMedia(page);
});

for(const theme of ['light','dark'])test(`paused Notes voice keeps real review and Stop controls visible at compact height: ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:740});await setup(page,true,theme);
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const f=(window as any).chatVoiceFixture;Component.prototype.sendVoiceTurn=async function(input:any){input.assertCurrent();f.sends++;f.turnId=input.turnId;this.cardAct=async()=>{f.reviewClicks=(f.reviewClicks||0)+1;};this.agentSay('Review the synthetic Notes request.',{type:'generic',icon:'check',title:'Approve: Share Notes',sub:'Review the exact note before sharing',proposalId:'owned-proposal',expiresAt:Date.now()+60000});return {requestId:input.turnId,conversationId:'synthetic-room',userMessageId:'original-user',assistantMessageId:'queued-assistant',text:'Review before sharing.',complete:false,awaitingUserInput:{proposalId:'owned-proposal',digest:'a'.repeat(64)}};};});
 await page.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');await utterance(page);await expect(voice(page)).toHaveAttribute('data-voice-state','awaiting-user-input');
 const review=page.getByRole('button',{name:/Approve: Share Notes/});await review.scrollIntoViewIfNeeded();await expect(review).toBeVisible();await expect(review).toBeEnabled();await expect(voice(page).getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible();
 const geometry=await page.evaluate(()=>{const panel=document.querySelector('[data-alpha-layer="conversation"]')!.getBoundingClientRect(),stop=document.querySelector('[data-alpha-chat-recorder] button[aria-label="Stop voice conversation"]')!.getBoundingClientRect(),review=[...document.querySelectorAll('button')].find(button=>button.textContent?.includes('Approve: Share Notes'))!.getBoundingClientRect();const f=(window as any).chatVoiceFixture;return {stopHeight:stop.height,reviewHeight:review.height,stopFits:stop.top>=panel.top&&stop.bottom<=panel.bottom,reviewFits:review.top>=panel.top&&review.bottom<=panel.bottom,disjoint:stop.bottom<=review.top||review.bottom<=stop.top,starts:f.starts,speech:f.speech,sends:f.sends,active:f.active};});
 expect(geometry.stopHeight).toBeGreaterThanOrEqual(44);expect(geometry.reviewHeight).toBeGreaterThanOrEqual(44);expect(geometry).toMatchObject({stopFits:true,reviewFits:true,disjoint:true,starts:1,speech:0,sends:1,active:null});await review.click();expect(await page.evaluate(()=>(window as any).chatVoiceFixture.reviewClicks)).toBe(1);await page.screenshot({path:info.outputPath('paused-review-'+theme+'.png'),animations:'disabled'});
 await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);await expect(page.locator('[data-alpha-layer="conversation"]')).toBeVisible();await expect(review).toBeVisible();await noMedia(page);
});

for(const viewport of [{width:390,height:740},{width:800,height:1200},{width:1280,height:900}])test(`text and voice keep the same composer footprint: ${viewport.width}`,async({page},info)=>{
 await page.setViewportSize(viewport);await setup(page);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 const panel=page.locator('[data-alpha-layer="conversation"]');
 const settle=()=>panel.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const box=()=>panel.locator('textarea[data-alpha-composer]').evaluate(el=>{const node=el.parentElement!,r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius};});
 const voiceBox=()=>voice(page).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius};});
 for(const detent of ['half','full']){
  if(detent==='full')await panel.getByRole('button',{name:'Expand chat',exact:true}).click();await settle();
  const text=await box();if(viewport.width>=760&&viewport.height>viewport.width)expect(text.width).toBeLessThanOrEqual(561);await page.evaluate(()=>(window as any).chatVoiceFixture.holdStart=true);
  await panel.getByRole('button',{name:'Talk',exact:true}).click();await expect(voice(page)).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).chatVoiceFixture.releaseStart)).toBe('function');await settle();
  const starting=await voiceBox();await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;f.holdStart=false;f.releaseStart();});await expect(voice(page)).toHaveAttribute('data-voice-state','listening');const listening=await voiceBox();
  await info.attach(`composer-${detent}`,{body:JSON.stringify({text,starting,listening},null,2),contentType:'application/json'});
  for(const state of [starting,listening]){expect(state.radius).toBe(text.radius);for(const key of ['x','y','width','height'] as const)expect(Math.abs(state[key]-text[key]),`${detent} ${key} remains fixed`).toBeLessThan(1);}
  await page.screenshot({path:info.outputPath(`composer-${detent}.png`),animations:'disabled'});
  await voice(page).getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice(page)).toHaveCount(0);await settle();
  const restored=await box();for(const key of ['x','y','width','height'] as const)expect(Math.abs(restored[key]-text[key])).toBeLessThan(1);
 }
 await noMedia(page);
});

test('compact pill keeps its footprint while voice connects and listens',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Notes',exact:true}).click();
 const pill=page.locator('[data-alpha-layer="pill"]'),outer=pill.locator(':scope > div');await expect(pill).toBeVisible();
 const settled=()=>outer.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));await settled();
 const measure=()=>outer.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius};});
 const text=await measure();await page.evaluate(()=>(window as any).chatVoiceFixture.holdStart=true);await pill.getByRole('button',{name:'Talk',exact:true}).click();await expect(pill.locator('[data-alpha-pill-voice]')).toBeVisible();await expect.poll(()=>page.evaluate(()=>typeof(window as any).chatVoiceFixture.releaseStart)).toBe('function');await expect(pill.locator('[data-alpha-voice-animation]')).toHaveAttribute('data-phase','connecting');await expect(pill.locator('button[aria-pressed]')).toBeDisabled();
 await settled();const starting=await measure();await page.evaluate(()=>{const f=(window as any).chatVoiceFixture;f.holdStart=false;f.releaseStart();});await expect.poll(()=>page.evaluate(()=>(window as any).chatVoiceFixture.active)).not.toBe(null);await expect(pill.locator('[data-alpha-voice-animation]')).toHaveAttribute('data-phase','listening');await settled();const listening=await measure();
 console.log(JSON.stringify({pill:{text,starting,listening}}));for(const state of [starting,listening]){expect(state.radius).toBe(text.radius);for(const key of ['x','y','width','height'] as const)expect(Math.abs(state[key]-text[key])).toBeLessThan(1);}
 await page.screenshot({path:info.outputPath('pill-voice.png'),animations:'disabled'});await pill.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(pill.getByRole('button',{name:'Talk',exact:true})).toBeVisible();await settled();const restored=await measure();for(const key of ['x','y','width','height'] as const)expect(Math.abs(restored[key]-text[key])).toBeLessThan(1);await noMedia(page);
});
