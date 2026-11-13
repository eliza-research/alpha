import test from 'node:test';
import assert from 'node:assert/strict';
const {detectWorkflowTriggers,triggerDefinition,placeChanged,EventRangeCache,ParsedDocuments,triggerTickPlan}=await import('../apps/app/src/browser/workflow-triggers.ts');

const flow=(id,trig,on=true)=>({id,name:'Flow '+id,on,trig,steps:[]});
const snapshot=(extra={})=>({messages:{},mails:[],events:[],places:{},placeKeys:{},...extra});
const cursorFor=(target,through,extra={})=>({flowId:String(target.id),definition:triggerDefinition(target),through,seen:[],...extra});
const T0=Date.UTC(2026,0,5,12,0,0);

test('one flow that cannot be checked is reported while every other flow is still detected',()=>{
 const broken=flow(1,{kind:'unsupported'}),mail=flow(2,{kind:'email',match:'receipt'}),badTime=flow(3,{kind:'time',t:99});
 const previous=[cursorFor(mail,T0),cursorFor(badTime,T0)];
 const result=detectWorkflowTriggers([broken,mail,badTime],previous,snapshot({mails:[{id:'m1',subj:'Your receipt',body:''}]}),T0+1000);
 assert.deepEqual(result.occurrences.map(row=>[row.flowId,row.source.id]),[['2','m1']]);
 assert.deepEqual(result.errors.map(row=>row.flowId),['1','3']);
 assert.match(result.errors[0].message,/supported workflow trigger/);
 // A flow that failed keeps its previous cursor unchanged, so nothing due is skipped later.
 assert.deepEqual(result.cursors.find(row=>row.flowId==='3'),previous[1]);
 assert.equal(result.cursors.some(row=>row.flowId==='1'),false);
});

test('a source without a stable identity fails only its own flow',()=>{
 const message=flow(1,{kind:'message',person:'maya'}),mail=flow(2,{kind:'email',match:'receipt'});
 const previous=[cursorFor(message,T0),cursorFor(mail,T0)];
 const result=detectWorkflowTriggers([message,mail],previous,snapshot({messages:{maya:[{text:'no identity'}]},mails:[{id:'m1',subj:'receipt'}]}),T0+1000);
 assert.deepEqual(result.errors.map(row=>row.flowId),['1']);
 assert.equal(result.occurrences.length,1);
});

test('corrupt cursor state and duplicate identities still stop the whole pass',()=>{
 assert.throws(()=>detectWorkflowTriggers([flow(1,{kind:'time'}),flow(1,{kind:'time'})],[],snapshot(),T0),/unique/);
 assert.throws(()=>detectWorkflowTriggers([],[{flowId:'1',definition:'x',through:-1,seen:[]}],snapshot(),T0),/recovery/);
});

test('seen keys are pruned to sources still present, so history cannot fill up',()=>{
 const mail=flow(1,{kind:'email',match:'receipt'});
 let cursors=[cursorFor(mail,T0)],fired=0;
 for(let round=0;round<30;round++){
  const mails=Array.from({length:500},(_,index)=>({id:`m${round}-${index}`,subj:index?'other':'receipt'}));
  const result=detectWorkflowTriggers([mail],cursors,snapshot({mails}),T0+round*1000);
  assert.deepEqual(result.errors,[]);fired+=result.occurrences.length;cursors=result.cursors;
  assert.equal(cursors[0].seen.length,500);
 }
 assert.equal(fired,30);
 // A source that is still present never fires twice.
 const mails=[{id:'kept',subj:'receipt'}];
 let state=detectWorkflowTriggers([mail],[cursorFor(mail,T0)],snapshot({mails}),T0+1);
 assert.equal(state.occurrences.length,1);
 state=detectWorkflowTriggers([mail],state.cursors,snapshot({mails}),T0+2);
 assert.equal(state.occurrences.length,0);
});

test('time and location keys from earlier passes are dropped without repeating an occurrence',()=>{
 const daily=flow(1,{kind:'time',t:12.5,days:'Every day'});
 let cursors=[cursorFor(daily,T0)],keys=[];
 const start=new Date(T0);start.setHours(0,0,0,0);
 for(let day=0;day<40;day++){
  const result=detectWorkflowTriggers([daily],cursors,snapshot(),start.getTime()+(day+1)*86400000);
  keys.push(...result.occurrences.map(row=>row.key));cursors=result.cursors;
  assert.ok(cursors[0].seen.length<=2,'seen stays bounded');
 }
 assert.equal(new Set(keys).size,keys.length);
 assert.ok(keys.length>=39);
});

test('a place key resets the cursor only when both the stored and the current key are known and differ',()=>{
 assert.equal(placeChanged('a','b'),true);
 assert.equal(placeChanged('a','a'),false);
 assert.equal(placeChanged('a',undefined),false);
 assert.equal(placeChanged(undefined,'a'),false);
 assert.equal(placeChanged(undefined,undefined),false);
});

