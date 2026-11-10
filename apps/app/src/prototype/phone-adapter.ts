import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createAospTelephony,normalizePhoneNumber,type AlphaTelephonyPlugin,type AospTelephony} from '../runtime/aosp-telephony';
import type {TelephonyCallLogEntry} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {audioReplied,audioRequested,callStarted,closed,closedVoicemail,deleteAsked,deleteCancelled,deleteFinished,ended,opened,paused,played,readinessLost,transcriptReplied,transcriptRequested,type OpenVoicemail,type TranscriptEngine} from '../runtime/voicemail-state';
import {watchReturnToApp} from './native-adapter';
import {isMvpView} from './mvp-features';
import {formatDateTime} from './locale-time';
import {callRow,clockLength,displayNumber,initials,numberKey,shortWhen} from './telephony-presenters';
type Bag=Record<string,any>;
type Voicemail={id:string;number:string;cachedName:string|null;date:number;durationSeconds:number;isNew:boolean;hasAudio:boolean;carrierTranscript:string|null};
const CALL_TYPE:Record<TelephonyCallLogEntry['type'],string>={incoming:'Incoming',outgoing:'Outgoing',missed:'Missed',voicemail:'Voicemail',rejected:'Declined',blocked:'Blocked',answered_externally:'Answered on another device',unknown:'Call'};
/** Plain rows of recent calls (label, detail and whether the number can be called). */
export function phoneRows(calls:readonly TelephonyCallLogEntry[],dial:(number:string)=>void){
 return calls.map(call=>{const who=call.cachedName||call.number||'Unknown caller',minutes=Math.floor(call.durationSeconds/60),seconds=call.durationSeconds%60;
  return {id:call.id,label:`${who}${call.isNew?' · new':''}`,detail:`${CALL_TYPE[call.type]} · ${formatDateTime(new Date(call.date))}${call.durationSeconds?` · ${minutes}:${String(seconds).padStart(2,'0')}`:''}`,noDial:!call.number,dialLabel:call.number?`Call ${who}`:`${who} cannot be called`,dial:()=>{if(call.number)dial(call.number);}};});
}
/**
 * Transcribes one window of a voicemail (a complete mono 16 kHz PCM16 WAV, base64) under the owner's
 * speech setting. `available` answers whether the on-device recognizer can run now. Installed by the
 * voice layer; without it a voicemail shows no transcript beyond the carrier's own.
 */
export type VoicemailTranscriber={mode:()=>'local'|'cloud';available:(signal:AbortSignal)=>Promise<boolean>;transcribe:(wavBase64:string,mode:'local'|'cloud',signal:AbortSignal)=>Promise<string>};
let transcriber:VoicemailTranscriber|null=null;
export function setVoicemailTranscriber(next:VoicemailTranscriber|null){transcriber=next;}
/** The voicemail the owner has open, for the agent's selected-voicemail read; null when none is open. */
export type OpenVoicemailRead={caller:string|null;date:number;durationSeconds:number;transcriptState:'ready'|'pending'|'unavailable'|'failed';engine:TranscriptEngine|null;transcript:string|null};
let openReader:(()=>OpenVoicemailRead|null)|null=null,openDeleter:(()=>Promise<'deleted'|'none-selected'|'cancelled'|'failed'>)|null=null;
export const openVoicemailRead=()=>openReader?.()??null;
/** Asks the owner to confirm deleting the open voicemail and reports what happened. */
export const deleteOpenVoicemail=()=>openDeleter?openDeleter():Promise.resolve('none-selected' as const);

