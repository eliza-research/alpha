import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;
  const paint=()=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,320,240);ctx.fillStyle='#00ff00';ctx.fillRect(80,0,80,240);ctx.fillStyle='#0000ff';ctx.fillRect(160,0,80,240);};paint();setInterval(paint,50);
  const streams=(window as any).controlStreams=[] as MediaStream[],original=HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream=function(rate){const stream=original.call(this,rate);streams.push(stream);return stream;};
  const devices=navigator.mediaDevices;devices.getUserMedia=async()=>canvas.captureStream(20);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
 });
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Camera',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
});
test('rendered focus selects viewfinder coordinates and clears on camera replacement and Home',async({page},info)=>{
 const finder=page.locator('[data-alpha-camera="viewfinder"]'),box=(await finder.boundingBox())!;await finder.click({position:{x:box.width*.25,y:box.height*.3}});const target=page.locator('[data-alpha-camera-focus]');await expect(target).toHaveAttribute('data-alpha-camera-focus','development');expect(await target.evaluate((e:HTMLElement)=>parseFloat(e.style.left))).toBeCloseTo(25,0);expect(await target.evaluate((e:HTMLElement)=>parseFloat(e.style.top))).toBeCloseTo(30,0);await page.screenshot({path:info.outputPath('focus.png')});await page.getByRole('button',{name:'Switch camera',exact:true}).click();await expect(target).toHaveCount(0);await expect.poll(()=>finder.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);await finder.click({position:{x:box.width*.25,y:box.height*.3}});await expect(target).toHaveCount(1);await returnToApps(page);await expect(target).toHaveCount(0);
});
test('keyboard activation of the camera preview focuses the centre',async({page})=>{
 const finder=page.getByRole('button',{name:/^Viewfinder\. Tap to focus/});await finder.focus();await page.keyboard.press('Enter');const target=page.locator('[data-alpha-camera-focus]');await expect(target).toHaveCount(1);expect(await target.evaluate((e:HTMLElement)=>[parseFloat(e.style.left),parseFloat(e.style.top)])).toEqual([50,50]);
});
test('focus clamps local targets and clears on page retirement',async({page})=>{
 await page.evaluate(async()=>{const {browserCamera}=await import('/src/prototype/browser-camera.ts');await browserCamera.setFocusPoint({x:-2,y:5});});const target=page.locator('[data-alpha-camera-focus]');expect(await target.evaluate((e:HTMLElement)=>[e.style.left,e.style.top])).toEqual(['0%','100%']);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(target).toHaveCount(0);
});
test('hardware point is mapped through mirrored zoom and checked against settings',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserCameraFocus}=await import('/src/browser/camera-focus.ts');const frame=document.createElement('div');frame.style.cssText='position:fixed;width:200px;height:200px';document.body.append(frame);const video=document.createElement('video');Object.defineProperties(video,{videoWidth:{value:400},videoHeight:{value:200}});let settings:any={},applied:any;
  navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true} as MediaTrackSupportedConstraints);
  const track={readyState:'live',getCapabilities:()=>({focusMode:['single-shot']}),applyConstraints:async(input:any)=>{applied=input.advanced[0];settings=applied;},getSettings:()=>settings} as unknown as MediaStreamTrack;
  const focus=new BrowserCameraFocus();await focus.select({x:.25,y:.75},{frame,video,track,zoom:2,mirror:true,development:true});const output={applied,state:frame.firstElementChild?.getAttribute('data-alpha-camera-focus')};focus.clear();frame.remove();return output;
 });expect(result.applied.focusMode).toBe('single-shot');expect(result.applied.pointsOfInterest[0]).toEqual({x:.5625,y:.625});expect(result.state).toBe('camera');
});
test('late hardware replies cannot recreate a retired target and unsupported settings remain development targets',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserCameraFocus}=await import('/src/browser/camera-focus.ts');const frame=document.createElement('div');frame.style.cssText='width:200px;height:200px';document.body.append(frame);const video=document.querySelector('video')!;navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true} as MediaTrackSupportedConstraints);let finish!:()=>void;
  const track={readyState:'live',getCapabilities:()=>({focusMode:['continuous']}),applyConstraints:()=>new Promise<void>(resolve=>finish=resolve),getSettings:()=>({})} as unknown as MediaStreamTrack;const focus=new BrowserCameraFocus();const pending=focus.select({x:.5,y:.5},{frame,video,track,zoom:1,mirror:false,development:true});focus.clear();finish();await pending;const retired=frame.childElementCount;
  track.applyConstraints=async()=>{};await focus.select({x:.5,y:.5},{frame,video,track,zoom:1,mirror:false,development:true});const unconfirmed=frame.firstElementChild?.getAttribute('data-alpha-camera-focus');focus.clear();frame.remove();return {retired,unconfirmed};
 });expect(result).toEqual({retired:0,unconfirmed:'development'});
});

