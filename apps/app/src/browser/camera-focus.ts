type Point={x:number;y:number};
type FocusSettings=MediaTrackSettings&{focusMode?:string;pointsOfInterest?:Point[]};
/** A selected point, distinct from confirmation that the lens acquired focus. */
export function cameraFocusTarget(input:Point,frame:HTMLElement){
 const target=document.createElement('span');target.dataset.alphaCameraFocus='target';target.setAttribute('role','status');target.setAttribute('aria-label','Focus target');
 target.style.cssText=`position:absolute;left:${input.x*100}%;top:${input.y*100}%;width:42px;height:42px;transform:translate(-50%,-50%);border:2px solid #ffd34e;border-radius:8px;box-shadow:0 0 2px #000;pointer-events:none;z-index:3;box-sizing:border-box`;frame.append(target);return target;
}
/** Owns a focus target and retires late driver replies with the preview. */
export class BrowserCameraFocus{
 private epoch=0;
 private writes=new WeakMap<MediaStreamTrack,Promise<void>>();
 private reticle:HTMLElement|undefined;
 clear(){++this.epoch;this.reticle?.remove();this.reticle=undefined;}
 async select(input:Point,options:{frame:HTMLElement;video:HTMLVideoElement;track:MediaStreamTrack;zoom:number;mirror:boolean;development:boolean}){
  if(!Number.isFinite(input.x)||!Number.isFinite(input.y))throw Error('Choose a focus point inside the viewfinder.');
  this.clear();const token=this.epoch,{frame,video,track,zoom,mirror,development}=options;
  if(track.readyState!=='live')throw Error('Start camera first.');
  const x=Math.max(0,Math.min(1,input.x)),y=Math.max(0,Math.min(1,input.y));
  const target=this.reticle=cameraFocusTarget({x,y},frame);target.setAttribute('aria-label',development?'Development focus target':'Focus target');
  const alive=()=>token===this.epoch&&target.isConnected&&track.readyState==='live';
  const capabilities=track.getCapabilities() as MediaTrackCapabilities&{focusMode?:string[]};
  const supported=navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints&{pointsOfInterest?:boolean};
  const mode=capabilities.focusMode?.includes('single-shot')?'single-shot':capabilities.focusMode?.includes('continuous')?'continuous':undefined;
  if(mode&&supported.pointsOfInterest){
   // Undo object-fit:cover, digital zoom and front-camera mirroring.
   const rect=frame.getBoundingClientRect(),scale=Math.max(rect.width/video.videoWidth,rect.height/video.videoHeight)*zoom;
   const point={x:.5+(mirror?.5-x:x-.5)*rect.width/(video.videoWidth*scale),y:.5+(y-.5)*rect.height/(video.videoHeight*scale)};
   // A late driver write can change hardware even when its old UI is retired.
   // Serialize per track; a replacement track remains independent.
   const previous=this.writes.get(track);let release!:()=>void;
   const queued=new Promise<void>(resolve=>{release=resolve;});this.writes.set(track,queued);
   try{
    if(previous)await previous;
    if(!alive())return;
    await track.applyConstraints({advanced:[{focusMode:mode,pointsOfInterest:[point]} as MediaTrackConstraintSet]});if(!alive())return;
    const settings=track.getSettings() as FocusSettings,p=settings.pointsOfInterest?.[0];
    if(settings.focusMode===mode&&p&&Math.abs(p.x-point.x)<.01&&Math.abs(p.y-point.y)<.01){target.dataset.alphaCameraFocus='camera';target.setAttribute('aria-label','Camera focus target applied');target.style.borderColor='#68dc94';return;}
   }catch{if(!alive())return;}
   finally{release();if(this.writes.get(track)===queued)this.writes.delete(track);}
  }
  if(!alive())return;
  // Local focus interaction remains usable when the source has no lens driver.
  // This state is explicitly distinct from a confirmed hardware setting.
  target.dataset.alphaCameraFocus=development?'development':'target';
  if(development)target.animate([{transform:'translate(-50%,-50%) scale(1.3)',opacity:.5},{transform:'translate(-50%,-50%) scale(1)',opacity:1}],{duration:180,fill:'none'});
 }
}
