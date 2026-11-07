import {layoutBrowserDialog} from './dialog-layout';
import {browserScreenLocked} from './screen-locked';
import type {BrowserDaily} from './daily';
import type {BrowserNotifications} from './notifications';
import {BrowserAlertAudio} from './alert-audio';
import {alertSoundDocument} from './preference-documents';
import {testMocksEnabled} from '../build-flags';
type Alarm={id:string;title:string;at:number;status:string;revision:string};
/** One foreground owner rings alarms; all tabs share the existing reminder records. */
export class BrowserClock {
 private rows:Alarm[]=[];
 private dialog?:HTMLDialogElement;
 private list?:HTMLElement;
 private status?:HTMLElement;
 private polling=false;
 private busy=false;
 private rendered='';
 private loaded=false;
 private save?:HTMLButtonElement;
 private snooze='10';
 private owns=false;
 private release?:()=>void;
 private ringing='';
 private soundTimer?:ReturnType<typeof setInterval>;
 private audio=new BrowserAlertAudio();
 constructor(private daily:BrowserDaily,private notifications:BrowserNotifications){
  window.addEventListener('alpha:clock-open',()=>this.open());window.addEventListener('alpha:alarms-changed',()=>void this.poll());window.addEventListener('alpha:reminders-document-changed',()=>void this.poll());
  window.addEventListener('pagehide',()=>this.retire());
  // HOME (AP-15) closes alarm settings left open in the app it leaves; a ringing alarm stays until it is stopped or snoozed.
  window.addEventListener('launcher-home',()=>{if(!this.ringing)this.dialog?.close();});
  window.addEventListener('alpha:device-state',()=>{this.retire();});document.addEventListener('visibilitychange',()=>{if(document.hidden)this.retire();else void this.poll();});
  window.addEventListener('storage',event=>{if(event.key==='alpha.browser.reminders.v1')void this.poll();});setInterval(()=>void this.poll(),1000);
 }
 private allowed(){return !document.hidden&&document.documentElement.dataset.devBackground!=='true'&&!(testMocksEnabled&&document.documentElement.dataset.connectionMode==='mock')&&!browserScreenLocked();}
 private stopSound(){clearInterval(this.soundTimer);this.soundTimer=undefined;this.audio.stop();}
 private retire(){this.stopSound();this.dialog?.close();this.owns=false;this.ringing='';this.release?.();this.release=undefined;}
 private async poll(){
  if(this.polling||!this.allowed())return;this.polling=true;
  try{
   this.rows=(await this.daily.listReminders()).reminders.filter(row=>row.id.startsWith('alarm_')&&['scheduled','posted'].includes(row.status)) as Alarm[];
   if(!this.allowed())return;this.loaded=true;this.render();const ringing=this.rows.filter(r=>r.status==='posted').map(r=>r.id+':'+r.revision).sort().join('|');
   if(!ringing){this.stopSound();this.owns=false;this.ringing='';this.release?.();this.release=undefined;}
   else if(this.owns){if(ringing!==this.ringing)this.ring(ringing);}
   else if(navigator.locks){void navigator.locks.request('alpha.browser.alarm-owner',{ifAvailable:true},async lock=>{if(!lock||!this.allowed()||this.owns)return;const current=(await this.daily.listReminders()).reminders.filter(row=>row.id.startsWith('alarm_')&&row.status==='posted').map(row=>row.id+':'+row.revision).sort().join('|');if(!current||!this.allowed())return;this.owns=true;await new Promise<void>(resolve=>{this.release=resolve;this.ring(current);});});}
   const notices=(await this.notifications.list()).items.filter(n=>!n.id.startsWith('alarm_'));
   if(!this.allowed())return;
   const active=notices.map(n=>n.source+':'+n.id+':'+n.revision.split(':')[0]),initial=()=>({seen:[] as string[]}),before=await alertSoundDocument.read(initial);
   // Unchanged polling must not invent records or advance recovery revisions.
   if(!active.some(key=>!before.seen.includes(key)))return;
   const fresh=await alertSoundDocument.edit(initial,data=>{const fresh=active.some(key=>!data.seen.includes(key));data.seen=[...data.seen.filter(key=>!active.includes(key)).slice(-(500-active.length)),...active];return fresh;});if(fresh&&this.allowed())this.audio.play('ring');
  }catch(error){if(this.status)this.status.textContent='Alarms could not refresh. Try again.';}finally{this.polling=false;}
 }
 private ring(key:string){this.ringing=key;this.stopSound();this.open();this.audio.play('alarm');const started=performance.now();this.soundTimer=setInterval(()=>{if(!this.owns||!this.allowed()||performance.now()-started>=60000)this.stopSound();else this.audio.play('alarm');},1000);}
 private async run(task:()=>Promise<unknown>){if(this.busy)return;this.busy=true;this.render();try{await task();if(this.status)this.status.textContent='';await this.poll();}catch{if(this.status)this.status.textContent='The alarm could not be saved. Try again.';}finally{this.busy=false;this.render();}}
 private render(){if(this.save)this.save.disabled=this.busy;if(!this.list)return;const key=JSON.stringify([this.rows,this.busy,this.loaded]);if(key===this.rendered)return;this.rendered=key;this.list.replaceChildren();for(const row of this.rows){const item=document.createElement('section');item.style.cssText='padding:16px 0;border-bottom:1px solid var(--line,#ddd)';const title=document.createElement('strong');title.textContent=row.title;const when=document.createElement('p');when.textContent=row.status==='posted'?'Ringing':new Date(row.at).toLocaleString();item.append(title,when);const action=(label:string,kind:'cancel'|'dismiss'|'snooze')=>{const b=this.button(label);b.disabled=this.busy;b.onclick=()=>void this.run(async()=>{const result=await this.daily.clockDecision({id:row.id,revision:row.revision,action:kind,minutes:Number(this.snooze)});if(result.status==='stale')throw Error('Alarm changed');});item.append(b);};if(row.status==='posted'){action('Snooze '+row.title,'snooze');action('Dismiss '+row.title,'dismiss');}else action('Delete '+row.title,'cancel');this.list.append(item);}if(!this.rows.length)this.list.textContent=this.loaded?'No alarms':'Loading alarms…';}
 private button(label:string){const b=document.createElement('button');b.textContent=label;b.style.cssText='min-height:44px;margin:4px;padding:10px 14px;border:1px solid #aaa;border-radius:12px;font:inherit;color:inherit;background:var(--s2,#eee)';return b;}
 open(){
  if(!this.allowed())return;if(this.dialog?.open){void this.poll();return;}
  const dialog=this.dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Clock alarms');dialog.style.cssText='box-sizing:border-box;width:min(380px,94vw);max-height:85dvh;overflow:auto;border:0;border-radius:22px;padding:22px;background:var(--bg,#fff);color:var(--fg,#111);font:16px/1.4 system-ui';const shell=document.querySelector('.os');if(shell){const theme=getComputedStyle(shell);for(const key of ['--bg','--fg','--s2','--line','--acc','--mut'])dialog.style.setProperty(key,theme.getPropertyValue(key));}
  const title=document.createElement('h2');title.textContent='Alarms';title.style.cssText='font-size:24px;margin:0 0 8px';
  // C-14: a browser tab is not an alarm clock. allowed() rings only in a visible foreground page.
  const caveat=document.createElement('p');caveat.textContent='Alarms ring only while this page is open in the foreground.';caveat.style.cssText='font-size:14px;margin:0 0 16px;color:var(--mut,currentColor)';
  const close=this.button('Cancel');close.onclick=()=>{this.stopSound();dialog.close();};
  const saved=document.createElement('section'),savedTitle=document.createElement('h3');savedTitle.textContent='Saved alarms';savedTitle.style.cssText='font-size:17px;margin:0 0 8px';
  this.rendered='';this.list=document.createElement('div');saved.append(savedTitle,this.list);
  const form=document.createElement('section'),formTitle=document.createElement('h3');formTitle.textContent='New alarm';formTitle.style.cssText='font-size:17px;margin:20px 0 8px';form.append(formTitle);
  const time=document.createElement('input');time.type='time';time.value='07:00';time.setAttribute('aria-label','Alarm time');
  const label=document.createElement('input');label.maxLength=200;label.placeholder='Optional label';label.setAttribute('aria-label','Alarm label');
  const snooze=document.createElement('input');snooze.type='number';snooze.min='1';snooze.max='60';snooze.value=this.snooze;snooze.setAttribute('aria-label','Snooze minutes');snooze.oninput=()=>{this.snooze=snooze.value;};
  for(const [name,field] of [['Time',time],['Label',label]] as const){const row=document.createElement('label');row.textContent=name;row.style.cssText='display:block;margin:10px 0';row.append(field);form.append(row);}
  const snoozeLabel=document.createElement('label');snoozeLabel.textContent='Snooze (min)';snoozeLabel.style.cssText='display:block;margin:16px 0 0';snoozeLabel.append(snooze);
  const hint=document.createElement('p');hint.textContent='Used when you snooze a ringing alarm.';hint.style.cssText='font-size:13px;margin:4px 0 0';
  for(const field of [time,label,snooze])field.style.cssText='box-sizing:border-box;width:100%;min-height:44px;margin:4px 0 0;padding:8px 10px;border:1px solid var(--line,#aaa);border-radius:10px;font:inherit;color:inherit;background:var(--s2,#eee)';
  const save=this.save=this.button('Save alarm');save.style.cssText+=';background:var(--acc,#0000ff);border-color:transparent;color:#fff';
  save.onclick=()=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)){this.status!.textContent='Choose an alarm time.';return;}const [hour,minute]=time.value.split(':').map(Number);void this.run(()=>this.daily.clockHandoff({action:'set',hour,minute,label:label.value,reviewed:true}));};
  this.status=document.createElement('p');this.status.setAttribute('role','status');dialog.append(title,caveat,saved,form,snoozeLabel,hint,this.status);const previous=document.activeElement as HTMLElement|null;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();this.stopSound();dialog.close();};window.addEventListener('alpha-back',back,true);dialog.oncancel=()=>this.stopSound();dialog.onclose=()=>{window.removeEventListener('alpha-back',back,true);dialog.remove();if(this.dialog===dialog){this.dialog=undefined;this.list=undefined;this.status=undefined;this.save=undefined;}previous?.focus();};layoutBrowserDialog(dialog,[close,save]);document.body.append(dialog);dialog.showModal();close.focus();this.render();void this.poll();
 }
}
