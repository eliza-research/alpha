import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
// Explicit opt-in live provider test. No substituted transcript, navigation event,
// response, model, adapter or runtime; Chrome supplies a generated virtual mic.
test('real voice opens Notes through the actual renderer channel',async({page},info)=>{
 test.skip(process.env.ALPHA_LIVE_VOICE_QA!=='1','Live-provider QA requires explicit opt-in');
 const long=process.env.ALPHA_LONG_VOICE_QA==='1';if(long)test.setTimeout(180000);
 // The route served is whatever the dev bridge was started with; the first health envelope reports it.
 const receipt:any={startedAt:new Date().toISOString(),console:[],timings:[],health:[]};
 page.on('response',async response=>{try{const input=JSON.parse(response.request().postData()||'{}');if(response.url().endsWith('/__alpha-local-agent')&&input.path?.startsWith('/api/v1/voice/session/health?')){const envelope=await response.json();receipt.health.push({status:envelope.status,...JSON.parse(envelope.body)});}}catch{}});
 page.on('response',async response=>{if(response.status()>=400){let body='';try{body=(await response.text()).slice(0,800);}catch{}let path;try{path=JSON.parse(response.request().postData()||'{}').path;}catch{}receipt.console.push({url:new URL(response.url()).pathname,path,status:response.status(),body});}});
 page.on('console',m=>{if(m.type()==='error')receipt.console.push(m.text());});
 await page.addInitScript(()=>{
  const w=window as any;w.voiceLiveProof={partial:[],transportEvents:[],spokenAudioBytes:0,playbackStarts:0,ready:[],rendererConnections:0,captures:0,maxConcurrentCaptures:0};const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);w.voiceProofStreams=[];navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await getUserMedia(constraints);w.voiceProofStreams.push(stream);w.voiceLiveProof.captures++;w.voiceLiveProof.maxConcurrentCaptures=Math.max(w.voiceLiveProof.maxConcurrentCaptures,w.voiceProofStreams.flatMap((s:MediaStream)=>s.getAudioTracks()).filter((t:MediaStreamTrack)=>t.readyState==='live').length);return stream;};
  const Original=window.WebSocket;
  w.WebSocket=new Proxy(Original,{construct(Target,args){const socket=new Target(...args as [string,string[]]);if(String(args[0]).includes('/__alpha-local-renderer/ws'))w.voiceLiveProof.rendererConnections++;socket.addEventListener('message',event=>{if(typeof event.data==='string'){try{const frame=JSON.parse(event.data);if(['stt_partial','stt_final','speaking_start','reply_complete'].includes(frame.t))w.voiceLiveProof.transportEvents.push({type:frame.t,at:Date.now()});if(frame.t==='ready')w.voiceLiveProof.ready.push({at:Date.now(),sessionId:frame.sessionId});if(frame.t==='stt_partial'||frame.t==='stt_final')w.voiceLiveProof.partial.push(frame);if(frame.t==='speaking_start')w.voiceLiveProof.playbackStarts++;}catch{}}else if(event.data instanceof ArrayBuffer){w.voiceLiveProof.firstAudioAt??=Date.now();w.voiceLiveProof.spokenAudioBytes+=event.data.byteLength;}else if(event.data instanceof Blob){w.voiceLiveProof.firstAudioAt??=Date.now();w.voiceLiveProof.spokenAudioBytes+=event.data.size;}});return socket;}});
 });
 await page.goto('/');await expect(page.getByRole('button',{name:'Talk',exact:true})).toBeVisible({timeout:30000});
 await expect.poll(async()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');return !!c.getSnapshot().session&&!c.getSnapshot().busy&&!c.getSnapshot().open;}),{timeout:30000}).toBe(true);
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const f=(window as any).voiceLiveProof;f.lifecycle=[];const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){(window as any).voiceLiveShell=this;return render.call(this);};for(const key of ['startVoice','prepareVoiceConversation','voiceConversationCurrent']){const original=Component.prototype[key];Component.prototype[key]=function(...args:any[]){f.lifecycle.push({key,hidden:document.hidden,state:{chat:this.S().chat,view:this.S().view},live:this.live});try{const result=original.apply(this,args);if(result?.then)return result.catch((error:any)=>{f.lifecycle.push({key,error:error.message});throw error;});return result;}catch(error:any){f.lifecycle.push({key,error:error.message});throw error;}}}});
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeEnabled();
 await expect.poll(()=>page.evaluate(()=>{const shell=(window as any).voiceLiveShell;return !!shell&&!shell.swallowed();})).toBe(true);
 await page.getByRole('button',{name:'Talk',exact:true}).click();
 const started=Date.now();receipt.talkAt=started;
 try{
  await expect(page.getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible({timeout:20000});
  await expect.poll(()=>receipt.health.length,{timeout:20000}).toBeGreaterThan(0);receipt.speechRoute=receipt.health[0].speechRoute??'direct';
  if(receipt.speechRoute==='cloud')expect(receipt.health[0]).toMatchObject({status:200,ready:true,speechRoute:'cloud',speechProvider:'cartesia',providerAdmission:'at-session-start'});
  await expect(page.locator('[data-alpha-voice-interim]')).toContainText(/open.*notes/i,{timeout:30000});receipt.timings.push({event:'visible-transcript',ms:Date.now()-started});
  await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible({timeout:30000});receipt.timings.push({event:'visible-notes',ms:Date.now()-started});
  await expect.poll(()=>page.evaluate(()=>(window as any).voiceLiveProof.spokenAudioBytes),{timeout:30000}).toBeGreaterThan(0);
  receipt.proof=await page.evaluate(()=>(window as any).voiceLiveProof);
  await page.screenshot({path:info.outputPath('actual-notes-open.png')});
  await expect(page.getByRole('heading',{name:'Notes',exact:true})).toHaveCount(0,{timeout:25000});receipt.timings.push({event:'home-after-spoken-request',ms:Date.now()-started});
  await expect.poll(()=>page.evaluate(()=>(window as any).voiceLiveProof.transportEvents.filter((event:any)=>event.type==='speaking_start').length),{timeout:30000}).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-alpha-chat-recorder] [data-alpha-voice-animation]')).toHaveAttribute('data-phase','listening',{timeout:30000});receipt.bothSpokenRepliesCompletedBeforeStop=true;
  await expect(page.getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible();
  const mute=page.getByRole('button',{name:'Mute microphone',exact:true});await expect(mute).toBeEnabled({timeout:10000});await mute.click();await expect(page.getByRole('button',{name:'Unmute microphone',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();
  await page.screenshot({path:info.outputPath('actual-home-return.png')});
  if(long){await expect.poll(()=>page.evaluate(()=>(window as any).voiceLiveProof.ready.length),{timeout:145000,intervals:[1000,5000]}).toBeGreaterThanOrEqual(2);await expect.poll(()=>Date.now()-started,{timeout:145000,intervals:[1000,5000]}).toBeGreaterThan(125000);await expect(page.getByRole('button',{name:'Stop voice conversation',exact:true})).toBeVisible();const proof=await page.evaluate(()=>(window as any).voiceLiveProof);expect(proof.rendererConnections).toBeGreaterThanOrEqual(2);expect(proof.maxConcurrentCaptures).toBe(1);receipt.rotationQualified=true;await page.screenshot({path:info.outputPath('after-125-seconds.png')});}
 }finally{
  receipt.visible=await page.locator('body').innerText();receipt.proof=await page.evaluate(()=>(window as any).voiceLiveProof);const final=receipt.proof.transportEvents.find((event:any)=>event.type==='stt_final');receipt.firstAudioAfterTalkMs=receipt.proof.firstAudioAt?receipt.proof.firstAudioAt-started:null;receipt.firstAudioAfterFinalTranscriptMs=final&&receipt.proof.firstAudioAt?receipt.proof.firstAudioAt-final.at:null;
  const stop=page.getByRole('button',{name:'Stop voice conversation',exact:true});if(await stop.count()){await stop.click();await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeEnabled();await expect(stop).toHaveCount(0);receipt.stopPreservedChat=true;}
  await writeFile(info.outputPath('receipt.json'),JSON.stringify(receipt,null,2));
 }
});
