import {useEffect,useLayoutEffect,useRef,useState} from 'react';

import type {LocalProviderKey as KeyKind,LocalProviderReveal as Reveal,ManagedLocalProviderStatus} from './local-agent';
type KeyStatus=Pick<ManagedLocalProviderStatus,'revision'|'keys'>;
type Props={
 status:KeyStatus;
 busy:boolean;
 retirement?:number;
 onEdit:(key:KeyKind,value:string,revision:string,signal:AbortSignal)=>Promise<void>;
 onRemove:(key:KeyKind,revision:string,signal:AbortSignal)=>Promise<void>;
 onReveal:(key:KeyKind,revision:string,signal:AbortSignal)=>Promise<Reveal>;
};

/** Keys stay masked until an explicit View. Native custody uses its own secure
 * surface; only the browser host's explicit reveal may return a value here. */
export function ProviderKeys({status,busy,retirement=0,onEdit,onRemove,onReveal}:Props){
 const [editing,setEditing]=useState<KeyKind|null>(null),[removing,setRemoving]=useState<KeyKind|null>(null);
 const [revealed,setRevealed]=useState<{key:KeyKind;value:string}|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 const field=useRef<HTMLInputElement>(null),request=useRef<AbortController|null>(null),epoch=useRef(0),revision=useRef(status.revision);
 const requestKind=useRef<'edit'|'remove'|'reveal'|null>(null);
 revision.current=status.revision;
 const clear=()=>{epoch.current++;request.current?.abort();request.current=null;requestKind.current=null;if(field.current)field.current.value='';setRevealed(null);setEditing(null);setRemoving(null);setPending(false);setError('');};
 // A successful edit publishes a new revision during connectResident, before
 // startup finishes. Redaction must not abort the mutation's own reconnect.
 // Native request/revision fences own mutation admission; explicit Cancel and
 // unmount still cancel it. Reveals never survive either revision or retirement.
 useLayoutEffect(()=>{if(requestKind.current==='reveal'){clear();return;}if(field.current)field.current.value='';setRevealed(null);setEditing(null);setRemoving(null);setError('');},[status.revision,retirement]);
 useEffect(()=>{const hide=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',clear);return()=>{epoch.current++;request.current?.abort();if(field.current)field.current.value='';document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',clear);};},[]);
 useEffect(()=>{if(!revealed)return;const timer=window.setTimeout(()=>setRevealed(null),30000);return()=>window.clearTimeout(timer);},[revealed]);
 useEffect(()=>{if(editing)field.current?.focus();},[editing]);
 async function run(key:KeyKind,action:'edit'|'remove'|'reveal'){
  if(busy||pending||document.hidden)return;
  const value=action==='edit'?field.current?.value:undefined;
  if(action==='edit'&&!value){field.current?.focus();return;}
  const expected=status.revision,token=++epoch.current,controller=new AbortController();request.current=controller;requestKind.current=action;setPending(true);setError('');setRevealed(null);
  try{
   if(action==='reveal'){
    const result=await onReveal(key,expected,controller.signal);
    if(controller.signal.aborted||token!==epoch.current||revision.current!==expected||document.hidden)return;
    if(result.key!==key||result.revision!==expected)throw Error('Changed key');
    if('value' in result&&typeof result.value==='string')setRevealed({key,value:result.value});
   }else{
    if(action==='edit')await onEdit(key,value!,expected,controller.signal);
    else await onRemove(key,expected,controller.signal);
    if(controller.signal.aborted||token!==epoch.current||document.hidden)return;
    if(field.current)field.current.value='';setEditing(null);setRemoving(null);
   }
  }catch{
   // Provider errors can contain request material. Never put raw exceptions or
   // keys into the UI, diagnostics or model context.
   if(!controller.signal.aborted&&token===epoch.current&&!document.hidden)setError(action==='reveal'?'Couldn’t show this key. Try again.':action==='remove'?'Couldn’t remove this key. Try again.':'Couldn’t save this key. Check it and try again.');
  }finally{if(token===epoch.current){request.current=null;requestKind.current=null;setPending(false);}}
 }
 const disabled=busy||pending;
 return <div className="alpha-own-keys" aria-label="Saved API keys">
  {(['text','voice'] as const).map(key=>{
   const title=key==='text'?'Text':'Voice',configured=status.keys[key].configured;
   return <section key={key} aria-label={`${title} key`}>
    <div className="alpha-key-heading"><h4>{title}</h4><span>{configured?'Added':'Not added'}</span></div>
    {revealed?.key===key&&<input aria-label={`${title} API key`} type="text" value={revealed.value} readOnly autoComplete="off" spellCheck={false}/>}
    {editing===key?<form onSubmit={event=>{event.preventDefault();void run(key,'edit');}}>
     <label>{title} API key<input ref={field} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={disabled}/></label>
     <div className="alpha-form-actions"><button className="alpha-btn alpha-btn--primary" disabled={disabled}>Save</button><button type="button" className="alpha-btn alpha-btn--text alpha-btn--quiet" onClick={clear}>Cancel</button></div>
    </form>:removing===key?<div>
     <p>Remove your {title.toLowerCase()} key?</p>
     <div className="alpha-form-actions"><button type="button" className="alpha-btn alpha-btn--secondary" disabled={disabled} onClick={()=>void run(key,'remove')}>Remove key</button><button type="button" className="alpha-btn alpha-btn--text alpha-btn--quiet" onClick={clear}>Cancel</button></div>
    </div>:<div className="alpha-form-actions">
     {configured&&<button type="button" className="alpha-btn alpha-btn--text" disabled={disabled} onClick={()=>revealed?.key===key?setRevealed(null):void run(key,'reveal')}>{revealed?.key===key?'Hide':'View'}</button>}
     <button type="button" className="alpha-btn alpha-btn--text" disabled={disabled} onClick={()=>{clear();setEditing(key);}}>{configured?'Edit':'Add'}</button>
     {configured&&<button type="button" className="alpha-btn alpha-btn--text alpha-btn--quiet" disabled={disabled} onClick={()=>{clear();setRemoving(key);}}>Remove</button>}
    </div>}
   </section>;
  })}
  {error&&<p role="alert" className="alpha-connection-error">{error}</p>}
 </div>;
}
