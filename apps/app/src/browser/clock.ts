import {layoutBrowserDialog} from './dialog-layout';
import {createInlineModal} from '../runtime/inline-modal';
import {browserScreenLocked} from './screen-locked';
import type {BrowserDaily} from './daily';
import type {BrowserNotifications} from './notifications';
import {BrowserAlertAudio} from './alert-audio';
import {alertSoundDocument} from './preference-documents';
import {testMocksEnabled} from '../build-flags';
type Alarm={id:string;title:string;at:number;status:string;revision:string;pendingDeletion?:string};
const ringingAlarms=(rows:Alarm[])=>rows.filter(row=>row.id.startsWith('alarm_')&&row.status==='posted'&&!row.pendingDeletion).map(row=>row.id+':'+row.revision).sort().join('|');
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
   this.rows=(await this.daily.listReminders()).reminders.filter(row=>row.id.startsWith('alarm_')&&['scheduled','posted','permission-denied'].includes(row.status)) as Alarm[];
   if(!this.allowed())return;this.loaded=true;this.render();const ringing=ringingAlarms(this.rows);
   if(!ringing){this.stopSound();this.owns=false;this.ringing='';this.release?.();this.release=undefined;}
   else if(this.owns){if(ringing!==this.ringing)this.ring(ringing);}
   else if(navigator.locks){void navigator.locks.request('alpha.browser.alarm-owner',{ifAvailable:true},async lock=>{if(!lock||!this.allowed()||this.owns)return;const current=ringingAlarms((await this.daily.listReminders()).reminders);if(!current||!this.allowed())return;this.owns=true;await new Promise<void>(resolve=>{this.release=resolve;this.ring(current);});});}
   const notices=(await this.notifications.list()).items.filter(n=>!n.id.startsWith('alarm_'));
   if(!this.allowed())return;
   const active=notices.map(n=>n.source+':'+n.id+':'+n.revision.split(':')[0]),initial=()=>({seen:[] as string[]}),before=await alertSoundDocument.read(initial);
   // Unchanged polling must not invent records or advance recovery revisions.
   if(!active.some(key=>!before.seen.includes(key)))return;
   const fresh=await alertSoundDocument.edit(initial,data=>{const fresh=active.some(key=>!data.seen.includes(key));data.seen=[...data.seen.filter(key=>!active.includes(key)).slice(-(500-active.length)),...active];return fresh;});if(fresh&&this.allowed())this.audio.play('ring');
  }catch(error){if(this.status)this.status.textContent='Alarms could not refresh. Try again.';}finally{this.polling=false;}
 }
 private ring(key:string){this.ringing=key;this.stopSound();this.open();this.audio.play('alarm');const started=performance.now();this.soundTimer=setInterval(()=>{if(!this.owns||!this.allowed()||performance.now()-started>=60000)this.stopSound();else this.audio.play('alarm');},1000);}
 private async run(task:()=>Promise<string|void>){if(this.busy)return;this.busy=true;this.render();try{const message=await task();if(this.status)this.status.textContent=message||'';await this.poll();}catch{if(this.status)this.status.textContent='The alarm could not be saved. Try again.';}finally{this.busy=false;this.render();}}
 private render(){if(this.save)this.save.disabled=this.busy;if(!this.list)return;const key=JSON.stringify([this.rows,this.busy,this.loaded]);if(key===this.rendered)return;this.rendered=key;this.list.replaceChildren();for(const row of this.rows){const item=document.createElement('section');item.style.cssText='padding:16px 0;border-bottom:1px solid var(--line,#ddd)';const title=document.createElement('strong');title.textContent=row.title;const when=document.createElement('p');when.textContent=row.status==='posted'?'Ringing':(row.status==='permission-denied'?'Notifications off · ':'')+new Date(row.at).toLocaleString();item.append(title,when);const action=(label:string,kind:'cancel'|'dismiss'|'snooze')=>{const b=this.button(label);b.disabled=this.busy;b.onclick=()=>void this.run(async()=>{const result=await this.daily.clockDecision({id:row.id,revision:row.revision,action:kind,minutes:Number(this.snooze)});if(result.status==='stale')throw Error('Alarm changed');});item.append(b);};if(row.status==='posted'){action('Snooze '+row.title,'snooze');action('Dismiss '+row.title,'dismiss');}else action('Delete '+row.title,'cancel');this.list.append(item);}if(!this.rows.length)this.list.textContent=this.loaded?'':'Loading alarms…';}
 private button(label:string){const b=document.createElement('button');b.textContent=label;b.style.cssText='min-height:44px;margin:4px;padding:10px 14px;border:1px solid #aaa;border-radius:12px;font:inherit;color:inherit;background:var(--s2,#eee)';return b;}
 open(){
  if(!this.allowed())return;if(this.dialog?.open){void this.poll();return;}
  const dialog=this.dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Clock alarms');dialog.style.cssText='box-sizing:border-box;width:min(380px,94vw);max-height:85dvh;overflow:auto;border:0;border-radius:22px;padding:22px;background:var(--bg,#fff);color:var(--fg,#111);font:16px/1.4 system-ui';const shell=document.querySelector('.os');if(shell){const theme=getComputedStyle(shell);for(const key of ['--bg','--fg','--s2','--line','--acc','--mut'])dialog.style.setProperty(key,theme.getPropertyValue(key));}
  const title=document.createElement('h2');title.textContent='Alarms';title.style.cssText='font-size:24px;margin:0 0 8px';
  // C-14: a browser tab is not an alarm clock. allowed() rings only in a visible foreground page.
  const caveat=document.createElement('span');caveat.textContent='Preview';caveat.title='Rings while this preview is open';caveat.style.cssText='font-size:12px;padding:4px 8px;border-radius:12px;background:var(--s2);color:var(--mut)';
  const close=this.button('');close.setAttribute('aria-label','Back');close.style.cssText='display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border:0;padding:0;background:transparent;color:inherit';const backIcon=document.createElement('span');backIcon.setAttribute('aria-hidden','true');backIcon.style.cssText='display:block;width:24px;height:24px;background:currentColor;mask:url(/icons/lucide/chevron-left.svg) center/contain no-repeat';close.append(backIcon);close.onclick=()=>{this.stopSound();dialog.close();};
  const saved=document.createElement('section');
  this.rendered='';this.list=document.createElement('div');saved.append(this.list);
  const form=document.createElement('section');form.style.marginTop='16px';
  const time=document.createElement('input');time.type='time';time.value='07:00';time.setAttribute('aria-label','Alarm time');
  const label=document.createElement('input');label.maxLength=200;label.placeholder='Optional label';label.setAttribute('aria-label','Alarm label');
  this.snooze='10';
  for(const [name,field] of [['Time',time],['Label',label]] as const){const row=document.createElement('label');row.textContent=name;row.style.cssText='display:block;margin:10px 0';row.append(field);form.append(row);}
  const snoozeLabel=document.createElement('p');snoozeLabel.textContent='Snooze · 10 minutes';snoozeLabel.style.cssText='font-size:14px;color:var(--mut);margin-top:16px';

  for(const field of [time,label])field.style.cssText='box-sizing:border-box;width:100%;min-height:44px;margin:4px 0 0;padding:8px 10px;border:0;border-radius:16px;font:inherit;color:inherit;background:var(--s2,#eee)';
  const save=this.save=this.button('Save');save.setAttribute('aria-label','Save alarm');save.style.cssText+=';margin-left:auto;border:0;border-radius:22px;background:var(--fg,#111);color:var(--bg,#fff)';
  save.onclick=()=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)){this.status!.textContent='Choose an alarm time.';return;}const [hour,minute]=time.value.split(':').map(Number);void this.run(async()=>{const result=await this.daily.clockHandoff({action:'set',hour,minute,label:label.value,reviewed:true});if(result.status!=='opened')throw Error(result.message);return result.message==='Alarm saved.'?'':result.message;});};
  this.status=document.createElement('p');this.status.setAttribute('role','status');const header=document.createElement('header');header.className='alarm-page-header';header.append(close,title,caveat,save);dialog.append(header,saved,form,snoozeLabel,this.status);const previous=document.activeElement as HTMLElement|null;const modal=createInlineModal(()=>{this.stopSound();dialog.close();},()=>previous);dialog.oncancel=()=>this.stopSound();dialog.onclose=()=>{modal.ref(null);dialog.remove();if(this.dialog===dialog){this.dialog=undefined;this.list=undefined;this.status=undefined;this.save=undefined;}if(!shell)previous?.focus();};layoutBrowserDialog(dialog,[]);
  dialog.classList.add('alarm-page');
  if(shell){dialog.setAttribute('role','dialog');Object.assign(dialog.style,{position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:'35',borderRadius:'inherit',paddingBottom:'calc(var(--alpha-dock-reserve, 108px) + 20px)'});(shell.querySelector('[data-screen]')||shell).prepend(dialog);dialog.show();modal.ref(dialog);}
  else{document.body.append(dialog);dialog.showModal();}
  close.focus();this.render();void this.poll();
 }
}
