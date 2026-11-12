import {test,expect} from '@playwright/test';
test.use({hasTouch:true});
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
  const row=await p.read({id:(await p.list()).items.find(r=>r.kind==='video')!.id}),video=document.createElement('video');video.muted=true;video.src=row.path!;
  // A resolved play() is not evidence that a decoded frame has been presented.
  const frame=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Recorded video did not present a frame')),5000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});});await video.play();await frame;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;ctx.drawImage(video,0,0);const pixels=[20,300].map(x=>Array.from(ctx.getImageData(x,120,1,1).data).slice(0,3));video.pause();video.removeAttribute('src');video.load();
  const thumb=new Image();thumb.src=row.image;await thumb.decode();ctx.drawImage(thumb,0,0);const thumbnail=[20,300].map(x=>Array.from(ctx.getImageData(x,120,1,1).data).slice(0,3));
  await c.stopPreview();return {pixels,thumbnail,released:(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};
 });expect(result.pixels[0][1]).toBeGreaterThan(220);expect(result.pixels[1][2]).toBeGreaterThan(220);expect(result.thumbnail[0][1]).toBeGreaterThan(230);expect(result.thumbnail[1][2]).toBeGreaterThan(230);expect(result.released).toBe(true);
});
for (const mime of ['video/webm;codecs=vp8', 'video/mp4;codecs=avc1.42001f']) {
 test(`a capped ${mime.split(';')[0]} saves the retained frames and measured duration`, async ({page}) => {
  test.skip(!await page.evaluate(type => MediaRecorder.isTypeSupported(type), mime), 'Browser recorder lacks this codec');
  const result = await page.evaluate(async type => {
   const {browserCamera, browserPhotoLibrary} = await import('/src/prototype/browser-camera.ts');
   const source = document.querySelector<HTMLVideoElement>('[data-alpha-camera="viewfinder"] video')!;
   const Recorder = window.MediaRecorder;
   const encoder = new Recorder(source.srcObject as MediaStream, {mimeType: type});
   const chunks: Blob[] = [];
   encoder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
   const encoded = new Promise<void>(resolve => { encoder.onstop = () => resolve(); });
   encoder.start(150);
   await new Promise(resolve => setTimeout(resolve, 1250));
   encoder.stop();
   await encoded;
   const [prefix, overflow] = chunks;
   if (!prefix || !overflow) throw Error('The browser recorder did not emit a prefix and a terminal chunk');

   // Use the real encoder bytes with a controlled delivery order. Reaching the
   // exact cap requests stop, then the encoder's nonempty terminal chunk arrives.
   let deliver!: () => void;
   class CappedRecorder {
    state: RecordingState = 'inactive';
    mimeType = type;
    ondataavailable?: (event: BlobEvent) => void;
    onstop?: () => void;
    start() {
     this.state = 'recording';
     deliver = () => this.ondataavailable?.(new BlobEvent('dataavailable', {data: prefix}));
    }
    stop() {
     if (this.state === 'inactive') return;
     this.state = 'inactive';
     queueMicrotask(() => {
      this.ondataavailable?.(new BlobEvent('dataavailable', {data: overflow}));
      this.onstop?.();
     });
    }
   }
   window.MediaRecorder = CappedRecorder as unknown as typeof MediaRecorder;
   try {
    await browserCamera.startRecording({audio: false, maxDuration: 5, maxFileSize: prefix.size});
    await new Promise(resolve => setTimeout(resolve, 650));
    deliver();
    const result = await browserCamera.stopRecording();
    const row = await browserPhotoLibrary.read({id: (await browserPhotoLibrary.list()).items.find(item => item.kind === 'video')!.id});
    const playback = document.createElement('video');
    playback.preload = 'auto';
    const decoded = new Promise<void>((resolve, reject) => {
     const deadline = setTimeout(() => reject(Error('Saved prefix did not decode')), 5000);
     playback.onloadeddata = () => { clearTimeout(deadline); resolve(); };
     playback.onerror = () => { clearTimeout(deadline); reject(Error('Saved prefix was unreadable')); };
    });
    playback.src = row.path!;
    try {
     await decoded;
     return {size: result.fileSize, prefixSize: prefix.size, duration: result.duration, storedDuration: row.duration, decodedWidth: playback.videoWidth};
    } finally {
     playback.removeAttribute('src');
     playback.load();
    }
   } finally {
    window.MediaRecorder = Recorder;
    await browserCamera.stopPreview();
   }
  }, mime);
  expect(result.size).toBe(result.prefixSize);
  expect(result.decodedWidth).toBeGreaterThan(0);
  expect(result.duration).toBeGreaterThan(0);
  expect(result.duration).toBeLessThan(0.45);
  expect(result.storedDuration).toBe(result.duration);
 });
}

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
 await page.evaluate(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);(window as any).videoAudioDenials=0;navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints?.audio){(window as any).videoAudioDenials++;throw new DOMException('Synthetic microphone denial','NotAllowedError');}return original(constraints);};});
 await page.getByRole('button',{name:'Zoom 2x',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');
 await page.getByRole('button',{name:'Video mode',exact:true}).click();
 await page.getByRole('button',{name:'Start recording',exact:true}).click();
 await expect(page.getByRole('alert',{name:'Mic off',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).videoAudioDenials)).toBe(1);
 await page.getByRole('button',{name:'Record without sound',exact:true}).click();await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
 const recording=page.getByRole('timer',{name:'Recording',exact:true});
 await expect(recording).toBeVisible();
 expect(await page.evaluate(()=>(window as any).videoAudioDenials)).toBe(1);
 await expect.poll(()=>page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');return (await c.getRecordingState()).fileSize;})).toBeGreaterThan(0);
 await page.evaluate(()=>{const video=document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement;(video.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'));});
 await expect.poll(()=>page.evaluate(async()=>{const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');return (await c.getRecordingState()).isRecording;})).toBe(false);
 await expect(recording).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open last video',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>{const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');return (await library.list({album:'videos'})).items.length;})).toBe(1);
 const saved=await page.evaluate(async()=>{
  const {browserPhotoLibrary:library}=await import('/src/prototype/browser-camera.ts');const rows=(await library.list({album:'videos'})).items;
  const row=await library.read({id:rows[0].id}),blob=await(await fetch(row.path!)).blob();
  return {count:rows.length,kind:row.kind,bytes:blob.size,size:row.size,streams:(window as any).controlStreams.length,released:(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};
 });
 expect(saved.count).toBe(1);expect(saved.kind).toBe('video');expect(saved.bytes).toBeGreaterThan(0);expect(saved.size).toBe(saved.bytes);expect(saved.streams).toBeGreaterThan(1);expect(saved.released).toBe(true);
 await expect(page.getByRole('alert',{name:'Can’t start camera',exact:true})).toBeVisible();
});
test('Ask mode reviews an unsaved frame and returns to Camera without adding a photo',async({page})=>{
 await page.getByRole('button',{name:'Ask mode',exact:true}).click();
 await page.getByRole('button',{name:'Ask about this',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Ask about selected content',exact:true});
 await expect(review.getByRole('img',{name:'Image for question review'})).toBeVisible();
 expect(await page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');return (await browserPhotoLibrary.list()).items.length;})).toBe(0);
 await review.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','camera');
 await expect(page.getByRole('button',{name:'Ask about this',exact:true})).toBeVisible();
});

test('the last capture opens directly and Back returns to the Camera viewfinder',async({page})=>{
 await page.getByRole('button',{name:'Take photo',exact:true}).click();
 await page.getByRole('button',{name:'Open last photo',exact:true}).click();
 await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toBeVisible();
 await expect(page.getByText('No photos',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back from photo',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','camera');
 await expect(page.getByRole('button',{name:'Take photo',exact:true})).toBeVisible();
});

test('switching with flash on and zoom 2x keeps both reset when the switch fails',async({page})=>{
 await page.evaluate(async()=>{
  const {browserCamera:c}=await import('/src/prototype/browser-camera.ts');const calls=(window as any).flipCalls=[] as string[],setZoom=c.setZoom,switchCamera=c.switchCamera;
  // Refuse the front lens at the media boundary after the real switch releases the old preview.
  const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   if((window as any).failSwitch&&typeof constraints?.video==='object'&&constraints.video.facingMode==='user')throw new DOMException('Front camera unavailable','NotFoundError');
   return getUserMedia(constraints);
  };
  c.flashAvailable=()=>true;c.lightingLabel=(on:boolean)=>`Flash ${on?'on':'off'}`;c.setSettings=async(input:{settings:{flash:string}})=>{calls.push('flash '+input.settings.flash);};
  c.setZoom=async(input:{zoom:number})=>{calls.push('zoom '+input.zoom);await setZoom(input);};
  c.switchCamera=async options=>{calls.push('switch '+options.direction);return switchCamera(options);};
 });
 await page.getByRole('button',{name:'Zoom 2x',exact:true}).click();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');
 await page.getByRole('button',{name:'Flash off',exact:true}).click();await expect(page.getByRole('button',{name:'Flash on',exact:true})).toBeVisible();
 const calls=()=>page.evaluate(()=>(window as any).flipCalls.splice(0));expect(await calls()).toEqual(['zoom 2','flash on']);
 await page.evaluate(()=>(window as any).failSwitch=true);await page.getByRole('button',{name:'Switch camera',exact:true}).click();
 const recovery=page.getByRole('alert',{name:'Can’t start camera',exact:true});
 await expect(recovery).toBeVisible();
 await expect(page.locator('[data-alpha-camera="viewfinder"] video')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 expect(await calls()).toEqual(['flash off','zoom 1','switch front']);
 await page.evaluate(()=>(window as any).failSwitch=false);
 await recovery.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(recovery).toHaveCount(0);
 await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThanOrEqual(2);
 expect(await calls()).toEqual([]);
 await expect(page.getByRole('button',{name:'Flash off',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Zoom 1x',exact:true})).toHaveCSS('width','40px');
 await page.getByRole('button',{name:'Switch camera',exact:true}).click();
 await expect(page.getByRole('button',{name:'Flash off',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCount(0);
 expect(await calls()).toEqual(['switch front']);
});

test('two-finger preview pinch changes the real zoom crop without firing tap focus',async({page})=>{
 const finder=page.locator('[data-alpha-camera="viewfinder"]'),box=(await finder.boundingBox())!;
 await expect(page.getByRole('button',{name:'Zoom .5x',exact:true})).toHaveCount(0);
 const x=box.x+box.width/2,y=box.y+box.height/2,cdp=await page.context().newCDPSession(page);
 const points=(span:number)=>[{x:x-span/2,y,id:0},{x:x+span/2,y,id:1}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(80)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(160)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>finder.locator('video').evaluate((video:HTMLVideoElement)=>video.style.transform)).toBe('scale(2, 2)');
 await expect(page.locator('[data-alpha-camera-focus]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Zoom 2x',exact:true})).toHaveCSS('width','40px');
 await cdp.detach();
});
