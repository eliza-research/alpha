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
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
});
test('digital zoom changes saved pixels and preserves front-camera mirroring',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');
  const samples=async()=>{const p=await c.capturePhoto(),image=new Image();image.src='data:image/jpeg;base64,'+p.base64;await image.decode();const canvas=document.createElement('canvas');canvas.width=p.width;canvas.height=p.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [20,300].map(x=>Array.from(ctx.getImageData(x,120,1,1).data).slice(0,3));};
  const normal=await samples();await c.setZoom({zoom:2});const zoomed=await samples();await c.switchCamera({direction:'front'});await c.setZoom({zoom:2});const mirrored=await samples();
  let invalid=false;try{await c.setZoom({zoom:.5});}catch{invalid=true;}
  return {normal,zoomed,mirrored,invalid,transform:(document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement).style.transform};
 });
 expect(result.normal[0][0]).toBeGreaterThan(230);expect(result.normal[1][0]).toBeGreaterThan(230);
 expect(result.zoomed[0][1]).toBeGreaterThan(230);expect(result.zoomed[1][2]).toBeGreaterThan(230);
 expect(result.mirrored[0][2]).toBeGreaterThan(230);expect(result.mirrored[1][1]).toBeGreaterThan(230);expect(result.transform).toBe('scale(-2, 2)');expect(result.invalid).toBe(true);
});
test('encoded video and thumbnail use the zoomed crop and release the processing stream',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c,browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');await c.setZoom({zoom:2});await c.startRecording({audio:false,maxDuration:.5,maxFileSize:1000000});await new Promise(r=>setTimeout(r,750));await c.stopRecording();
  const row=(await p.list()).items.find(r=>r.kind==='video')!,video=document.createElement('video');video.muted=true;video.src=row.path!;
  // A resolved play() is not evidence that a decoded frame has been presented.
  const frame=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Recorded video did not present a frame')),5000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});});await video.play();await frame;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;ctx.drawImage(video,0,0);const pixels=[20,300].map(x=>Array.from(ctx.getImageData(x,120,1,1).data).slice(0,3));video.pause();video.removeAttribute('src');video.load();
  const thumb=new Image();thumb.src=row.image;await thumb.decode();ctx.drawImage(thumb,0,0);const thumbnail=[20,300].map(x=>Array.from(ctx.getImageData(x,120,1,1).data).slice(0,3));
  await c.stopPreview();return {pixels,thumbnail,released:(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};
 });expect(result.pixels[0][1]).toBeGreaterThan(220);expect(result.pixels[1][2]).toBeGreaterThan(220);expect(result.thumbnail[0][1]).toBeGreaterThan(230);expect(result.thumbnail[1][2]).toBeGreaterThan(230);expect(result.released).toBe(true);
});
test('flash requires a confirmed torch capability and never applies a brightness filter',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');const video=document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement,track=(video.srcObject as MediaStream).getVideoTracks()[0];let unavailable=false;
  try{await c.setSettings({settings:{flash:'on'}});}catch{unavailable=true;}
  const changes:boolean[]=[];let torch=false;track.getCapabilities=()=>({torch:true} as MediaTrackCapabilities);track.applyConstraints=async(input:any)=>{torch=input.advanced[0].torch;changes.push(torch);};track.getSettings=()=>({torch} as MediaTrackSettings);
  await c.setSettings({settings:{flash:'on'}});await c.setSettings({settings:{flash:'off'}});
  track.getSettings=()=>({});let unconfirmed=false;try{await c.setSettings({settings:{flash:'on'}});}catch{unconfirmed=true;}
  return {unavailable,unconfirmed,changes,filter:video.style.filter};
 });expect(result).toEqual({unavailable:true,unconfirmed:true,changes:[true,false,true,false],filter:''});
});

test('rendered zoom selection captures cropped pixels and switching resets the control',async({page})=>{
 await page.getByRole('button',{name:'Zoom 2x',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open last photo',exact:true})).toBeVisible();
 const pixel=await page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const row=(await browserPhotoLibrary.list()).items[0],image=new Image();image.src=row.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(20,120,1,1).data);});expect(pixel[1]).toBeGreaterThan(230);
 await page.getByRole('button',{name:'Switch camera',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Switch camera',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 1x',exact:true})).toHaveCSS('width','40px');
});

test('a zoomed recording stops when its camera source ends',async({page})=>{
 await page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');await c.setZoom({zoom:2});await c.startRecording({audio:false,maxDuration:10,maxFileSize:1000000});});
 await expect.poll(()=>page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');return (await c.getRecordingState()).fileSize;})).toBeGreaterThan(0);
 await page.evaluate(()=>{const video=document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement;(video.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'));});
 await expect.poll(()=>page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');return (await c.getRecordingState()).isRecording;})).toBe(false);
 const saved=await page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');const result=await c.stopRecording();await c.stopPreview();return {bytes:result.fileSize,released:(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};});expect(saved.bytes).toBeGreaterThan(0);expect(saved.released).toBe(true);
});

test('switching with flash on and zoom 2x turns both off first and restores them when the switch fails',async({page})=>{
 await page.evaluate(async()=>{
  const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');const calls=(window as any).flipCalls=[] as string[],setZoom=c.setZoom,switchCamera=c.switchCamera;
  // Only the control boundary is observed; the browser camera still zooms and switches.
  c.flashAvailable=()=>true;c.lightingLabel=(on:boolean)=>`Flash ${on?'on':'off'}`;c.setSettings=async(input:{settings:{flash:string}})=>{calls.push('flash '+input.settings.flash);};
  c.setZoom=async(input:{zoom:number})=>{calls.push('zoom '+input.zoom);await setZoom(input);};
  c.switchCamera=async(options:{direction:'front'|'back'})=>{calls.push('switch '+options.direction);if((window as any).failSwitch)throw Object.assign(Error('Target camera has no flash unit'),{code:'FLASH_UNSUPPORTED'});return switchCamera(options);};
 });
 await page.getByRole('button',{name:'Zoom 2x',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');
 await page.getByRole('button',{name:'Flash off',exact:true}).click();await expect(page.getByRole('button',{name:'Flash on',exact:true})).toBeVisible();
 const calls=()=>page.evaluate(()=>(window as any).flipCalls.splice(0));expect(await calls()).toEqual(['zoom 2','flash on']);
 await page.evaluate(()=>(window as any).failSwitch=true);await page.getByRole('button',{name:'Switch camera',exact:true}).click();
 await expect(page.locator('[data-alpha-camera="said"]')).toContainText("This camera can't use that flash or zoom.");
 expect(await calls()).toEqual(['flash off','zoom 1','switch front','flash on','zoom 2']);
 await expect(page.getByRole('button',{name:'Flash on',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');
 await page.evaluate(()=>(window as any).failSwitch=false);await page.getByRole('button',{name:'Switch camera',exact:true}).click();
 await expect(page.getByRole('button',{name:'Flash off',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCount(0);
 expect(await calls()).toEqual(['flash off','zoom 1','switch front']);
});
