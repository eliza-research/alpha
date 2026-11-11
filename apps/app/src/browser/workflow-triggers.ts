type Bag=Record<string,any>;
export type TriggerOccurrence={flowId:string;definition:string;key:string;at:number;source:Bag};
export type TriggerCursor={flowId:string;definition:string;through:number;seen:string[];inside?:boolean;placeKey?:string};
export type TriggerSnapshot={messages:Record<string,Bag[]>;mails:Bag[];events:Bag[];places:{home?:boolean|null;work?:boolean|null};placeKeys?:Record<string,string>};
export const triggerDefinition=(flow:Bag)=>JSON.stringify({name:flow.name,trig:flow.trig,steps:flow.steps});
const identity=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&!value||typeof value==='number'&&!Number.isFinite(value))throw Error('A trigger source has no stable identity.');return value;};
const messageKey=(person:string,row:Bag)=>JSON.stringify(['message',person,identity(row.id??row.k)]);
const emailKey=(row:Bag)=>JSON.stringify(['email',identity(row.id)]);
function incomingKeys(trigger:Bag,snapshot:TriggerSnapshot){
 if(trigger.kind==='message')return (snapshot.messages[trigger.person||'maya']||[]).filter(row=>!row.me).map(row=>{if(row.id===undefined&&row.k===undefined)throw Error('An incoming message has no stable identity.');return messageKey(trigger.person||'maya',row);});
 if(trigger.kind==='email')return snapshot.mails.map(row=>{if(row.id===undefined)throw Error('An incoming email has no stable identity.');return emailKey(row);});
 return [];
}
function placeValue(trigger:Bag,snapshot:TriggerSnapshot){return snapshot.places[trigger.place==='I arrive at work'?'work':'home'];}
function timeDue(trigger:Bag,begin:number,end:number):{key:string;at:number;source:Bag}[]{
 const t=trigger.t??18,days=trigger.days||'Every day';if(!Number.isFinite(t)||t<0||t>=24||!['Every day','Weekdays','Weekends','Mondays','Fridays'].includes(days))throw Error('Choose a valid workflow time and day pattern.');
 const minutes=Math.round(t*60);if(minutes>=1440)throw Error('Choose a time before midnight.');const due=[];const date=new Date(begin);date.setHours(0,0,0,0);
 for(;date.getTime()<=end;date.setDate(date.getDate()+1)){
  const weekday=date.getDay();if(days==='Weekdays'&&(weekday===0||weekday===6)||days==='Weekends'&&weekday!==0&&weekday!==6||days==='Mondays'&&weekday!==1||days==='Fridays'&&weekday!==5)continue;
  const at=new Date(date);at.setHours(Math.floor(minutes/60),minutes%60,0,0);const civil=[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-');
  if(at.getTime()>begin&&at.getTime()<=end)due.push({key:JSON.stringify(['time',civil,minutes]),at:at.getTime(),source:{kind:'time',scheduledAt:at.getTime(),civilDate:civil}});
 }
 return due;
}
export type TriggerError={flowId:string;message:string};
const placeZone=(trigger:Bag)=>trigger.place==='I arrive at work'?'work':'home';
/** A location cursor starts over only when both the stored and the current place are known and differ.
 * While the position is unknown the place has no key; the cursor then keeps its last known side. */
export const placeChanged=(stored:string|undefined,current:string|undefined):boolean=>{
 //@ verify
 //@ ensures stored === undefined || current === undefined ==> !\result
 //@ ensures stored === current ==> !\result
 //@ ensures \result <==> stored !== undefined && current !== undefined && stored !== current
 return stored!==undefined&&current!==undefined&&stored!==current;
};
/** The next cursor position: at most one day past the previous one, never past `now`, and never backwards. */
export function cursorThrough(old:number,now:number):number{
 //@ verify
 //@ ensures old <= \result
 //@ ensures \result <= Math.max(old, now)
 //@ ensures \result - old <= 86400000
 //@ ensures now >= old ==> \result <= now
 //@ ensures now >= old ==> \result === now || \result === old + 86400000
 //@ ensures now <= old ==> \result === old
 return Math.max(old,Math.min(now,old+86400000));
}
const eventKey=(event:Bag,ev:string)=>JSON.stringify(['event',event.id,event.begin,event.end,ev]);
/** Pure detection: persist the returned cursors AND occurrences together before executing any step.
 * A flow that cannot be checked is reported in `errors` and keeps its previous cursor; the other flows are still checked. */
export function detectWorkflowTriggers(flows:Bag[],previous:TriggerCursor[],snapshot:TriggerSnapshot,now=Date.now()):{cursors:TriggerCursor[];occurrences:TriggerOccurrence[];errors:TriggerError[]}{
 const validTime=(time:number)=>Number.isFinite(time)&&time>=0&&Number.isFinite(new Date(time).getTime());
 if(!validTime(now)||previous.some(cursor=>!validTime(cursor.through)||typeof cursor.flowId!=='string'||typeof cursor.definition!=='string'||!Array.isArray(cursor.seen)||cursor.seen.length>10000||cursor.seen.some(key=>typeof key!=='string'))||new Set(previous.map(cursor=>cursor.flowId)).size!==previous.length)throw Error('Workflow trigger state needs recovery.');
 const cursors:TriggerCursor[]=[],occurrences:TriggerOccurrence[]=[],errors:TriggerError[]=[],ids=new Set<string>();
 for(const flow of flows){const flowId=String(flow.id);if(ids.has(flowId))throw Error('Workflow identities must be unique.');ids.add(flowId);}
 for(const flow of flows){
  const flowId=String(flow.id);if(!flow.on)continue;
  const definition=triggerDefinition(flow),old=previous.find(cursor=>cursor.flowId===flowId&&cursor.definition===definition),found:TriggerOccurrence[]=[];
  try{
   const trigger=flow.trig;if(!trigger||!['time','event','message','email','location'].includes(trigger.kind))throw Error('Choose a supported workflow trigger.');
   const keys=incomingKeys(trigger,snapshot),inside=trigger.kind==='location'?placeValue(trigger,snapshot):undefined;
   const placeKey=trigger.kind==='location'?snapshot.placeKeys?.[placeZone(trigger)]:undefined;
   if(!old||trigger.kind==='location'&&placeChanged(old.placeKey,placeKey)){if(keys.length>10000)throw Error('Workflow trigger history is full.');cursors.push({flowId,definition,through:now,seen:[...new Set(keys)],...(placeKey?{placeKey}:{}),...(typeof inside==='boolean'?{inside}:{})});continue;}
   // Resume long absences in one-day batches; do not silently discard earlier due occurrences.
   const through=cursorThrough(old.through,now),cursor:TriggerCursor={...old,through,seen:[...old.seen]},seen=new Set(cursor.seen);
   // Keys still needed after this pass: sources present in the snapshot, and occurrences found now. Time, event
   // and location windows never overlap an earlier pass, so their older keys cannot recur and are dropped.
   const live=new Set<string>(keys),fresh=new Set<string>();
   const add=(key:string,at:number,source:Bag)=>{if(seen.has(key))return;if(seen.size>=10000)throw Error('Workflow trigger history is full.');seen.add(key);fresh.add(key);found.push({flowId,definition,key,at,source:structuredClone(source)});};
   if(trigger.kind==='time')for(const item of timeDue(trigger,old.through,through))add(item.key,item.at,item.source);
   if(trigger.kind==='event'){
    if(!['A deep-work event starts','An event ends','10 minutes before a meeting'].includes(trigger.ev))throw Error('Choose a supported Calendar trigger.');
    for(const event of snapshot.events){
     if(event.allDay)continue;if(!Number.isFinite(event.begin)||!Number.isFinite(event.end)||event.end<=event.begin||event.id===undefined)throw Error('Calendar trigger input is invalid.');
     if(trigger.ev==='A deep-work event starts'&&!/\bdeep[\s-]+work\b/i.test(event.title||''))continue;
     if(trigger.ev==='10 minutes before a meeting'&&event.video!==true&&(!Array.isArray(event.who)||!event.who.length))continue;
     const at=trigger.ev==='An event ends'?event.end:trigger.ev==='10 minutes before a meeting'?event.begin-600000:event.begin,key=eventKey(event,trigger.ev);live.add(key);
     if(at>old.through&&at<=through)add(key,at,{kind:'event',id:event.id,begin:event.begin,end:event.end,revision:event.revision??null,trigger:trigger.ev});
    }
   }
   if(trigger.kind==='message')for(const row of snapshot.messages[trigger.person||'maya']||[]){if(row.me)continue;const key=messageKey(trigger.person||'maya',row);if(!seen.has(key))add(key,now,{kind:'message',person:trigger.person||'maya',id:row.id??null,k:row.k??null});}
   if(trigger.kind==='email'){
    const match=String(trigger.match||'receipt').trim().toLocaleLowerCase();if(!match)throw Error('Choose text for the email trigger.');
    for(const row of snapshot.mails){const key=emailKey(row);if(seen.has(key))continue;if(!row.arch&&!row.del&&[row.subj,row.body].some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(match)))add(key,now,{kind:'email',id:row.id});else{if(seen.size>=10000)throw Error('Workflow trigger history is full.');seen.add(key);}}
   }
   if(trigger.kind==='location'){
    if(!['I arrive home','I leave home','I arrive at work'].includes(trigger.place))throw Error('Choose a supported place trigger.');
    if(placeKey)cursor.placeKey=placeKey;
    if(typeof inside==='boolean'){if(typeof old.inside==='boolean'&&inside!==old.inside){if(inside!== (trigger.place==='I leave home'))add(JSON.stringify(['location',trigger.place,now,inside]),now,{kind:'location',place:trigger.place,inside});}cursor.inside=inside;}
   }
   cursor.seen=[...seen].filter(key=>live.has(key)||fresh.has(key));cursors.push(cursor);occurrences.push(...found);
  }catch(error){
   // The flow's cursor does not advance, so nothing due is skipped once the flow can be checked again.
   if(old)cursors.push(old);errors.push({flowId,message:error instanceof Error?error.message:'This workflow trigger could not be checked.'});
  }
 }
 return {cursors,errors,occurrences:occurrences.sort((a,b)=>a.at-b.at||a.flowId.localeCompare(b.flowId)||a.key.localeCompare(b.key))};
}
/** Calendar reads reused between polls. A stored range answers any range it covers until `clear`.
 * A read that began before a `clear` is not stored, so a change is never hidden behind an older answer. */
