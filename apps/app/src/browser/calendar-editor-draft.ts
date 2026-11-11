import {AssistantDraftController} from '../prototype/assistant-draft-controller';
import {assistantDraftStore} from '../runtime/assistant-draft-store';
import {browserDevProfile} from './dev-profile';
import {openDomainRecovery} from './domain-recovery';
export type CalendarEditorFields={title:string;body:string;location:string;start:string;end:string;zone:string;allDay:boolean;repeat:string;alert:string;video:boolean;who:string[];timed?:{start:string;end:string;firstDay:string;lastDay:string}};
type RecordDraft={version:1;id:string;revision:string;fields:CalendarEditorFields};
export function readCalendarEditorDraft(raw:string,id:string):RecordDraft{
 const row=JSON.parse(raw),f=row?.fields;
 const keys=(v:any,list:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
 if(new TextEncoder().encode(raw).length>64000||!keys(row,['version','id','revision','fields'])||row.version!==1||row.id!==id||typeof row.revision!=='string'||!row.revision||!keys(f,['title','body','location','start','end','zone','allDay','repeat','alert','video','who','timed']))throw Error('Saved calendar editor needs recovery.');
 for(const key of ['title','body','location','start','end','zone','repeat','alert'])if(typeof f[key]!=='string'||f[key].length>(key==='body'?32768:key==='title'||key==='location'?2048:256))throw Error('Saved calendar editor fields are invalid.');
 if(typeof f.allDay!=='boolean'||typeof f.video!=='boolean'||!Array.isArray(f.who)||f.who.length>100||f.who.some((v:any)=>typeof v!=='string'||v.length>256))throw Error('Saved calendar editor fields are invalid.');
 if(f.timed!==undefined&&(!keys(f.timed,['start','end','firstDay','lastDay'])||['start','end','firstDay','lastDay'].some(k=>typeof f.timed[k]!=='string'||f.timed[k].length>256)))throw Error('Saved calendar editor dates are invalid.');
 return row;
}
/** Product modal lifecycle over the shared transactional draft storage adapter. */
export function calendarEditorDraft(dialog:HTMLDialogElement,form:HTMLElement,save:HTMLButtonElement,identity:{id:string;revision:string},read:()=>CalendarEditorFields,restore:(fields:CalendarEditorFields)=>void){
 const baseline=read(),panel=document.createElement('section'),message=document.createElement('p');panel.setAttribute('aria-label','Draft');message.setAttribute('role','status');message.setAttribute('aria-label','Draft status');panel.append(message);dialog.insertBefore(panel,form);panel.style.cssText='padding:0 16px;flex-shrink:0;max-height:35dvh;overflow:auto';
 let alive=true,opened=false,offered=false,applying=false,invalid=false,saving=false,saved=false,text='',revision=identity.revision,recoveryAbort:AbortController|undefined;
 const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);return b;};
 const apply=(raw:string)=>{const row=raw?readCalendarEditorDraft(raw,identity.id):null;revision=row?.revision||identity.revision;restore(row?.fields||baseline);invalid=false;};
 const controller=new AssistantDraftController(async binding=>{const store=await assistantDraftStore(binding);return {...store,read:async()=>{const row=await store.read();if(row?.text)readCalendarEditorDraft(row.text,identity.id);return row;}};},()=>text,raw=>{text=raw;if(applying)apply(raw);},()=>publish());
 const resume=button('Restore saved editor',()=>{if(controller.state.conflict){applying=true;try{controller.restoreSaved();}finally{applying=false;}}else apply(text);offered=false;publish();});
 const replace=button('Replace saved editor',()=>{if(!window.confirm('Replace edits?'))return;controller.keepCurrent();publish();});
 const discard=button('Discard saved editor',()=>{if(!window.confirm('Discard edits?'))return;const expected=text;void controller.consume(expected,()=>alive).then(()=>{apply('');offered=false;publish();}).catch(()=>publish());});
 const retry=button('Retry editor storage',()=>{opened=false;void controller.retry().then(()=>{if(!alive)return;opened=true;offered=!!text;publish();});});
 const recover=button('Recover editor storage',()=>{const recovery=controller.recovery();if(!recovery)return;recoveryAbort?.abort();recoveryAbort=new AbortController();openDomainRecovery({capture:async signal=>{const data=await recovery.capture(signal);return {...data,raw:JSON.stringify({saved:data.raw,current:read()})};},reset:recovery.reset},'calendar editor','Calendar editor recovery','Back up first',recoveryAbort.signal);});
 function publish(){if(!alive)return;const state=controller.state;form.inert=!opened||offered||saving||saved;save.disabled=!opened||offered||state.conflict||state.error||invalid||saving||saved;message.textContent=saved?'Saved':invalid?'Too large':offered?'Unsaved edits':state.message.replaceAll('sending','saving').replace('Preparing draft to send','Preparing');resume.hidden=!(offered||state.conflict);replace.hidden=!state.conflict;discard.hidden=!offered||state.conflict;retry.hidden=recover.hidden=!state.error;}
 const capture=()=>{if(!opened||offered||saving||saved)return;try{const raw=JSON.stringify({version:1,id:identity.id,revision,fields:read()});readCalendarEditorDraft(raw,identity.id);text=raw;invalid=false;controller.edit(raw);}catch{invalid=true;}publish();};
 form.addEventListener('input',capture);form.addEventListener('change',capture);
 const binding=JSON.stringify(['calendar-modal-editor',browserDevProfile?'development':'app',identity.id]);
 void controller.open(binding).then(()=>{if(!alive)return;opened=true;offered=!!text;publish();});
 return {
  beforeSave(){if(!opened||offered||controller.state.conflict||controller.state.error||invalid)throw Error('Review the retained editor before saving.');if(revision!==identity.revision)throw Error('These edits belong to an older event revision. Discard them and reopen the current event.');capture();if(invalid)throw Error('Current edits could not be retained.');saving=true;publish();return text;},
  async committed(expected:string){try{if(expected)await controller.consume(expected,()=>alive);return true;}catch{saved=true;publish();return false;}},
  settled(){saving=false;publish();},
  close(){alive=false;controller.retire(false);recoveryAbort?.abort();form.removeEventListener('input',capture);form.removeEventListener('change',capture);},
 };
}
