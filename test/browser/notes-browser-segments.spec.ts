import {test,expect} from '@playwright/test';
// Browser Notes recording in segments (design/view-refresh-2026-11 PLAN.md section 3): like the
// native recorder, finished segments of bounded recorded time arrive while recording, each a
// standalone file that fits a transcription request; the whole recording is kept as well.
async function source(page:any){await page.evaluate(async()=>{const context=new AudioContext(),osc=context.createOscillator(),sink=context.createMediaStreamDestination();osc.connect(sink);osc.start();await context.resume();const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});devices.getUserMedia=async()=>sink.stream;(window as any).segmentSource={context,osc};});}
test('a browser recording is written as bounded standalone segments, the last one before stop resolves',async({page})=>{
 await page.goto('/?mode=dev');await source(page);
 const result=await page.evaluate(async()=>{
  const {BrowserAudioCapture}=await import('/src/browser/audio-capture.ts');
  const segments:{index:number;blob:Blob;durationMs:number}[]=[];
  const capture=new BrowserAudioCapture(()=>{});
  const {recordingId}=await capture.start({unlimited:true,segmentMs:1500,onSegment:segment=>segments.push(segment)});
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  await wait(2200);capture.pause();await wait(1500);capture.resume();await wait(1800);
  const beforeStop=segments.length;
  const clip=await capture.stop();
  const decoded=[];for(const s of segments){const ctx=new OfflineAudioContext(1,1,16000);decoded.push((await ctx.decodeAudioData(await s.blob.arrayBuffer())).duration);}
  const s=(window as any).segmentSource;s.osc.stop();await s.context.close();
  return {recordingId,beforeStop,count:segments.length,indexes:segments.map(s=>s.index),durations:segments.map(s=>s.durationMs),decoded,total:clip.durationMs,whole:capture.get(recordingId)!.blob.size};
 });
 expect(result.beforeStop,'segments arrive while recording').toBeGreaterThanOrEqual(1);
 expect(result.count).toBeGreaterThanOrEqual(3);
 expect(result.indexes).toEqual(result.indexes.map((_:number,i:number)=>i));
 for(const d of result.durations)expect(d).toBeLessThanOrEqual(1500+400);
 for(const d of result.decoded)expect(d,'every segment decodes on its own').toBeGreaterThan(0);
 const sum=result.durations.reduce((a:number,b:number)=>a+b,0);
 expect(Math.abs(sum-result.total),'segments cover the recorded time, paused time excluded').toBeLessThan(800);
 expect(result.total).toBeLessThan(5000);
 expect(result.whole).toBeGreaterThan(0);
});
