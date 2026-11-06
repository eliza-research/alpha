import {forgetNoteOrigin,savedNoteOrigin} from '../prototype/note-origin-adapter';
import {connectionController} from './connection-ui';
import {useEffect,useRef,useState} from 'react';
import {deletions,refreshDeletionViews,type DeletionEntry} from './deletions';
import {browserScreenLocked} from '../browser/screen-locked';
import {UNDO_TOO_LATE,undoConfirmed} from './deletion-window';
import './deletion-undo.css';
export function DeletionUndo(){
 const [entries,setEntries]=useState<DeletionEntry[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');const signature=useRef(''),knownPending=useRef(false);
 useEffect(()=>{let retired=false,inflight=false,identityEpoch=0,failures=0;
  const refresh=async()=>{if(inflight||retired)return;if(document.hidden||browserScreenLocked()){setEntries([]);return;}inflight=true;const admittedEpoch=identityEpoch;
   try{const result=await deletions.pending();if(retired||admittedEpoch!==identityEpoch||document.hidden||browserScreenLocked())return;
    for(const origin of result.deletedOrigins||[]){if(savedNoteOrigin(origin.kind,origin.id))await forgetNoteOrigin(origin.kind,origin.id);}
    if(retired||admittedEpoch!==identityEpoch||document.hidden||browserScreenLocked())return;
    const next=result.deletions.map(e=>[e.kind,e.id,e.phase]).join('|');if(signature.current&&next!==signature.current)refreshDeletionViews();signature.current=next;
    const pending=result.deletions.filter(e=>['queued','paused','unknown','dispatching'].includes(e.phase));
    failures=0;knownPending.current=pending.length>0;setEntries(pending);setError('');
   }catch{if(!retired&&admittedEpoch===identityEpoch&&!document.hidden&&!browserScreenLocked()&&++failures>=3&&knownPending.current)setError('Pending deletion status is unavailable. Refresh before making another change.');}finally{inflight=false;}
  };
  const identity=()=>{const session=connectionController.getSnapshot().session;return session?JSON.stringify([session.origin,session.ownerId,session.agentId,session.sessionId]):'';};let previousIdentity=identity();
  const unsubscribe=connectionController.subscribe(()=>{const next=identity();if(next===previousIdentity)return;previousIdentity=next;identityEpoch++;failures=0;signature.current='';knownPending.current=false;setEntries([]);setError('');void refresh();});
  void refresh();const timer=setInterval(()=>void refresh(),500);window.addEventListener('alpha:deletions-changed',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('alpha:device-state',refresh);
  return()=>{retired=true;unsubscribe();clearInterval(timer);window.removeEventListener('alpha:deletions-changed',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('alpha:device-state',refresh);};
 },[]);
 if(!entries.length&&!error)return null;
 return <aside className="alpha-deletion-undo" aria-label="Pending deletions">{error&&<p role="status">{error}</p>}{entries.map(entry=>{
  const uncertain=entry.phase==='unknown'||entry.phase==='dispatching';
  const paused=entry.phase==='paused'||entry.window==='clock-changed',canUndo=paused||entry.phase==='queued'&&entry.window==='open';
  return <div key={entry.kind+entry.id}><p>{entry.target.row?.title||entry.target.fields?.title||entry.original?.title||'Selected '+entry.kind}<br/><small>{paused?'Deletion paused. Undo to keep it, then review again if you still want to delete.':canUndo?'Deletion queued for 10 seconds.':entry.phase==='unknown'||entry.phase==='dispatching'?'Deletion outcome needs review. It will not be repeated.':'Deletion is being verified.'}</small></p>{canUndo&&<button disabled={!!busy} onClick={async()=>{setBusy(entry.id);try{const result=await deletions.undo({kind:entry.kind,id:entry.id});if(!undoConfirmed(result)){setError(UNDO_TOO_LATE);refreshDeletionViews();return;}refreshDeletionViews();}catch{setError('Undo could not be confirmed. The deletion may already have gone ahead; refresh and inspect the saved item.');refreshDeletionViews();}finally{setBusy('');}}}>Undo</button>}{uncertain&&<><button disabled={!!busy} onClick={()=>{setError('Refreshing the saved receipt. This does not repeat the deletion or prove the item was restored.');refreshDeletionViews();}}>Refresh receipt</button><button disabled={!!busy} onClick={async()=>{setBusy(entry.id);try{await deletions.dismiss({kind:entry.kind,id:entry.id});setEntries(current=>{const remaining=current.filter(row=>row.id!==entry.id||row.kind!==entry.kind);knownPending.current=remaining.length>0;return remaining;});setError('Outcome dismissed. The receipt is retained; nothing was restored or repeated.');refreshDeletionViews();}catch{setError('The outcome could not be dismissed. Refresh the receipt and try again.');}finally{setBusy('');}}}>Dismiss outcome</button></>}</div>;
 })}</aside>;
}
