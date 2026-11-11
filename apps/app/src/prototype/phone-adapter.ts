import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createAospTelephony,normalizePhoneNumber,type AlphaTelephonyPlugin,type AospTelephony} from '../runtime/aosp-telephony';
import type {TelephonyCallLogEntry} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {watchReturnToApp} from './native-adapter';
import {isMvpView} from './mvp-features';
import {formatDateTime} from './locale-time';
type Bag=Record<string,any>;
const CALL_TYPE:Record<TelephonyCallLogEntry['type'],string>={incoming:'Incoming',outgoing:'Outgoing',missed:'Missed',voicemail:'Voicemail',rejected:'Declined',blocked:'Blocked',answered_externally:'Other device',unknown:'Call'};
/** Rows for the image Phone view: recent calls with a dial handoff, and nothing a prototype call could start. */
export function phoneRows(calls:readonly TelephonyCallLogEntry[],dial:(number:string)=>void){
 return calls.map(call=>{const who=call.cachedName||call.number||'Unknown caller',minutes=Math.floor(call.durationSeconds/60),seconds=call.durationSeconds%60;
  return {id:call.id,label:`${who}${call.isNew?' · new':''}`,detail:`${CALL_TYPE[call.type]} · ${formatDateTime(new Date(call.date))}${call.durationSeconds?` · ${minutes}:${String(seconds).padStart(2,'0')}`:''}`,noDial:!call.number,dialLabel:call.number?`Call ${who}`:`Can’t dial ${who}`,dial:()=>{if(call.number)dial(call.number);}};});
}
/**
 * Phone on the verified Alpha image only (P-36). The shared telephony profile is the only path:
 * recent calls come from its bounded, unlocked, foreground-only call-log read, access is asked for
 * only from the owner's own control, and every dial is a handoff to the system dial screen, which
 * places (or not) the call and keeps emergency numbers. Nothing here starts, simulates or reports a
 * call. Rows stay in memory, never in prototype persistence or agent context. Off the image this
 * adapter returns before registering anything, and the Phone view is not admitted.
 *
 * A read and a dial handoff hold separate latches. A newer read supersedes an older one (`epoch`),
 * but a dial belongs to the showing of Phone it started in (`session`): a refresh while the handoff
 * is in flight neither drops its notice nor lets a second dial start before it settles.
 */
export function installPhoneAdapter(Component:any,views:Bag,client:AospTelephony|null=aospImage?createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true):null){
 if(!client)return;
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,calls:TelephonyCallLogEntry[]=[],number='',status='',notice='',reading=false,dialing=false,needsAccess=false,active=false,epoch=0,session=0;
 const busy=()=>reading||dialing;
 const changed=()=>owner?.setState({phoneNativeRevision:Date.now()});
 const available=()=>!!owner&&owner.S().view==='phone'&&!document.hidden;
 const clear=()=>{epoch++;session++;calls=[];number='';notice='';reading=false;dialing=false;needsAccess=false;changed();};
 const sync=()=>{const next=available();if(next===active)return;active=next;if(next)void refresh();else clear();};
 async function refresh(request=false){
  const token=++epoch;if(!available())return;reading=true;changed();
  try{
   let state=await client!.status();
   if(token!==epoch||!available())return;
   if(state.permissions.callLog===undefined){calls=[];needsAccess=false;status='No recents';return;}
   if(state.permissions.callLog!=='granted'&&request){state=await client!.requestAccess('callLog');if(token!==epoch||!available())return;}
   if(state.permissions.callLog!=='granted'){calls=[];needsAccess=true;status='Off';return;}
   needsAccess=false;const rows=await client!.recentCalls(50);
   if(token!==epoch||!available())return;
   calls=rows;status=rows.length?`${rows.length} recent calls`:'No recent calls.';
  }catch{if(token===epoch){calls=[];status='Couldn’t load';}}
  finally{if(token===epoch){reading=false;changed();}}
 }
 async function dial(raw:string){
  if(busy()||!available())return;const target=normalizePhoneNumber(raw);
  if(!target){notice='Invalid number';changed();return;}
  const token=session;dialing=true;changed();
  try{const result=await client!.dial(target);if(token===session)notice=result.message;}
  catch{if(token===session)notice='Couldn’t open';}
  finally{if(token===session){dialing=false;changed();}}
 }
 views.phone.reply=()=>null;
 views.phone.suggestions=()=>[];
 views.phone.status=()=>undefined;
 views.phone.render=(st:Bag,api:Bag)=>{
 /* A number handed over from Contacts fills the field once; only the owner's Dial tap opens the dial screen. */
 if(typeof st?.prefill==='string'&&st.prefill){if(!busy()){number=st.prefill.slice(0,40);notice='';}queueMicrotask(()=>api.set?.({prefill:null}));}
 return {nativeManaged:true,nativePrototype:false,nativeStatus:status,nativeStatusDot:!status?'':status==='Couldn’t load'?'err':needsAccess?'warn':'',nativeBusy:busy(),nativeAccess:needsAccess,nativeNumber:number,nativeNotice:notice,
  nativeRows:phoneRows(calls,value=>void dial(value)),
  nativeOnNumber:(event:Event)=>{if(busy())return;number=(event.target as HTMLInputElement).value;notice='';changed();},
  nativeDial:()=>void dial(number),nativeRefresh:()=>void refresh(),nativeRequest:()=>void refresh(true),
  nativeContacts:()=>isMvpView('contacts')?api.open?.('contacts'):api.toast?.('Unavailable')};};
 p.componentDidMount=function(){mount?.call(this);owner=this;this.phoneReturn=watchReturnToApp(()=>{if(active)void refresh();});this.phoneHide=()=>sync();document.addEventListener('visibilitychange',this.phoneHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.phoneReturn?.();document.removeEventListener('visibilitychange',this.phoneHide);if(owner===this){owner=null;active=false;clear();}unmount?.call(this);};
}
