import { registerPlugin } from '../platform-plugins';
import { watchReturnToApp } from './native-adapter';
import { isMvpView } from './mvp-features';
type Bag=Record<string,any>;
const contacts=registerPlugin<any>('AlphaContacts');
const PHONE='M4 4h4l2 5-2 2 5 5 2-2 5 2v4C10 22 2 14 4 4',BUBBLE='M4 5h16v11H9l-5 4z';
/** Per-number Call and Message open Phone or Messages with the number filled in; nothing dials or sends until the owner does it there. */
export function contactActs(phones:readonly string[],api:Bag){
 return phones.flatMap(number=>[
  ...(isMvpView('phone')?[{d:PHONE,label:`Call ${number}`,go:()=>api.open('phone',{prefill:number})}]:[]),
  ...(isMvpView('messages')?[{d:BUBBLE,label:`Message ${number}`,go:()=>api.open('messages',{prefill:number})}]:[])]);
}
/** Native address-book rows stay in memory, never in prototype persistence or agent context. */
export function installContactsAdapter(Component:any,views:Bag){
 const render=views.contacts.render,p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,rows:Bag[]=[],status='Off',readable=false,loading=false,more=false,limit=50,epoch=0,active=false;
 const changed=()=>owner?.setState({contactsNativeRevision:Date.now()});
 const clear=()=>{epoch++;rows=[];readable=false;more=false;loading=false;changed();};
 const available=()=>!!owner&&owner.S().view==='contacts'&&isMvpView('contacts')&&!document.hidden;
 const sync=()=>{const next=available();if(next===active)return;active=next;if(next)void refresh();else clear();};
 async function refresh(request=false,queryOverride?:string){
  const target=owner,token=++epoch;if(!available()){return;}
  // Rows already shown stay until this read answers; leaving the view or losing access clears them.
  loading=true;changed();
  try{
   const access=request?await contacts.requestPermissions():await contacts.status();
   if(token!==epoch||target!==owner||!available())return;
   readable=access.available===true&&access.readable===true;
   if(!readable){rows=[];more=false;status='Off';return;}
   const value=await contacts.list({query:queryOverride??String(target.vget('contacts').q||''),limit});
   if(token!==epoch||target!==owner||!available())return;
   if(!Array.isArray(value.contacts))throw Error();rows=value.contacts;more=value.more===true;
   status=more&&limit>=200?'200 shown. Search to find other contacts.':rows.length?`${rows.length} contacts${more?' · more available':''}`:'No contacts found.';
  }catch{if(token===epoch){rows=[];more=false;status='Couldn’t load';}}
  finally{if(token===epoch){loading=false;changed();}}
 }
 async function editor(selected?:Bag){
  if(loading||!available())return;loading=true;changed();
  try{if(selected)await contacts.edit({id:selected.id,lookup:selected.lookup,revision:selected.revision});else await contacts.create();}
  catch{owner?.toast('Couldn’t open');}
  finally{loading=false;void refresh();}
 }
 views.contacts.reply=()=>null;
 views.contacts.suggestions=()=>[];
 views.contacts.render=function(st:Bag,api:Bag){
  const list=rows.map(row=>({id:row.id,name:row.name||'Unnamed contact',first:row.name||'Unnamed contact',ini:(row.name||'#').slice(0,1).toUpperCase(),phone:'',email:'',fav:false}));
  const model=render({...st,list,edit:null,add:null,form:null},api);
  model.nativeManaged=true;model.nativePrototype=false;model.nativeStatus=status;model.nativeStatusDot=!status?'':!readable?'warn':'';model.nativeBusy=loading;model.nativeAccess=!readable;model.nativeMore=more&&limit<200;
  model.nativeRefresh=()=>void refresh();model.nativeRequest=()=>void refresh(true);model.nativeLoadMore=()=>{limit=Math.min(200,limit+50);void refresh();};
  model.hasQ=false;model.noHits=false;model.addNew=()=>void editor();
  model.onQ=(event:Event)=>{api.set({q:(event.target as HTMLInputElement).value,open:null});limit=50;void refresh(false,(event.target as HTMLInputElement).value);};
  model.closeSearch=()=>{api.set({q:'',searching:false,open:null});limit=50;void refresh(false,'');};
  if(model.d){const selected=rows.find(row=>row.id===st.open);model.d.nativeManaged=true;model.d.acts=selected?contactActs(selected.phones||[],api):[];model.d.hasActs=model.d.acts.length>0;model.d.hasCtx=false;
   model.d.fields=selected?[...(selected.phones||[]).map((v:string)=>({d:PHONE,v})),...(selected.emails||[]).map((v:string)=>({d:'M3 5h18v14H3zM3 5l9 7 9-7',v}))]:[];
   model.d.hasFields=model.d.fields.length>0;model.d.edit=()=>selected&&void editor(selected);model.d.del=()=>{};model.d.toggleFav=()=>{};
  }
  return model;
 };
 p.componentDidMount=function(){mount?.call(this);owner=this;this.contactsReturn=watchReturnToApp(()=>void refresh());this.contactsHide=()=>sync();document.addEventListener('visibilitychange',this.contactsHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.contactsReturn?.();document.removeEventListener('visibilitychange',this.contactsHide);if(owner===this){owner=null;clear();}unmount?.call(this);};
}
