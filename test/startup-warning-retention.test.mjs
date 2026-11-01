import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('startup OFF warning survives mount races once without replaying listener shutdown',()=>{
 const source=readFileSync(new URL('../apps/app/src/main.tsx',import.meta.url),'utf8');
 const begin=source.indexOf('ref={(value: any) => { shell = value;');assert(begin>=0);
 const end=source.indexOf('} />',begin);assert(end>begin);
 const ref=source.slice(begin+5,end).replace('(value: any)','(value)');
 const marker='stopWakeListenerForChatOnly().then(';const a=source.indexOf(marker);assert(a>=0);assert.equal(source.indexOf(marker,a+1),-1);
 const z=source.indexOf('\n  });',a);const stopped=source.slice(a+marker.length,z)+'\n  }';
 const warning='Wake listening could not be confirmed off. Turn it off in Android settings.';
 function fixture(){const queue=[],context={queueMicrotask:f=>queue.push(f)};vm.runInNewContext('let shell;let pendingNotice;const ref='+ref+';const stopped='+stopped+';globalThis.result={ref,stopped,pending:()=>pendingNotice};',context);return{...context.result,flush(){while(queue.length)queue.shift()();},queue};}
 const shell=()=>({live:true,notices:[],toast(n){this.notices.push(n);}});
 {const f=fixture(),s=shell();f.stopped(false);assert.equal(f.pending(),warning);f.ref(s);f.flush();assert.deepEqual(s.notices,[warning]);assert.equal(f.pending(),undefined);f.ref(s);f.flush();assert.deepEqual(s.notices,[warning]);}
 {const f=fixture(),s=shell();f.ref(s);f.stopped(false);assert.deepEqual(s.notices,[warning]);f.flush();assert.deepEqual(s.notices,[warning]);}
 {const f=fixture(),old=shell(),next=shell();f.stopped(false);f.ref(old);f.ref(next);f.flush();assert.deepEqual(old.notices,[]);assert.deepEqual(next.notices,[warning]);assert.equal(f.pending(),undefined);}
 {const f=fixture(),old=shell(),next=shell();f.stopped(false);f.ref(old);f.ref(null);f.flush();assert.deepEqual(old.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),dead=shell(),next=shell();dead.live=false;f.ref(dead);f.stopped(false);f.flush();assert.deepEqual(dead.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),dead=shell(),next=shell();f.stopped(false);f.ref(dead);dead.live=false;f.flush();assert.deepEqual(dead.notices,[]);assert.equal(f.pending(),warning);f.ref(next);f.flush();assert.deepEqual(next.notices,[warning]);}
 {const f=fixture(),s=shell();f.stopped(true);f.ref(s);f.flush();assert.deepEqual(s.notices,[]);assert.equal(f.pending(),undefined);}
 assert.doesNotMatch(ref,/stopWakeListener|installListenerInvocation|startListening|\.stop\(/);assert.doesNotMatch(stopped,/stopWakeListener|installListenerInvocation|startListening/);
});
