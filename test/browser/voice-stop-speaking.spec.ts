import {test,expect,type Page} from '@playwright/test';
import {button} from './flag-off-android';
import {setupLiveAssistant} from './voice-assistant-fixture';
// Source-served synthetic native ports: the Stop speaking control of the voice assistant, NOT
// production-bundle UI or phone acceptance (audio focus and echo need a device).
test.beforeEach(async({page})=>{await page.route('**/src/build-flags.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const testMocksEnabled=false;export const devSurfacesEnabled=false;export const privateLocalPreviewEnabled=false;export const updateChannelCheckEnabled=false;'}));});
async function setupLive(page:Page){
 const foreign=await setupLiveAssistant(page,{echoCancelled:false});
 // Count calls on the actual shared controller.
 await page.evaluate(async()=>{const {VoiceAssistantSession}=await import('/src/runtime/voice-assistant.ts');const start=VoiceAssistantSession.prototype.start;VoiceAssistantSession.prototype.start=function(){const w=window as any;w.live.interrupts=0;const interrupt=this.interruptSpeech.bind(this);this.interruptSpeech=()=>{w.live.interrupts++;return interrupt();};return start.call(this);};});
 return foreign;
}
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
const stopSpeaking=(page:Page)=>voice(page).getByRole('button',{name:'Stop speaking',exact:true});
const live=<T,>(page:Page,read:(f:any)=>T)=>page.evaluate(`(${read.toString()})(window.live)`) as Promise<T>;
async function say(page:Page,text:string){
 await page.evaluate(text=>{const f=(window as any).live,t=Date.now();f.finals.push(text);f.frames([t-64,t-32,t],[{type:'speech-start',timestampMs:t-64}]);},text);
 await page.waitForTimeout(150);
 await page.evaluate(()=>{const f=(window as any).live,t=Date.now();f.frames([t],[{type:'speech-end',timestampMs:t}]);});
}

test('Stop speaking shows only while Alpha speaks and interrupts the reply once',async({page})=>{
 const foreign=await setupLive(page);
 await page.evaluate(()=>{(window as any).flagOff.replies.push('Here is a long answer about the weather this week.');});
 await button(page,'Talk').click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await expect(stopSpeaking(page)).toHaveCount(0);
 await say(page,'How is the weather');
 await expect(voice(page)).toHaveAttribute('data-voice-state','speaking');
 await expect(stopSpeaking(page)).toBeVisible();
 const box=await stopSpeaking(page).boundingBox();
 expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
 const stopped=await live(page,f=>f.stopped);
 await stopSpeaking(page).click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 await expect(stopSpeaking(page)).toHaveCount(0);
 expect(await live(page,f=>f.interrupts)).toBe(1);
 await expect.poll(()=>live(page,f=>f.stopped)).toBeGreaterThan(stopped);
 // The conversation goes on: the busy hold reopens exactly one capture after the cut playback.
 await expect.poll(()=>live(page,f=>f.active!==null)).toBe(true);
 await button(page,'Stop voice conversation').click();
 await expect(page.getByText('(Interrupted before this reply was played.)')).toBeVisible();
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});

test('Stop speaking is absent when voice fails',async({page})=>{
 const foreign=await setupLive(page);
 await page.evaluate(()=>{const c=(window as any).Capacitor,prior=c.nativePromise;c.nativePromise=(plugin:string,method:string,input:any)=>plugin==='AlphaVoiceCloud'&&method==='startLiveCapture'?Promise.reject(Error('Microphone unavailable')):prior(plugin,method,input);});
 await button(page,'Talk').click();
 await expect(voice(page)).toHaveAttribute('data-voice-state','error');
 await expect(stopSpeaking(page)).toHaveCount(0);
 expect(await live(page,f=>f.interrupts??0)).toBe(0);
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});
