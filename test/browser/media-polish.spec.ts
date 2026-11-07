import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
async function openSyntheticCamera(page:Page){
 await page.addInitScript(()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const paint=()=>{canvas.getContext('2d')!.fillRect(0,0,320,240);};paint();setInterval(paint,50);(window as any).cameraAudioRequests=0;Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async(input:MediaStreamConstraints)=>{if(input?.audio){(window as any).cameraAudioRequests++;throw Error('No microphone in this UI test');}return canvas.captureStream(10);}}});});
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();await expect.poll(()=>page.locator('[aria-label^="Viewfinder."] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
}
test('empty scan starts with capture and import instead of disabled export buttons',async({page},info)=>{
 await page.goto('/');await page.evaluate(async()=>(await import('/src/prototype/scan-document.ts')).openScanDocument());
 const dialog=page.getByRole('dialog',{name:'Review scan document',exact:true});
 await expect(dialog.getByRole('button',{name:'Capture new page',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Add page',exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Download document PDF',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Save document draft',exact:true})).toHaveCount(0);
 expect(await dialog.locator('h2').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Denton');
 expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
 await page.screenshot({path:info.outputPath('scan-empty.png')});await dialog.getByRole('button',{name:'Close document',exact:true}).click();await expect(dialog).toHaveCount(0);
});
test('video editor shows readable times, compact tools and saves exact original bounds',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).focus();await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.getContext('2d')!.fillStyle='#d6a667';canvas.getContext('2d')!.fillRect(0,0,320,180);const stream=canvas.captureStream(10);const chunks:BlobPart[]=[];const recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start();await new Promise(r=>setTimeout(r,250));recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
  const url=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));(window as any).editorSource=url;
  (window as any).videoPreviewDraws=0;const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){if(this.canvas.closest('.video-edit-review'))(window as any).videoPreviewDraws++;return (draw as any).apply(this,args);};
  (await import('/src/prototype/video-edit-review.ts')).openVideoEditReview({path:url,duration:3.653800000011921},async edit=>{(window as any).savedVideoEdit=edit;return true;});
 });
 const dialog=page.getByRole('dialog',{name:'Edit video',exact:true});await expect(dialog.getByRole('slider',{name:'End seconds'})).toHaveAttribute('aria-valuetext','3.654 seconds');
 await expect.poll(()=>dialog.locator('video').evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThanOrEqual(2);
 const idleBefore=await page.evaluate(()=>(window as any).videoPreviewDraws);await page.waitForTimeout(1200);const idleDraws=await page.evaluate(()=>(window as any).videoPreviewDraws)-idleBefore;
 console.log('Paused video preview draws over 1200ms:',idleDraws);expect(idleDraws).toBe(0);
 await expect(dialog.getByRole('button',{name:'Pause preview',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Preview trim',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Rotate video',exact:true}).click();expect(await page.evaluate(()=>(window as any).videoPreviewDraws)-idleBefore).toBe(1);await dialog.getByRole('button',{name:'Crop video',exact:true}).click();expect(await page.evaluate(()=>(window as any).videoPreviewDraws)-idleBefore).toBe(2);await expect(dialog.getByRole('button',{name:'Crop video',exact:true})).toHaveAttribute('aria-pressed','true');
 const start=dialog.getByRole('slider',{name:'Start seconds'}),end=dialog.getByRole('slider',{name:'End seconds'});
 await start.press('ArrowRight');await expect(start).toHaveAttribute('aria-valuenow','0.1');await start.press('Home');await end.press('ArrowLeft');await expect(end).toHaveAttribute('aria-valuetext','3.554 seconds');await end.press('End');
 expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.height-915)<1&&r.width<=412&&getComputedStyle(el).borderRadius==='0px';})).toBe(true);
 await page.screenshot({path:info.outputPath('video-editor.png')});await dialog.getByRole('button',{name:'Save video copy',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).savedVideoEdit)).toEqual({start:0,end:3.653800000011921,rotation:90,crop:true});await expect(page.getByRole('button',{name:'Photos',exact:true})).toBeFocused();const closedDraws=await page.evaluate(()=>(window as any).videoPreviewDraws);await page.waitForTimeout(150);expect(await page.evaluate(()=>(window as any).videoPreviewDraws)).toBe(closedDraws);
});
test('camera errors expire, refresh their deadline and center the logo',async({page},info)=>{
 await openSyntheticCamera(page);
 await page.clock.install();await page.evaluate(async()=>{(await import('/src/prototype/browser-camera.ts')).browserCamera.setZoom=async()=>{throw Error('Synthetic unavailable control');};});
 const zoom=page.getByRole('button',{name:'Zoom 2x',exact:true}),notice=page.locator('[data-alpha-camera="said"]');await zoom.click();await expect(notice).toBeVisible();
 expect(await notice.evaluate(el=>{const box=el.getBoundingClientRect(),icon=el.querySelector('span')!.getBoundingClientRect();return Math.abs(icon.top+icon.height/2-box.top-box.height/2);})).toBeLessThan(1);
 await page.screenshot({path:info.outputPath('camera-error.png')});
 await page.clock.fastForward(2500);await zoom.click();await page.clock.fastForward(2600);await expect(notice).toBeVisible();await page.clock.fastForward(2500);await expect(notice).toHaveCount(0);
});

