import {mediaToolIcon} from './media-review-controls';
import './scan-dialog.css';
import type {VideoEdit} from '../browser/video-edit';
import {validateVideoEdit,drawEditedVideo} from '../browser/video-edit';
/** A media workspace: preview first, direct trim handles, one copy-save action.
 * Alpha's existing media colors and published icons; no unsupported tools. */
export function openVideoEditReview(source:{path:string;duration:number;stream?:boolean},save:(edit:VideoEdit,signal:AbortSignal)=>Promise<boolean>,onClose:()=>void=()=>{}){
 const previous=document.activeElement,controller=new AbortController(),dialog=document.createElement('dialog');
 dialog.setAttribute('aria-label','Edit video');dialog.className='scan-dialog video-edit-review';
 const video=document.createElement('video');video.preload='auto';video.playsInline=true;video.hidden=true;
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Edited video preview');
 const preview=document.createElement('div');preview.className='video-editor-preview';preview.append(canvas,video);
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading video…';
 const edit:VideoEdit={start:0,end:source.duration,rotation:0,crop:false};
 let busy=false,closed=false,loaded=false,sourceUrl:string|undefined,previewFrame:number|undefined,lastPreviewTime=-1,lastPaintAt=0;
 const controls:HTMLButtonElement[]=[];
 const button=(name:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.type='button';b.onclick=action;controls.push(b);return b;};
 const clock=(value:number)=>`${Math.floor(value/60)}:${(value%60).toFixed(1).padStart(4,'0')}`;
 const timeline=document.createElement('div');timeline.className='video-editor-timeline';timeline.setAttribute('aria-label','Trim video');
 const track=document.createElement('div');track.className='video-editor-track';track.setAttribute('aria-hidden','true');
 const selected=document.createElement('div');selected.className='video-editor-selection';
 const playhead=document.createElement('div');playhead.className='video-editor-playhead';track.append(selected,playhead);
 const times=document.createElement('div');times.className='video-editor-times';
 const startTime=document.createElement('span'),length=document.createElement('span'),endTime=document.createElement('span');times.append(startTime,length,endTime);
 const handles={} as Record<'start'|'end',HTMLButtonElement>;
 const updateTimeline=()=>{
  for(const key of ['start','end'] as const){const h=handles[key];if(!h)continue;h.style.left=`${edit[key]/source.duration*100}%`;h.setAttribute('aria-valuenow',String(edit[key]));h.setAttribute('aria-valuetext',`${edit[key].toFixed(3)} seconds`);h.setAttribute('aria-valuemin',String(key==='start'?0:edit.start+.1));h.setAttribute('aria-valuemax',String(key==='end'?source.duration:Math.max(0,edit.end-.1)));}
  selected.style.left=`${edit.start/source.duration*100}%`;selected.style.width=`${(edit.end-edit.start)/source.duration*100}%`;
  playhead.style.left=`${Math.min(1,Math.max(0,video.currentTime/source.duration))*100}%`;
  startTime.textContent=clock(edit.start);endTime.textContent=clock(edit.end);length.textContent=`${(edit.end-edit.start).toFixed(1)}s`;
 };
 const updateControls=()=>{for(const control of controls)control.disabled=busy||!loaded;};
 // One source fetch; zero paused polling. Playback draws only changed frames, at <=30fps.
 const update=(force=true)=>{if(!closed&&video.readyState>=2&&(force||video.currentTime!==lastPreviewTime)){drawEditedVideo(video,edit,canvas);lastPreviewTime=video.currentTime;updateTimeline();}};
 const stopFrames=()=>{if(previewFrame!==undefined)cancelAnimationFrame(previewFrame);previewFrame=undefined;};
 const frame=(time:number)=>{previewFrame=undefined;if(closed||video.paused||video.ended)return;if(time-lastPaintAt>=33){lastPaintAt=time;update(false);}if(!closed&&!video.paused&&!video.ended)previewFrame=requestAnimationFrame(frame);};
 const startFrames=()=>{if(previewFrame===undefined&&!closed)previewFrame=requestAnimationFrame(frame);};
 const trim=(key:'start'|'end',value:number)=>{
  if(busy||!loaded||!Number.isFinite(value))return;video.pause();
  edit[key]=Math.min(key==='start'?edit.end-.1:source.duration,Math.max(key==='start'?0:edit.start+.1,value));
  video.currentTime=Math.min(Math.max(0,edit[key]),Number.isFinite(video.duration)?video.duration:source.duration);updateTimeline();
 };
 for(const key of ['start','end'] as const){
  const h=button(key==='start'?'Trim start':'Trim end',()=>{});handles[key]=h;h.className='video-editor-handle';h.setAttribute('role','slider');h.setAttribute('aria-label',key==='start'?'Start seconds':'End seconds');h.setAttribute('aria-orientation','horizontal');
  let dragging:number|undefined;
  const move=(event:PointerEvent)=>{const box=track.getBoundingClientRect();trim(key,Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*source.duration);};
  h.onpointerdown=event=>{if(h.disabled||event.button!==0)return;event.preventDefault();h.focus();dragging=event.pointerId;h.setPointerCapture(event.pointerId);};
  h.onpointermove=event=>{if(dragging===event.pointerId)move(event);};h.onpointerup=event=>{if(dragging!==event.pointerId)return;move(event);dragging=undefined;h.releasePointerCapture(event.pointerId);};h.onpointercancel=()=>{dragging=undefined;};
  h.onkeydown=event=>{const step=event.shiftKey?1:.1;let next:number|undefined;if(event.key==='ArrowRight'||event.key==='ArrowUp')next=edit[key]+step;if(event.key==='ArrowLeft'||event.key==='ArrowDown')next=edit[key]-step;if(event.key==='Home')next=0;if(event.key==='End')next=source.duration;if(next!==undefined){event.preventDefault();trim(key,event.key==='Home'||event.key==='End'?next:Math.round(next*1000)/1000);}};
 }
 timeline.append(track,handles.start,handles.end);
 const rotate=button('Rotate video',()=>{edit.rotation=(edit.rotation+90)%360;update();});
 const crop=button('Crop video',()=>{edit.crop=!edit.crop;crop.setAttribute('aria-pressed',String(edit.crop));update();});
 const play=button('Preview trim',()=>{try{validateVideoEdit(edit,source.duration);if(video.currentTime<edit.start||video.currentTime>=edit.end)video.currentTime=edit.start;void video.play().catch(()=>{status.textContent='';});}catch(error){status.textContent=(error as Error).message;}});
 const pause=button('Pause preview',()=>video.pause());
 for(const [b,icon] of [[rotate,'rotate-cw'],[crop,'crop'],[play,'play'],[pause,'pause']] as const)mediaToolIcon(b,icon);
 crop.setAttribute('aria-pressed','false');crop.title='Center crop';pause.hidden=true;
 video.onplay=()=>{play.hidden=true;pause.hidden=false;startFrames();};video.onpause=()=>{play.hidden=false;pause.hidden=true;stopFrames();update(false);};
 video.ontimeupdate=()=>{if(video.currentTime>=edit.end)video.pause();};
 video.onloadeddata=()=>{if(closed)return;loaded=true;updateControls();status.textContent='';update();};video.onseeked=()=>update();
 video.onerror=()=>{if(closed)return;loaded=false;updateControls();status.textContent='Couldn’t load';};
 const dispose=()=>{if(closed)return;closed=true;stopFrames();controller.abort();video.pause();video.removeAttribute('src');video.load();if(sourceUrl)URL.revokeObjectURL(sourceUrl);dialog.remove();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();onClose();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',dispose);document.removeEventListener('visibilitychange',visibility);};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dispose();},visibility=()=>{if(document.hidden)dispose();};
 const commit=button('Save video copy',()=>{if(busy||!loaded)return;try{validateVideoEdit(edit,source.duration);}catch(error){status.textContent=(error as Error).message;return;}busy=true;video.pause();updateControls();status.textContent='Saving video copy…';void save({...edit},controller.signal).then(saved=>{if(closed)return;if(saved)dispose();else status.textContent='Not saved';},()=>{if(!closed)status.textContent='Save unconfirmed';});});
 commit.className='primary';commit.setAttribute('aria-label','Save video copy');commit.textContent='Save copy';
 const close=button('Close video editor',dispose);controls.pop();mediaToolIcon(close,'chevron-left');
 const heading=document.createElement('h2');heading.textContent='Edit video';const header=document.createElement('header');header.className='video-editor-header';header.append(close,heading,commit);
 const playback=document.createElement('div');playback.className='video-editor-playback';playback.append(play,pause);
 const tools=document.createElement('div');tools.className='video-editor-tools';
 for(const [b,label] of [[rotate,'Rotate'],[crop,'Center crop']] as const){const caption=document.createElement('span');caption.textContent=label;b.append(caption);tools.append(b);}
 const panel=document.createElement('div');panel.className='video-editor-panel';panel.append(playback,timeline,times,tools,status);
 dialog.append(header,preview,panel);dialog.oncancel=e=>{e.preventDefault();dispose();};window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',dispose);document.addEventListener('visibilitychange',visibility);(document.querySelector('.os')||document.body).append(dialog);updateTimeline();updateControls();dialog.showModal();
 // Native playback is an already-admitted, same-origin range capability. Let
 // the decoder stream it instead of duplicating the complete video in a Blob.
 if(source.stream)video.src=source.path;
 else void fetch(source.path,{signal:controller.signal}).then(response=>{if(!response.ok)throw Error('Video unavailable');return response.blob();}).then(blob=>{if(closed)return;sourceUrl=URL.createObjectURL(blob);video.src=sourceUrl;}).catch(()=>{if(!closed)status.textContent='Couldn’t load';});return dispose;
}
