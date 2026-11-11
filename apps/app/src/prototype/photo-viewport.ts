type Point = {x:number;y:number};
type Binding = {
 key:string;width:number;height:number;zoomable:boolean;current():boolean;changed():void;
 toggle():void;step(direction:number):void;
};

/** One source-bound gesture state per mounted Photos viewer. No media is modified. */
export function createPhotoViewport(){
 let binding:Binding|undefined,scale=1,x=0,y=0,frame:HTMLElement|undefined;
 const pointers=new Map<number,Point>();
 let start:Point|undefined,last:Point|undefined,pinch:{distance:number;scale:number;x:number;y:number;center:Point}|undefined;
 let moved=false,suppressTap=false,lastTouch:{at:number;point:Point}|undefined;
 const valid=()=>!!binding?.current();
 const center=(a:Point,b:Point)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
 function clamp(){
  if(!frame)return;
  const w=frame?.clientWidth||0,h=frame?.clientHeight||0;
  const fit=binding&&binding.width>0&&binding.height>0?Math.min(w/binding.width,h/binding.height):0;
  const maxX=Math.max(0,((binding?.width||0)*fit*scale-w)/2),maxY=Math.max(0,((binding?.height||0)*fit*scale-h)/2);
  x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));
 }
 function publish(){clamp();binding?.changed();}
 function reset(){scale=1;x=y=0;pointers.clear();pinch=undefined;start=last=undefined;lastTouch=undefined;moved=false;suppressTap=false;}
 function zoom(value:number,point?:Point){
  if(!valid()||!binding?.zoomable)return;
  const next=Math.max(1,Math.min(4,value));
  if(point&&frame){const r=frame.getBoundingClientRect(),px=point.x-r.left-r.width/2,py=point.y-r.top-r.height/2;x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;}
  scale=next;if(scale===1)x=y=0;publish();
 }
 return {
  bind(next:Binding){if(binding?.key!==next.key)reset();binding=next;clamp();return this;},
  clear(){reset();binding=undefined;frame=undefined;},
  ref(element:HTMLElement|null){frame=element||undefined;clamp();},
  get scale(){return scale;},get transform(){return `translate(${x}px, ${y}px) scale(${scale})`;},
  zoomIn(){zoom(scale+.5);},zoomOut(){zoom(scale-.5);},fit(){zoom(1);},
  tap(){if(!valid())return;if(suppressTap){suppressTap=false;return;}binding?.toggle();},
  double(event:MouseEvent){if(!valid())return;if(lastTouch&&performance.now()-lastTouch.at<500)return;event.preventDefault();zoom(scale>1?1:2.5,{x:event.clientX,y:event.clientY});},
  down(event:PointerEvent){
   if(!valid()||event.button>0)return;
   const point={x:event.clientX,y:event.clientY};pointers.set(event.pointerId,point);
   try{(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);}catch{/* The pointer may already have been retired by the host. */}
   if(pointers.size===1){start=last=point;moved=false;suppressTap=false;}
   if(pointers.size===2){const[a,b]=[...pointers.values()];pinch={distance:distance(a,b),scale,x,y,center:center(a,b)};moved=true;}
  },
  move(event:PointerEvent){
   if(!valid()||!pointers.has(event.pointerId))return;
   const point={x:event.clientX,y:event.clientY};pointers.set(event.pointerId,point);
   if(pointers.size===2&&pinch&&pinch.distance>0&&frame&&binding?.zoomable){
    const[a,b]=[...pointers.values()],mid=center(a,b),r=frame.getBoundingClientRect();
    scale=Math.max(1,Math.min(4,pinch.scale*distance(a,b)/pinch.distance));
    x=mid.x-r.left-r.width/2-(pinch.center.x-r.left-r.width/2-pinch.x)*scale/pinch.scale;
    y=mid.y-r.top-r.height/2-(pinch.center.y-r.top-r.height/2-pinch.y)*scale/pinch.scale;
    moved=true;publish();
   }else if(pointers.size===1&&last){
    if(start&&distance(start,point)>8)moved=true;
    if(scale>1){x+=point.x-last.x;y+=point.y-last.y;publish();}
   }
   last=point;
  },
  up(event:PointerEvent){
   if(!pointers.has(event.pointerId))return;
   const point={x:event.clientX,y:event.clientY},wasPinch=!!pinch;pointers.delete(event.pointerId);
   if(!valid()){reset();return;}
   if(pointers.size){last=[...pointers.values()][0];start=last;return;}
   if(!wasPinch&&scale===1&&start){const dx=point.x-start.x,dy=point.y-start.y;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.5){moved=true;binding?.step(dx<0?1:-1);}}
   if(event.pointerType==='touch'&&!moved){
    const now=performance.now();
    if(lastTouch&&now-lastTouch.at<350&&distance(lastTouch.point,point)<32){zoom(scale>1?1:2.5,point);moved=true;lastTouch=undefined;}
    else lastTouch={at:now,point};
   }
   suppressTap=moved||wasPinch;pinch=undefined;start=last=undefined;
  },
  cancel(){pointers.clear();pinch=undefined;start=last=undefined;suppressTap=true;},
  key(event:KeyboardEvent){
   if(!valid())return;
   if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale+.5);}
   else if(event.key==='-'){event.preventDefault();zoom(scale-.5);}
   else if(event.key==='0'){event.preventDefault();zoom(1);}
   else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
    event.preventDefault();
    if(scale===1){if(event.key==='ArrowLeft')binding?.step(-1);if(event.key==='ArrowRight')binding?.step(1);}
    else{x+=event.key==='ArrowLeft'?48:event.key==='ArrowRight'?-48:0;y+=event.key==='ArrowUp'?48:event.key==='ArrowDown'?-48:0;publish();}
   }
  },
 };
}
