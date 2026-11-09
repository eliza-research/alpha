import {test,expect} from '@playwright/test';
import {agentBrowserVoice} from './voice-fixture';
// P-43: reading aloud has no Web Speech fallback; it runs through the local agent's on-device
// speech (libelizainference Paradee), stubbed at the agent boundary (agentBrowserVoice).
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.route('https://example.com/**',route=>route.abort());
 await page.goto('/');await agentBrowserVoice(page);
});
async function open(page:any){await page.evaluate(async()=>{
 const {reviewBrowserReading}=await import('/src/browser/reading-review.ts');const state=window as any;state.readAbort=new AbortController();state.readDone=reviewBrowserReading('https://example.com/article',state.readAbort.signal,()=>state.readAbort.signal.throwIfAborted());
});}
test('review requires explicit text and confirmation, uses the exact excerpt, and releases playback on close',async({page})=>{
 await open(page);const dialog=page.getByRole('dialog',{name:'Read page excerpt'});
 await expect(dialog).toBeVisible();expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual([]);
 await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Enter between');
 await dialog.getByRole('textbox',{name:'Excerpt to read'}).fill('Reviewed excerpt\nSecond line.');
 await dialog.getByRole('button',{name:'Read locally',exact:true}).click();
 await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual(['Reviewed excerpt\nSecond line.']);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).voiceFixture.cancels)).toBeGreaterThan(0);
});
test('stop retires old callbacks, a retry reads new text, and lifecycle cancellation closes the review',async({page})=>{
 await open(page);const dialog=page.getByRole('dialog',{name:'Read page excerpt'}),field=dialog.getByRole('textbox');
 await field.fill('First');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.evaluate(()=>{const audio=(window as any).voiceFixture.audios.at(-1);(window as any).oldEnd=()=>audio.onended?.(new Event('ended'));});
 await dialog.getByRole('button',{name:'Stop reading',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading stopped.');
 await field.fill('Second');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.evaluate(()=>(window as any).oldEnd());await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.evaluate(()=>(window as any).readAbort.abort());await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual(['First','Second']);
});
test('without agent speech the excerpt is never spoken and cancel before confirmation is silent',async({page})=>{
 await page.evaluate(()=>{(window as any).voiceFixture.ready=false;});
 await open(page);let dialog=page.getByRole('dialog',{name:'Read page excerpt'});await dialog.getByRole('textbox').fill('Private reviewed text');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();
 await expect(dialog.getByRole('status')).not.toHaveText(/Reading locally|Preparing local speech/);
 expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual([]);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await open(page);dialog=page.getByRole('dialog',{name:'Read page excerpt'});await dialog.getByRole('textbox').fill('Unconfirmed text');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual([]);
});

test('rendered Browser menu opens local review offline and HOME cancels it',async({page})=>{
 await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',headers:{'access-control-allow-origin':'*'},body:'<h1>Public article</h1><p>Fixture excerpt.</p>'}));
 await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Search or type address',exact:true}).click();
 await page.getByRole('textbox',{name:'Address',exact:true}).fill('https://example.com/article');await page.getByRole('textbox',{name:'Address',exact:true}).press('Enter');
 await expect(page.frameLocator('iframe[title="Website"]').getByRole('heading',{name:'Public article'})).toBeVisible();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Browser menu'});
 await expect(menu.getByRole('note',{name:'Page reading unavailable'})).toHaveCount(0);
 await expect(menu.getByRole('button',{name:'Ask about page',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'Read aloud',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Read page excerpt'});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('textbox')).toHaveValue('Public article\n\nFixture excerpt.');
 await dialog.getByRole('textbox').fill('Fixture excerpt.');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.screenshot({path:'test-results/reading-review.png'});
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).voiceFixture.spoken)).toEqual(['Fixture excerpt.']);
});

test('compact dark review keeps controls reachable and page hide retires the draft',async({page})=>{
 await page.setViewportSize({width:360,height:640});await page.goto('/?theme=dark');await agentBrowserVoice(page);await open(page);
 const dialog=page.getByRole('dialog',{name:'Read page excerpt'});await dialog.getByRole('textbox').fill('Compact review');
 await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await dialog.getByRole('button',{name:'Close',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 expect(await dialog.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(0, 0, 0)');await page.screenshot({path:'test-results/reading-review-dark.png'});
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(dialog).toHaveCount(0);
});

test('closing a replaced reading session does not stop another speech consumer',async({page})=>{
 await open(page);const dialog=page.getByRole('dialog',{name:'Read page excerpt'});await dialog.getByRole('textbox').fill('Reading excerpt');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const voice=registerPlugin<any>('AlphaVoiceCloud');await voice.play(await voice.synthesizeLocal({text:'Other consumer'}));});
 const before=await page.evaluate(()=>(window as any).voiceFixture.cancels);await dialog.getByRole('button',{name:'Close',exact:true}).click();expect(await page.evaluate(()=>(window as any).voiceFixture.cancels)).toBe(before);
});

test('Back dismisses the reading review and cancels only its speech before browser navigation',async({page})=>{
 await open(page);const dialog=page.getByRole('dialog',{name:'Read page excerpt'});await dialog.getByRole('textbox').fill('Reviewed local text');await dialog.getByRole('button',{name:'Read locally',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Reading locally…');
 await page.evaluate(()=>{(window as any).backEscaped=false;window.addEventListener('alpha-back',()=>{(window as any).backEscaped=true;},{once:true});window.dispatchEvent(new Event('alpha-back',{cancelable:true}));});
 await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>(window as any).backEscaped)).toBe(false);expect(await page.evaluate(()=>(window as any).voiceFixture.cancels)).toBeGreaterThan(0);
 // Its capture listener must be gone: the next Back belongs to the app again.
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));expect(await page.evaluate(()=>(window as any).backEscaped)).toBe(true);
});

// LOOP-E: production Android reads through the resident runtime. The renderer must pick the resident
// binding (execution 'device') over a paired voice, hand native only the one-use token with that
// binding, and abort when the binding changes mid-reading or before the next one. The native call is
// a synthetic in-page stub on the browser voice; this is renderer source evidence, not native.
test('resident reading uses the resident binding and a binding change aborts it',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const {BrowserVoice}=await import('/src/browser/voice.ts');
  const {createNativeReadingVoice}=await import('/src/runtime/native-reading-voice.ts');
  const controller=connectionController as any,proto=BrowserVoice.prototype as any,calls:any[]=[];
  let resident={execution:'device',ownerId:'fixture-owner',sessionId:'fixture-session'};
  const listeners=new Set<()=>void>(),saved={resident:controller.getResidentReadingBinding,paired:controller.getPairedVoiceBinding,subscribe:controller.subscribe,synth:proto.synthesizeLocalBrowserReading,status:proto.localSpeechStatus};
  controller.getResidentReadingBinding=()=>resident;
  controller.getPairedVoiceBinding=()=>{throw Error('The paired voice must not be consulted while a resident binding exists');};
  controller.subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
  proto.synthesizeLocalBrowserReading=function(input:any){calls.push(input);return new Promise(()=>{});};
  try{
   const voice=createNativeReadingVoice();
   if(!voice)return {voice:false};
   const chosen={binding:voice.binding,current:voice.isCurrent()};
   // Resident reading needs playback (Kokoro) only: recognition being unavailable must not block it.
   proto.localSpeechStatus=async()=>({ready:false,playback:true,execution:'browser'});
   const readAloudWithoutRecognition=await voice.ready(new AbortController().signal);
   proto.localSpeechStatus=async()=>({ready:false,playback:false,execution:'browser'});
   const readAloudWithoutPlayback=await voice.ready(new AbortController().signal);
   const speaking=voice.speak('token-one',new AbortController().signal).then(()=>'finished',(error:any)=>`${error?.name}:${error?.message}`);
   for(let i=0;i<50&&!calls.length;i++)await new Promise(resolve=>setTimeout(resolve,20));
   const before=calls.length;
   resident={...resident,sessionId:'replaced-session'};
   listeners.forEach(listener=>listener());
   const outcome=await speaking;
   const next=await voice.speak('token-two',new AbortController().signal).then(()=>'finished',(error:any)=>`${error?.name}:${error?.message}`);
   return {voice:true,chosen,before,calls,outcome,afterChange:voice.isCurrent(),next,readAloudWithoutRecognition,readAloudWithoutPlayback};
  }finally{Object.assign(controller,{getResidentReadingBinding:saved.resident,getPairedVoiceBinding:saved.paired,subscribe:saved.subscribe});if(saved.synth)proto.synthesizeLocalBrowserReading=saved.synth;else delete proto.synthesizeLocalBrowserReading;if(saved.status)proto.localSpeechStatus=saved.status;else delete proto.localSpeechStatus;}
 });
 expect(result.voice).toBe(true);
 expect([result.readAloudWithoutRecognition,result.readAloudWithoutPlayback]).toEqual([true,false]);
 expect(result.chosen!.binding).toMatchObject({execution:'device',ownerId:'fixture-owner',sessionId:'fixture-session'});
 expect(result.chosen!.binding.expiresAt).toBeGreaterThan(Date.now());
 expect(result.chosen!.current).toBe(true);
 // Exactly one native call, carrying the resident binding and the one-use token, never page text.
 expect(result.before).toBe(1);expect(result.calls).toHaveLength(1);
 expect(result.calls![0]).toMatchObject({execution:'device',ownerId:'fixture-owner',sessionId:'fixture-session',readingToken:'token-one'});
 expect(Object.keys(result.calls![0]).sort()).toEqual(['execution','expiresAt','ownerId','readingToken','requestId','sessionId']);
 expect(result.outcome).toMatch(/^AbortError:/);
 expect(result.afterChange).toBe(false);
 expect(result.next).toBe('AbortError:Reading selection changed');
});
