import { registerPlugin } from '../platform-plugins';
import { watchReturnToApp } from './native-adapter';
import { isMvpView } from './mvp-features';
import { displayNumber, initials } from './telephony-presenters';
import {contactDraftProblem,parseContactDetail,parseContactRemove,parseContactSave,type ContactDetail,type ContactDraft} from '../../../../.eliza/client-features/packages/contracts/src/native-address-book.ts';
type Bag=Record<string,any>;
const contacts=registerPlugin<any>('AlphaContacts');
const PHONE='M4 4h4l2 5-2 2 5 5 2-2 5 2v4C10 22 2 14 4 4',BUBBLE='M4 5h16v11H9l-5 4z';
/** Per-number Call and Message open Phone or Messages with the number filled in; nothing dials or sends until the owner does it there. */
export function contactActs(phones:readonly string[],api:Bag){
 return phones.flatMap(number=>[
  ...(isMvpView('phone')?[{d:PHONE,label:`Call ${number}`,go:()=>api.open('phone',{prefill:number})}]:[]),
  ...(isMvpView('messages')?[{d:BUBBLE,label:`Message ${number}`,go:()=>api.open('messages',{prefill:number})}]:[])]);
}
const PROBLEM:Record<string,string>={'empty-contact':'Add a name, number or email.','invalid-name':'Check the name.','too-many-fields':'Too many numbers or emails.','invalid-number':'Check the phone numbers.','invalid-address':'Check the email addresses.','invalid-type':'Check the phone numbers.'};
const TYPE_LABEL=(type:string)=>type.startsWith('custom:')?type.slice(7):type.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
/** The contact editor of the image Contacts view (specs/quint/native/ContactsBook.qnt). */
type Editor={mode:'creating'|'editing';id:string|null;version:string|null;draft:ContactDraft;dirty:boolean;stale:boolean;notice:string};
/** Native address-book rows stay in memory, never in prototype persistence or agent context. */
export function installContactsAdapter(Component:any,views:Bag){
 const render=views.contacts.render,p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let uncertain=false;
 let owner:any,rows:Bag[]=[],status='Off',readable=false,writable=false,loading=false,more=false,limit=50,epoch=0,visit=0,active=false;
 /* The open contact as the phone holds it now, the in-app editor and a pending delete confirmation. */
 let detail:ContactDetail|null=null,detailFor='',detailEpoch=0,form:Editor|null=null,confirming=false,saving=false,opening=false,api:Bag|null=null;
 const changed=()=>owner?.setState({contactsNativeRevision:Date.now()});
 const setApi=(next:Bag)=>{api=next;};
 const clear=()=>{epoch++;visit++;rows=[];readable=false;writable=false;more=false;loading=false;detail=null;detailFor='';detailEpoch++;form=null;confirming=false;saving=false;opening=false;changed();};
 const available=()=>!!owner&&owner.S().view==='contacts'&&isMvpView('contacts')&&!document.hidden;
 const sync=()=>{const next=available();if(next===active)return;active=next;if(next)void refresh();else clear();};
 async function refresh(request=false,queryOverride?:string,confirmUnknown=false){
  const target=owner,token=++epoch;if(!available()){return;}
  // Rows already shown stay until this read answers; leaving the view or losing access clears them.
  loading=true;changed();
  try{
   const access=request?await contacts.requestPermissions():await contacts.status();
   if(token!==epoch||target!==owner||!available())return;
   readable=access.available===true&&access.readable===true;writable=readable&&access.writable===true;
   if(!readable){rows=[];more=false;status='Off';return;}
   const value=await contacts.list({query:queryOverride??String(target.vget('contacts').q||''),limit});
   if(token!==epoch||target!==owner||!available())return;
   if(!Array.isArray(value.contacts))throw Error();rows=value.contacts;more=value.more===true;if(confirmUnknown)uncertain=false;
   status=uncertain?'Outcome unknown · refresh Contacts':more&&limit>=200?'200 shown. Search to find other contacts.':rows.length?`${rows.length} contacts${more?' · more available':''}`:'No contacts found.';
  }catch{if(token===epoch){rows=[];more=false;status='Couldn’t load';}}
  finally{if(token===epoch){loading=false;changed();}}
 }
 async function editor(selected?:Bag){
  if(loading||!available())return;
  const target=owner,token=++epoch,current=()=>owner===target&&token===epoch&&available();
  loading=true;changed();
  try{if(selected)await contacts.edit({id:selected.id,lookup:selected.lookup,revision:selected.revision});else await contacts.create();}
  catch{if(current())target.toast('Android Contacts could not open. Refresh and try again.');}
  // A return-to-app read may already own the current visit before Android answers the editor.
  finally{if(current()){loading=false;void refresh();}}
 }
 /* The open contact with its typed fields and the version an in-app save or delete must name. */
 async function loadDetail(id:string){
  if(!available())return;detailFor=id;detail=null;confirming=false;const token=++detailEpoch;
  try{const value=parseContactDetail(await contacts.get({id}),id);if(token===detailEpoch&&detailFor===id&&available()){detail=value;changed();}}
  catch{/* An incomplete or unreadable contact keeps the list fields and the system editor. */}
 }
 const unknownWrite=()=>{uncertain=true;form=null;confirming=false;detail=null;detailFor='';detailEpoch++;api?.set?.({open:null});status='Outcome unknown · refresh Contacts';owner?.toast('Outcome unknown. Refresh Contacts before trying again.');changed();};
 const blank=():ContactDraft=>({displayName:'',phoneNumbers:[],emailAddresses:[]});
 async function openEditor(selected?:Bag){
  if(uncertain){owner?.toast('Refresh Contacts first');return;}
  if(loading||saving||opening||form||!available())return;
  const token=visit,selectedAt=detailEpoch;opening=true;
  const current=()=>token===visit&&selectedAt===detailEpoch&&available();
  try{
   if(!writable){
    try{const access=await contacts.requestPermissions();if(!current())return;writable=access.available===true&&access.readable===true&&access.writable===true;}
    catch{if(!current())return;writable=false;}
   }
   if(!writable){void editor(selected);return;}
   let record=selected&&detail?.id===selected.id?detail:null;
   if(selected&&!record){
    try{record=parseContactDetail(await contacts.get({id:selected.id}),selected.id);}
    catch{if(current())void editor(selected);return;}
    if(!current())return;
   }
   form=record?{mode:'editing',id:record.id,version:record.version,draft:{displayName:record.displayName,phoneNumbers:record.phoneNumbers.map(row=>({...row})),emailAddresses:record.emailAddresses.map(row=>({...row}))},dirty:false,stale:false,notice:''}
    :{mode:'creating',id:null,version:null,draft:blank(),dirty:false,stale:false,notice:''};
   changed();
  }finally{if(token===visit)opening=false;}
 }
 const touch=(change:(draft:ContactDraft)=>void)=>{if(!form||saving)return;change(form.draft);form.dirty=true;if(!form.stale)form.notice='';changed();};
 const tidy=(draft:ContactDraft):ContactDraft=>({displayName:draft.displayName.trim(),phoneNumbers:draft.phoneNumbers.map(row=>({number:row.number.trim(),type:row.type})).filter(row=>row.number),emailAddresses:draft.emailAddresses.map(row=>({address:row.address.trim(),type:row.type})).filter(row=>row.address)});
 /* A save names the version that was shown. A contact that changed since keeps the editor and says so; nothing is written. */
 async function save(){
  if(!form||saving||!form.dirty||form.stale||!available())return;const token=visit,current=form,draft=tidy(current.draft),problem=contactDraftProblem(draft);
  if(problem){current.notice=PROBLEM[problem]||'Check the contact.';changed();return;}
  saving=true;changed();
  try{
   const result=parseContactSave(await contacts.save(current.mode==='editing'?{id:current.id,version:current.version,...draft}:draft),current.mode==='editing'?current.id!:undefined);
   if(token!==visit||form!==current||!available())return;
   if(result.status==='saved'){form=null;const id=result.id||current.id;if(id){api?.set?.({open:id});void loadDetail(id);}void refresh();}
   else if(result.status==='stale'){
    current.stale=true;current.notice='This contact changed. Close the editor and reopen it to review the latest fields.';
    if(current.id)void loadDetail(current.id);
   }
   else if(result.status==='unknown'){unknownWrite();}
   else if(result.status==='not-found'){form=null;api?.set?.({open:null});owner?.toast('That contact is no longer on this phone.');void refresh();}
   else current.notice='The contact could not be saved.';
  }catch{if(token===visit&&form===current)unknownWrite();}
  finally{if(token===visit){saving=false;changed();}}
 }
 async function remove(){
  if(uncertain||!confirming||saving||opening||form||!detail||!available())return;const token=visit,target=detail;saving=true;changed();
  try{
   const result=parseContactRemove(await contacts.remove({id:target.id,version:target.version}));
   if(token!==visit||detail!==target||!available())return;
   if(result.status==='deleted'||result.status==='not-found'){confirming=false;detail=null;detailFor='';api?.set?.({open:null});void refresh();}
   else if(result.status==='unknown'){unknownWrite();}
   else if(result.status==='stale'){confirming=false;owner?.toast('This contact changed. Check it and delete again.');void loadDetail(target.id);}
   else{confirming=false;owner?.toast('The contact could not be deleted.');}
  }catch{if(token===visit&&detail===target&&available())unknownWrite();}
  finally{if(token===visit){saving=false;changed();}}
 }
 views.contacts.reply=()=>null;
 views.contacts.suggestions=()=>[];
 views.contacts.render=function(st:Bag,viewApi:Bag){
  const api=viewApi;setApi(viewApi);
  if(st.open&&st.open!==detailFor&&readable)void loadDetail(String(st.open));
  if(!st.open&&detailFor){detailFor='';detail=null;detailEpoch++;confirming=false;}
  const list=rows.map(row=>({id:row.id,name:row.name||'Unnamed contact',first:row.name||'Unnamed contact',ini:initials(row.name||''),phone:'',email:'',fav:false}));
  const model=render({...st,list,edit:null,add:null,form:null},api);
  model.nativeManaged=true;model.nativePrototype=false;model.nativeStatus=status;model.nativeStatusDot=!status?'':!readable?'warn':'';model.nativeBusy=loading;model.nativeAccess=!readable;model.nativeMore=more&&limit<200;
  model.nativeRefresh=()=>void refresh(false,undefined,true);model.nativeRequest=()=>void refresh(true);model.nativeLoadMore=()=>{limit=Math.min(200,limit+50);void refresh();};
  model.hasQ=false;model.noHits=false;model.addNew=()=>void openEditor();model.notSearching=false;model.searching=false;model.hasQuery=!!String(st.q||'');
  /* A short list needs no letter headings; the search field is always there. */
  for(const group of model.groups||[])group.head=rows.length>=20;
  model.onQ=(event:Event)=>{api.set({q:(event.target as HTMLInputElement).value,open:null});limit=50;void refresh(false,(event.target as HTMLInputElement).value);};
  model.closeSearch=()=>{api.set({q:'',searching:false,open:null});limit=50;void refresh(false,'');};
  if(model.d){const selected=rows.find(row=>row.id===st.open);model.d.nativeManaged=true;model.d.acts=selected?contactActs(detail&&detail.id===selected.id?detail.phoneNumbers.map(row=>row.number):selected.phones||[],api):[];model.d.hasActs=model.d.acts.length>0;model.d.hasCtx=false;
   model.d.fields=selected?[...(selected.phones||[]).map((v:string)=>({d:PHONE,v:displayNumber(v)})),...(selected.emails||[]).map((v:string)=>({d:'M3 5h18v14H3zM3 5l9 7 9-7',v}))]:[];
   if(selected&&detail&&detail.id===selected.id)model.d.fields=[...detail.phoneNumbers.map(row=>({d:PHONE,v:displayNumber(row.number),sub:TYPE_LABEL(row.type)})),...detail.emailAddresses.map(row=>({d:'M3 5h18v14H3zM3 5l9 7 9-7',v:row.address,sub:TYPE_LABEL(row.type)}))];
   model.d.hasFields=model.d.fields.length>0;model.d.edit=()=>selected&&void openEditor(selected);model.d.toggleFav=()=>{};
   model.d.canDelete=!uncertain&&!!selected&&!!detail&&detail.id===selected.id&&writable;model.d.del=()=>{if(model.d.canDelete&&!saving&&!opening&&!form){confirming=true;changed();}};
   model.d.confirming=confirming;model.d.cancelDelete=()=>{if(!saving){confirming=false;changed();}};model.d.confirmDelete=()=>void remove();model.d.busy=saving;
  }
  const current=form;
  model.ed={open:!!current,busy:saving,cannotSave:saving||!current?.dirty||current.stale,notice:current?.notice||'',hasNotice:!!current?.notice,
   name:current?.draft.displayName||'',onName:(event:Event)=>touch(draft=>{draft.displayName=(event.target as HTMLInputElement).value.slice(0,256);}),
   phones:(current?.draft.phoneNumbers||[]).map((row,index)=>({value:row.number,label:TYPE_LABEL(row.type),onChange:(event:Event)=>touch(draft=>{draft.phoneNumbers[index].number=(event.target as HTMLInputElement).value.slice(0,64);}),remove:()=>touch(draft=>{draft.phoneNumbers.splice(index,1);}),removeLabel:`Remove ${TYPE_LABEL(row.type).toLowerCase()} number`})),
   emails:(current?.draft.emailAddresses||[]).map((row,index)=>({value:row.address,label:`${TYPE_LABEL(row.type)} email`,onChange:(event:Event)=>touch(draft=>{draft.emailAddresses[index].address=(event.target as HTMLInputElement).value.slice(0,320);}),remove:()=>touch(draft=>{draft.emailAddresses.splice(index,1);}),removeLabel:`Remove ${TYPE_LABEL(row.type).toLowerCase()} email`})),
   addPhone:()=>touch(draft=>{if(draft.phoneNumbers.length<32)draft.phoneNumbers.push({number:'',type:'mobile'});}),addEmail:()=>touch(draft=>{if(draft.emailAddresses.length<32)draft.emailAddresses.push({address:'',type:'home'});}),
   save:()=>void save(),cancel:()=>{if(saving)return;form=null;changed();}};
  return model;
 };
 /* Back closes the editor or the delete confirmation before it leaves the contact. */
 const back=views.contacts.back;views.contacts.back=(st:Bag,viewApi:Bag)=>{if(form){if(!saving){form=null;changed();}return true;}if(confirming){if(!saving){confirming=false;changed();}return true;}return back?back(st,viewApi):false;};
 p.componentDidMount=function(){mount?.call(this);owner=this;this.contactsReturn=watchReturnToApp(()=>void refresh());this.contactsHide=()=>sync();document.addEventListener('visibilitychange',this.contactsHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.contactsReturn?.();document.removeEventListener('visibilitychange',this.contactsHide);if(owner===this){owner=null;active=false;clear();}unmount?.call(this);};
}
