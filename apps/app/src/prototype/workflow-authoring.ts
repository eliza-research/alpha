import {workflowDeviceTimeZone,workflowLocalInstant,workflowClockContext} from '../runtime/workflow-local-time';
import {automationLocalDateInput,localDate} from '../runtime/workflow-local-time';
import {Capacitor} from '@capacitor/core';
import {testMocksEnabled} from '../build-flags';
import {browserWorkflowDraftStore} from '../browser/workflow-drafts';
import {browserDevProfile} from '../browser/dev-profile';
import { registerPlugin } from '../platform-plugins';
import { browserLocalAgentEnabled } from '../runtime/local-agent';
import { developmentWorkflowDraftStore } from '../runtime/local-agent-storage';
import { connectionController } from '../runtime/connection-ui';
import { normalizePhoneSpec, assertPhoneCapabilities, describePhoneTrigger, phoneTriggerClockChangeNote, type PhoneSpec, type PhoneStep, type PhoneCatalog, type PhoneTimeTrigger } from '../runtime/phone-workflow-authoring';
import { workflowSha, workflowBytes } from '../runtime/workflow-device-contract';
import { checkWorkflowScope, WORKFLOW_OPERATION_LABELS } from '../../../../.eliza/client-features/packages/contracts/src/workflow-scope.ts';
import { WorkflowTypedRejected, type RemoteWorkflow } from '../runtime/workflow-protocol';
import { projectNoteForModel, type StickyNote } from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
type Bag=Record<string,any>;
type Pending={mutationId:string;specDigest:string;compilerRevision:string;workflowId?:string;versionId?:string};
type Draft={format:1;identity:string;spec:PhoneSpec;workflowId?:string;versionId?:string;pending?:Pending};
const secure=browserLocalAgentEnabled?developmentWorkflowDraftStore:registerPlugin<{secureRead(v:{slot:string}):Promise<{value:string|null}>;secureCompareExchange(v:{slot:string;expectedValue:string|null;value:string|null}):Promise<{status:string}>}>('AlphaConnection');
const draftStorageDescription=browserDevProfile?'in this preview (not encrypted)':browserLocalAgentEnabled?'in the private development profile on this computer (not encrypted)':'encrypted on this phone';
const calendar=registerPlugin<{workflowCalendars():Promise<{status:string;calendars:Bag[]}>;requestWorkflowReadAccess():Promise<{status:string}>}>('AlphaCalendar');
const palette=['Read','If','Write','Send','Notify','Speak','Do'];
const icons:Record<string,string>={Read:'wfRead',If:'wfIf',Write:'edit',Send:'send',Notify:'bell',Speak:'wave',Do:'wfDo'};
const known=new Set(['supplied_text','selected_notes','selected_reminders','calendar_range','contains','compose_draft','model_draft','save_note','app_notification','read_aloud']);
const supported=(id:string)=>known.has(id)&&(!['app_notification','read_aloud'].includes(id)||connectionController.getWorkflowPresentationProtocol()===2)&&(id!=='selected_reminders'||connectionController.getWorkflowDeviceProtocol()>=3);
/** Monday-first weekday chips for a reviewed local-time trigger (0 = Sunday in the shared contract). */
const WEEKDAYS:Array<[number,string]>=[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']];
const TRIGGER_LABELS:Record<string,string>={manual:'Manual',time:'Time'};
const deviceTimeZone=workflowDeviceTimeZone;
function followDeviceClock(spec:PhoneSpec){const zone=deviceTimeZone();if(spec.trigger.kind==='time')spec.trigger.timeZone=zone;for(const step of spec.steps){if(step.operation==='selected_reminders')step.scope.timeZone=zone;if(step.operation==='calendar_range')step.range.timeZone=zone;}}
const shiftLocalTime=(value:string,minutes:number)=>{const [h,m]=value.split(':').map(Number);const total=Math.min(23*60+59,Math.max(0,h*60+m+minutes));return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');};
/** Owner-facing policy for a scheduled typed workflow; the agent enforces each part. */
const SCHEDULE_POLICY='Phone must be on.';
/** Typed local authoring. No prototype natural-language parser or arbitrary source is executed. */
export function createWorkflowAuthoring(owner:()=>any,publish:()=>void,onSaved:(id:string)=>Promise<unknown>){
 let active=false,draft:Draft|null=null,catalog:PhoneCatalog|null=null,sheet:string|null=null,busy=false,status='',review:string|null=null,discard=false,generation=0,controller:AbortController|null=null;
 let describeOn=false,descriptionPrompt='',generated:PhoneSpec|null=null,generatedSession='',generatedBaseline='',generating=false;
 // A refreshed receipt showed the agent has no record of the pending save. Only then may the owner send that exact save again.
 let unreceipted=false,resendReview=false;
 // The workflow the open draft saves to (named in the save review), and the target the owner asked to open when a
 // retained draft for another workflow was shown instead: Discard then opens that target.
 let targetName='',requested:{workflow?:RemoteWorkflow}|null=null;
 type DraftStorage={slot:string;raw:string|null;failed:boolean;queue:Promise<void>;secure:typeof secure};
 let calendars:Bag[]=[],storage:DraftStorage|null=null;
 let retainedDraftState:{storage:DraftStorage;draft:Draft|null}|null=null;
 const pendingWrites=new Set<Promise<void>>();
 const failedWrites=new Set<DraftStorage>();
 const toast=(value:string)=>owner()?.toast?.(value);
 const selected=()=>draft?.spec.steps.find(s=>s.id===sheet);
 const locked=()=>busy||!!draft?.pending||!!storage?.failed;
 /** Workflows cannot yet save into the agent's Notes: its create has no client identity, so a repeat could add a second note. */
 const offered=(id:string)=>supported(id)&&!(id==='save_note'&&owner()?.notesSourceMode==='canonical');
 /** Notes a Notes step may select: the agent's Notes when that is the current source, otherwise Previous notes. */
 const noteRows=():Array<{id:string;title:string;body:string}>=>{const host=owner();if(host?.notesSourceMode!=='canonical')return host?.vget('notes').list??[];return ((host.canonicalNotesUi?.notes()??[]) as StickyNote[]).map(note=>({id:note.id,...projectNoteForModel(note)}));};
 function persist(recovered?:DraftStorage){
  if(!draft||!storage)return;
  const target=storage,snapshot=JSON.stringify(draft);
  const write=target.queue=target.queue.then(async()=>{
   if(target.failed)throw new Error('Local draft needs recovery');
   if(new TextEncoder().encode(snapshot).length>100000)throw new Error('Local draft is too large');
   const result=await target.secure.secureCompareExchange({slot:target.slot,expectedValue:target.raw,value:snapshot});
   if(result.status!=='saved')throw new Error('Draft changed in another window. Close and reopen it before editing.');
   target.raw=snapshot;
   if(recovered)failedWrites.delete(recovered);
  }).catch(error=>{
   target.failed=true;failedWrites.add(target);
   status=error instanceof Error?error.message:'Draft not saved';
   if(storage===target)publish();
  });
  pendingWrites.add(write);
  void write.then(()=>pendingWrites.delete(write));
 }
 async function flushForAppUpdate(current:()=>boolean){
  const token=generation,target=storage,writes=new Set(pendingWrites);
  const exact=()=>current()&&generation===token&&storage===target&&!busy&&
   !(describeOn&&descriptionPrompt)&&!failedWrites.size&&
   [...pendingWrites].every(write=>writes.has(write));
  await Promise.all(writes);
  if(!exact())throw Error('Workflow draft changed');
  if(!target)return;
  const queue=target.queue,raw=target.raw;
  const saved=await target.secure.secureRead({slot:target.slot});
  if(!exact()||target.queue!==queue||target.raw!==raw||saved.value!==raw)
   throw Error('Workflow draft could not be verified');
 }
 function change(run:()=>void){if(locked()||!draft)return;run();if(!draft.workflowId)followDeviceClock(draft.spec);review=null;generated=null;discard=false;status='Draft';persist();publish();}
 async function localSaved(){await storage?.queue;if(!storage||storage.failed)throw new Error('Resolve local draft storage before saving');}
 function close(){requested=null;unreceipted=false;resendReview=false;describeOn=false;descriptionPrompt='';generated=null;generating=false;active=false;generation++;controller?.abort();controller=null;busy=false;sheet=null;review=null;discard=false;calendars=[];publish();}
 async function open(workflow?:RemoteWorkflow){
  if(active||busy)return;const binding=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session;if(!binding||!session){showAgentStatus(owner());return;}
  if(storage)retainedDraftState={storage,draft};
  const previousStorage=retainedDraftState?.storage,previousDraft=retainedDraftState?.draft;
  active=true;busy=true;unreceipted=false;resendReview=false;draft=null;catalog=null;storage=null;requested=null;targetName=workflow?.name??'';status='';const token=++generation;controller=new AbortController();const signal=controller.signal;publish();
  const valid=()=>token===generation&&!signal.aborted&&connectionController.getWorkflowClient()?.sessionId===binding.sessionId&&!document.hidden&&!connectionController.getSnapshot().open;
  try{const [cap,identity]=await Promise.all([binding.client.phoneCatalog(signal),workflowSha([session.origin,session.ownerId,session.agentId])]);if(!valid())return;catalog=cap;const slot='workflow-draft:v1:'+identity;let unsaved:Draft|null=null,unsavedBase:string|null=null;if(previousStorage?.slot===slot){await previousStorage.queue;if(!valid())return;
   // Consume the retained state once: every later reopen reads the slot again, so a failed save can always be recovered by close and reopen.
   if(retainedDraftState?.storage===previousStorage)retainedDraftState=null;if(previousStorage.failed&&previousDraft){unsaved=previousDraft;unsavedBase=previousStorage.raw;}}
   const draftSecure=browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development'?await browserWorkflowDraftStore(session):secure,saved=await draftSecure.secureRead({slot});if(!valid())return;storage={slot,raw:saved.value,failed:false,queue:Promise.resolve(),secure:draftSecure};
   if(previousStorage?.slot===slot&&previousStorage.failed&&previousDraft&&saved.value===JSON.stringify(previousDraft))failedWrites.delete(previousStorage);
   // A failed write leaves the slot at the last confirmed bytes: retry the retained edits there. If another window changed the slot, load its newer draft instead.
   if(unsaved&&saved.value===unsavedBase&&JSON.stringify(unsaved)!==saved.value){draft=unsaved;status='Retrying';persist(previousStorage);}
   else if(saved.value!==null){if(new TextEncoder().encode(saved.value).length>100000)throw new Error('Saved draft exceeds the recovery limit');const retained=JSON.parse(saved.value);if(retained.format!==1||retained.identity!==identity||!retained.spec||retained.spec.version!==1||!Array.isArray(retained.spec.steps)||retained.spec.steps.length>32)throw new Error('Saved draft requires recovery');draft=retained;const name=retained.spec.name||'New workflow';if(retained.workflowId!==workflow?.id)targetName=retained.workflowId?name:'';
    // One draft slot serves every workflow. A draft for another workflow (or for New) is named, never silently saved
    // over the one the owner opened; Discard opens that one instead.
    status=draft!.pending?'Pending':unsaved&&JSON.stringify(unsaved)!==saved.value?'Newer draft restored':retained.workflowId!==workflow?.id?(requested={workflow},`Unsaved draft: ${name}`):'Draft restored';}
   else{const spec=workflow?normalizePhoneSpec(workflow.phoneSpec):{version:1 as const,name:'New workflow',description:'',trigger:{kind:'manual' as const},steps:[]};draft={format:1,identity,spec,...(workflow?{workflowId:workflow.id,versionId:workflow.versionId}:{})};status='';}
   if(draft&&!draft.pending&&!draft.workflowId)followDeviceClock(draft.spec);
   // Nothing is stored until the first change: opening and leaving without an edit keeps the slot empty.
  }catch(error){if(valid()){status=error instanceof Error?error.message:'Unavailable';draft=null;toast(status);}}finally{if(token===generation){busy=false;controller=null;publish();}}
 }
 function ensureDevice(){const target=connectionController.getWorkflowDeviceTarget();if(!target)throw new Error('Reconnect this agent to verify phone enrollment');if(draft)draft.spec.device=target;}
 function operation(kind:string,id:string,stepId:string,index:number):PhoneStep{
  const source=draft?.spec.steps[index-1]?.id;if(kind!=='Read'&&!source)throw new Error('Add a Read step first');
  const common={id:stepId,kind:kind as PhoneStep['kind'],operation:id};
  if(id==='supplied_text')return {...common,text:''};
  if(id==='selected_notes'){ensureDevice();return {...common,notes:[]};}
  if(id==='selected_reminders'){ensureDevice();return {...common,scope:{window:'open_and_completed_today',timeZone:deviceTimeZone(),maximumItems:50}};}
  if(id==='calendar_range'){ensureDevice();const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return {...common,range:{calendarIds:[],start:start.toISOString(),end:end.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,maximumEvents:100}};}
  if(id==='contains')return {...common,source,text:'',caseSensitive:false};
  if(id==='compose_draft')return {...common,source,prefix:'',suffix:''};
  if(id==='model_draft')return {...common,source,instruction:''};
  if(id==='app_notification'){ensureDevice();return {...common,source,title:'Workflow result'};}
  if(id==='read_aloud'){ensureDevice();return {...common,source};}
  if(id==='save_note'){ensureDevice();return {...common,source,title:'Workflow note'};}
  throw new Error('This operation needs a newer qualified phone capability');
 }
 function add(kind:string){if(locked()||!draft||!catalog)return;const available=catalog.palette.find(k=>k.kind===kind)?.operations.find(o=>o.available&&offered(o.id));if(!available){toast(catalog.palette.find(k=>k.kind===kind)?.operations[0]?.reason||'Not on your agent');return;}if(draft.spec.steps.length>=32){toast('32 max');return;}try{const step=operation(kind,available.id,'s'+crypto.randomUUID().replaceAll('-',''),draft.spec.steps.length);change(()=>{draft!.spec.steps.push(step);sheet=step.id;});}catch(error){toast((error as Error).message);}}
 function chooseOperation(id:string){const step=selected();if(!step||!draft||!catalog||locked())return;const option=catalog.palette.find(p=>p.kind===step.kind)?.operations.find(o=>o.id===id);if(!option?.available||!offered(id)){toast(option?.reason||(id==='save_note'?'Coming soon':'Unavailable'));return;}try{const replacement=operation(step.kind,id,step.id,draft.spec.steps.indexOf(step));change(()=>{draft!.spec.steps[draft!.spec.steps.indexOf(step)]=replacement;});}catch(error){toast((error as Error).message);}}
 function remove(){const step=selected();if(!step||!draft||locked())return;if(draft.spec.steps.some(s=>s.source===step.id)){toast('Used by later step');return;}change(()=>{draft!.spec.steps=draft!.spec.steps.filter(s=>s!==step);sheet=null;});}
 function move(offset:number){const step=selected();if(!step||!draft||locked())return;const list=[...draft.spec.steps],index=list.indexOf(step),next=index+offset;if(next<0||next>=list.length)return;[list[index],list[next]]=[list[next],list[index]];const seen=new Set<string>();for(const item of list){if(item.source&&!seen.has(item.source)){toast('Must follow its input');return;}seen.add(item.id);}change(()=>{draft!.spec.steps=list;});}
 async function chooseNote(id:string){const step=selected();if(step?.operation!=='selected_notes'||!draft||locked())return;const expected=generation,target=step;if(step.notes.some((n:Bag)=>n.id===id)){change(()=>{step.notes=step.notes.filter((n:Bag)=>n.id!==id);});return;}if(step.notes.length>=16){toast('16 max');return;}try{const host=owner();
  // The agent's Notes: the revision is the saved record's text, checked again when the approved step reads it.
  if(host.notesSourceMode==='canonical'){const notes=host.canonicalNotesUi;if(!notes?.current)throw new Error('Notes is unavailable. Reconnect your agent, then try again.');const found=noteRows().filter(n=>n.id===id);if(found.length!==1)throw new Error('Note text is unavailable');const revision=await workflowSha([found[0].title,found[0].body]);if(expected!==generation||target!==selected()||locked()||host.canonicalNotesUi!==notes)return;change(()=>{ensureDevice();step.notes.push({id,revision});});return;}
  await host.notesStore?.assertCurrent();const raw=host.notesStore?.raw;if(host.notesStorageFailed||host.notesPending||host.notesRaw!==raw)throw new Error('Notes changed. Reopen Notes before selecting');const found=host.vget('notes').list.filter((n:Bag)=>n.id===id);if(found.length!==1||typeof found[0].title!=='string'||typeof found[0].body!=='string')throw new Error('Note text is unavailable');const revision=await workflowSha([found[0].title,found[0].body]);await host.notesStore.assertCurrent();if(expected!==generation||target!==selected()||locked()||host.notesStore.raw!==raw)return;change(()=>{ensureDevice();step.notes.push({id,revision});});}catch(error){toast((error as Error).message);}}
 async function loadCalendars(request=false){const step=selected();if(step?.operation!=='calendar_range'||locked())return;const token=generation;try{if(request&&(await calendar.requestWorkflowReadAccess()).status!=='granted')throw new Error('Calendar read permission was not granted');const result=await calendar.workflowCalendars();if(token!==generation||selected()!==step)return;if(result.status!=='ready')throw new Error('Choose Connect calendars to grant read access');calendars=result.calendars;status=calendars.length?'Select only the calendars this workflow may read':'No calendars are available on this phone';publish();}catch(error){if(token===generation){status=(error as Error).message;publish();}}}
 async function save(){if(describeOn||!draft||!catalog||locked())return;const binding=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session;if(!binding||!session)return;let spec:PhoneSpec;if(!draft.workflowId)followDeviceClock(draft.spec);const draftAtStart=draft,revisionAtStart=JSON.stringify(draft.spec),generationAtStart=generation;try{spec=normalizePhoneSpec(draft.spec);assertPhoneCapabilities(spec,catalog);await localSaved();if(draft!==draftAtStart||generation!==generationAtStart||JSON.stringify(draft.spec)!==revisionAtStart)return;}catch(error){status=(error as Error).message;publish();return;}const encoded=JSON.stringify(spec);if(review!==encoded){review=encoded;sheet=null;status='Review the steps, then tap Save again. It saves paused, and each phone step still needs your approval.'+(spec.trigger.kind==='time'?' Its schedule stays off until you turn it on.':'');publish();return;}
  const token=generation,expectedCatalog=catalog;controller=new AbortController();const signal=controller.signal;busy=true;publish();const valid=()=>token===generation&&!signal.aborted&&connectionController.getWorkflowClient()?.sessionId===binding.sessionId&&!document.hidden;
  try{const validation=await binding.client.validatePhone(spec,expectedCatalog,signal);if(!valid())return;const pending:Pending={mutationId:crypto.randomUUID(),specDigest:validation.specDigest,compilerRevision:expectedCatalog.compilerRevision,...(draft.workflowId?{workflowId:draft.workflowId,versionId:draft.versionId}:{})};draft.spec=validation.spec;draft.pending=pending;persist();await localSaved();if(!valid())return;const receipt=await binding.client.savePhone(validation.spec,expectedCatalog,pending,signal);if(!valid())return;await committed(receipt.workflowId,token);}
  catch(error){if(valid()){if(error instanceof WorkflowTypedRejected&&draft?.pending){await refused();}else status=draft?.pending?'Unknown':(error as Error).message;toast(status);}}finally{if(token===generation){busy=false;controller=null;publish();}}
 }
 // The agent answered this exact edit with a refusal: it is a known non-save, so the draft unlocks instead of waiting for a receipt that cannot exist.
 async function refused(){if(!draft?.pending)return;delete draft.pending;unreceipted=false;resendReview=false;review=null;persist();try{await localSaved();}catch{/* persist() already reported the storage failure. */}status='Changed on agent';}
 async function committed(id:string,token:number){await localSaved();const target=storage!;const result=await target.secure.secureCompareExchange({slot:target.slot,expectedValue:target.raw,value:null});if(result.status!=='saved')throw new Error('Saved on agent; local draft cleanup needs recovery');target.raw=null;if(token!==generation)return;draft=null;close();await onSaved(id);toast('Saved');}
 async function recover(){if(!draft?.pending||busy)return;const binding=connectionController.getWorkflowClient();if(!binding)return;const token=generation,pending=draft.pending;controller=new AbortController();busy=true;publish();try{const receipt=await binding.client.phoneSaveReceipt(pending,controller.signal);if(token!==generation||binding.sessionId!==connectionController.getWorkflowClient()?.sessionId||document.hidden)return;if(receipt)await committed(receipt.workflowId,token);else{unreceipted=true;resendReview=false;status='Not received · Resend';publish();}}catch{if(token===generation){unreceipted=false;resendReview=false;status='Receipt unavailable';publish();}}finally{if(token===generation){busy=false;controller=null;publish();}}}
 /** Explicit, confirmed repeat of the one pending save under its original mutation identity and reviewed specification. Offered only after the agent reported no record of it. */
 async function resend(){
  if(!draft?.pending||busy||!unreceipted||!catalog)return;const binding=connectionController.getWorkflowClient();if(!binding)return;
  if(catalog.compilerRevision!==draft.pending.compilerRevision){unreceipted=false;resendReview=false;status='Agent updated · locked';publish();return;}
  if(!resendReview){resendReview=true;status='Resend once';publish();return;}
  resendReview=false;const token=generation,pending=draft.pending,capabilities=catalog;let spec:PhoneSpec;try{spec=normalizePhoneSpec(draft.spec);}catch(error){status=(error as Error).message;publish();return;}
  controller=new AbortController();const signal=controller.signal;busy=true;publish();const valid=()=>token===generation&&!signal.aborted&&connectionController.getWorkflowClient()?.sessionId===binding.sessionId&&!document.hidden;
  try{const known=await binding.client.phoneSaveReceipt(pending,signal);if(!valid())return;const receipt=known??await binding.client.savePhone(spec,capabilities,pending,signal);if(!valid())return;await committed(receipt.workflowId,token);}
  catch(error){if(valid()){unreceipted=false;if(error instanceof WorkflowTypedRejected)await refused();else status='Unknown';toast(status);}}
  finally{if(token===generation){busy=false;controller=null;publish();}}
 }
 async function discardDraft(){
  if(!draft||busy||draft.pending)return;
  if(!discard){discard=true;status='';publish();return;}
  const target=storage,token=generation;
  if(!target){toast('Storage issue');return;}
  busy=true;publish();
  try{
   await target.queue;
   if(token!==generation||storage!==target)return;
   const result=await target.secure.secureCompareExchange({slot:target.slot,expectedValue:target.raw,value:null});
   if(result.status!=='saved')throw Error('Changed');
   target.raw=null;target.failed=false;failedWrites.delete(target);
   if(token===generation&&storage===target){const next=requested;draft=null;close();if(next)await open(next.workflow);}
  }catch(error){if(token===generation)toast((error as Error).message);}
  finally{if(token===generation){busy=false;publish();}}
 }
 function cancelGeneration(){if(generating){generation++;controller?.abort();controller=null;busy=false;generating=false;}describeOn=false;generated=null;status='';publish();}
 async function generateDraft(){
  if(!describeOn||!draft||!catalog||locked())return;
  const binding=connectionController.getWorkflowClient();if(!binding)return;
  const baseline=JSON.stringify(draft.spec),token=generation,target=connectionController.getWorkflowDeviceTarget()??undefined,prompt=descriptionPrompt;
  const operations=catalog.palette.flatMap(p=>p.operations.filter(o=>o.available&&offered(o.id)).map(o=>o.id));
  // Unsupported scope is refused on the phone; the request never reaches the agent or its model.
  const scope=checkWorkflowScope(prompt,operations);if(scope.refused){generated=null;status=scope.message;toast('Not supported');publish();return;}
  let existing:PhoneSpec|undefined;try{if(draft.spec.steps.length)existing=normalizePhoneSpec(draft.spec);}catch(error){status=(error as Error).message;publish();return;}
  const capabilities=catalog;controller=new AbortController();const signal=controller.signal;busy=true;generating=true;generated=null;status='';publish();
  const valid=()=>active&&describeOn&&token===generation&&!signal.aborted&&!document.hidden&&binding.sessionId===connectionController.getWorkflowClient()?.sessionId&&JSON.stringify(draft?.spec)===baseline;
  try{await localSaved();if(!valid())return;const spec=await binding.client.generatePhone(prompt,capabilities,operations,signal,existing,target);if(!valid())return;generated=spec;generatedBaseline=baseline;generatedSession=binding.sessionId;status='';}
  catch(error){if(valid()){const message=error instanceof Error?error.message:'Generation failed.';status=message.startsWith('Workflow needs clarification: ')?message.slice('Workflow needs clarification: '.length):error instanceof Error?error.message:'Failed';}}
  finally{if(token===generation){busy=false;generating=false;controller=null;publish();}}
 }
 function useGenerated(){if(!generated||locked()||!draft)return;if(generatedSession!==connectionController.getWorkflowClient()?.sessionId||generatedBaseline!==JSON.stringify(draft.spec)||JSON.stringify(generated.device)!==JSON.stringify(connectionController.getWorkflowDeviceTarget()??undefined)){generated=null;status='Changed';publish();return;}const spec=generated;change(()=>{draft!.spec={...spec,trigger:draft!.spec.trigger};generated=null;describeOn=false;sheet=null;});}
 /** The owner sets when the workflow runs; generation never does. Only triggers this agent offers are selectable. */
 function chooseTrigger(kind:string){if(!draft||!catalog||locked())return;const offered=catalog.triggers.find(t=>t.kind===kind);if(!offered?.available||!['manual','time'].includes(kind)){toast(offered?.reason||'Not on this agent');return;}if(draft.spec.trigger.kind===kind)return;change(()=>{draft!.spec.trigger=kind==='time'?{kind:'time',localTime:'08:00',timeZone:deviceTimeZone(),days:[1,2,3,4,5]}:{kind:'manual'};});}
 function editTime(edit:(trigger:PhoneTimeTrigger)=>PhoneTimeTrigger|null){const trigger=draft?.spec.trigger;if(!trigger||trigger.kind!=='time'||locked())return;const next=edit(trigger);if(next)change(()=>{draft!.spec.trigger=next;});}
 function toggleDay(day:number){editTime(trigger=>{const days=trigger.days.includes(day)?trigger.days.filter(d=>d!==day):[...trigger.days,day].sort((a,b)=>a-b);if(!days.length){toast('Pick a day');return null;}return {...trigger,days};});}
 function triggerSheet(api:Bag){const trigger=draft?.spec.trigger??{kind:'manual' as const};const time=trigger.kind==='time'?trigger:null;
  return {kinds:(catalog?.triggers??[]).filter(t=>t.available).map(t=>{const on=trigger.kind===t.kind;return {label:TRIGGER_LABELS[t.kind]??t.kind,d:t.kind==='time'?api.ic.clock:api.ic.play,pressed:on,css:on?'background:var(--acc);color:#fff':'background:var(--s2)',pick:()=>t.kind==='manual'&&on?toast('Manual'):chooseTrigger(t.kind)};}),
   text:time?[workflowClockContext(time.timeZone),describePhoneTrigger(time)+'.',(note=>note?note+' ':'')(phoneTriggerClockChangeNote(time))+SCHEDULE_POLICY].filter(Boolean).join(' '):'Manual',isTime:!!time,isEvent:false,isPlace:false,isMsg:false,isEmail:false,
   days:time?WEEKDAYS.map(([day,label])=>{const on=time.days.includes(day);return {label,pressed:on,css:on?'background:var(--fg);color:var(--bg)':'background:var(--s2)',pick:()=>toggleDay(day)};}):[],
   time:time?.localTime??'',tMinus:()=>editTime(t=>({...t,localTime:shiftLocalTime(t.localTime,-15)})),tPlus:()=>editTime(t=>({...t,localTime:shiftLocalTime(t.localTime,15)}))};}
 function field(label:string,value:string,onChange:(value:string)=>void,type='text',multiline=false){return {label,value,type,multiline,single:!multiline,change:(event:Bag)=>(()=>{try{change(()=>onChange(String(event.target.value)));}catch(error){toast(error instanceof Error?error.message:'Invalid time');}})()};}
 /** The owner-facing save review: where it saves, when it runs and each step. The full specification stays under Technical details. */
 function reviewSummary(spec:PhoneSpec):string{
  const target=draft?.workflowId?`Replaces ${targetName||spec.name}`:'';
  const when=spec.trigger.kind==='time'?describePhoneTrigger(spec.trigger):'Manual';
  return [target,when,...spec.steps.map((step,i)=>`${i+1}. ${WORKFLOW_OPERATION_LABELS[step.operation]??step.operation.replaceAll('_',' ')}`)].filter(Boolean).join('\n');
 }
 function render(api:Bag){const step=selected(),index=step&&draft?draft.spec.steps.indexOf(step):-1,fields:Bag[]=[];if(step){
  if(step.operation==='supplied_text')fields.push(field('Text',step.text,v=>step.text=v,'text',true));
  if(step.operation==='contains')fields.push(field('Text to match',step.text,v=>step.text=v));
  if(step.operation==='compose_draft')fields.push(field('Before',step.prefix,v=>step.prefix=v,'text',true),field('After',step.suffix,v=>step.suffix=v,'text',true));
  if(step.operation==='model_draft')fields.push(field('Drafting instruction',step.instruction,v=>step.instruction=v,'text',true));
  if(step.operation==='app_notification')fields.push(field('Notification title',step.title,v=>step.title=v));
  if(step.operation==='save_note')fields.push(field('New note title',step.title,v=>step.title=v));
  if(step.operation==='selected_reminders')fields.push(field('Max',String(step.scope.maximumItems),v=>step.scope.maximumItems=Number(v),'number'));
  if(step.operation==='calendar_range'){fields.push(field('Range start',automationLocalDateInput(step.range.start),v=>step.range.start=localDate(v).toISOString(),'datetime-local'),field('Range end',automationLocalDateInput(step.range.end),v=>step.range.end=localDate(v).toISOString(),'datetime-local'),field('Max',String(step.range.maximumEvents),v=>step.range.maximumEvents=Number(v),'number'));}
 }
 const generatedSteps=generated?.steps.map((s,i)=>{
  const input=s.source?'Input: step '+(generated!.steps.findIndex(p=>p.id===s.source)+1)+'\n':'';
  const title:Record<string,string>={...WORKFLOW_OPERATION_LABELS,calendar_range:'Read Calendar range'};
  let text='';
  if(s.operation==='supplied_text')text=s.text;
  else if(s.operation==='selected_notes')text=s.notes.map((n:Bag)=>noteRows().find(note=>note.id===n.id)?.title||n.id).join('\n');
  else if(s.operation==='selected_reminders')text='Due today\n'+'Up to '+s.scope.maximumItems+' reminders';
  else if(s.operation==='calendar_range')text=workflowLocalInstant(s.range.start)+'–'+workflowLocalInstant(s.range.end)+'\nUp to '+s.range.maximumEvents+' events\nCalendars: '+s.range.calendarIds.map((id:string)=>calendars.find(c=>c.id===id)?.name||id).join(', ');
  else if(s.operation==='contains')text='Match: '+JSON.stringify(s.text)+'\n'+(s.caseSensitive?'Case-sensitive':'Ignore letter case');
  else if(s.operation==='compose_draft')text='Prefix: '+JSON.stringify(s.prefix)+'\nSuffix: '+JSON.stringify(s.suffix);
  else if(s.operation==='model_draft')text=s.instruction;
  else if(s.operation==='save_note'||s.operation==='app_notification')text='Title: '+s.title;
  return {title:(i+1)+'. '+title[s.operation],text:input+text};
 })??[];
 const enabledOptions=step?catalog?.palette.find(p=>p.kind===step.kind)?.operations??[]:[];
 const rows:Bag[]=draft?.spec.steps.map(s=>({k:s.kind,t:`${s.kind}: ${s.operation.replaceAll('_',' ')}`,d:api.ic[icons[s.kind]],dotCss:'background:var(--s2)',boxCss:'background:var(--s2)',tap:()=>{if(locked())return;sheet=s.id;review=null;if(s.operation==='calendar_range')void loadCalendars();publish();}}))??[];
 rows.unshift({k:'When',t:draft?.spec.trigger.kind==='time'?describePhoneTrigger(draft.spec.trigger):'Manual',d:api.ic.clock,dotCss:'background:var(--s2)',boxCss:'background:var(--s2)',tap:()=>{if(locked())return;sheet='trigger';review=null;publish();}});
 return {typed:true,fullEditor:true,metadataOnly:false,name:draft?.spec.name||'',onName:(event:Bag)=>change(()=>{draft!.spec.name=String(event.target.value);}),description:draft?.spec.description||'',onDescription:(event:Bag)=>change(()=>{draft!.spec.description=String(event.target.value);}),saveOff:describeOn||locked()||!draft||!draft.spec.steps.length,saveCss:describeOn||locked()?'background:var(--s2);color:var(--mut)':'background:var(--acc);color:#fff',save,cancel:close,typedStatus:status,typedReview:review?reviewSummary(JSON.parse(review)):'',typedSpecification:review?JSON.stringify(JSON.parse(review),null,2):'',hasTypedReview:!!review,unknown:!!draft?.pending,refresh:recover,canResend:!!draft?.pending&&unreceipted&&!busy,resend,resendLabel:resendReview?'Confirm resend':'Resend',discard:discardDraft,canDiscard:!!draft&&!draft.pending&&!busy,discardLabel:discard?'Confirm discard':'Discard',canDescribe:catalog?.generationProtocol===1,steps:rows,palette:palette.map(k=>({k,d:api.ic[icons[k]],label:'Add '+k+' step',add:()=>add(k)})),hasApps:false,
   // `empty` is the template's only gate for the Describe button: offered whenever the draft can change, steps or not.
   // describe() and generateDraft send the current draft as the existing one.
   empty:!!draft&&!describeOn&&!locked(),describe:()=>{if(locked()||!draft)return;if(catalog?.generationProtocol!==1){toast('Not on your agent');return;}describeOn=true;generated=null;review=null;status='Sent to your agent';publish();},describeOn,descriptionPrompt,onGenerationPrompt:(event:Bag)=>{if(generating){generation++;controller?.abort();controller=null;busy=false;generating=false;}descriptionPrompt=String(event.target.value);generated=null;status='';publish();},generateDraft,cancelGeneration,generating,generateLabel:generating?'Generating…':'Generate draft',generateCss:locked()||!descriptionPrompt.trim()?'background:var(--s2);color:var(--mut)':'background:var(--acc);color:#fff',generationOff:locked()||!descriptionPrompt.trim(),generatedName:generated?.name||'',generatedDescription:generated?.description||'',generatedSteps,generatedReview:generated?JSON.stringify(generated,null,2):'',hasGenerated:!!generated,useGenerated,sheetOn:!!sheet,closeSheet:()=>{sheet=null;publish();},isTrig:sheet==='trigger',isStep:!!step,
  tr:triggerSheet(api),
  sp:step?{typed:true,freeTextStyle:"display:none",k:step.kind,d:api.ic[icons[step.kind]],up:()=>move(-1),down:()=>move(1),upCss:index===0?'opacity:.3':'',downCss:index===draft!.spec.steps.length-1?'opacity:.3':'',presets:enabledOptions.map(o=>({label:o.label||o.id.replaceAll('_',' '),css:o.id===step.operation?'background:var(--acc);color:#fff':o.available&&offered(o.id)?'background:var(--s2)':'background:var(--s2);opacity:.5',pick:()=>chooseOperation(o.id)})),text:'',onText:()=>{},fields,hasSource:!!step.source,sources:draft!.spec.steps.slice(0,index).map(s=>({label:s.kind+': '+s.operation.replaceAll('_',' '),selected:step.source===s.id,pick:()=>change(()=>{step.source=s.id;})})),caseMatch:step.operation==='contains',caseLabel:step.caseSensitive?'Case-sensitive match':'Ignore letter case',toggleCase:()=>change(()=>{step.caseSensitive=!step.caseSensitive;}),isNotes:step.operation==='selected_notes',notes:step.operation==='selected_notes'?noteRows().map((n:Bag)=>({label:n.title||'Untitled note',selected:step.notes.some((chosen:Bag)=>chosen.id===n.id),pick:()=>void chooseNote(n.id)})):[],isCalendar:step.operation==='calendar_range',connectCalendars:()=>void loadCalendars(true),calendars:step.operation==='calendar_range'?calendars.map(c=>({label:c.name+' · '+c.account,selected:step.range.calendarIds.includes(c.id),pick:()=>change(()=>{const chosen=step.range.calendarIds;step.range.calendarIds=chosen.includes(c.id)?chosen.filter((id:string)=>id!==c.id):chosen.length<16?[...chosen,c.id]:chosen;})})):[],del:remove}:null};
 }
 return {get active(){return active;},open,close,render,flushForAppUpdate};
}

type AgentStatusShell = {S():{view?:string|null};openView(view:string,patch?:Record<string,unknown>|null,chat?:unknown,opts?:{push?:boolean}):unknown};
/** Where a tap on an unavailable agent goes. Product Android hides the connection chooser, so it opens
 * Settings > Agent connection (Back returns to the calling view); development and browser builds keep the chooser. */
export function showAgentStatus(shell:AgentStatusShell|null|undefined){
 if(!shell||!Capacitor.isNativePlatform()||testMocksEnabled){connectionController.open();return;}
 const from=shell.S().view;
 shell.openView('settings',{page:'agent-connection'},undefined,{push:!!from&&from!=='settings'});
}
