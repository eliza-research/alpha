import {anyAbortSignal} from '../runtime/abort-signal';
import {useEffect,useRef,useState} from 'react';
import {digestAuthorizationDocument,type DigestAuthorization as Pending} from './digest-authorization-document';
import {openDomainRecovery} from './domain-recovery';
import type {HostedDigestProtocol} from '../runtime/hosted-digests';
type Binding={client:HostedDigestProtocol;signal:AbortSignal;valid:()=>boolean;store:ReturnType<typeof digestAuthorizationDocument>;readEpoch:number;refresh:(resume:boolean)=>Promise<void>};
export function BrowserDigestDelegation({client,scope,signal,current,onConnected,onReviewRemoval,removalBusy,revocation}:{client:HostedDigestProtocol;scope:string;signal:AbortSignal;current:()=>boolean;onConnected:()=>void;onReviewRemoval:(grantId:string)=>void;removalBusy:boolean;revocation:{grantId:string;removed:boolean}|null}){
 const [pending,setPending]=useState<Pending|null>(null),[email,setEmail]=useState(true),[calendar,setCalendar]=useState(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[active,setActive]=useState(true),[message,setMessage]=useState('Reading saved authorization…'),[grantId,setGrantId]=useState(''),[expanded,setExpanded]=useState(false);
 const binding=useRef<Binding|null>(null),locked=useRef<Binding|null>(null);
 const save=async(b:Binding,expected:Pending|null,next:Pending|null)=>{b.readEpoch++;await b.store.save(expected,next);b.readEpoch++;if(b.valid()){setPending(next);if(next)setExpanded(true);}};
 const run=async(b:Binding,work:()=>Promise<void>)=>{
  if(locked.current===b||!b.valid())return;locked.current=b;setBusy(true);
  try{await work();}catch{
   if(b.valid())try{const saved=await b.store.read();if(b.valid()){setPending(saved);setMessage(saved?'The request is saved. Retry it to recover the exact authorization.':'Authorization was not saved. Try again.');}}catch{if(b.valid()){setReady(false);setMessage('Saved authorization could not be read. Use authorization recovery.');}}
  }finally{if(locked.current===b)locked.current=null;if(b.valid()){setBusy(false);void b.refresh(false);}}
 };
 const finish=async(b:Binding,record:Pending)=>{
  let response=await b.client.delegation('status',{state:record.state},b.signal);if(!b.valid())return;
  if(response.status==='waiting'&&record.phase==='complete')response=await b.client.delegation('complete',{state:record.state,confirmed:true},b.signal);
  if(!b.valid())return;
  if(response.status==='complete'){await save(b,record,null);if(b.valid()){setGrantId(String(response.grantId));setMessage('Cloud read access is connected. Choose its account and source below.');onConnected();}}
  else if(response.status==='failed'){await save(b,record,null);if(b.valid())setMessage('Authorization expired or was cancelled. Start a new review.');}
  else setMessage('Review the requested read access to continue.');
 };
 const resume=async(b:Binding,record:Pending)=>{
  if(record.phase!=='start'){await finish(b,record);return;}
  const result=await b.client.delegation('start',{mutationId:record.mutationId,kinds:record.kinds,confirmed:true},b.signal);if(!b.valid())return;
  await save(b,record,{...record,phase:'review',state:String(result.state),expiresAt:String(result.expiresAt)});
 };
 useEffect(()=>{
  const owner=new AbortController(),ownedSignal=anyAbortSignal([signal,owner.signal]);
  const b:Binding={client,signal:ownedSignal,valid:()=>binding.current===b&&!ownedSignal.aborted&&current(),store:null as any,readEpoch:0,refresh:async()=>{}};
  b.store=digestAuthorizationDocument(scope,b.valid,ownedSignal);binding.current=b;setReady(false);setActive(true);setBusy(false);setPending(null);setGrantId('');setMessage('Reading saved authorization…');
  b.refresh=async(autoResume)=>{
   if(!b.valid()||locked.current===b)return;const epoch=++b.readEpoch;
   try{const saved=await b.store.read();if(!b.valid()||epoch!==b.readEpoch)return;setPending(saved);setReady(true);if(saved)setExpanded(true);if(autoResume){setMessage('Choose which browser app data this agent may read.');if(saved&&saved.phase!=='review')void run(b,()=>resume(b,saved));}}
   catch{if(b.valid()&&epoch===b.readEpoch){setReady(false);setMessage('Saved authorization could not be read. Use authorization recovery.');}}
  };
  const release=b.store.subscribe(()=>void b.refresh(false));
  const retire=()=>{owner.abort();if(binding.current===b){setReady(false);setActive(false);setBusy(false);setMessage('Authorization paused. Close and reopen scheduled digests to continue.');}},hidden=()=>{if(document.hidden)retire();};
  const events=['launcher-home','alpha:device-state','alpha:dev-incoming-call','pagehide'];for(const event of events)window.addEventListener(event,retire);document.addEventListener('visibilitychange',hidden);
  void b.refresh(true);
  return()=>{owner.abort();release();if(binding.current===b)binding.current=null;if(locked.current===b)locked.current=null;for(const event of events)window.removeEventListener(event,retire);document.removeEventListener('visibilitychange',hidden);};
 },[scope,client,signal]);
 const act=(work:(b:Binding)=>Promise<void>)=>{const b=binding.current;if(b)void run(b,()=>work(b));};
 useEffect(()=>{
  if(!revocation||!binding.current?.valid()||grantId!==revocation.grantId)return;
  if(revocation.removed)setGrantId('');
  setMessage(revocation.removed?'Cloud read access revoked.':'Cloud disconnect pending.');
 },[revocation]);
 const disabled=busy||!ready||!active;
 return <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>Connect Cloud for scheduled reads</summary><p role="status">{message}</p>
 {!pending?<><label><input type="checkbox" checked={email} disabled={disabled} onChange={e=>setEmail(e.target.checked)}/>Inbox subjects and snippets</label><label><input type="checkbox" checked={calendar} disabled={disabled} onChange={e=>setCalendar(e.target.checked)}/>Calendar events</label><button disabled={disabled||!email&&!calendar} onClick={()=>act(async b=>{const record:Pending={mutationId:crypto.randomUUID(),phase:'start',kinds:[...(email?['email']:[]),...(calendar?['calendar']:[])]};await save(b,null,record);await resume(b,record);})}>Review Cloud read access</button></>:<>
 <p>Allow this agent to read {pending.kinds.join(' and ')} from Browser Inbox and Calendar for seven days.</p><p>No sending or calendar changes are included.</p>
 {pending.phase==='review'&&<button disabled={disabled} onClick={()=>act(async b=>{const next:Pending={...pending,phase:'complete'};await save(b,pending,next);await finish(b,next);})}>Approve browser read access</button>}
 <button disabled={disabled} onClick={()=>act(b=>resume(b,pending))}>Check authorization status</button>
 <button disabled={disabled||pending.phase==='complete'} onClick={()=>act(async b=>{if(pending.state){const result=await b.client.delegation('cancel',{state:pending.state,confirmed:true},b.signal);if(!b.valid())return;if(result.status==='complete'){await finish(b,pending);return;}}else{const result=await b.client.delegation('start',{mutationId:pending.mutationId,kinds:pending.kinds,confirmed:true},b.signal);if(!b.valid())return;await b.client.delegation('cancel',{state:result.state,confirmed:true},b.signal);}await save(b,pending,null);if(b.valid())setMessage('Authorization cancelled.');})}>Cancel authorization</button></>}
 {grantId&&<button disabled={disabled||removalBusy} onClick={()=>{if(binding.current?.valid())onReviewRemoval(grantId);}}>Review Cloud read grant removal</button>}
 <button disabled={busy||!active} onClick={()=>{const b=binding.current;if(b?.valid())openDomainRecovery(b.store,'digest authorization','Development digest authorization recovery','Download this connection’s pending authorization before resetting. Reset clears only the saved local request; it does not revoke a completed grant. Check connected accounts and revoke unwanted access separately before starting a replacement request.',b.signal);}}>Authorization recovery</button>
 </details>;
}
