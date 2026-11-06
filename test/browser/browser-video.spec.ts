import {test,expect} from '@playwright/test';
// Synthetic camera/microphone sources; real MediaRecorder, codecs and IndexedDB.
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
 const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const state=(window as any).videoTest={streams:[] as MediaStream[],audioCalls:0,held:false,deny:false};
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const context=canvas.getContext('2d')!;let n=0;setInterval(()=>{context.fillStyle=n++%2?'#2266aa':'#aa6622';context.fillRect(0,0,320,240);},50);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   if(constraints?.audio){state.audioCalls++;if(state.deny)throw new DOMException('Denied','NotAllowedError');if(state.held)await new Promise<void>(resolve=>{state.release=resolve;});const ac=new AudioContext(),osc=ac.createOscillator(),out=ac.createMediaStreamDestination();osc.connect(out);osc.start();await ac.resume();state.audioContext=ac;state.streams.push(out.stream);return out.stream;}
   const stream=canvas.captureStream(20);state.streams.push(stream);return stream;
  };
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();await expect.poll(()=>page.locator('[aria-label^="Viewfinder."] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
});
for(const clearedMime of [false,true])test(`video records microphone audio, saves exactly once and decodes after reload (cleared MIME: ${clearedMime})`,async({page})=>{
 if(clearedMime)await page.evaluate(()=>{const Native=MediaRecorder;(window as any).MediaRecorder=class extends Native{get mimeType(){return this.state==='inactive'?'':super.mimeType;}};});
 const result=await page.evaluate(async()=>{
  const {browserCamera:camera,browserPhotoLibrary:photos}=await import('/src/prototype/browser-camera.ts');
  await camera.startRecording({audio:true,maxDuration:.5,maxFileSize:1_000_000});
  await new Promise(resolve=>setTimeout(resolve,750));const ended=await camera.getRecordingState();
  const [first,second]=await Promise.all([camera.stopRecording(),camera.stopRecording()]);const rows=(await photos.list()).items;
  return {first,second,count:rows.length,ended,audioCalls:(window as any).videoTest.audioCalls,audioEnded:(window as any).videoTest.streams.filter((s:MediaStream)=>s.getAudioTracks().length).every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};
 });expect(result.first).toEqual(result.second);expect(result.count).toBe(1);expect(result.first.fileSize).toBeGreaterThan(0);expect(result.ended.isRecording).toBe(false);expect(result.ended.fileSize).toBeGreaterThan(0);expect(result.ended.duration).toBeLessThan(1);expect(result.audioCalls).toBe(1);expect(result.audioEnded).toBe(true);
 await page.reload();
 const decoded=await page.evaluate(async()=>{
  const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const row=(await browserPhotoLibrary.list()).items[0];
  const blob=await(await fetch(row.path!)).blob(),url=URL.createObjectURL(blob),video=document.createElement('video'),ac=new AudioContext();
  video.src=url;video.loop=true;document.body.append(video);
  const source=ac.createMediaElementSource(video),analyser=ac.createAnalyser(),silent=ac.createGain();silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(ac.destination);
  try{await ac.resume();await video.play();const samples=new Float32Array(analyser.fftSize);let rms=0;const start=performance.now();while(performance.now()-start<1500&&rms<.01){await new Promise(resolve=>setTimeout(resolve,25));analyser.getFloatTimeDomainData(samples);rms=Math.max(rms,Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length));}const tracks=typeof (video as any).captureStream==='function'?(video as any).captureStream().getTracks().map((t:MediaStreamTrack)=>t.kind):null;return {mime:blob.type,kind:row.kind,tracks,width:row.width,height:row.height,decodedWidth:video.videoWidth,rms};}
  finally{video.pause();video.removeAttribute('src');video.load();video.remove();source.disconnect();analyser.disconnect();silent.disconnect();await ac.close();URL.revokeObjectURL(url);}

 });expect(decoded.mime).toMatch(/^video\/(webm|mp4)$/);expect(decoded).toMatchObject({kind:'video',width:320,height:240});expect(decoded.decodedWidth).toBe(320);expect(decoded.rms).toBeGreaterThan(.01);if(decoded.tracks)expect(decoded.tracks.sort()).toEqual(['audio','video']);
});
test('late microphone permission after camera closure is released and cannot save',async({page})=>{
 await page.evaluate(async()=>{(window as any).videoTest.held=true;const {browserCamera}=await import('/src/prototype/browser-camera.ts');(window as any).pendingVideo=browserCamera.startRecording({audio:true,maxDuration:1,maxFileSize:1000000}).then(()=>false,()=>true);});
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).videoTest.release)).toBe('function');
 await page.evaluate(async()=>{const {browserCamera}=await import('/src/prototype/browser-camera.ts');await browserCamera.stopPreview();(window as any).videoTest.release();});
 expect(await page.evaluate(()=>(window as any).pendingVideo)).toBe(true);
 expect(await page.evaluate(()=>(window as any).videoTest.streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});
