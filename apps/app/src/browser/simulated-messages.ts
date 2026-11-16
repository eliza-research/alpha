import {DailyApps} from '../daily';
import {devSurfacesEnabled} from '../build-flags';
import {registerPlugin} from '../platform-plugins';
import {reviewMailAttachment} from '../runtime/inbox-attachment';
type Bag=Record<string,any>;
const attachments=registerPlugin<any>('AlphaMailAttachments');
const recipient=(state:Bag)=>state.thread||(typeof state.compose==='string'?state.compose:null);
/** Local message copies never enter the SMS/provider transport. */
export function installSimulatedMessages(view:Bag){
 if(!devSurfacesEnabled)return ()=>{};
 const render=view.render,leave=view.onLeave,back=view.back,bar=view.bar,submit=view.submit;let epoch=0,busy=false,activeApi:Bag|undefined;
 const hidden=()=>{if(document.hidden)retirePage();},retirePage=()=>{epoch++;busy=false;void attachments.cancel();if(activeApi?.isActive())activeApi.set({browserAttachmentRevision:crypto.randomUUID()});};
 window.addEventListener('pagehide',retirePage);window.addEventListener('alpha:device-state',retirePage);document.addEventListener('visibilitychange',hidden);
 const retire=(api:Bag)=>{epoch++;busy=false;void attachments.cancel();api.set({browserAttachment:null});};
 const picked=(state:Bag,pid:string)=>state.browserAttachment?.pid===pid?state.browserAttachment.file:null;
 const fail=(api:Bag,error:unknown)=>api.toast(error instanceof Error?error.message:'Could not save. Your draft is still here.');
 view.onLeave=(api:Bag)=>{retire(api);return leave?.(api);};
 view.back=(state:Bag,api:Bag)=>{if(!state.tray)retire(api);return back?.(state,api);};
 /* The thread's one Send (the bar, and the draft bubble through it): a picked file goes with the
  * draft slot's text in one write with the cleared slot; otherwise the view's own Send. */
 view.submit=(api:Bag,pid:string)=>{
  if(busy)return null;const s=api.get('messages'),selected=picked(s,pid);if(!selected)return submit(api,pid);
  const text=String(s.drafts?.[pid]?.text||'').trim(),threads={...s.threads},drafts={...s.drafts};delete drafts[pid];
  const k=Math.max(api.now.getHours()*60+api.now.getMinutes()-1,...Object.values(s.threads as Bag).flatMap((rows:any)=>rows.map((m:Bag)=>Number(m.k)||0)))+1;
  const messages=[{id:crypto.randomUUID(),k,me:true,file:selected.name,size:selected.size+' bytes',browserAttachment:selected},...(text?[{id:crypto.randomUUID(),k,me:true,text}]:[])];threads[pid]=[...(threads[pid]||[]),...messages];
  const patch={threads,drafts,browserAttachment:null,tray:false},stored=Object.fromEntries(view.persist.map((key:string)=>[key,{...s,...patch}[key]]));
  try{if(JSON.stringify(stored).length>12_000_000)throw Error('Messages storage is full. Remove older conversations before saving.');api.set(patch);return messages[messages.length-1].id;}catch(error){fail(api,error);return null;}
 };
 view.bar=(state:Bag,api:Bag)=>{const spec=bar(state,api),pid=recipient(state);return pid&&spec?.target?.kind==='thread'&&picked(state,pid)?{...spec,closed:{...spec.closed,canSubmit:true}}:spec;};
 view.render=(state:Bag,api:Bag)=>{
  const out=render(state,api),pid=recipient(state);if(!out.t||!pid)return out;activeApi=api;
  const current=()=>api.get('messages'),file=picked(state,pid);
  const repaint=()=>api.set({browserAttachmentRevision:crypto.randomUUID()});
  const base=out.t;
  out.t={...base,local:true,busy,
   attachFile:async()=>{if(busy)return;busy=true;const ticket=epoch;repaint();let selectionId:string|undefined;
    const valid=()=>ticket===epoch&&api.isActive()&&recipient(current())===pid;
    try{const selection=await DailyApps.perform({action:'files'});selectionId=selection.selectionId;if(!valid()||selection.status==='cancelled')return;if(!selectionId)throw Error('Choose a file.');const selected=await attachments.readSelected({selectionId});const checked=await reviewMailAttachment(selected);if(!valid())return;api.set({browserAttachment:{pid,file:{...checked,dataBase64:selected.dataBase64}}});}
    catch(error){if(valid())fail(api,error);}finally{if(selectionId)await DailyApps.forgetSelected({selectionId}).catch(()=>{});if(ticket===epoch){busy=false;repaint();}}
   }
  };
  if(file){out.t.hasAtts=true;out.t.atts=[...base.atts,{name:file.name,rm:()=>api.set({browserAttachment:null})}];}
  out.t.bubbles=base.bubbles.map((bubble:Bag,index:number)=>{const stored=state.threads[pid]?.[index]?.browserAttachment;return stored?{...bubble,openFile:()=>void attachments.openReviewed({...stored,reviewed:true}).catch((error:unknown)=>fail(api,error))}:bubble;});
  return out;
 };
 return ()=>{activeApi=undefined;retirePage();window.removeEventListener('pagehide',retirePage);window.removeEventListener('alpha:device-state',retirePage);document.removeEventListener('visibilitychange',hidden);};
}