const WINDOW_SECONDS=50,RATE=16000;
const KEYS:[string,string][]=[['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
const TAB_ICON={recents:'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM12 7v5l3 2',keypad:'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
 voicemail:'M6.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM6.5 16h11',contacts:'M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0zM4 21a8 8 0 0 1 16 0'};
const ARROW={in:'M17 7L7 17M7 9v8h8',out:'M7 17L17 7M9 7h8v8',missed:'M17 7L7 17M7 9v8h8'};
const bytesOf=(base64:string)=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
const base64Of=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);};
/** Splits one mono 16 kHz PCM16 WAV into complete WAVs of at most fifty seconds each. */
export function wavWindows(wav:Uint8Array,seconds=WINDOW_SECONDS):Uint8Array[]{
 const view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength);let at=12,data=-1,size=0;
 while(at+8<=wav.length){const kind=String.fromCharCode(wav[at],wav[at+1],wav[at+2],wav[at+3]),length=view.getUint32(at+4,true);if(kind==='data'){data=at+8;size=Math.min(length,wav.length-data);break;}at+=8+length+(length%2);}
 if(data<0||size<2)throw Error('No audio');
 const step=seconds*RATE*2,out:Uint8Array[]=[];
 for(let start=0;start<size;start+=step){const length=Math.min(step,size-start)&~1,chunk=new Uint8Array(44+length),head=new DataView(chunk.buffer);
  chunk.set([82,73,70,70]);head.setUint32(4,36+length,true);chunk.set([87,65,86,69,102,109,116,32],8);head.setUint32(16,16,true);head.setUint16(20,1,true);head.setUint16(22,1,true);head.setUint32(24,RATE,true);head.setUint32(28,RATE*2,true);head.setUint16(32,2,true);head.setUint16(34,16,true);chunk.set([100,97,116,97],36);head.setUint32(40,length,true);
  chunk.set(wav.subarray(data+start,data+start+length),44);out.push(chunk);}
 return out;
}
/**
 * Phone on the verified Alpha image only (P-36, AP-08), through the shared telephony profile.
 * Recents and voicemail are its bounded, unlocked, foreground-only reads, kept in memory for the
 * visit and never in prototype persistence or agent context. A call is placed only by the owner's
 * own tap here; `placed` means Android accepted it, and the system call screen takes over. An
 * emergency number is handed to the system dial screen. Voicemail audio is decoded on the phone and
 * transcribed under the owner's speech setting (Voicemail.qnt). Off the image this adapter returns
 * before registering anything, and the Phone view is not admitted.
 */