test('rapid focus selections serialize driver writes so an older reply cannot override the latest point',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserCameraFocus}=await import('/src/browser/camera-focus.ts');const frame=document.createElement('div');frame.style.cssText='width:200px;height:200px';document.body.append(frame);const video=document.createElement('video');Object.defineProperties(video,{videoWidth:{value:200},videoHeight:{value:200}});navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true} as MediaTrackSupportedConstraints);
  let settings:any={},firstDone!:()=>void;const calls:any[]=[];const track={readyState:'live',getCapabilities:()=>({focusMode:['single-shot']}),getSettings:()=>settings,applyConstraints:async(input:any)=>{const value=input.advanced[0];calls.push(value);if(calls.length===1)await new Promise<void>(resolve=>firstDone=resolve);settings=value;}} as unknown as MediaStreamTrack;
  const focus=new BrowserCameraFocus(),options={frame,video,track,zoom:1,mirror:false,development:true};const first=focus.select({x:.2,y:.2},options);while(!firstDone)await new Promise(resolve=>setTimeout(resolve,0));const second=focus.select({x:.8,y:.8},options);await new Promise(resolve=>setTimeout(resolve,10));const pendingCount=calls.length;firstDone();await Promise.all([first,second]);const result={pendingCount,calls:calls.length,point:settings.pointsOfInterest[0],state:frame.firstElementChild?.getAttribute('data-alpha-camera-focus')};focus.clear();frame.remove();return result;
 });expect(result).toEqual({pendingCount:1,calls:2,point:{x:.8,y:.8},state:'camera'});
});

test('retirement skips queued writes without blocking a replacement camera track',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {BrowserCameraFocus}=await import('/src/browser/camera-focus.ts');const frame=document.createElement('div');frame.style.cssText='width:200px;height:200px';document.body.append(frame);const video=document.createElement('video');Object.defineProperties(video,{videoWidth:{value:200},videoHeight:{value:200}});navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true} as MediaTrackSupportedConstraints);
  let release!:()=>void,oldCalls=0,newCalls=0,settings:any={};const oldTrack={readyState:'live',getCapabilities:()=>({focusMode:['single-shot']}),getSettings:()=>({}),applyConstraints:async()=>{oldCalls++;await new Promise<void>(resolve=>release=resolve);}} as unknown as MediaStreamTrack;
  const newTrack={readyState:'live',getCapabilities:()=>({focusMode:['single-shot']}),getSettings:()=>settings,applyConstraints:async(input:any)=>{newCalls++;settings=input.advanced[0];}} as unknown as MediaStreamTrack;
  const focus=new BrowserCameraFocus(),options={frame,video,track:oldTrack,zoom:1,mirror:false,development:true};const first=focus.select({x:.2,y:.2},options);while(!release)await new Promise(resolve=>setTimeout(resolve,0));const queued=focus.select({x:.5,y:.5},options);focus.clear();await focus.select({x:.8,y:.8},{...options,track:newTrack});const beforeRelease={oldCalls,newCalls,state:frame.firstElementChild?.getAttribute('data-alpha-camera-focus')};release();await Promise.all([first,queued]);const result={...beforeRelease,finalOldCalls:oldCalls,stateAfter:frame.firstElementChild?.getAttribute('data-alpha-camera-focus')};focus.clear();frame.remove();return result;
 });expect(result).toEqual({oldCalls:1,newCalls:1,state:'camera',finalOldCalls:1,stateAfter:'camera'});
});
