import {shareSelectedText,copySelectedText} from '../runtime/text-share';
import {openSharePanel} from '../runtime/share-panel';
import {noteShareText} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-share-text.ts';
type Bag=Record<string,any>;
/** User actions snapshot exactly one currently selected note; Email remains an in-app draft. */
export function installNotesShareAdapter(views:Record<string,Bag>){
 const notes=views.notes,render=notes.render;
 notes.render=(state:Bag,api:Bag)=>{
  const view=render(state,api);
  const selected=()=>{const current=api.get('notes');if(!api.isActive()||!current.open)throw Error('Open a note first.');const note=current.list.find((row:Bag)=>row.id===current.open);if(!note)throw Error('The note is no longer available.');return noteShareText(note);};
  const failure=(error:unknown)=>{if(!(error instanceof DOMException&&error.name==='AbortError')&&api.isActive())api.toast(error instanceof Error?error.message:'Sharing is unavailable.');};
  const share=()=>{try{const snapshot=selected(),identity=JSON.stringify(snapshot),id=api.get('notes').open;
   void openSharePanel({title:snapshot.title,current:()=>{try{return api.isActive()&&api.get('notes').open===id&&JSON.stringify(selected())===identity;}catch{return false;}},external:()=>shareSelectedText(snapshot).catch(failure),email:()=>view.shareMail(),copy:()=>copySelectedText(snapshot.text).then(()=>api.toast('Note text copied.'),failure),save:view.canExportText?()=>view.exportText():undefined});
  }catch(error){failure(error);}};
  for(const key of ['ed','vo','lk'])if(view[key]){view[key].share=share;}
  view.shareSheet=false;
  view.copyText=()=>{try{const snapshot=selected();api.set({sheet:null});void copySelectedText(snapshot.text).then(()=>{if(api.isActive())api.toast('Note text copied.');},failure);}catch(error){failure(error);}};
  // Compose a draft only. The existing explicit Send/review flow owns email delivery.
  view.shareMail=()=>{try{const snapshot=selected();api.set({sheet:null});api.open('inbox',{compose:{subject:snapshot.title,body:snapshot.text}});}catch(error){failure(error);}};
  return view;
 };
}
