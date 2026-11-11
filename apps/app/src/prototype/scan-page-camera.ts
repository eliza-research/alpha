import './scan-dialog.css';
/** Camera owns the native preview and serializes capture. A scan only borrows it. */
export interface ScanPageCamera {
 current():boolean;
 viewfinder():HTMLElement|undefined;
 capture(signal:AbortSignal):Promise<Blob>;
}
function captureBoundPage(signal:AbortSignal,camera:ScanPageCamera):Promise<Blob|undefined>{
 if(signal.aborted)return Promise.resolve(undefined);
 if(!camera.current()||!camera.viewfinder())return Promise.reject(Error('Open Camera before capturing a document page.'));
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='scan-dialog scan-native-capture';dialog.setAttribute('aria-label','Capture document page');
  const heading=document.createElement('h2');heading.textContent='Capture page';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Frame the page in Camera, then capture. Nothing is saved to Photos.';
  const preview=document.createElement('img');preview.alt='Review captured document page';preview.hidden=true;
  const panel=document.createElement('div');panel.className='scan-native-capture-panel';
  const tools=document.createElement('div');tools.className='scan-dialog-tools';
  const actions=document.createElement('div');actions.className='scan-dialog-actions';
  const controller=new AbortController();let closed=false,busy=false,blob:Blob|undefined,url:string|undefined;
  // A document or OCR review must not paint over Camera's existing transparent
  // viewfinder. Preserve each dialog's exact visibility until capture finishes.
  const covered=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].map(element=>({element,visibility:element.style.visibility}));
  for(const {element} of covered)element.style.visibility='hidden';
  const button=(name:string,action:()=>void)=>{const value=document.createElement('button');value.type='button';value.textContent=name;value.onclick=action;return value;};
  const finish=(result?:Blob)=>{
   if(closed)return;closed=true;controller.abort();signal.removeEventListener('abort',abort);
   window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',abort);window.removeEventListener('resize',layout);document.removeEventListener('visibilitychange',visibility);
   if(url)URL.revokeObjectURL(url);dialog.remove();for(const {element,visibility} of covered)if(element.isConnected)element.style.visibility=visibility;resolve(result);
  };
  const abort=()=>finish(),visibility=()=>{if(document.hidden)finish();};
  const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
  const layout=()=>{
   const finder=camera.viewfinder(),screen=finder?.closest<HTMLElement>('[data-screen]');
   if(!camera.current()||!finder||!screen){finish();return;}
   const rect=screen.getBoundingClientRect();Object.assign(dialog.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
  };
  const capture=button('Capture page',()=>{
   if(closed||busy||!camera.current())return;busy=true;capture.disabled=true;status.textContent='Capturing page…';
   void camera.capture(controller.signal).then(value=>{
    if(closed)return;if(!camera.current()){finish();return;}blob=value;url=URL.createObjectURL(value);preview.src=url;preview.hidden=false;
    dialog.classList.add('scan-native-captured');capture.hidden=true;retake.hidden=false;use.disabled=false;status.textContent='Review this page before adding it. Nothing is saved to Photos.';
   },error=>{if(!closed){status.textContent=error instanceof Error?error.message:'Page could not be captured. Try again.';capture.disabled=false;}}).finally(()=>{busy=false;});
  });
  const retake=button('Retake capture',()=>{
   if(!camera.current()){finish();return;}if(url)URL.revokeObjectURL(url);url=undefined;blob=undefined;preview.removeAttribute('src');preview.hidden=true;
   dialog.classList.remove('scan-native-captured');capture.hidden=false;capture.disabled=false;retake.hidden=true;use.disabled=true;status.textContent='Frame the page in Camera, then capture.';
  });retake.hidden=true;
  const use=button('Use captured page',()=>{if(blob&&camera.current())finish(blob);});use.disabled=true;use.className='primary';
  tools.append(capture,retake);actions.append(use,button('Cancel capture',abort));panel.append(heading,status,tools,actions);dialog.append(preview,panel);
  signal.addEventListener('abort',abort,{once:true});window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',abort);window.addEventListener('resize',layout);document.addEventListener('visibilitychange',visibility);
  dialog.oncancel=event=>{event.preventDefault();finish();};(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();layout();capture.focus();
 });
}
/** A document capture owns cloned preview tracks or its own camera request. */
export function captureScanPage(signal:AbortSignal,camera?:ScanPageCamera):Promise<Blob|undefined>{
 if(camera)return captureBoundPage(signal,camera);
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Capture document page');dialog.className='scan-dialog';const heading=document.createElement('h2');heading.textContent='Capture page';const video=document.createElement('video');video.playsInline=true;video.muted=true;video.style.cssText='width:100%;max-height:48dvh;object-fit:contain;background:#111';const preview=document.createElement('img');preview.alt='Review captured document page';preview.hidden=true;preview.style.cssText=video.style.cssText;const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Starting camera…';let closed=false,stream:MediaStream|undefined,blob:Blob|undefined,url:string|undefined,busy=false;
  const button=(name:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=action;return b;};
  const finish=(result?:Blob)=>{if(closed)return;closed=true;clearTimeout(deadline);signal.removeEventListener('abort',abort);window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',abort);document.removeEventListener('visibilitychange',visibility);stream?.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;if(url)URL.revokeObjectURL(url);dialog.remove();resolve(result);};const abort=()=>finish(),back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();},visibility=()=>{if(document.hidden)finish();};
  const capture=button('Capture page',()=>{if(busy||video.readyState<2||closed||!stream?.getVideoTracks().some(t=>t.readyState==='live'))return;busy=true;capture.disabled=true;const canvas=document.createElement('canvas');const scale=Math.min(1,2048/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);const ctx=canvas.getContext('2d');if(!ctx||!canvas.width||!canvas.height){busy=false;capture.disabled=false;status.textContent='Camera frame could not be captured. Try again.';return;}ctx.drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(value=>{if(closed)return;busy=false;if(!value){capture.disabled=false;status.textContent='Camera frame could not be captured. Try again.';return;}blob=value;url=URL.createObjectURL(value);preview.src=url;preview.hidden=false;video.hidden=true;video.pause();capture.hidden=true;retake.hidden=false;use.disabled=false;status.textContent='Review this page before adding it.';},'image/jpeg',.9);});capture.disabled=true;
  const retake=button('Retake capture',()=>{if(url)URL.revokeObjectURL(url);url=undefined;blob=undefined;preview.removeAttribute('src');preview.hidden=true;video.hidden=false;capture.hidden=false;capture.disabled=false;retake.hidden=true;use.disabled=true;void video.play().catch(()=>{status.textContent='Camera preview could not resume. Close and try again.';});});retake.hidden=true;
  const use=button('Use captured page',()=>{if(blob)finish(blob);});use.disabled=true;const cancel=button('Cancel capture',abort);
  const deadline=setTimeout(()=>{if(!closed&&!stream){status.textContent='Camera is still waiting. You can cancel and choose an image instead.';}},15000);
  signal.addEventListener('abort',abort,{once:true});window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',abort);document.addEventListener('visibilitychange',visibility);dialog.oncancel=e=>{e.preventDefault();finish();};use.className='primary';const content=document.createElement('div');content.className='scan-dialog-content';content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Review details');const tools=document.createElement('div');tools.className='scan-dialog-tools';tools.append(capture,retake);content.append(video,preview,status,tools);const actions=document.createElement('div');actions.className='scan-dialog-actions';actions.append(use,cancel);dialog.append(heading,content,actions);(document.querySelector('.os')||document.body).append(dialog);dialog.showModal();if(signal.aborted){finish();return;}
  const existing=document.querySelector<HTMLVideoElement>('[data-alpha-camera="viewfinder"] video')?.srcObject as MediaStream|null|undefined;const tracks=existing?.getVideoTracks().filter(t=>t.readyState==='live');
  let request:Promise<MediaStream>|undefined;try{request=tracks?.length?Promise.resolve(new MediaStream(tracks.map(t=>t.clone()))):navigator.mediaDevices?.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1600},height:{ideal:1200}}});}catch{status.textContent='Choose an image or close and try camera access again.';return;}
  if(!request){status.textContent='Choose an image to add this page.';return;}
  void request.then(async value=>{if(closed){value.getTracks().forEach(t=>t.stop());return;}stream=value;video.srcObject=value;try{await video.play();if(closed)return;clearTimeout(deadline);capture.disabled=false;status.textContent='Frame the page, then capture.';value.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(!closed){capture.disabled=true;status.textContent='Camera stopped. Keep the reviewed capture or choose another image.';}},{once:true}));}catch{if(!closed){value.getTracks().forEach(t=>t.stop());status.textContent='Camera preview could not start. Close and try again.';}}},()=>{if(!closed){clearTimeout(deadline);status.textContent='Choose an image or close and try camera access again.';}});
 });
}
