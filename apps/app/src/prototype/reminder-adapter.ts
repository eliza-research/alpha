import {reviewOwnNoticeQuestion} from './own-notice-question';
import {deletions,refreshDeletionViews,reminderDeletionRefusal} from '../runtime/deletions';
import { alphaClient } from '../runtime/alpha-client';
import { connectionController } from '../runtime/connection-ui';
import {reminderCreations,retainReminderCreation,discardUndispatchedCreation,checkReminderCreation,reconcileReminderCreations,retireRefusedCreation,isReminderRefusal,reminderWallTime,reminderEvents,overdueReminders,undatedTodos,reminderRefusalMessage,reopenSchedule,isUndatedReminder,reminderDueAt as dueOf,type ReminderCreation,type ReminderRefusal} from '../runtime/reminder-creations';
// Pure reminder helpers (events, overdue, to-dos, refusal reasons, reopen) live in reminder-creations.
import { DailyApps, type Reminder } from '../daily';
import { pendingReminderDeletions,retainReminderDeletion,acknowledgeReminderDeletion,reconcileReminderDeletions,discardUndispatchedReminderDeletion } from '../runtime/reminder-deletions';
import { Capacitor } from '@capacitor/core';
import {rememberNoteOrigin,forgetNoteOrigin} from './note-origin-adapter';
type Bag = any;
/** Native reminders use the reference calendar form, timeline and detail sheet. */
export function installReminderAdapter(Component: Bag, views: Bag) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount;
  // Open the same native reminder form from Calendar or the unified automation list.
  // This creates a draft only; the existing Save flow owns storage and scheduling.
  p.newDeviceReminderDraft=function(){
    const date=new Date();date.setHours(date.getHours()+1,0,0,0);
    const today=new Date();today.setHours(0,0,0,0);const day=new Date(date);day.setHours(0,0,0,0);
    this.vset('calendar',{month:null,open:null,form:{id:null,title:'',off:Math.round((day.getTime()-today.getTime())/86400000),t:date.getHours(),d:1,where:'',video:false,who:[],cal:'alpha-reminders',repeat:'none',alert:0,notes:''}});
  };
  const render = views.calendar.render;
  views.calendar.state = { ...views.calendar.state, events: [] };
  let owner: Bag;
  const events = (rows: Reminder[]) => reminderEvents(rows);
  let closeNoticeQuestion:(()=>void)|undefined;
  let tapBusy=false, tapRequested=false, tapInteraction=0;
  const interaction=()=>{tapInteraction++;};
  for(const name of ['openView','goHome','back']){const original=p[name];p[name]=function(...args:Bag[]){tapInteraction++;return original.apply(this,args);};}
  const sameTarget=(a:Bag,b:Bag)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
  async function checkReminderTap(explicit=false) {
    if(closeNoticeQuestion)return;
    if(tapBusy){if(explicit)tapRequested=true;return;}
    const shell=owner;
    if(!Capacitor.isNativePlatform()||!shell?.live||document.hidden||connectionController.getSnapshot().open||alphaClient.getState().context.sensitive||shell.vget('calendar').form)return;
    const initialView=shell.S().view, initialOpen=shell.vget('calendar').open, interactionAt=tapInteraction;
    const current=()=>tapInteraction===interactionAt&&owner===shell&&shell.live&&!document.hidden&&!connectionController.getSnapshot().open&&!alphaClient.getState().context.sensitive&&!shell.vget('calendar').form&&shell.S().view===initialView&&shell.vget('calendar').open===initialOpen;
    tapBusy=true;
    try {
      const capability=await DailyApps.surfaceInfo();
      if(!current()||capability.reminderTapVersion!==1)return;
      const pending=await DailyApps.pendingReminderTap();
      if(!current())return;
      shell.vset('calendar',{reminderTapPending:!!pending.token,reminderTapToken:pending.token});
      if(!pending.token)return;
      if(!pending.retained||!pending.target){if(explicit)shell.toast('The original reminder changed. Its notification link is retained without opening a replacement.');return;}
      const result=await DailyApps.listReminders();
      if(!current())return;
      const selected=result.reminders.find(row=>sameTarget(row.target,pending.target));
      if(!selected){if(explicit)shell.toast('The exact reminder is unavailable. Its notification link is retained.');return;}
      const confirmation=await DailyApps.pendingReminderTap();
      if(!current()||confirmation.token!==pending.token||!confirmation.retained||!sameTarget(confirmation.target,pending.target))return;
      const rows=[...(shell.nativeCalendarRows||[]),...events(result.reminders)];
      const target=rows.find(row=>row.alphaReminderId===selected.id&&sameTarget(row.reminderTarget,pending.target));
      if(!target)return;
      shell.openView('calendar',{open:target.id,day:target.off,openDay:target.off,events:rows});
      const openingInteraction=tapInteraction;
      await new Promise<void>(resolve=>shell.setState({},resolve));
      // Consume only after the exact detail is visible. Native rechecks the current
      // source, occurrence and revision; a newer queued tap cannot be consumed here.
      if(tapInteraction!==openingInteraction||owner!==shell||!shell.live||document.hidden||shell.S().view!=='calendar'||shell.vget('calendar').open!==target.id)return;
      if(pending.question){
        const session=connectionController.getSnapshot().session,enrollment=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        if(!session){shell.toast('Select an agent before asking about this reminder. The notification is retained.');return;}
        const live=()=>owner===shell&&shell.live&&!document.hidden&&!connectionController.getSnapshot().open&&!alphaClient.getState().context.sensitive&&connectionController.getSnapshot().session===session&&JSON.stringify(connectionController.getWorkflowDeviceTarget())===enrollment&&shell.S().view==='calendar'&&shell.vget('calendar').open===target.id;
        closeNoticeQuestion=reviewOwnNoticeQuestion({notice:{id:selected.id,revision:pending.target.revision,source:'own',title:selected.title,text:selected.body||'',appLabel:'Alpha Phone'},current:live,recheck:async()=>{
          const again=await DailyApps.pendingReminderTap();if(!live()||again.token!==pending.token||!again.question||!again.retained||!sameTarget(again.target,pending.target))return false;
          const fresh=await DailyApps.listReminders();return live()&&fresh.reminders.some(row=>sameTarget(row.target,pending.target)&&row.title===selected.title&&(row.body||'')===(selected.body||''));
        },consume:()=>DailyApps.consumeReminderTap({token:pending.token!}),release:()=>DailyApps.releaseReminderQuestion({token:pending.token!}),compose:draft=>shell.api(shell.S().view).composeContentQuestion(draft),report:message=>shell.toast(message),closed:()=>{closeNoticeQuestion=undefined;
          // Refresh only the saved-link banner from native; never reopen the review here.
          void DailyApps.pendingReminderTap().then(next=>{if(owner===shell&&shell.live)shell.vset('calendar',{reminderTapPending:!!next.token,reminderTapToken:next.token});}).catch(()=>{});}});
        return;
      }
      await DailyApps.consumeReminderTap({token:pending.token});
      if(owner===shell&&shell.live)shell.vset('calendar',{reminderTapPending:false});
    } catch {if(current())shell.vset('calendar',{reminderTapPending:true});}
    finally{tapBusy=false;if(tapRequested){tapRequested=false;queueMicrotask(()=>void checkReminderTap(true));}}
  }
  /** Home agenda rows for due, unhandled reminders (data-adapter reads this). Title, calendar id and due instant only. */
  p.overdueReminders = function () {
    return overdueReminders(this.reminderRows||[]).map(r=>{const row=reminderEvents([r])[0];return row?{id:row.id,title:r.title,off:row.off,at:dueOf(r)}:null;}).filter(Boolean);
  };
  p.refreshReminders = async function (openId?: string, occurrenceId?: string) {
    // Resume and calendar refresh may supersede the notification's fetch.
    // Keep its navigation intent until the latest successful fetch consumes it.
    if (openId) {this.pendingReminderOpenId = openId;this.pendingReminderOccurrenceId=occurrenceId;}
    const generation = this.reminderRefreshGeneration = (this.reminderRefreshGeneration || 0) + 1;
    try {
      const reminderDeleteUnknown=await reconcileReminderDeletions();
      let reminderCreateUnknown=Object.values(await reminderCreations()).filter(r=>r.state==='pending').length;
      try{reminderCreateUnknown=await reconcileReminderCreations();}catch{/* Retain creation uncertainty when readback is unavailable. */}
      if (!this.live || generation !== this.reminderRefreshGeneration) return;
      this.reminderCreateUnknown=reminderCreateUnknown;
      this.vset('calendar',{reminderCreateUnknown});
      this.reminderDeleteUnknown=reminderDeleteUnknown;
      this.vset('calendar',{reminderDeleteUnknown});
      if (Capacitor.getPlatform() === 'web' && !Capacitor.isPluginAvailable('DailyApps')) {this.vset('calendar',{reminderStale:false});return;}
      if(this.reminderTodoVersion===undefined)try{this.reminderTodoVersion=(await DailyApps.surfaceInfo() as {reminderTodoVersion?:number}).reminderTodoVersion??0;}catch{/* Unknown native support hides to-dos. */}
      const result = await DailyApps.listReminders();
      if (!this.live || generation !== this.reminderRefreshGeneration) return;
      this.reminderTargets=new Map(result.reminders.map(r=>[r.id,r.target]));
      this.reminderRows=result.reminders;
      const rows = [...(this.nativeCalendarRows || []), ...events(result.reminders)];
      this.reminderRefreshFailed = false;
      this.vset('calendar', { events: rows, reminderStale:false, reminderDeleteUnknown });
      const pendingOpenId = this.pendingReminderOpenId;
      if (pendingOpenId) {
        const target = rows.find(e => e.alphaReminderId === pendingOpenId && (!this.pendingReminderOccurrenceId || e.reminderOccurrence===this.pendingReminderOccurrenceId));
        this.pendingReminderOpenId = undefined;this.pendingReminderOccurrenceId=undefined;
        this.openView('calendar', target ? { open:target.id, day:target.off, openDay:target.off, events:rows } : {events:rows});
      }
    } catch {
      if (!this.live || generation !== this.reminderRefreshGeneration) return;
      this.vset('calendar', {reminderStale:true});
      if (!this.reminderRefreshFailed) this.toast('Reminders could not refresh. Previously loaded reminders may be out of date.');
      this.reminderRefreshFailed = true;
    }
  };
  p.componentDidMount = function () {
    mount.call(this); owner=this;
    window.addEventListener('pointerdown',interaction,true);window.addEventListener('keydown',interaction,true);
    void this.refreshReminders();void checkReminderTap();
    let chooserOpen=connectionController.getSnapshot().open;
    this.reminderTapConnection=connectionController.subscribe(()=>{const next=connectionController.getSnapshot().open;if(chooserOpen&&!next)queueMicrotask(()=>void checkReminderTap(true));chooserOpen=next;});
    this.reminderCommittedHandler=()=>{if(this.live)void this.refreshReminders();};
    window.addEventListener('alpha:reminders-committed',this.reminderCommittedHandler);
    window.addEventListener('alpha:reminders-document-changed',this.reminderCommittedHandler);
    this.reminderListener=DailyApps.addListener('reminderOpened', r=>void this.refreshReminders(r.id,r.occurrenceId)).catch(()=>null);
    this.reminderResume=DailyApps.addListener('appResumed', ()=>{void this.refreshReminders();void checkReminderTap();}).catch(()=>null);
    this.reminderTapVisible=()=>{if(!document.hidden)void checkReminderTap();};document.addEventListener('visibilitychange',this.reminderTapVisible);
    this.reminderTapListener=DailyApps.addListener('pendingReminderTap',()=>void checkReminderTap(true)).catch(()=>null);
  };
  p.componentWillUnmount = function () {
    closeNoticeQuestion?.();closeNoticeQuestion=undefined;
    this.reminderTapConnection?.();
    document.removeEventListener('visibilitychange',this.reminderTapVisible);
    window.removeEventListener('pointerdown',interaction,true);window.removeEventListener('keydown',interaction,true);
    void this.reminderTapListener?.then((l:Bag)=>l?.remove());
    void this.reminderListener?.then((l:Bag)=>l?.remove()); void this.reminderResume?.then((l:Bag)=>l?.remove());
    window.removeEventListener('alpha:reminders-committed',this.reminderCommittedHandler);
    window.removeEventListener('alpha:reminders-document-changed',this.reminderCommittedHandler);
    if(owner===this)owner=null;unmount.call(this);
  };
  views.calendar.render = function (state: Bag, api: Bag) {
    const out = render(state,api);
    out.reminderTapPending=!!state.reminderTapPending;
    out.checkReminderTap=()=>void checkReminderTap(true);
    out.dismissReminderTap=async()=>{
      const shell=owner,token=state.reminderTapToken;
      if(!shell?.live||!token||document.hidden||shell.S().view!=='calendar'||shell.vget('calendar').form)return;
      if(!window.confirm('Dismiss this saved notification link? The reminder itself will not change.'))return;
      const epoch=tapInteraction;
      try{
        await DailyApps.dismissReminderTap({token});
        const pending=await DailyApps.pendingReminderTap();
        if(owner===shell&&shell.live&&epoch===tapInteraction)shell.vset('calendar',{reminderTapPending:!!pending.token,reminderTapToken:pending.token});
      }catch{if(owner===shell&&shell.live)shell.toast('The notification link could not be dismissed. Refresh and retry.');}
    };
    out.reminderDeleteUnknown=Number(owner?.reminderDeleteUnknown??state.reminderDeleteUnknown??0);
    out.checkReminderDeletions=()=>void owner?.refreshReminders();
    const rows:Reminder[]=owner?.reminderRows||[];
    out.overdueReminders=overdueReminders(rows,api.now??Date.now()).map(r=>({title:r.title,label:'Overdue',due:new Date(dueOf(r)).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),open:()=>{const row=reminderEvents([r])[0];api.set({open:row.id,day:row.off,openDay:row.off});}}));
    out.hasOverdueReminders=out.overdueReminders.length>0;
    // Undated to-dos: listed without a calendar day; native support only (reminderTodoVersion 1).
    out.todoAvailable=owner?.reminderTodoVersion===1;
    const todoBusy=()=>!!owner?.reminderSaving;
    const todoDecision=async(r:Reminder,action:'done'|'reopen'|'cancel')=>{
      const todoOwner=owner;if(!todoOwner||todoBusy()||!r.target)return;
      if(action==='cancel'&&!window.confirm(`Delete the to-do “${r.title}”?`))return;
      todoOwner.reminderSaving=true;
      try{
        const result=await DailyApps.todoDecision({target:r.target,action});
        const saved=(await DailyApps.listReminders()).reminders.find(row=>row.id===r.id);
        const expected=action==='done'?'completed':action==='reopen'?'todo':'cancelled';
        if(result.status!==expected||(expected!=='cancelled'&&(saved?.status as string)!==expected)||(expected==='cancelled'&&saved))throw Error('To-do readback mismatch');
        if(owner===todoOwner&&todoOwner.live){await todoOwner.refreshReminders();api.toast(action==='done'?'To-do completed.':action==='reopen'?'To-do reopened.':'To-do deleted.');}
      }catch{if(owner===todoOwner&&todoOwner.live){await todoOwner.refreshReminders();api.toast('This to-do changed or could not be saved. Check it and try again.');}}
      finally{todoOwner.reminderSaving=false;}
    };
    out.todos=undatedTodos(rows).map(r=>({id:r.id,title:r.title,body:r.body,done:r.status==='completed',complete:()=>void todoDecision(r,'done'),reopen:()=>void todoDecision(r,'reopen'),remove:()=>void todoDecision(r,'cancel')}));
    out.hasTodos=out.todos.length>0;
    out.addTodo=async(title:string,body='')=>{
      const todoOwner=owner,text=String(title||'').trim();if(!todoOwner||!text||todoBusy())return;
      if(todoOwner.reminderTodoVersion!==1){api.toast('Update Alpha to save undated to-dos. Nothing was saved.');return;}
      // A retried save reuses the same ID; native treats an identical retry as idempotent.
      const attempt=todoOwner.todoAttempt?.title===text&&todoOwner.todoAttempt?.body===body?todoOwner.todoAttempt:{id:crypto.randomUUID(),title:text,body};
      todoOwner.todoAttempt=attempt;todoOwner.reminderSaving=true;
      try{
        let response:{status:string}|undefined;
        try{response=await DailyApps.saveTodo({id:attempt.id,title:text,body});}catch{/* Readback decides. */}
        const saved=(await DailyApps.listReminders()).reminders.find(r=>r.id===attempt.id);
        if(!saved&&isReminderRefusal(response?.status)){todoOwner.todoAttempt=undefined;if(owner===todoOwner)api.toast(reminderRefusalMessage(response.status as ReminderRefusal).replace('This reminder','This to-do'));return;}
        if(!saved||!isUndatedReminder(saved))throw Error('To-do save unconfirmed');
        todoOwner.todoAttempt=undefined;
        if(owner===todoOwner&&todoOwner.live){await todoOwner.refreshReminders();api.toast('To-do saved on this device. No date or alert.');}
      }catch{if(owner===todoOwner&&todoOwner.live)api.toast('To-do save is unconfirmed. Try again; the same to-do will not be duplicated.');}
      finally{todoOwner.reminderSaving=false;}
    };
    out.reminderCreateUnknown=Number(owner?.reminderCreateUnknown??state.reminderCreateUnknown??0);
    out.checkReminderCreations=()=>void owner?.refreshReminders();
    if(out.f) {
      const f=state.form;
      if(f.cal==='alpha-reminders'&&owner?.reminderSaving)out.f.saveOff=true;
      out.f.cals.push({domain:'reminders',name:'Reminders',dot:'var(--acc)',css:f.cal==='alpha-reminders'?'background:var(--fg);color:var(--bg)':'background:var(--bg)',pick:()=>{const original=api.get('calendar').form;const {canonicalOwnerKey,canonicalEventKey,expectedProviderVersion,canonicalTiming,canonicalAllDay,...kept}=original;const next={...kept,cal:'alpha-reminders',repeat:'none',alert:0};api.set({form:owner?.calendarFormDestinationChanged?.(original,next)??next});}});
      if(f.cal==='alpha-reminders') out.f.save=async()=>{
        if(owner?.reminderSaving)return;
        const current=api.get('calendar').form;
        if(current?.alphaReminderId&&(api.get('calendar').reminderStale||owner?.reminderRefreshFailed)){api.toast('Refresh reminders before changing this saved reminder.');void owner?.refreshReminders();return;}
        if(!current?.title?.trim())return;
        const formAdmission=owner?.calendarFormAdmitted?.(current);

        const unchangedSchedule=current.alphaReminderId&&current.reminderEditSchedule&&JSON.stringify([current.off,current.t,current.repeat,current.alert])===JSON.stringify(current.reminderEditSchedule);
        const saveEdit=async(schedule?:{at:number;recurrence:any;dueAt:number;alertMinutes:number|null})=>{
          if(!current.reminderEditTarget){api.toast('Refresh and reopen this reminder before saving.');return;}
          const editSession=current.reminderEditSession,saveOwner=owner;
          if(!saveOwner||!editSession)return;
          const draftSignature=(form:Bag)=>JSON.stringify([form?.title,form?.notes,form?.off,form?.t,form?.repeat,form?.alert,form?.cal]);
          const signature=draftSignature(current);
          const sameEditor=()=>owner===saveOwner&&saveOwner.live&&!document.hidden&&api.isActive()&&api.get('calendar').form?.reminderEditSession===editSession&&draftSignature(api.get('calendar').form)===signature;
          if(!sameEditor())return;
          saveOwner.reminderSaving=true;api.set({});
          let createdInput:Bag=null,dispatched=false,editSaved=false;
          try{
            const operation={type:'reminder_update' as const,target:current.reminderEditTarget,fields:{title:current.title.trim(),body:current.notes||'',...(schedule?{schedule}:{})}};
            const pending=Object.values(await pendingReminderDeletions()).find(input=>Object.entries(operation.target).every(([key,value])=>input.operation.target[key as keyof typeof input.operation.target]===value));
            if(!sameEditor())return;
            let input=editSession.attempt||pending;
            if(input&&JSON.stringify(input.operation)!==JSON.stringify(operation)){api.toast('The previous edit must be checked before saving this changed draft. Check action status in Calendar, then reopen the reminder.');return;}
            if(!input){
              const selected=await DailyApps.selectedReminder({id:current.alphaReminderId});
              if(!sameEditor())return;
              if(Object.entries(operation.target).some(([key,value])=>selected[key as keyof typeof selected]!==value)){api.toast('This reminder changed. Reopen it before saving.');await saveOwner.refreshReminders();return;}
              if(schedule&&current.reminderStatus==='completed'&&!window.confirm('This reminder is completed. Schedule a new occurrence at the reviewed time?'))return;
              if(!sameEditor())return;
              const bindingHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(operation))))).map(v=>v.toString(16).padStart(2,'0')).join('');
              if(!sameEditor())return;
              input={operationId:crypto.randomUUID(),bindingHash,operation};createdInput=input;editSession.attempt=input;
              await retainReminderDeletion(input);
              if(!sameEditor())return;
            }
            let response;
            if(!createdInput)response=await DailyApps.reminderOperationReceipt(input);
            else try{dispatched=true;response=await DailyApps.operateReminder(input);}catch{response=await DailyApps.reminderOperationReceipt(input);}
            if(response.status!=='succeeded'||!response.result)throw Error('Unconfirmed reminder update');
            await acknowledgeReminderDeletion(input,response.result);
            const active=sameEditor();
            editSaved=true;
            if(owner===saveOwner&&saveOwner.live){await saveOwner.refreshReminders();api.toast(active?(response.result.status==='pending'?'Saved with no alert.':response.result.status==='permission-denied'?'Saved, notifications disabled. Enable notifications then review this reminder again.':response.result.status==='scheduling-failed'?'Saved, scheduling failed. Review this reminder before retrying.':schedule?'Reminder rescheduled · approximate delivery':'Reminder updated. Schedule unchanged.'):'The reviewed reminder edit was saved. Later draft changes were not saved.');}
          }catch{if(owner===saveOwner&&saveOwner.live)api.toast('Reminder edit is unconfirmed. Check action status in Calendar; it will not be repeated.');}
          finally{
            if(createdInput&&!dispatched)try{await discardUndispatchedReminderDeletion(createdInput);if(editSession.attempt===createdInput)delete editSession.attempt;}catch{/* Preserve uncertain persistence and its exact attempt. */}
            if(owner===saveOwner&&saveOwner.live)try{saveOwner.reminderDeleteUnknown=Object.keys(await pendingReminderDeletions()).length;api.set({reminderDeleteUnknown:saveOwner.reminderDeleteUnknown});}catch{}
            saveOwner.reminderSaving=false;
            if(owner===saveOwner&&saveOwner.live)api.set({});
            // Keep the editor visible until refreshed targets and the mutation lock settle.
            if(editSaved&&sameEditor()){saveOwner.calendarFormCommitted?.(api.get('calendar').form,formAdmission);api.set({form:null});}
          }
        };
        if(unchangedSchedule){await saveEdit();return;}
        const date=reminderWallTime(Number(current.off||0),Number(current.t)),alertMinutes=current.alert===null?null:Number(current.alert||0),lead=alertMinutes??0;
        if(!date||!Number.isFinite(lead)||lead<0){api.toast('This local time does not exist because the clocks change. Choose another reminder time. Nothing was saved.');return;}
        // Alert lead is elapsed time before a valid event instant, including across DST.
        const recurrence = current.repeat==='none' ? undefined : {
          rule:current.repeat,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          date:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
          time:`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`,leadMinutes:lead
        };
        if(recurrence?.rule==='weekdays' && [0,6].includes(date.getDay())){api.toast('Choose a weekday for the first reminder. Nothing was saved.');return;}
        const dueAt=date.getTime();date.setTime(dueAt-lead*60000);
        if(!current.alphaReminderId){
          const createOwner=owner;if(!createOwner)return;
          createOwner.reminderSaving=true;api.set({});
          const id=current.reminderCreationId||crypto.randomUUID();
          const request={id,title:current.title.trim(),body:current.notes||'',at:date.getTime(),dueAt,alertMinutes,...(recurrence?{recurrence}:{})};
          const signature=JSON.stringify([current.title,current.notes,current.off,current.t,current.repeat,current.alert,current.cal]);
          let matchesAttempt=true;
          const active=()=>matchesAttempt&&owner===createOwner&&createOwner.live&&!document.hidden&&api.isActive()&&api.get('calendar').form?.reminderCreationId===id&&JSON.stringify([api.get('calendar').form.title,api.get('calendar').form.notes,api.get('calendar').form.off,api.get('calendar').form.t,api.get('calendar').form.repeat,api.get('calendar').form.alert,api.get('calendar').form.cal])===signature;
          let created:ReminderCreation|null=null,dispatched=false,scheduled=false,notificationsBlocked=false;
          try{
            if(!current.reminderCreationId){
              let timingVersion:unknown;
              try{timingVersion=(await DailyApps.surfaceInfo()).reminderTimingVersion;}catch{/* Unknown native support cannot dispatch an explicit alert. */}
              if(owner!==createOwner||!createOwner.live||!api.isActive()||api.get('calendar').form!==current||document.hidden)return;
              if(timingVersion!==2){api.toast('Update Alpha to save reminders with this alert setting. Nothing was saved.');return;}
              const pending=Object.values(await reminderCreations()).filter(row=>row.state==='pending');
              if(owner!==createOwner||!createOwner.live||!api.isActive()||api.get('calendar').form!==current||document.hidden)return;
              if(pending.length&&!window.confirm('A previous reminder creation is unconfirmed and may already exist. Create a separate new reminder? The previous attempt will remain available for status checks.'))return;
              if(owner!==createOwner||!createOwner.live||!api.isActive()||api.get('calendar').form!==current||document.hidden)return;
              api.set({form:{...current,reminderCreationId:id}});
              created={id,request,state:'pending'};
              await retainReminderCreation(created);
              if(!active())return;
              dispatched=true;
              let refusal:ReminderRefusal|undefined;
              try{const response=await DailyApps.scheduleReminder(request);scheduled=(response.status==='scheduled'||response.status==='pending')&&response.id===id;notificationsBlocked=response.status==='permission-denied'&&response.id===id;if(response.id===id&&isReminderRefusal(response.status))refusal=response.status;}catch{/* Recovery reads only; never reschedule an unknown attempt. */}
              // A definite refusal whose ID is confirmed absent is retired, so refused attempts
              // never accumulate as unknown creations. The draft stays open for another time.
              if(refusal&&await retireRefusedCreation(id,refusal)){
                if(owner===createOwner&&createOwner.live){api.toast(reminderRefusalMessage(refusal));if(api.get('calendar').form?.reminderCreationId===id)api.set({form:{...api.get('calendar').form,reminderCreationId:undefined}});}
                return;
              }
            }
            const retained=(await reminderCreations())[id];
            matchesAttempt=!!retained&&JSON.stringify(retained.request)===JSON.stringify(request);
            const found=await checkReminderCreation(id);
            if(found!=='found')throw Error('Creation outcome unknown');
            // Only the reminder this exact reviewed draft created is linked to the note it came from.
            if(current.origin&&matchesAttempt&&!await rememberNoteOrigin('reminder',id,current.origin)&&owner===createOwner&&createOwner.live)api.toast('Reminder saved. The link to its note could not be saved.');
            if(active()){createOwner.calendarFormCommitted?.(api.get('calendar').form,formAdmission);api.set({form:null});}
            if(owner===createOwner&&createOwner.live){await createOwner.refreshReminders();api.toast(!matchesAttempt?'The previous reminder was found. This edited draft was not saved. Close it to start a separate reminder.':notificationsBlocked?'Reminder saved; notifications are disabled. Enable notifications, then review its time.':scheduled?(alertMinutes===null?'Reminder saved with no alert.':'Reminder scheduled · approximate delivery'):alertMinutes===null?'The saved reminder was found. No alert is enabled.':'The saved reminder was found. Delivery is not verified.');}
          }catch{
            if(owner===createOwner&&createOwner.live)api.toast('Reminder creation is unconfirmed. Check new reminder status in Calendar; it will not be created again automatically.');
          }finally{
            if(created&&!dispatched){
              try{await discardUndispatchedCreation(created);if(owner===createOwner&&api.get('calendar').form?.reminderCreationId===id)api.set({form:{...api.get('calendar').form,reminderCreationId:undefined}});}catch{/* Preserve uncertain persistence; never create again automatically. */}
            }
            if(owner===createOwner&&createOwner.live)try{createOwner.reminderCreateUnknown=Object.values(await reminderCreations()).filter(row=>row.state==='pending').length;api.set({reminderCreateUnknown:createOwner.reminderCreateUnknown});}catch{}
            createOwner.reminderSaving=false;
            if(owner===createOwner&&createOwner.live)api.set({});
          }
          return;
        }
        await saveEdit({at:date.getTime(),recurrence:recurrence||null,dueAt,alertMinutes});
      };
    }
    const event=(state.events||[]).find((e:Bag)=>e.id===state.open);
    if(event?.alphaReminderId && out.ev) {
      out.ev.calName='Reminders';
      const requireFresh=()=>{if(!api.get('calendar').reminderStale&&!owner?.reminderRefreshFailed)return true;api.toast('Refresh reminders before changing this saved reminder.');void owner?.refreshReminders();return false;};
      if(state.reminderStale||owner?.reminderRefreshFailed){out.ev.hasNotes=true;out.ev.notes='This reminder may be out of date. Return to Calendar and tap Retry.\n'+(out.ev.notes||'');}
      out.ev.recurringReminder=!!event.reminderOccurrence;
      out.ev.reminderActionable=!!event.reminderOccurrence&&event.reminderStatus!=='completed';
      out.ev.reminderPolicy=event.reminderRecurrence ? `Repeats ${event.reminderRecurrence.rule} in ${event.reminderRecurrence.zone}. ${event.alert===null?'Next occurrence is saved with no alert after Done.':'Next occurrence is scheduled after Done.'} Last 32 completion receipts are retained.` : event.reminderStatus==='completed'?'Completed · no further alarm scheduled. Last 32 completion receipts are retained.':'One-time reminder. Done completes it without scheduling another alarm.';
      out.ev.reminderHistory=(event.reminderHistory||[]).map((h:Bag)=>({text:`Completed ${new Date(h.completedAt).toLocaleString()} · due ${new Date(h.dueAt).toLocaleString()}${h.skippedDates?` · ${h.skippedDates} elapsed repeat dates skipped`:''}`}));
      const renderedDecisionTarget=event.reminderTarget?structuredClone(event.reminderTarget):undefined;
      const decide=async(action:'done'|'snooze')=>{
        if(!requireFresh()||owner?.reminderSaving)return;
        if(action==='snooze'&&event.alert===null){api.toast('Edit this reminder to enable an alert before snoozing.');return;}
        if(!renderedDecisionTarget){api.toast('Refresh and reopen this reminder before changing it.');return;}
        const decisionOwner=owner;
        const stillSelected=()=>owner===decisionOwner&&decisionOwner?.live&&!document.hidden&&api.isActive()&&api.get('calendar').open===event.id&&!api.get('calendar').form;
        if(!stillSelected())return;
        decisionOwner.reminderSaving=true;
        let createdInput:Bag=null,dispatched=false;
        try{
          const operation={type:action==='done'?'reminder_complete' as const:'reminder_snooze' as const,target:renderedDecisionTarget};
          const pending=Object.values(await pendingReminderDeletions()).find(input=>Object.keys(renderedDecisionTarget).every(key=>input.operation.target[key as keyof typeof input.operation.target]===renderedDecisionTarget[key]));
          if(pending&&pending.operation.type!==operation.type)throw Error('Another action on this revision is unconfirmed');
          let input=pending;
          if(!input){
            const current=await DailyApps.selectedReminder({id:event.alphaReminderId});
            if(Object.keys(renderedDecisionTarget).some(key=>current[key as keyof typeof current]!==renderedDecisionTarget[key])){await decisionOwner.refreshReminders();api.toast('This reminder changed. Review it again before changing it.');return;}
            if(!stillSelected())return;
            const bindingHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(operation))))).map(v=>v.toString(16).padStart(2,'0')).join('');
            if(!stillSelected())return;
            input={operationId:crypto.randomUUID(),bindingHash,operation};createdInput=input;
            await retainReminderDeletion(input);
            if(!stillSelected())return;
          }
          let response;
          if(pending)response=await DailyApps.reminderOperationReceipt(input);
          else try{dispatched=true;response=await DailyApps.operateReminder(input);}catch{response=await DailyApps.reminderOperationReceipt(input);}
          if(response.status!=='succeeded'||!response.result)throw Error('Unconfirmed reminder action');
          await acknowledgeReminderDeletion(input,response.result);
          if(owner===decisionOwner&&decisionOwner.live){
            await decisionOwner.refreshReminders();
            const status=response.result.status;
            api.toast(status==='permission-denied'?'Saved, notifications disabled. Enable notifications then review this reminder again.':status==='scheduling-failed'?'Saved, scheduling failed. Review this reminder before retrying.':action==='snooze'?'Snoozed 10 minutes · approximate delivery':status==='completed'?'Completed. No further alarm scheduled.':status==='pending'?'Completed. Next occurrence saved with no alert.':'Completed. Next occurrence scheduled.');
          }
        }catch{
          if(owner===decisionOwner&&decisionOwner.live)api.toast('Reminder action is unconfirmed. Check action status in Calendar; it will not be repeated.');
        }finally{
          if(createdInput&&!dispatched)try{await discardUndispatchedReminderDeletion(createdInput);}catch{/* Preserve uncertain storage; never clear another operation. */}
          if(owner===decisionOwner&&decisionOwner.live)try{decisionOwner.reminderDeleteUnknown=Object.keys(await pendingReminderDeletions()).length;api.set({reminderDeleteUnknown:decisionOwner.reminderDeleteUnknown});}catch{}
          decisionOwner.reminderSaving=false;
        }
      };
      out.ev.reminderCanSnooze=event.alert!==null;out.ev.reminderDone=()=>decide('done');out.ev.reminderSnooze=()=>decide('snooze');
      // Reopen a completed one-off through a reviewed reminder_update, then read it back.
      const reopen=async(mode:'open'|'tomorrow')=>{
        if(!requireFresh()||owner?.reminderSaving)return;
        if(!renderedDecisionTarget||event.reminderStatus!=='completed'||event.reminderRecurrence){api.toast('Refresh and reopen this reminder before changing it.');return;}
        const schedule=reopenSchedule({dueAt:Number(event.reminderDueAt),alertMinutes:event.alert===null?null:Number(event.alert||0)},mode);
        if(!schedule){api.toast('That local time does not exist tomorrow because the clocks change. Edit the reminder to choose a time. Nothing was saved.');return;}
        const reopenOwner=owner;
        const stillSelected=()=>owner===reopenOwner&&reopenOwner?.live&&!document.hidden&&api.isActive()&&api.get('calendar').open===event.id&&!api.get('calendar').form;
        if(!stillSelected())return;
        const when=new Date(schedule.dueAt).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
        if(!window.confirm(mode==='open'?`Reopen “${event.title}” with no alert? It stays open, due ${when}.`:`Reopen “${event.title}” and alert ${when}? Delivery is approximate.`))return;
        if(!stillSelected())return;
        // The reviewed time must still be in the future; never shift it silently after review.
        if(schedule.at<=Date.now()){api.toast('The reviewed time passed while this was open. Reopen it again to choose a new time. Nothing was saved.');return;}
        reopenOwner.reminderSaving=true;
        let createdInput:Bag=null,dispatched=false;
        try{
          const operation={type:'reminder_update' as const,target:renderedDecisionTarget,fields:{title:event.title,body:event.reminderBody||'',schedule}};
          const pending=Object.values(await pendingReminderDeletions()).find(input=>Object.keys(renderedDecisionTarget).every(key=>input.operation.target[key as keyof typeof input.operation.target]===renderedDecisionTarget[key]));
          if(pending&&JSON.stringify(pending.operation)!==JSON.stringify(operation))throw Error('Another action on this revision is unconfirmed');
          let input=pending;
          if(!input){
            const current=await DailyApps.selectedReminder({id:event.alphaReminderId});
            if(Object.keys(renderedDecisionTarget).some(key=>current[key as keyof typeof current]!==renderedDecisionTarget[key])){await reopenOwner.refreshReminders();api.toast('This reminder changed. Review it again before reopening it.');return;}
            if(!stillSelected())return;
            const bindingHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(operation))))).map(v=>v.toString(16).padStart(2,'0')).join('');
            if(!stillSelected())return;
            input={operationId:crypto.randomUUID(),bindingHash,operation};createdInput=input;
            await retainReminderDeletion(input);
            if(!stillSelected())return;
          }
          let response;
          if(pending)response=await DailyApps.reminderOperationReceipt(input);
          else try{dispatched=true;response=await DailyApps.operateReminder(input);}catch{response=await DailyApps.reminderOperationReceipt(input);}
          if(response.status!=='succeeded'||!response.result)throw Error('Unconfirmed reminder reopen');
          await acknowledgeReminderDeletion(input,response.result);
          // Readback: the same reminder ID now holds a new open occurrence at the reviewed due time.
          const saved=(await DailyApps.listReminders()).reminders.find(r=>r.id===event.alphaReminderId);
          if(!saved||saved.status==='completed'||saved.occurrenceId===event.reminderOccurrence||saved.dueAt!==schedule.dueAt)throw Error('Reopen readback mismatch');
          if(owner===reopenOwner&&reopenOwner.live){
            await reopenOwner.refreshReminders();
            api.toast(saved.status==='pending'?'Reopened with no alert.':saved.status==='permission-denied'?'Reopened, notifications disabled. Enable notifications then review this reminder again.':saved.status==='scheduling-failed'?'Reopened, scheduling failed. Review this reminder before retrying.':'Reopened · approximate delivery');
          }
        }catch{
          if(owner===reopenOwner&&reopenOwner.live)api.toast('Reopen is unconfirmed. Check action status in Calendar; it will not be repeated.');
        }finally{
          if(createdInput&&!dispatched)try{await discardUndispatchedReminderDeletion(createdInput);}catch{/* Preserve uncertain storage; never clear another operation. */}
          if(owner===reopenOwner&&reopenOwner.live)try{reopenOwner.reminderDeleteUnknown=Object.keys(await pendingReminderDeletions()).length;api.set({reminderDeleteUnknown:reopenOwner.reminderDeleteUnknown});}catch{}
          reopenOwner.reminderSaving=false;
        }
      };
      out.ev.reminderReopenable=event.reminderStatus==='completed'&&!event.reminderRecurrence&&!!renderedDecisionTarget;
      out.ev.reminderReopen=()=>reopen('open');out.ev.reminderReopenTomorrow=()=>reopen('tomorrow');
      out.ev.edit=()=>{if(!requireFresh())return;const repeat=event.reminderRecurrence?.rule||'none',target=event.reminderTarget;api.set({form:{...event,repeat,id:event.id,cal:'alpha-reminders',where:'',video:false,who:[],notes:event.reminderBody||'',alphaReminderId:event.alphaReminderId,reminderEditSession:{uncertain:false},reminderEditTarget:target?structuredClone(target):undefined,reminderEditSchedule:[event.off,event.t,repeat,event.alert]}});};
      const renderedTarget=event.reminderTarget?structuredClone(event.reminderTarget):undefined;
      out.ev.del=async()=>{
        if(!requireFresh()||owner?.reminderSaving)return;
        if(!renderedTarget){api.toast('Refresh and reopen this reminder before deleting.');return;}
        const deleteOwner=owner;
        const stillSelected=()=>owner===deleteOwner&&deleteOwner?.live&&!document.hidden&&api.isActive()&&api.get('calendar').open===event.id;
        if(!stillSelected())return;
        deleteOwner.reminderSaving=true;
        try {
          const pending=Object.values(await pendingReminderDeletions()).find(input=>Object.keys(renderedTarget).every(key=>input.operation.target[key as keyof typeof input.operation.target]===renderedTarget[key]));
          if(pending&&pending.operation.type!=='reminder_cancel')throw Error('Another action on this revision is unconfirmed');
          if(!pending){
            const reviewed=await deletions.reviewReminder({target:renderedTarget});
            if(reviewed.status==='queued'){if(stillSelected())api.set({open:null});refreshDeletionViews();api.toast('Reminder alert paused. Undo is available for 10 seconds.');return;}
            if(reviewed.status==='cancelled')return;
            // Definite refusals before admission: nothing was staged, so no uncertain outcome is reported.
            const refusal=reminderDeletionRefusal(reviewed.status);
            if(refusal){if(reviewed.status==='stale'&&owner===deleteOwner&&deleteOwner.live)await deleteOwner.refreshReminders();if(owner===deleteOwner&&deleteOwner.live)api.toast(refusal);return;}
            throw Error('Deletion outcome requires review.');
          }
          // Older uncertain operations retain their original receipt-only reconciliation.
          const input=pending,result=await DailyApps.reminderOperationReceipt(input);
          if(result.status!=='succeeded'||!result.result)throw Error('Unconfirmed reminder cancellation');
          await acknowledgeReminderDeletion(input,result.result);
          void forgetNoteOrigin('reminder',event.alphaReminderId);
          if(stillSelected())api.set({open:null});
          if(owner===deleteOwner&&deleteOwner.live){await deleteOwner.refreshReminders();api.toast('Reminder cancelled');}
        }catch{
          if(owner===deleteOwner&&deleteOwner.live){
            api.set({reminderDeleteUnknown:Object.keys(await pendingReminderDeletions()).length});
            api.toast('Deletion is unconfirmed. Check action status in Calendar; no cancellation will be repeated.');
          }
        }finally{
          if(owner===deleteOwner&&deleteOwner.live)try{deleteOwner.reminderDeleteUnknown=Object.keys(await pendingReminderDeletions()).length;api.set({reminderDeleteUnknown:deleteOwner.reminderDeleteUnknown});}catch{}
          deleteOwner.reminderSaving=false;
        }
      };
    }
    return out;
  };
}
