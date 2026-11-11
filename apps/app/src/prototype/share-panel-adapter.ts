import {openSharePanel} from '../runtime/share-panel';
import {shareSelectedText,selectedText} from '../runtime/text-share';
type Bag=Record<string,any>;
/** Refresh counters do not change the selected content. */
const shareSnapshot=(state:Bag|undefined)=>JSON.stringify(state&&Object.fromEntries(Object.entries(state).filter(([key])=>!key.endsWith('Revision'))));
/** Keep each source's native attachment checks and open its device chooser directly. */
export function installSharePanelAdapter(Component:any,_views:Record<string,Bag>){
 const prototype=Component.prototype,render=prototype.renderVals;
 let calendarText='';
 prototype.renderVals=function(){
  const values=render.call(this),shell=this;
  const failure=(module:string,error:unknown)=>{if(!(error instanceof DOMException&&error.name==='AbortError'))shell.api(module).toast(error instanceof Error?error.message:'Sharing is unavailable.');};
  const bind=(module:string,target:Bag,key:string)=>{
   const external=target?.[key];if(typeof external!=='function')return;
   target[key]=()=>{
    const before=shareSnapshot(shell.vget(module)),browser=module==='browser'?JSON.stringify(shell.browserSelection?.()):'';
    const current=()=>shell.S().view===module&&before===shareSnapshot(shell.vget(module))&&browser===(module==='browser'?JSON.stringify(shell.browserSelection?.()):'');
    return openSharePanel({current,external:target.shareAvailable===false?undefined:()=>external()}).catch(error=>failure(module,error));
   };
  };
  if(values.browser)bind('browser',values.browser,'openShare');
  if(values.photos){if(values.photos.v)bind('photos',values.photos.v,'share');bind('photos',values.photos,'selShare');}
  if(values.files){if(values.files.pv)bind('files',values.files.pv,'share');bind('files',values.files,'selShare');}
  if(values.calendar?.ev){
   const event=values.calendar.ev,text=[event.title,event.day,event.when,event.where,event.notes].filter(value=>typeof value==='string'&&value).join('\n\n');calendarText=text;
   event.share=()=>{
    const before=shareSnapshot(shell.vget('calendar'));
    const snapshot=selectedText({title:String(event.title||'Calendar event'),text});
    return openSharePanel({current:()=>shell.S().view==='calendar'&&calendarText===text&&before===shareSnapshot(shell.vget('calendar')),external:()=>shareSelectedText(snapshot)}).catch(error=>failure('calendar',error));
   };
  }
  return values;
 };
}