test('microphone denial and size overflow produce no saved video and permit a fresh attempt',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c,browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const s=(window as any).videoTest;let denied=false,overflow=false;s.deny=true;
  try{await c.startRecording({audio:true,maxDuration:1,maxFileSize:1000000});}catch{denied=true;}s.deny=false;
  // Wait for an actual encoded chunk, rather than assuming each codec starts in 300 ms.
  const recorded=async()=>{while(true){const state=await c.getRecordingState();if(state.fileSize>0||!state.isRecording)return;await new Promise(r=>setTimeout(r,25));}};
  await c.startRecording({audio:true,maxDuration:2,maxFileSize:1});await recorded();try{await c.stopRecording();}catch(error){overflow=String(error).includes('Video exceeded the size limit.');}const empty=(await p.list()).items.length;
  await c.startRecording({audio:true,maxDuration:2,maxFileSize:1000000});await recorded();await c.stopRecording();return {denied,overflow,empty,saved:(await p.list()).items.length};
 });expect(result).toEqual({denied:true,overflow:true,empty:0,saved:1});
});
test('quota failure does not publish a receipt or duplicate a video on repeated Stop',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c,browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');await c.startRecording({audio:true,maxDuration:.3,maxFileSize:1000000});await new Promise(r=>setTimeout(r,500));
  const original=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value,key){if(this.name==='photos')throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);};
  let failures=0;try{await c.stopRecording();}catch{failures++;}finally{IDBObjectStore.prototype.add=original;}
  try{await c.stopRecording();}catch{failures++;}return {failures,count:(await p.list()).items.length};
 });expect(result).toEqual({failures:2,count:0});
});

test('rendered Video mode saves on Home and restores playable media in Photos',async({page})=>{
 await page.getByRole('button',{name:'Video mode',exact:true}).click();await page.getByRole('button',{name:'Start recording',exact:true}).click();await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>{const {browserCamera}=await import('/src/prototype/browser-camera.ts');return (await browserCamera.getRecordingState()).fileSize;})).toBeGreaterThan(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect.poll(()=>page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');return (await browserPhotoLibrary.list()).items.filter(r=>r.kind==='video').length;})).toBe(1);
 await expect.poll(()=>page.evaluate(()=>(window as any).videoTest.streams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 await page.reload();await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:/^Video, /}).click();await page.getByRole('button',{name:'Play video',exact:true}).click();
 await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
});

test('recorder startup failure and missing stop callback release microphone ownership',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {browserCamera:c,browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const Original=window.MediaRecorder;let startup=false,timeout=false;
  (window as any).MediaRecorder=class{constructor(){throw Error('Recorder unavailable');}};
  try{await c.startRecording({audio:true,maxDuration:1,maxFileSize:1000000});}catch{startup=true;}
  (window as any).MediaRecorder=class{state='inactive';mimeType='video/webm';ondataavailable:any;onstop:any;onerror:any;start(){this.state='recording';}stop(){this.state='inactive';}};
  try{await c.startRecording({audio:true,maxDuration:1,maxFileSize:1000000});await c.stopRecording();}catch(e){timeout=(e as Error).message.includes('did not finish');}finally{window.MediaRecorder=Original;}
  return {startup,timeout,count:(await p.list()).items.length,released:(window as any).videoTest.streams.filter((s:MediaStream)=>s.getAudioTracks().length).every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended'))};
 });expect(result).toEqual({startup:true,timeout:true,count:0,released:true});
});

test('Stop during pending microphone permission rejects a late start',async({page})=>{
 await page.evaluate(async()=>{(window as any).videoTest.held=true;const {browserCamera}=await import('/src/prototype/browser-camera.ts');(window as any).pendingVideo=browserCamera.startRecording({audio:true,maxDuration:1,maxFileSize:1000000}).then(()=>false,()=>true);});
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).videoTest.release)).toBe('function');
 await page.evaluate(async()=>{const {browserCamera}=await import('/src/prototype/browser-camera.ts');try{await browserCamera.stopRecording();}catch{}(window as any).videoTest.release();});
 expect(await page.evaluate(()=>(window as any).pendingVideo)).toBe(true);
 expect(await page.evaluate(()=>(window as any).videoTest.streams.filter((s:MediaStream)=>s.getAudioTracks().length).every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});
