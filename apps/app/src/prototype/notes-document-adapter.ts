import {noteShareText} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-share-text.ts';
import {testMocksEnabled} from '../build-flags';
import { registerPlugin } from '../platform-plugins';
type Bag=Record<string,any>;
const documents=registerPlugin<{importText():Promise<{status:string;message:string;text?:string;name?:string}>;exportText(input:{title:string;text:string}):Promise<{status:string;message:string}>}>('AlphaNoteDocuments', {
 web: () => import('../runtime/browser-note-documents').then(module => new module.BrowserNoteDocuments()),
});
/** Explicit user-selected text only; existing Notes persistence owns conflict/readback checks. */
export function installNotesDocumentAdapter(Component:any,views:Record<string,Bag>){
 const notes=views.notes,render=notes.render,leave=notes.onLeave;let busy=false,epoch=0;
 // Android delivers a picker result before the app is shown again. A receipt lasts under two
 // seconds, so one issued while the document is hidden can be over before anyone sees it.
 const whenVisible=()=>document.hidden?new Promise<void>(resolve=>{const shown=()=>{if(document.hidden)return;document.removeEventListener('visibilitychange',shown);resolve();};document.addEventListener('visibilitychange',shown);}):Promise.resolve();
 const originalApi=Component.prototype.api;
 Component.prototype.api=function(key:string){const api=originalApi.call(this,key);if(key==='notes')api.saveImportedNote=async(patch:Bag)=>await this.vset('notes',patch)===true;return api;};
 notes.onLeave=(api:Bag)=>{epoch++;leave?.(api);};
 notes.render=(state:Bag,api:Bag)=>{
  const view=render(state,api);
  /** The outcome of a document operation, a failure included, shown once the document is visible and only in the Notes view it belongs to. */
  const receipt=(message:string)=>{const token=epoch;void whenVisible().then(()=>{if(token===epoch&&api.isActive())api.toast(message);});};
  const perform=async(task:()=>Promise<any>,apply:(value:any)=>void|Promise<void>)=>{if(busy){api.toast('Finish the current document selection first.');return;}const token=epoch;busy=true;api.set({noteDocumentBusy:true});try{const value=await task();if(token!==epoch||!api.isActive())return;await apply(value);}catch{if(token===epoch)receipt('Document operation failed. No completed export or import is confirmed.');}finally{busy=false;api.set({noteDocumentBusy:false});}};
  view.importText=()=>{if(!testMocksEnabled)return;void perform(()=>documents.importText(),async value=>{
   if(value.status!=='read'||typeof value.text!=='string'){receipt(value.message);return;}
   const current=api.get('notes'),id=crypto.randomUUID();if(current.list.length>=10000){receipt('Notes is full. Nothing imported.');return;}
   const note={id,kind:'text',title:String(value.name||'Imported note').replace(/\.(txt|md|markdown)$/i,'').slice(0,200),body:value.text,pinned:false,when:'Imported on this device'};
   if(await api.saveImportedNote({list:[note,...current.list],open:id,sheet:null}))receipt('Imported as a new note. Nothing uploaded.');
  });};
  view.canImportText=testMocksEnabled;view.documentBusy=busy;
  const selected=state.list?.find((n:Bag)=>n.id===state.open);
  view.canExportText=!!selected;
  view.exportText=()=>{const current=api.get('notes'),note=current.list.find((n:Bag)=>n.id===current.open);if(!note||!api.isActive()){api.toast('Open a note first.');return;}const snapshot=noteShareText(note);api.set({sheet:null});void perform(()=>documents.exportText(snapshot),value=>receipt(value.message));};
  return view;
 };
}
