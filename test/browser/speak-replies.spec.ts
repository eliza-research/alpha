import {test,expect} from '@playwright/test';
import {installCloudVoiceFixture} from './cloud-voice-fixture';

// Replies are spoken in the voice conversation and nowhere else (its playback lifecycle is
// chat-voice-mode.spec.ts). There is no Read replies aloud setting: a typed message, or one
// dictated with Transcribe and sent from the composer, gets a silent reply, and a value an
// earlier build stored under this key changes nothing.
const oldReadRepliesAloud='alphaphone:speak-replies:v1';

for(const stored of [false,true])test(`a typed reply never autoplays${stored?' with an old Read replies aloud value stored':''}`,async({page})=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await installCloudVoiceFixture(page,'Unused synthetic transcript',true);
 await page.evaluate(async({stored,key})=>{
  if(stored)localStorage.setItem(key,JSON.stringify({version:1,enabled:true}));
  const {alphaClient}=await import('/src/runtime/alpha-client.ts');
  const f=(window as any).typedReplyFixture={posts:0};
  alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},
   send:async({onText}:any)=>{f.posts++;onText('Thinking');return {text:'Your next event is at noon.'};},
   execute:async()=>{throw Error('No action may execute');}});
 },{stored,key:oldReadRepliesAloud});
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('What is my next event?');await input.press('Enter');
 await expect(page.locator('[data-alpha-layer="conversation"]').getByText('Your next event is at noon.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>({posts:(window as any).typedReplyFixture.posts,speech:(window as any).cloudVoiceFixture.speech}))).toEqual({posts:1,speech:[]});
});

test('a dictated draft sent as placed gets a silent reply, whatever an earlier build stored',async({page})=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await installCloudVoiceFixture(page,'Unused synthetic transcript',true);
 await page.evaluate(async key=>{
  localStorage.setItem(key,JSON.stringify({version:1,enabled:true}));
  const {alphaClient}=await import('/src/runtime/alpha-client.ts');
  const f=(window as any).typedReplyFixture={posts:0};
  alphaClient.attachVerifiedTransport({session:{ownerId:'fixture-owner',agentId:'fixture-agent',sessionId:'fixture-session',origin:'https://fixture.example'},
   send:async({onText}:any)=>{f.posts++;onText('Thinking');return {text:'Your next event is at noon.'};},
   execute:async()=>{throw Error('No action may execute');}});
  // What Transcribe's Use in draft does with a reviewed transcript placed in an empty composer
  // (voice-adapter.ts): the turn is timed from the end of recording and its draft is noted.
  const timing=await import('/src/runtime/voice-timing.ts'),{noteVoiceDraft}=await import('/src/prototype/local-speech-playback.ts');
  timing.beginVoiceTurn({route:'eliza-cloud',cold:false,entry:'notes'});timing.markVoiceTiming('transcript-ready');noteVoiceDraft('What is my next event?',[]);
 },oldReadRepliesAloud);
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('What is my next event?');await input.press('Enter');
 await expect(page.locator('[data-alpha-layer="conversation"]').getByText('Your next event is at noon.',{exact:true})).toBeVisible();
 // The dictated turn is followed to its final reply, where a spoken reply would have started.
 const marks=()=>page.evaluate(async()=>{const row=(await import('/src/runtime/voice-timing.ts')).voiceTimingRecords().at(-1);return [...Object.keys(row?.marks??{}),...(row?.outcome?[row.outcome]:[])];});
 await expect.poll(marks).toContain('final-reply');
 await page.waitForTimeout(1000);
 expect(await marks()).toEqual(['recording-end','transcript-ready','send','first-token','final-reply']);
 await expect(page.getByRole('button',{name:'Stop reading',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>({posts:(window as any).typedReplyFixture.posts,speech:(window as any).cloudVoiceFixture.speech}))).toEqual({posts:1,speech:[]});
});

for(const mode of ['','?mode=dev'])test(`Settings has no Read replies aloud switch${mode?' (development profile)':''}`,async({page})=>{
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/'+mode);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Character',exact:true}).click();
 const voicePage=page.locator('[data-settings-page]:not([inert])').last();
 await expect(voicePage.getByText('Speech',{exact:true})).toBeVisible();
 // Scheduled digests has one entry, the top-level Settings row; the voice page does not repeat it.
 await expect(voicePage.getByRole('button',{name:'Scheduled digests',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Read replies aloud',exact:true})).toHaveCount(0);
 await expect(page.getByText(/Read replies aloud|Speak replies|Speak the reply to a message you dictated/)).toHaveCount(0);
});
