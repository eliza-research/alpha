// Browser recording limits and video edit arithmetic with a stand-in MediaRecorder.
// No camera, encoder or decoder runs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const capture=await import(url(stripTypeScriptTypes(readFileSync('apps/app/src/browser/video-capture.ts','utf8'))
 .replace("'./sensor-policy'",JSON.stringify(url('export class BrowserMicrophone{close(){}}')))
 .replace("'./video-capture-prefix'",JSON.stringify(url('export const measureVideoPrefix=(blob,signal)=>globalThis.readVideoPrefix(blob,signal);')))
 .replace("'./camera-frame'",JSON.stringify(url('export const drawCameraFrame=()=>({toDataURL:()=>"data:image/jpeg;base64,AA=="});')))));
const edit=await import(url(stripTypeScriptTypes(readFileSync('apps/app/src/browser/video-edit.ts','utf8'))
 .replace("'./video-transcode'",JSON.stringify(url('export const transcodeVideo=async()=>undefined;')))
 .replace("'./video-codecs'",JSON.stringify(url('export const videoRecorders=()=>[];')))));

test('size accounting keeps what fits, leaves out the chunk that would pass the limit, and stops',()=>{
 assert.deepEqual(capture.admitVideoChunk(0,40,100),{keep:true,stop:false,bytes:40});
 assert.deepEqual(capture.admitVideoChunk(60,40,100),{keep:true,stop:true,bytes:100},'reaching the limit exactly keeps the chunk');
 assert.deepEqual(capture.admitVideoChunk(80,40,100),{keep:false,stop:true,bytes:80},'an overflowing chunk is left out and nothing collected is lost');
 for(let bytes=0;bytes<=100;bytes+=7)for(let chunk=0;chunk<=120;chunk+=11){const result=capture.admitVideoChunk(bytes,chunk,100);assert.ok(result.bytes<=100);assert.equal(result.bytes,result.keep?bytes+chunk:bytes);if(!result.keep)assert.equal(result.stop,true);}
});

function recording(readPrefix=async()=>0.125){
 globalThis.readVideoPrefix=readPrefix;
 const recorders=[];
 globalThis.document={hidden:false};
 globalThis.MediaStream=class{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
 globalThis.MediaRecorder=class{constructor(){this.state='inactive';this.mimeType='video/webm;codecs=vp8';recorders.push(this);}start(){this.state='recording';}emit(size){this.ondataavailable({data:new Blob([new Uint8Array(size)],{type:'video/webm'})});}
  stop(){if(this.state==='inactive')return;this.state='inactive';this.emit(10);queueMicrotask(()=>this.onstop());}};
 const track={readyState:'live',clone:()=>({stop(){}}),addEventListener(){},removeEventListener(){}};
 const video={srcObject:{getVideoTracks:()=>[track]},readyState:4,videoWidth:640,videoHeight:480};
 return {video,recorders};
}
test('a recording that reaches the size limit is saved shortened, without a gap',async()=>{
 const {video,recorders}=recording(),session=new capture.BrowserVideoCapture();
 await session.start(video,{audio:false,maxDuration:300,maxFileSize:100});
 const recorder=recorders[0];recorder.emit(40);recorder.emit(40);
 assert.equal(session.state().fileSize,80);
 recorder.emit(40);
 assert.equal(recorder.state,'inactive','the overflowing chunk stops the recorder');
 const clip=await session.stop();
 assert.equal(clip.blob.size,80,'the chunks collected before the limit are the video; the overflow and the recorder\'s last chunk are left out');
 assert.equal(clip.blob.type,'video/webm');assert.equal(clip.duration,0.125);
});
test('a limit too small for any chunk still fails with the size message',async()=>{
 const {video,recorders}=recording(),session=new capture.BrowserVideoCapture();
 await session.start(video,{audio:false,maxDuration:300,maxFileSize:1});
 recorders[0].emit(40);
 await assert.rejects(session.stop(),/Video exceeded the size limit\./);
});

test('an unreadable retained prefix does not become a saved recording',async()=>{
 const {video,recorders}=recording(async()=>{throw Error('Unreadable prefix');});
 const session=new capture.BrowserVideoCapture();
 await session.start(video,{audio:false,maxDuration:300,maxFileSize:100});
 recorders[0].emit(90);recorders[0].emit(20);
 await assert.rejects(session.stop(),/Unreadable prefix/);
});

test('cancelling a capped recording retires its pending media read',async()=>{
 let readSignal;
 const {video,recorders}=recording((_blob,signal)=>{
  readSignal=signal;
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 });
 const session=new capture.BrowserVideoCapture();
 await session.start(video,{audio:false,maxDuration:300,maxFileSize:100});
 recorders[0].emit(90);recorders[0].emit(20);
 const stopped=session.stop();
 await new Promise(resolve=>queueMicrotask(resolve));
 assert.ok(readSignal);
 session.cancel();
 assert.equal(readSignal.aborted,true);
 await assert.rejects(stopped,{name:'AbortError'});
});

test('the trim clock never shows 60.0 seconds',()=>{
 assert.equal(edit.videoClock(0),'0:00.0');assert.equal(edit.videoClock(59.94),'0:59.9');
 assert.equal(edit.videoClock(59.96),'1:00.0');assert.equal(edit.videoClock(119.97),'2:00.0');assert.equal(edit.videoClock(65.04),'1:05.0');
 let previous=-1;
 for(let value=0;value<=300;value+=.013){const text=edit.videoClock(value),[minutes,seconds]=text.split(':');assert.match(text,/^\d+:\d\d\.\d$/);assert.ok(Number(seconds)<60,text);const total=Number(minutes)*60+Number(seconds);assert.ok(total>=previous,text);assert.ok(Math.abs(total-value)<=.0500001,text);previous=total;}
});
test('an edited copy reports the range it actually produced',()=>{
 assert.equal(edit.editedVideoDuration({start:1,end:4}),3);
 assert.equal(edit.editedVideoDuration({start:1,end:4},4.02),3,'encoding that ran to the chosen end reports the chosen range');
 assert.equal(edit.editedVideoDuration({start:1,end:4},2.5),1.5,'a source that ended early reports the shorter copy');
 assert.equal(edit.editedVideoDuration({start:1,end:4},.5),.001,'never zero or negative');
 assert.equal(edit.editedVideoDuration({start:1,end:4},NaN),3);
});