export function installPhoneAdapter(Component:any,views:Bag,client:AospTelephony|null=aospImage?createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true):null){
 if(!client)return;
 const p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,api:Bag|null=null,calls:TelephonyCallLogEntry[]=[],number='',status='',notice='',busy=false,needsAccess=false,noHistory=false,active=false,epoch=0,tab:'recents'|'keypad'|'voicemail'='recents';
 let voicemails:Voicemail[]=[],carrier:'ready'|'unconfigured'|'unsupported'|null=null,vm:OpenVoicemail=closedVoicemail(),stopObserving:(()=>Promise<void>)|null=null;
 let audio:HTMLAudioElement|null=null,audioUrl='',wav:Uint8Array|null=null,position=0,work:AbortController|null=null,inCall=false,deleteAnswer:((value:'deleted'|'cancelled'|'failed')=>void)|null=null;
 const names=new Map<string,string>(),people:{name:string;number:string}[]=[];
 const changed=()=>owner?.setState({phoneNativeRevision:Date.now()});
 const available=()=>!!owner&&owner.S().view==='phone'&&!document.hidden;
 const releaseAudio=()=>{work?.abort();work=null;if(audio){audio.pause();audio.removeAttribute('src');audio=null;}if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl='';}wav?.fill(0);wav=null;position=0;};
 const closeVoicemail=()=>{releaseAudio();vm=closed(vm);deleteAnswer?.('cancelled');deleteAnswer=null;};
 const clear=()=>{epoch++;calls=[];voicemails=[];carrier=null;number='';notice='';busy=false;needsAccess=false;names.clear();people.length=0;closeVoicemail();void stopObserving?.().catch(()=>{});stopObserving=null;changed();};
 const sync=()=>{const next=available();if(next===active)return;active=next;if(next)void refresh();else clear();};
 async function refresh(request=false){
  const token=++epoch;if(!available())return;busy=true;changed();
  try{
   let state=await client!.status();
   if(token!==epoch||!available())return;
   if(state.permissions.contacts==='granted'&&!people.length)void client!.searchContacts('',100).then(cards=>{if(token!==epoch)return;for(const card of cards)for(const value of card.phoneNumbers){const key=numberKey(value);if(!key||!card.displayName)continue;if(!names.has(key))names.set(key,card.displayName);people.push({name:card.displayName,number:value});}changed();}).catch(()=>{});
   void loadVoicemail(token);
   if(state.permissions.callLog===undefined){calls=[];needsAccess=false;noHistory=true;status='Recent calls aren\'t available.';return;}
   noHistory=false;
   if(state.permissions.callLog!=='granted'&&request){state=await client!.requestAccess('callLog');if(token!==epoch||!available())return;}
   if(state.permissions.callLog!=='granted'){calls=[];needsAccess=true;status='Allow call history to see recent calls.';return;}
   needsAccess=false;const rows=await client!.recentCalls(50);
   if(token!==epoch||!available())return;
   calls=rows;status=rows.length?`${rows.length} recent calls`:'No recent calls.';
  }catch{if(token===epoch){calls=[];status='Recent calls could not be read. Unlock the phone and refresh.';}}
  finally{if(token===epoch){busy=false;changed();}}
 }
 /* An unsupported or unconfigured carrier shows no voicemail tab: an unread store is never "no voicemail". */
 async function loadVoicemail(token:number){
  try{
   const page=await client!.listVoicemail(50);if(token!==epoch||!available())return;
   carrier=page.state;voicemails=page.state==='ready'?page.voicemails:[];
   if(vm.id&&!voicemails.some(row=>row.id===vm.id))closeVoicemail();
   if(carrier!=='ready'&&tab==='voicemail')tab='recents';
   if(carrier==='ready'&&!stopObserving){const stop=await client!.observeVoicemail(()=>{if(active)void loadVoicemail(epoch);});if(token!==epoch||!active){void stop().catch(()=>{});return;}stopObserving=stop;}
  }catch{if(token===epoch){carrier=null;voicemails=[];if(tab==='voicemail')tab='recents';closeVoicemail();}}
  finally{if(token===epoch)changed();}
 }
 /* The owner's tap places the call. Without the dialer role the number opens in the system dial screen instead. */
 async function call(raw:string){
  if(busy||!available())return;const target=normalizePhoneNumber(raw);
  if(!target){notice='Enter a valid phone number.';changed();return;}
  const token=epoch;busy=true;notice='';changed();
  try{const result=await client!.placeCall(target);if(token!==epoch)return;if(result.status==='placed'){number='';inCall=true;vm=callStarted(vm);audio?.pause();}else notice=result.message;}
  catch(error){if(token!==epoch)return;const code=(error as {code?:string})?.code;
   if(code==='role-required'||code==='permission-required'){try{const handoff=await client!.dial(target);if(token===epoch)notice=handoff.message;}catch{if(token===epoch)notice='Couldn\'t open the phone app.';}}
   else notice='The call could not be started.';}
  finally{if(token===epoch){busy=false;changed();}}
 }
 const ready=()=>active&&available();
 const open=(row:Voicemail)=>{if(vm.id===row.id){closeVoicemail();changed();return;}releaseAudio();vm=opened(vm,row.id,!row.isNew,row.carrierTranscript);void loadAudio(row);changed();};
 /* The decoded audio serves both playback and transcription; it stays in memory for the open voicemail only. */
 async function loadAudio(row:Voicemail){
  const before=vm;vm=audioRequested(vm,ready());if(vm===before)return;const ticket=vm.ticket,controller=new AbortController();work?.abort();work=controller;changed();
  try{
   if(!row.hasAudio){const fetched=await client!.fetchVoicemailAudio(row.id);if(ticket!==vm.ticket)return;if(fetched!=='ready')throw Error(fetched);}
   const pcm=await client!.voicemailPcm(row.id);if(ticket!==vm.ticket||controller.signal.aborted)return;
   wav=bytesOf(pcm.data);audioUrl=URL.createObjectURL(new Blob([wav as BlobPart],{type:'audio/wav'}));
   vm=audioReplied(vm,ticket,true);changed();void transcribe();
  }catch{if(ticket===vm.ticket){vm=audioReplied(vm,ticket,false);changed();}}
 }
 async function transcribe(){
  if(!transcriber||!wav||vm.transcript==='done')return;const ticket=vm.ticket,controller=work??new AbortController(),mode=transcriber.mode();
  let local=true;if(mode==='local'){try{local=await transcriber.available(controller.signal);}catch{local=false;}}
  if(ticket!==vm.ticket||!wav)return;
  vm=transcriptRequested(vm,ready(),mode,local);changed();if(vm.transcript!=='running')return;
  try{const parts:string[]=[];for(const part of wavWindows(wav)){const text=await transcriber.transcribe(base64Of(part),mode,controller.signal);if(ticket!==vm.ticket||controller.signal.aborted)return;if(text.trim())parts.push(text.trim());}
   vm=transcriptReplied(vm,ticket,parts.join(' ').slice(0,8000)||null);}
  catch{if(ticket===vm.ticket&&!controller.signal.aborted)vm=transcriptReplied(vm,ticket,null);}
  finally{if(ticket===vm.ticket)changed();}
 }
 function toggle(){
  if(vm.playback==='playing'){audio?.pause();vm=paused(vm);changed();return;}
  const before=vm;vm=played(vm,ready(),inCall);if(vm===before||!audioUrl)return;
  if(!audio&&typeof Audio!=='undefined'){const element=new Audio(audioUrl),ticket=vm.ticket;audio=element;
   element.ontimeupdate=()=>{if(ticket===vm.ticket){position=element.currentTime;changed();}};
   element.onended=()=>{if(ticket===vm.ticket){vm=ended(vm);position=0;changed();}};}
  void audio?.play().catch(()=>{vm=paused(vm);changed();});
  const row=voicemails.find(item=>item.id===vm.id);if(row?.isNew){row.isNew=false;void client!.markVoicemailHeard(row.id).catch(()=>{});}
  changed();
 }
 async function confirmDelete(){
  if(!vm.confirmDelete||!vm.id)return;const id=vm.id,ticket=vm.ticket;busy=true;changed();
  let ok=false;try{ok=(await client!.deleteVoicemail(id))==='deleted';}catch{ok=false;}
  if(ticket===vm.ticket){if(ok){releaseAudio();voicemails=voicemails.filter(row=>row.id!==id);}vm=deleteFinished(vm,ok);if(!ok)notice='The voicemail could not be deleted.';deleteAnswer?.(ok?'deleted':'failed');deleteAnswer=null;}
  busy=false;changed();
 }
 const who=(row:{number:string;cachedName:string|null})=>row.number?names.get(numberKey(row.number))||row.cachedName||displayNumber(row.number):'Unknown';
 openReader=()=>{const row=voicemails.find(item=>item.id===vm.id);if(!active||!row)return null;const known=row.number?names.get(numberKey(row.number))||row.cachedName:null;
  const state=vm.transcript==='done'?'ready' as const:vm.transcript==='running'||vm.audio==='fetching'?'pending' as const:vm.transcript==='failed'?'failed' as const:'unavailable' as const;
  return {caller:known||null,date:row.date,durationSeconds:row.durationSeconds,transcriptState:state,engine:state==='ready'?vm.engine:null,transcript:state==='ready'?vm.text:null};};
 openDeleter=()=>new Promise(resolve=>{if(!active||!vm.id){resolve('none-selected');return;}deleteAnswer?.('cancelled');deleteAnswer=resolve;vm=deleteAsked(vm,ready());if(!vm.confirmDelete){deleteAnswer=null;resolve('failed');}changed();});
 views.phone.reply=()=>null;
 views.phone.suggestions=()=>[];
 views.phone.status=()=>undefined;
 views.phone.render=(st:Bag,viewApi:Bag)=>{
 api=viewApi;
 /* A number handed over from Contacts or Messages fills the keypad once; only the owner's Call tap calls. */
 if(typeof st?.prefill==='string'&&st.prefill){if(!busy){number=st.prefill.slice(0,40);notice='';tab='keypad';}queueMicrotask(()=>viewApi.set?.({prefill:null}));}
 /* Home's Phone card names the tab it leads to. */
 if(st?.tab==='recents'||st?.tab==='voicemail'){if(st.tab==='recents'||carrier==='ready')tab=st.tab;if(carrier!==null||st.tab==='recents')queueMicrotask(()=>viewApi.set?.({tab:null}));}
 const now=Date.now(),hasVoicemail=carrier==='ready',digits=number.replace(/\D/g,'');
 const pick=(next:typeof tab)=>()=>{if(tab===next)return;if(tab==='voicemail')closeVoicemail();tab=next;notice='';changed();};
 const tabs=[{key:'recents',label:'Recents',on:tab==='recents',pick:pick('recents'),dot:false},{key:'keypad',label:'Keypad',on:tab==='keypad',pick:pick('keypad'),dot:false},
  ...(hasVoicemail?[{key:'voicemail',label:'Voicemail',on:tab==='voicemail',pick:pick('voicemail'),dot:voicemails.some(row=>row.isNew)}]:[]),
  ...(isMvpView('contacts')?[{key:'contacts',label:'Contacts',on:false,pick:()=>viewApi.open?.('contacts'),dot:false}]:[])]
  .map(item=>({...item,d:TAB_ICON[item.key as keyof typeof TAB_ICON],bg:item.on?'var(--fg)':'transparent',fg:item.on?'var(--bg)':'var(--fg)'}));
 const match=digits.length>=3?people.find(person=>person.number.replace(/\D/g,'').includes(digits)):undefined;
 const openRow=voicemails.find(row=>row.id===vm.id),length=openRow?openRow.durationSeconds:0;
 return {nativeManaged:true,nativePrototype:false,nativeStatus:status,nativeBusy:busy,nativeAccess:needsAccess,nativeNumber:number,nativeNotice:notice,hasNotice:!!notice,
  nativeRows:phoneRows(calls,value=>void call(value)),
  nativeOnNumber:(event:Event)=>{if(busy)return;number=(event.target as HTMLInputElement).value;notice='';changed();},
  nativeDial:()=>void call(number),nativeRefresh:()=>void refresh(),nativeRequest:()=>void refresh(true),
  nativeContacts:()=>isMvpView('contacts')?viewApi.open?.('contacts'):viewApi.toast?.('Contacts isn\'t available on this phone.'),
  tabs,isRecents:tab==='recents',isKeypad:tab==='keypad',isVoicemail:tab==='voicemail'&&hasVoicemail,
  recents:calls.map(entry=>{const row=callRow(entry,names,now);return {...row,color:row.missed?'var(--alpha-call-red)':'var(--fg)',d:ARROW[row.kind],noCall:!row.canCall||busy,call:()=>{if(entry.number)void call(entry.number);}};}),
  noRecents:tab==='recents'&&!needsAccess&&!noHistory&&!busy&&calls.length===0,
  shown:displayNumber(number),hasNumber:!!number,cannotCall:busy||!number,
  keys:KEYS.map(([key,letters])=>({key,letters,press:()=>{if(busy||number.length>=40)return;number+=key;notice='';changed();},plus:key==='0'?()=>{if(busy||number)return;number='+';changed();}:undefined})),
  erase:()=>{if(busy)return;number=number.slice(0,-1);notice='';changed();},
  hasMatch:!!match,matchName:match?.name||'',matchNumber:match?displayNumber(match.number):'',matchLabel:match?`Call ${match.name}`:'',callMatch:()=>{if(match)void call(match.number);},
  voicemails:voicemails.map(row=>{const name=who(row),on=row.id===vm.id;return {id:row.id,name,ini:initials(name),when:shortWhen(row.date,now),length:clockLength(row.durationSeconds),fresh:row.isNew,weight:row.isNew?700:600,
   preview:row.carrierTranscript||'',open:on,closed:!on,toggle:()=>open(row),label:`Voicemail from ${name}, ${shortWhen(row.date,now)}${row.isNew?', new':''}`};}),
  vm:{open:!!openRow,name:openRow?who(openRow):'',ini:openRow?initials(who(openRow)):'',when:openRow?shortWhen(openRow.date,now):'',
   loading:vm.audio==='fetching',failed:vm.audio==='failed',canPlay:vm.audio==='ready',playing:vm.playback==='playing',playLabel:vm.playback==='playing'?'Pause':'Play',
   playIcon:vm.playback==='playing'?'M9 6v12M15 6v12':'M8 5l11 7-11 7z',toggle,retry:()=>{if(openRow)void loadAudio(openRow);},
   progress:`${length?Math.min(100,Math.round(position/length*100)):0}%`,time:`${clockLength(position)} / ${clockLength(length)}`,
   seek:(event:Event)=>{const value=Number((event.target as HTMLInputElement).value);if(audio&&Number.isFinite(value)){audio.currentTime=value;position=value;changed();}},position:Math.floor(position),duration:length,
   hasText:vm.transcript==='done',text:vm.text,transcribing:vm.transcript==='running',
   canCall:!!openRow?.number,call:()=>{if(openRow?.number)void call(openRow.number);},canMessage:!!openRow?.number&&isMvpView('messages'),message:()=>{if(openRow?.number)viewApi.open?.('messages',{prefill:openRow.number});},
   confirming:vm.confirmDelete,notConfirming:!vm.confirmDelete,askDelete:()=>{vm=deleteAsked(vm,ready());changed();},cancelDelete:()=>{vm=deleteCancelled(vm);deleteAnswer?.('cancelled');deleteAnswer=null;changed();},confirmDelete:()=>void confirmDelete()}};};
 p.componentDidMount=function(){mount?.call(this);owner=this;this.phoneReturn=watchReturnToApp(()=>{inCall=false;if(active)void refresh();});this.phoneHide=()=>{if(document.hidden){vm=readinessLost(vm);audio?.pause();}sync();};document.addEventListener('visibilitychange',this.phoneHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.phoneReturn?.();document.removeEventListener('visibilitychange',this.phoneHide);if(owner===this){owner=null;active=false;clear();}unmount?.call(this);};
}