export class EventRangeCache {
 private rows:{begin:number;end:number;events:Bag[]}[]=[];private epoch=0;
 ticket(){return this.epoch;}
 get(begin:number,end:number){return this.rows.find(row=>row.begin<=begin&&row.end>=end)?.events;}
 put(ticket:number,begin:number,end:number,events:Bag[]){if(ticket!==this.epoch)return;this.rows=[...this.rows.filter(row=>!(begin<=row.begin&&end>=row.end)),{begin,end,events}].slice(-8);}
 clear(){this.epoch++;this.rows=[];}
}
/** Parses each stored document once per distinct text. An unchanged document returns the same object; callers must not modify it. */
export class ParsedDocuments {
 private rows=new Map<string,{raw:string;value:Bag}>();
 read(name:string,raw:string|null):Bag{const text=raw||'{}',held=this.rows.get(name);if(held?.raw===text)return held.value;const value=JSON.parse(text);this.rows.set(name,{raw:text,value});return value;}
}
/** What one timer tick may do. A failed check stops further checks until a wake event, but never stops queued
 * work from being dispatched; a job that stayed queued after its dispatch holds only further dispatch. */
export type TriggerTickState={foreground:boolean;scanBlocked:boolean;dispatchHeld:boolean};
export const triggerTickPlan=(state:TriggerTickState):{scan:boolean;dispatch:boolean}=>{
 //@ verify
 //@ ensures !state.foreground ==> !\result.scan && !\result.dispatch
 //@ ensures \result.scan <==> state.foreground && !state.scanBlocked
 //@ ensures \result.dispatch <==> state.foreground && !state.dispatchHeld
 return {scan:state.foreground&&!state.scanBlocked,dispatch:state.foreground&&!state.dispatchHeld};
};
