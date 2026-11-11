import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoViewport} from '../apps/app/src/prototype/photo-viewport.ts';

function setup(){
 const viewport=createPhotoViewport();let active=true,changes=0,toggles=0;const steps=[];
 const binding={key:'photo:revision-1',width:400,height:200,zoomable:true,current:()=>active,changed:()=>changes++,toggle:()=>toggles++,step:n=>steps.push(n)};
 viewport.bind(binding);viewport.ref({clientWidth:400,clientHeight:400,getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})});
 const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,button:0,pointerType:'touch',currentTarget:{setPointerCapture(){}}});
 return{viewport,binding,pointer,steps,get changes(){return changes;},get toggles(){return toggles;},leave(){active=false;}};
}
test('zoom and pan clamp to the fitted image, survive ref replacement and reset for a new source',()=>{
 const t=setup(),v=t.viewport;v.zoomIn();v.zoomIn();assert.equal(v.scale,2);
 v.down(t.pointer(1,200,200));v.move(t.pointer(1,1000,1000));v.up(t.pointer(1,1000,1000));
 assert.equal(v.transform,'translate(200px, 0px) scale(2)');v.tap();assert.equal(t.toggles,0);
 v.ref(null);v.ref({clientWidth:400,clientHeight:400});assert.equal(v.transform,'translate(200px, 0px) scale(2)');
 v.bind({...t.binding,key:'photo:revision-2'});assert.equal(v.transform,'translate(0px, 0px) scale(1)');v.tap();assert.equal(t.toggles,1);
});
test('two-pointer pinch changes zoom and never navigates or toggles controls',()=>{
 const t=setup(),v=t.viewport;v.down(t.pointer(1,100,200));v.down(t.pointer(2,300,200));v.move(t.pointer(2,500,200));
 assert.equal(v.scale,2);v.up(t.pointer(1,100,200));v.up(t.pointer(2,500,200));v.tap();
 assert.deepEqual(t.steps,[]);assert.equal(t.toggles,0);
});
test('fit-image swipe navigates, zoomed arrow keys pan, and retired source callbacks do nothing',()=>{
 const t=setup(),v=t.viewport;v.down(t.pointer(1,200,200));v.up(t.pointer(1,100,200));assert.deepEqual(t.steps,[1]);
 const key=k=>({key:k,preventDefault(){}});v.key(key('+'));v.key(key('ArrowRight'));assert.match(v.transform,/translate\(-48px/);assert.deepEqual(t.steps,[1]);
 t.leave();const prior=v.transform,count=t.changes;v.zoomIn();v.key(key('0'));assert.equal(v.transform,prior);assert.equal(t.changes,count);
});
test('video bindings keep swipe navigation but refuse image zoom',()=>{
 const t=setup(),v=t.viewport;v.bind({...t.binding,key:'video:1',zoomable:false});v.zoomIn();v.double({preventDefault(){},clientX:100,clientY:100});assert.equal(v.scale,1);
});
