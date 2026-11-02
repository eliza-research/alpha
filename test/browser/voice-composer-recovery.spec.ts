import {test,expect,type Page} from '@playwright/test';

// A synthetic voice delegate exercises the real adapter/template without capturing audio,
// opening a speech connection or submitting a provider/model request.
async function setup(page:Page){
 await page.route('https://**/*',route=>route.abort());
 await page.route('**/src/runtime/development-cartesia-conversation.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
 export const developmentCartesiaVoiceEnabled=true;
 export async function developmentCartesiaConversation(input){
  const f=window.voicePresentationFixture;let muted=false;
  f.navigate=event=>input.onNavigate(event);f.context=()=>input.getUiContext();f.phase=phase=>{f.currentPhase=phase;input.onState(phase);};f.partial=text=>input.onTranscript(text);f.fail=()=>input.onError(Error('Synthetic voice unavailable'));
  return {start:async()=>{f.starts++;if(f.startHold){input.onState('connecting');await new Promise(resolve=>f.releaseStart=resolve);}input.onState('listening');},stop:async()=>{f.stops++;if(f.stopHold)await new Promise(resolve=>f.releaseStop=resolve);if(f.stopFailure)throw Error('Synthetic retirement unconfirmed');},recheck:()=>{},resume:()=>false,
   get microphoneAutomaticallyMuted(){return f.currentPhase==='speaking';},get microphoneMuted(){return muted;},setMicrophoneMuted:value=>{muted=value;f.muted=value;},needsPlaybackUnlock:false,unlockPlayback:async()=>{}};
 }`}));
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  (window as any).voicePresentationFixture={starts:0,stops:0,media:0,sends:0,muted:false};
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{(window as any).voicePresentationFixture.media++;throw Error('Actual microphone forbidden in synthetic presentation test');};
 });
 await page.goto('/');await expect(page.locator('textarea[data-alpha-composer]')).toBeEnabled();
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{Component}=await import('/src/prototype/model.js');
  const f=(window as any).voicePresentationFixture;
  const snapshot={...c.getSnapshot(),open:false,busy:false,session:{origin:'https://owned.invalid',ownerId:'owner',agentId:'agent',sessionId:'synthetic-agent'}};
  c.getSnapshot=()=>snapshot as any;c.getCloudEnvironment=()=>'production';c.getCloudClient=()=>({sessionId:'synthetic-cloud',credentialId:'synthetic-credential',client:{}} as any);
  Component.prototype.prepareVoiceConversation=async function(signal:any){signal.throwIfAborted();return {binding:{conversationId:'synthetic-room',session:{sessionId:'synthetic-agent'},connectionEpoch:1},context:{view:this.S().view||'home',revision:1,sensitive:false}};};
  c.voiceConversationCurrent=()=>true;
  Component.prototype.voiceConversationCurrent=()=>true;
  Component.prototype.sendVoiceTurn=async()=>{f.sends++;throw Error('Synthetic presentation must not send');};
  const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return render.call(this);};c.close();
 });
 await expect.poll(()=>page.evaluate(()=>!!(window as any).voicePresentationFixture.shell)).toBe(true);
}
async function noMediaOrSends(page:Page){expect(await page.evaluate(()=>{const f=(window as any).voicePresentationFixture;return {media:f.media,sends:f.sends};})).toEqual({media:0,sends:0});}

test('synthetic voice: one idle mic, full-width synth, mute and Stop preserve visible chat',async({page},info)=>{
 await setup(page);await expect(page.getByRole('button',{name:'Talk',exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'Transcribe',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 const before=await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat);
 await expect.poll(()=>page.evaluate(()=>(window as any).voicePresentationFixture.shell.swallowed())).toBe(false);await page.getByRole('button',{name:'Talk',exact:true}).click();
 const voice=page.locator('.alpha-voice-composer');await expect(voice).toHaveAttribute('data-voice-state','listening');
 await expect(page.locator('[data-alpha-transcript]')).toBeVisible();await expect(voice.locator('[data-alpha-voice-bar]')).toHaveCount(35);
 await expect(voice.getByRole('button',{name:'Switch to keyboard',exact:true})).toHaveCount(0);
 const widths=await voice.evaluate(element=>{const input=element.querySelector('.alpha-voice-input')!.getBoundingClientRect(),synth=element.querySelector('[data-alpha-voice-animation]')!.getBoundingClientRect();return {input:input.width,synth:synth.width};});expect(widths.synth).toBeGreaterThan(100);expect(Math.abs(widths.input-widths.synth)).toBeLessThan(1);
 await page.evaluate(()=>(window as any).voicePresentationFixture.partial('Synthetic live words'));
 await expect(page.locator('[data-alpha-transcript] [data-alpha-voice-interim]')).toHaveText('Synthetic live words');
 await voice.getByRole('button',{name:'Mute microphone',exact:true}).click();await expect(voice.getByRole('button',{name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
 await voice.getByRole('button',{name:'Unmute microphone',exact:true}).click();expect(await page.evaluate(()=>(window as any).voicePresentationFixture.muted)).toBe(false);
 await page.screenshot({path:info.outputPath('synthetic-inline-voice.png'),animations:'disabled'});
 await voice.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(voice).toHaveCount(0);expect(await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat)).toBe(before);await expect(page.locator('[data-alpha-layer="conversation"]')).toBeVisible();await noMediaOrSends(page);
});

test('synthetic pill voice keeps five-bar synth, mute and Stop compact without opening chat',async({page},info)=>{
 await setup(page);await page.evaluate(()=>new Promise<void>(resolve=>(window as any).voicePresentationFixture.shell.setState({chat:'hidden'},resolve)));
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 const pill=page.locator('[data-alpha-pill-voice]');await expect(pill).toBeVisible();await expect(pill.locator('[data-alpha-voice-bar]')).toHaveCount(5);
 expect(await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat)).toBe('hidden');
 await expect(pill.getByRole('button',{name:'Type',exact:true})).toHaveCount(0);
 await pill.getByRole('button',{name:'Mute microphone',exact:true}).click();await expect(pill.getByRole('button',{name:'Unmute microphone',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('synthetic-pill-voice.png'),animations:'disabled'});
 await pill.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(pill).toHaveCount(0);expect(await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat)).toBe('hidden');await noMediaOrSends(page);
});

for(const detent of ['sheet','full','hidden'])test(`synthetic voice error keeps a square Stop and truthful disabled mic: ${detent}`,async({page},info)=>{
 await setup(page);await page.evaluate(detent=>new Promise<void>(resolve=>(window as any).voicePresentationFixture.shell.setState({chat:detent},resolve)),detent);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 const controls=page.locator(detent==='hidden'?'[data-alpha-pill-voice]':'.alpha-voice-composer');await expect(controls.getByRole('button',{name:'Mute microphone',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).voicePresentationFixture.fail());
 const stop=controls.getByRole('button',{name:'Stop voice conversation',exact:true});await expect(stop).toBeEnabled();await expect(stop.locator('[data-alpha-icon]')).toHaveAttribute('data-alpha-icon','/icons/lucide/square.svg');
 const mic=controls.getByRole('button',{name:'Microphone status unconfirmed',exact:true});await expect(mic).toBeDisabled();await expect(mic).toHaveAttribute('aria-pressed','mixed');
 await expect(controls.getByRole('button',{name:/Connect|Try voice/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('synthetic-voice-error-'+detent+'.png'),animations:'disabled'});
 await stop.click();await expect(controls).toHaveCount(0);expect(await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat)).toBe(detent);await noMediaOrSends(page);
});

test('synthetic retirement failure keeps Stop guarded and never claims the mic is off',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Talk',exact:true}).click();const controls=page.locator('.alpha-voice-composer');await expect(controls).toHaveAttribute('data-voice-state','listening');
 await page.evaluate(()=>(window as any).voicePresentationFixture.stopFailure=true);await controls.getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 await expect(controls).toHaveAttribute('data-voice-state','error');const mic=controls.getByRole('button',{name:'Microphone status unconfirmed',exact:true});await expect(mic).toBeDisabled();await expect(mic).toHaveAttribute('aria-pressed','mixed');
 await controls.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(controls).toBeVisible();expect(await page.evaluate(()=>(window as any).voicePresentationFixture.starts)).toBe(1);await noMediaOrSends(page);
});

test('synthetic pending retirement stays unconfirmed until Stop acknowledgement',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Talk',exact:true}).click();const controls=page.locator('.alpha-voice-composer');await expect(controls).toHaveAttribute('data-voice-state','listening');
 await page.evaluate(()=>(window as any).voicePresentationFixture.stopHold=true);await controls.getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 await expect(controls).toHaveAttribute('data-voice-state','stopping');const mic=controls.getByRole('button',{name:'Microphone status unconfirmed',exact:true});await expect(mic).toBeDisabled();await expect(mic).toHaveAttribute('aria-pressed','mixed');await expect(controls.getByRole('button',{name:'Microphone off',exact:true})).toHaveCount(0);
 await page.evaluate(()=>(window as any).voicePresentationFixture.releaseStop());await expect(controls).toHaveCount(0);await noMediaOrSends(page);
});

test('synthetic pending microphone startup is unconfirmed until the ready state',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).voicePresentationFixture.startHold=true);await page.getByRole('button',{name:'Talk',exact:true}).click();const controls=page.locator('.alpha-voice-composer');await expect(controls).toHaveAttribute('data-voice-state','starting');
 const mic=controls.getByRole('button',{name:'Microphone status unconfirmed',exact:true});await expect(mic).toBeDisabled();await expect(mic).toHaveAttribute('aria-pressed','mixed');
 await page.evaluate(()=>(window as any).voicePresentationFixture.releaseStart());await expect(controls.getByRole('button',{name:'Mute microphone',exact:true})).toBeEnabled();await controls.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await expect(controls).toHaveCount(0);await noMediaOrSends(page);
});


test('realtime transcribing streams revised words into one pending bubble until the message is committed',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).voicePresentationFixture.shell.swallowed())).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 await page.evaluate(()=>{const f=(window as any).voicePresentationFixture;f.phase('transcribing');f.partial('hello');});
 const pending=page.locator('[data-alpha-voice-interim]');
 await expect(page.locator('.alpha-voice-composer')).toHaveAttribute('data-voice-state','transcribing');
 await expect(pending).toHaveText('hello');
 await expect(page.getByRole('button',{name:'Mute microphone',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).voicePresentationFixture.partial('hello from Alpha'));
 await expect(pending).toHaveCount(1);await expect(pending).toHaveText('hello from Alpha');
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('thinking'));
 await expect(pending).toHaveText('hello from Alpha');
 await page.evaluate(()=>{const f=(window as any).voicePresentationFixture;f.shell.setState({msgs:[{id:'committed-voice',from:'user',text:'hello from Alpha'}]});});
 await expect(pending).toHaveCount(0);
 await page.evaluate(()=>{const f=(window as any).voicePresentationFixture;f.phase('listening');f.phase('transcribing');f.partial('hello from Alpha');});
 await expect(pending).toHaveText('hello from Alpha');
 await page.getByRole('button',{name:'Stop voice conversation',exact:true}).click();
 await expect(pending).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeVisible();
 await noMediaOrSends(page);
});

test('blue synth distinguishes thinking from speech and respects reduced motion',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).voicePresentationFixture.shell.swallowed())).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 const wave=page.locator('.alpha-voice-composer [data-alpha-voice-animation]');
 const sample=()=>wave.evaluate(el=>({color:getComputedStyle(el).color,timings:[...el.children].map(c=>c.getAnimations()[0]?.effect?.getTiming()).filter(Boolean).map(t=>({duration:t!.duration,delay:t!.delay}))}));
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('thinking'));
 await expect(wave).toHaveAttribute('data-phase','thinking');const thinking=await sample();
 expect(thinking.timings[6].delay).toBeGreaterThan(thinking.timings[5].delay);
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('speaking'));
 await expect(wave).toHaveAttribute('data-phase','speaking');const speaking=await sample();
 expect(speaking.color).not.toBe(thinking.color);expect(speaking.timings[0].duration).toBeLessThan(thinking.timings[0].duration);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(wave).toHaveAttribute('data-paused','true');
 await expect.poll(()=>wave.evaluate(el=>[...el.children].flatMap(c=>c.getAnimations()).length)).toBe(0);
 await page.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noMediaOrSends(page);
});


test('realtime voice opens Notes in the real shell while retaining chat and the next transcript',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).voicePresentationFixture.shell.swallowed())).toBe(false);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 const detent=await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat);
 await page.evaluate(async()=>{const f=(window as any).voicePresentationFixture;await f.navigate({viewId:'notes',viewPath:'/notes',traceId:'synthetic-notes-turn'});});
 await expect.poll(()=>page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().view)).toBe('notes');
 expect(await page.evaluate(()=>(window as any).voicePresentationFixture.shell.S().chat)).toBe(detent);
 await expect(page.getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible();
 await page.evaluate(()=>{const f=(window as any).voicePresentationFixture;f.phase('transcribing');f.partial('and make a note');});
 await expect(page.locator('[data-alpha-voice-interim]')).toHaveText('and make a note');
 await page.getByRole('button',{name:'Stop voice conversation',exact:true}).click();await noMediaOrSends(page);
});


test('speaking shows automatic microphone pause without changing the manual mute preference',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Talk',exact:true}).click();
 const voice=page.locator('.alpha-voice-composer');
 await voice.getByRole('button',{name:'Mute microphone',exact:true}).click();
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('speaking'));
 const paused=voice.getByRole('button',{name:'Microphone paused while Alpha responds',exact:true});
 await expect(paused).toBeDisabled();await expect(paused).toHaveAttribute('aria-pressed','true');
 await expect(voice.locator('[data-alpha-voice-animation]')).toHaveAttribute('data-phase','speaking');
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('listening'));
 await expect(voice.getByRole('button',{name:'Unmute microphone',exact:true})).toBeEnabled();
 await voice.getByRole('button',{name:'Unmute microphone',exact:true}).click();
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('speaking'));
 await expect(paused).toBeDisabled();
 await page.evaluate(()=>(window as any).voicePresentationFixture.phase('listening'));
 await expect(voice.getByRole('button',{name:'Mute microphone',exact:true})).toBeEnabled();
 await noMediaOrSends(page);
});
