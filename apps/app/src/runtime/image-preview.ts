import {createInlineModal} from './inline-modal';

/** Full-screen image interaction; zoom never changes the image or the chat draft. */
export function createImagePreview(close:()=>void){
 const modal=createInlineModal(close,undefined,{coverAssistant:true});
 let mounted:HTMLElement|null=null,dispose:(()=>void)|undefined;
 return {ref(container:HTMLElement|null){
  if(container===mounted)return;
  dispose?.();dispose=undefined;mounted=container;modal.ref(container);
  if(!container)return;
  const image=container.querySelector('img')!,viewport=container.querySelector<HTMLElement>('[role="dialog"]')!;
  let scale=1,x=0,y=0,pinchDistance=0,pinchScale=1,multiple=false,lastImageTap=false,lastTouchTap=0,dismissOnClick=false;
  const pointers=new Map<number,{x:number;y:number;startX:number;startY:number;image:boolean;type:string;moved:boolean}>();
  let panX=0,panY=0;
  const apply=()=>{
   const maxX=Math.max(0,(image.offsetWidth*scale-viewport.clientWidth)/2),maxY=Math.max(0,(image.offsetHeight*scale-viewport.clientHeight)/2);
   x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));
   image.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
   image.style.cursor=scale>1?'grab':'zoom-in';
  };
  const zoom=(value:number)=>{scale=Math.max(1,Math.min(8,value));if(scale===1)x=y=0;apply();};
  const reset=()=>{scale=1;x=y=0;pointers.clear();multiple=false;pinchDistance=0;apply();};
  const down=(event:PointerEvent)=>{
   if(event.button!==0)return;
   event.stopPropagation();dismissOnClick=false;
   if((event.target as Element).closest('button'))return;
   pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,image:event.target===image,type:event.pointerType,moved:false});
   panX=x;panY=y;container.setPointerCapture(event.pointerId);
   if(pointers.size===2){const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);pinchScale=scale;multiple=true;}
  };
  const move=(event:PointerEvent)=>{
   const point=pointers.get(event.pointerId);if(!point)return;
   event.stopPropagation();
   point.x=event.clientX;point.y=event.clientY;point.moved||=Math.hypot(point.x-point.startX,point.y-point.startY)>5;
   if(pointers.size===2&&pinchDistance){const [a,b]=[...pointers.values()];zoom(pinchScale*Math.hypot(a.x-b.x,a.y-b.y)/pinchDistance);}
   else if(pointers.size===1&&scale>1){x=panX+point.x-point.startX;y=panY+point.y-point.startY;apply();}
   event.preventDefault();
  };
  const up=(event:PointerEvent)=>{
   event.stopPropagation();
   const point=pointers.get(event.pointerId);if(!point)return;
   pointers.delete(event.pointerId);lastImageTap=point.image&&!point.moved&&!multiple;
   if(!point.moved&&!multiple){
    if(!point.image)dismissOnClick=true;
    else if(point.type==='touch'){const now=Date.now();if(now-lastTouchTap<350){zoom(scale===1?2:1);lastTouchTap=0;}else lastTouchTap=now;}
   }
   if(!pointers.size){multiple=false;pinchDistance=0;}
   else {const remaining=[...pointers.values()][0];remaining.startX=remaining.x;remaining.startY=remaining.y;panX=x;panY=y;}
  };
  const cancel=(event:PointerEvent)=>{event.stopPropagation();pointers.delete(event.pointerId);multiple=pointers.size>0;pinchDistance=0;for(const point of pointers.values())point.moved=true;};
  // Keep the overlay mounted until the click has its target. Removing it on pointerup can
  // retarget the following click to the app under the image (for example Photos).
  const click=(event:MouseEvent)=>{
   if((event.target as Element).closest('button'))return;
   event.stopPropagation();
   if(dismissOnClick){event.preventDefault();dismissOnClick=false;close();}
  };
  const doubleClick=(event:MouseEvent)=>{if(event.target===image||lastImageTap){event.preventDefault();zoom(scale===1?2:1);}};
  const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoom(scale*Math.exp(-event.deltaY*.002));};
  const key=(event:KeyboardEvent)=>{
   if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.5);}
   else if(event.key==='-'){event.preventDefault();zoom(scale/1.5);}
   else if(event.key==='0'){event.preventDefault();reset();}
  };
  container.addEventListener('pointerdown',down);container.addEventListener('pointermove',move);container.addEventListener('pointerup',up);container.addEventListener('pointercancel',cancel);
  container.addEventListener('click',click);container.addEventListener('dblclick',doubleClick);container.addEventListener('wheel',wheel,{passive:false});container.addEventListener('keydown',key);image.addEventListener('load',reset);
  const resize=new ResizeObserver(apply);resize.observe(viewport);apply();
  dispose=()=>{resize.disconnect();container.removeEventListener('pointerdown',down);container.removeEventListener('pointermove',move);container.removeEventListener('pointerup',up);container.removeEventListener('pointercancel',cancel);container.removeEventListener('click',click);container.removeEventListener('dblclick',doubleClick);container.removeEventListener('wheel',wheel);container.removeEventListener('keydown',key);image.removeEventListener('load',reset);pointers.clear();};
 }};
}
