import {openSharePanel,setShareEmailComposer} from '../runtime/share-panel';
import {shareSelectedText,selectedText,copySelectedText} from '../runtime/text-share';
type Bag=Record<string,any>;
/** Wrap the completed app adapters, preserving their native revision/attachment admission. */
export function installSharePanelAdapter(Component:any,views:Record<string,Bag>){
 const prototype=Component.prototype,mount=prototype.componentDidMount,unmount=prototype.componentWillUnmount,render=prototype.renderVals;
 let owner:Bag|undefined;
 prototype.componentDidMount=function(){mount.call(this);owner=this;if(views.inbox)setShareEmailComposer((title,text)=>{if(owner!==this||document.hidden)throw Error('Email view changed.');const snapshot=selectedText({title,text});this.api(this.S().view).open('inbox',{compose:{subject:snapshot.title,body:snapshot.text}});});};
 prototype.componentWillUnmount=function(){if(owner===this){owner=undefined;setShareEmailComposer(undefined);}unmount.call(this);};
 prototype.renderVals=function(){
  const values=render.call(this),shell=this;
  const bind=(module:string,target:Bag,key:string,options:{title:string;email?:()=>unknown;copy?:()=>unknown;save?:()=>unknown})=>{
   const external=target?.[key];if(typeof external!=='function')return;
   target[key]=()=>{
    const before=JSON.stringify(shell.vget(module)),browser=module==='browser'?JSON.stringify(shell.browserSelection?.()):'';
    const current=()=>!document.hidden&&shell.S().view===module&&before===JSON.stringify(shell.vget(module))&&browser===(module==='browser'?JSON.stringify(shell.browserSelection?.()):'');
    const api=shell.api(module),safe=(run:()=>unknown)=>async()=>{try{if(!current())throw Error('The selection changed. Choose it again.');await run();}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))api.toast(error instanceof Error?error.message:'Sharing is unavailable.');}};
    void openSharePanel({title:options.title,current,external:safe(()=>external()),email:options.email?safe(options.email):undefined,emailUnavailable:'Email attachments are unavailable for this selection. Open one supported item to use its email review.',copy:options.copy?safe(options.copy):undefined,save:options.save?safe(options.save):undefined});
   };
  };
  if(values.browser){const view=values.browser;bind('browser',view,'openShare',{title:'Current page',email:typeof view.shareEmail==='function'?view.shareEmail:undefined,copy:typeof view.copyLink==='function'?view.copyLink:undefined});}
  if(values.photos){const view=values.photos;if(view.v)bind('photos',view.v,'share',{title:view.v.shareLabel||'Selected photo',email:view.v.canEmail?view.v.email:undefined,save:view.v.saveLocally});bind('photos',view,'selShare',{title:'Selected photos',save:view.selSaveLocally});if(view.alb?.dev)bind('photos',view.alb.dev,'share',{title:'Selected library items'});}
  if(values.files){const view=values.files;if(view.pv)bind('files',view.pv,'share',{title:view.pv.name||'Selected file',email:view.pv.canEmail?view.pv.email:undefined});bind('files',view,'selShare',{title:'Selected files',save:view.selSaveLocally});}
  if(values.calendar?.ev){const event=values.calendar.ev;const text=[event.title,event.day,event.when,event.where,event.notes].filter(value=>typeof value==='string'&&value).join('\n\n');
   event.share=()=>{const api=shell.api('calendar'),before=JSON.stringify(shell.vget('calendar')),current=()=>shell.S().view==='calendar'&&before===JSON.stringify(shell.vget('calendar'));
    const snapshot=selectedText({title:String(event.title||'Calendar event'),text});void openSharePanel({title:snapshot.title,current,external:()=>shareSelectedText(snapshot).catch(()=>api.toast('Android sharing is unavailable.')),email:views.inbox?()=>api.open('inbox',{compose:{subject:snapshot.title,body:snapshot.text}}):undefined,copy:()=>copySelectedText(snapshot.text).then(()=>api.toast('Event text copied.'))});};
  }
  return values;
 };
}