test('leaving home fires after a gap in which the position was unknown',()=>{
 const leave=flow(1,{kind:'location',place:'I leave home'}),arrive=flow(2,{kind:'location',place:'I arrive home'});
 const known=inside=>snapshot({places:{home:inside},placeKeys:{home:'home-key'}});
 let state=detectWorkflowTriggers([leave,arrive],[],known(true),T0);
 assert.deepEqual(state.cursors.map(row=>row.inside),[true,true]);
 // Backgrounded or stale fix: no place value and no place key.
 state=detectWorkflowTriggers([leave,arrive],state.cursors,snapshot(),T0+1000);
 assert.equal(state.occurrences.length,0);
 assert.deepEqual(state.cursors.map(row=>[row.inside,row.placeKey]),[[true,'home-key'],[true,'home-key']]);
 // An ambiguous fix near the boundary also keeps the last known side.
 state=detectWorkflowTriggers([leave,arrive],state.cursors,snapshot({places:{home:null},placeKeys:{home:'home-key'}}),T0+2000);
 assert.equal(state.occurrences.length,0);
 state=detectWorkflowTriggers([leave,arrive],state.cursors,known(false),T0+3000);
 assert.deepEqual(state.occurrences.map(row=>[row.flowId,row.source.inside]),[['1',false]]);
 // Exactly one occurrence per observed change.
 state=detectWorkflowTriggers([leave,arrive],state.cursors,known(false),T0+4000);
 assert.equal(state.occurrences.length,0);
 state=detectWorkflowTriggers([leave,arrive],state.cursors,snapshot(),T0+5000);
 state=detectWorkflowTriggers([leave,arrive],state.cursors,known(true),T0+6000);
 assert.deepEqual(state.occurrences.map(row=>row.flowId),['2']);
});

test('a place that really changed starts over without firing',()=>{
 const leave=flow(1,{kind:'location',place:'I leave home'});
 let state=detectWorkflowTriggers([leave],[],snapshot({places:{home:true},placeKeys:{home:'old'}}),T0);
 state=detectWorkflowTriggers([leave],state.cursors,snapshot({places:{home:false},placeKeys:{home:'new'}}),T0+1000);
 assert.equal(state.occurrences.length,0);
 assert.deepEqual([state.cursors[0].placeKey,state.cursors[0].inside],['new',false]);
});

test('a cursor created while the position was unknown adopts the first known side without firing',()=>{
 const leave=flow(1,{kind:'location',place:'I leave home'});
 let state=detectWorkflowTriggers([leave],[],snapshot(),T0);
 assert.equal(state.cursors[0].placeKey,undefined);
 state=detectWorkflowTriggers([leave],state.cursors,snapshot({places:{home:false},placeKeys:{home:'k'}}),T0+1000);
 assert.equal(state.occurrences.length,0);
 assert.deepEqual([state.cursors[0].placeKey,state.cursors[0].inside],['k',false]);
});

test('a calendar range is answered from a covering stored range until cleared',()=>{
 const cache=new EventRangeCache(),events=[{id:'e'}];
 assert.equal(cache.get(10,20),undefined);
 cache.put(cache.ticket(),10,80,events);
 assert.equal(cache.get(10,20),events);
 assert.equal(cache.get(15,80),events);
 assert.equal(cache.get(9,20),undefined);
 assert.equal(cache.get(10,81),undefined);
 cache.clear();
 assert.equal(cache.get(10,20),undefined);
});

test('a calendar read that began before a clear is not stored',()=>{
 const cache=new EventRangeCache(),ticket=cache.ticket();
 cache.clear();cache.put(ticket,10,80,[{id:'stale'}]);
 assert.equal(cache.get(10,20),undefined);
 for(let index=0;index<20;index++)cache.put(cache.ticket(),index*100,index*100+50,[]);
 assert.equal(cache.get(0,50),undefined,'the store is bounded');
 assert.deepEqual(cache.get(1900,1950),[]);
});

test('an unchanged stored document is parsed once and returns the same object',()=>{
 const documents=new ParsedDocuments(),raw=JSON.stringify({mails:[{id:1}]});
 const first=documents.read('inbox',raw);
 assert.equal(documents.read('inbox',raw),first);
 assert.equal(documents.read('inbox',String(raw)),first);
 const changed=documents.read('inbox',JSON.stringify({mails:[]}));
 assert.notEqual(changed,first);assert.deepEqual(changed,{mails:[]});
 assert.deepEqual(documents.read('messages',null),{});
 assert.equal(documents.read('messages',null),documents.read('messages',null));
});

test('a failed check stops checking but never dispatch; a job left queued holds only dispatch',()=>{
 assert.deepEqual(triggerTickPlan({foreground:true,scanBlocked:true,dispatchHeld:false}),{scan:false,dispatch:true});
 assert.deepEqual(triggerTickPlan({foreground:true,scanBlocked:false,dispatchHeld:true}),{scan:true,dispatch:false});
 assert.deepEqual(triggerTickPlan({foreground:false,scanBlocked:false,dispatchHeld:false}),{scan:false,dispatch:false});
});
