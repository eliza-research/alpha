import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
const code=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/calendar-confirmation.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
function fixture(){
 const listeners=new Set();let complete,options,calls=0,live=true;const document={hidden:false},shell={live:true,calendar:{form:{}},vget(){return this.calendar;}},context={selection:'A'},snapshot={session:'A'};
 const connection={getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}},alpha={getState:()=>({context}),subscribe:connection.subscribe};
 class Reviews{confirm(_id,_title,_details,_label,opts){calls++;options=opts;return new Promise(resolve=>{complete=resolve;opts.signal.addEventListener('abort',()=>resolve(false),{once:true});});}}
 const confirm=new Function('BrowserReviews','connectionController','alphaClient','document',code+';return confirmCalendarAction;')(Reviews,connection,alpha,document);
 const start=()=>confirm(shell,{isActive:()=>live},'Delete?','Exact event','Delete',()=>true);
 return{start,shell,context,snapshot,document,complete:value=>complete(value),changed:()=>{for(const fn of [...listeners])fn();},leave:()=>{live=false;},get calls(){return calls;},get options(){return options;},get listeners(){return listeners.size;}};
}
test('a confirmation admits once and removes both observers',async()=>{const f=fixture(),pending=f.start();assert.equal(await f.start(),false);assert.equal(f.calls,1);f.complete(true);assert.equal(await pending,true);assert.equal(f.listeners,0);});
for(const change of ['view','drawing','context','owner','hidden'])test(`a pending Calendar review retires after ${change} drift and cannot revive`,async()=>{
 const f=fixture(),pending=f.start();
 if(change==='view')f.leave();if(change==='drawing')f.shell.calendar={form:{}};if(change==='context')f.context.selection='B';if(change==='owner')f.snapshot.session='B';if(change==='hidden')f.document.hidden=true;
 f.changed();f.context.selection='A';f.snapshot.session='A';f.document.hidden=false;f.complete(true);
 assert.equal(await pending,false);assert.equal(f.listeners,0);assert.equal(f.options.signal.aborted,true);
});