test('failed video read leaves save disabled and performs no save operation',async({page})=>{
 await page.route('https://example.invalid/unavailable-video',route=>route.fulfill({status:404,body:'Not found'}));await page.goto('/');
 await page.evaluate(async()=>{(window as any).unavailableVideoSaves=0;(await import('/src/prototype/video-edit-review.ts')).openVideoEditReview({path:'https://example.invalid/unavailable-video',duration:3.6},async()=>{(window as any).unavailableVideoSaves++;return true;});});
 const dialog=page.getByRole('dialog',{name:'Edit video',exact:true});await expect(dialog.getByRole('status')).toContainText('Video could not load');
 const save=dialog.getByRole('button',{name:'Save video copy',exact:true});await expect(save).toBeDisabled();await save.dispatchEvent('click');expect(await page.evaluate(()=>(window as any).unavailableVideoSaves)).toBe(0);
 await dialog.getByRole('button',{name:'Close video editor',exact:true}).click();await expect(dialog).toHaveCount(0);
});

test('recording uses the timer and saved-video thumbnail without a success banner',async({page},info)=>{
 await openSyntheticCamera(page);await page.evaluate(async()=>{
  const {browserCamera:c,browserPhotoLibrary:p}=await import('/src/prototype/browser-camera.ts');const state=await c.getRecordingState(),listed=await p.list();let recording=false,saved=false;
  const image=document.createElement('canvas');image.width=320;image.height=240;image.getContext('2d')!.fillRect(0,0,320,240);
  const row={id:'v:777',kind:'video',path:'browser-video:///777',image:image.toDataURL(),width:320,height:240,date:Date.now(),duration:3.5,revision:'video-fixture',mutationRevision:'video-fixture'};
  c.startRecording=async input=>{(window as any).recordingOptions=input;recording=true;};c.getRecordingState=async()=>({...state,isRecording:recording,duration:3.5});c.stopRecording=async()=>{recording=false;saved=true;return {path:'browser-video:///777',duration:3.5,fileSize:1024};};p.list=async()=>({...listed,items:saved?[row]:[]}) as any;p.read=async()=>row as any;
 });
 await page.getByRole('button',{name:'Video mode',exact:true}).click();await page.getByRole('button',{name:'Start recording',exact:true}).click();
 await expect(page.getByRole('timer',{name:'Recording',exact:true})).toBeVisible();await expect(page.locator('[data-alpha-camera="said"]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('camera-recording.png')});await page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(page.getByRole('button',{name:'Open last video',exact:true})).toBeVisible();
 const notice=page.locator('[data-alpha-camera="said"]');
 await expect(notice).toHaveCount(0,{timeout:7000});
 await expect(page.getByRole('button',{name:'Open last video',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).cameraAudioRequests)).toBe(0);
});


test('Photos tabs stay aligned in Albums and selection opens the real media library',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).click();
 const select=page.getByRole('button',{name:'Select photos',exact:true}),library=page.getByRole('button',{name:'Library',exact:true});
 const settle=()=>library.evaluate(async el=>{await document.fonts.ready;const animations=new Set(el.getAnimations({subtree:true}));for(let parent=el.parentElement;parent;parent=parent.parentElement)for(const animation of parent.getAnimations())animations.add(animation);await Promise.all([...animations].filter(animation=>animation.effect?.getComputedTiming().endTime!==Infinity).map(animation=>animation.finished));await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
 await settle();const before=await library.boundingBox();await page.getByRole('button',{name:'Albums',exact:true}).click();
 await settle();const after=await library.boundingBox();expect(after!.x).toBe(before!.x);expect(after!.y).toBe(before!.y);
 // Select belongs to grids (the Library and each album), not the album list.
 await expect(select).toHaveCount(0);await library.click();
 await select.click();await expect(page.getByRole('button',{name:'Cancel selection',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Delete selected',exact:true})).toBeVisible();
});

test('image question review is compact and only stages explicitly reviewed text',async({page},info)=>{
 await page.goto('/');await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d')!;c.fillStyle='#d6a667';c.fillRect(0,0,320,180);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!)));
  (window as any).questionDraft=null;(await import('/src/browser/content-question.ts')).reviewContentQuestion({name:'Video preview frame',text:'',current:()=>true,compose:text=>(window as any).questionDraft=text,image:async()=>blob});
 });
 const review=page.getByRole('dialog',{name:'Ask about selected content'});await expect(review.getByRole('img')).toBeVisible();
 const proceed=review.getByRole('button',{name:'Use in conversation',exact:true});await expect(proceed).toBeDisabled();await review.getByRole('textbox',{name:'Content excerpt'}).fill('A synthetic tan frame.');
 await expect(proceed).toBeEnabled();expect(await review.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(388);await page.screenshot({path:info.outputPath('image-question-review.png')});
 await proceed.click();await expect(review).toHaveCount(0);expect(await page.evaluate(()=>(window as any).questionDraft)).toContain('A synthetic tan frame.');
});

for(const endpoint of ['start','end'] as const)test(`trim ${endpoint} handle can save its minimum span`,async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Photos',exact:true}).focus();await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.getContext('2d')!.fillStyle='#d6a667';canvas.getContext('2d')!.fillRect(0,0,320,180);const stream=canvas.captureStream(10);const chunks:BlobPart[]=[];const recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start();await new Promise(r=>setTimeout(r,250));recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
  const url=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));(window as any).editorSource=url;
  (await import('/src/prototype/video-edit-review.ts')).openVideoEditReview({path:url,duration:1},async edit=>{(window as any).savedVideoEdit=edit;return true;});
 });
 const dialog=page.getByRole('dialog',{name:'Edit video',exact:true});
 expect(await page.evaluate(async()=>{const {validateVideoEdit}=await import('/src/browser/video-edit.ts');try{validateVideoEdit({start:.901,end:1,rotation:0,crop:false},1);return false;}catch{return true;}})).toBe(true);
 const handle=dialog.getByRole('slider',{name:endpoint==='start'?'Start seconds':'End seconds'});
 await expect(handle).toBeEnabled();await handle.press(endpoint==='start'?'End':'Home');
 await dialog.getByRole('button',{name:'Save video copy',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).savedVideoEdit)).toMatchObject(endpoint==='start'?{start:.9,end:1}:{start:0,end:.1});
});
