import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as reminderJournal from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';

// Run the real ReminderAdapter refresh with only its native and service dependencies replaced.
const adapterCode=stripTypeScriptTypes(readFileSync('apps/app/src/prototype/reminder-adapter.ts','utf8').replace(/^import .*?;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const presentationFile=readFileSync('apps/app/src/runtime/reminder-creations.ts','utf8');
const presentationCode=stripTypeScriptTypes(presentationFile.slice(presentationFile.indexOf('export function reminderEvents('),presentationFile.indexOf('/** Specific, stable reason')).replace(/^export /gm,''),{mode:'transform'});

function fixture(){
 const calendar={},opened=[],toasts=[],reads=[],clock={now:1_000_000};
 const reminder={id:'tapped',title:'Tapped reminder',body:'',at:clock.now+3600_000,dueAt:clock.now+3600_000,alertMinutes:0,status:'scheduled',occurrenceId:'one',target:{reminderId:'tapped'}};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
 class Shell{live=true;view='home';reminderTodoVersion=1;componentDidMount(){}componentWillUnmount(){}S(){return {view:this.view};}vget(){return calendar;}vset(_,patch){Object.assign(calendar,patch);}openView(view,patch){this.view=view;opened.push({view,...patch});}goHome(){this.view='home';}back(){}setState(_,done){done?.();}toast(text){toasts.push(text);}}
 const document={hidden:false,addEventListener(){},removeEventListener(){}};
 const context={Shell,views:{calendar:{state:{},render:()=>({})}},Date:FixedDate,document,window:{addEventListener(){},removeEventListener(){}},
  Capacitor:{getPlatform:()=>'android',isNativePlatform:()=>false,isPluginAvailable:()=>true},
  connectionController:{getSnapshot:()=>({open:false}),subscribe:()=>()=>{}},alphaClient:{getState:()=>({context:{sensitive:false}})},
  reminderCreations:async()=>({}),reconcileReminderCreations:async()=>0,reconcileReminderDeletions:async()=>0,
  dueOf:reminderJournal.reminderDueAt,isUndatedReminder:reminderJournal.isUndatedReminder,overdueReminders:reminderJournal.overdueReminders,undatedTodos:reminderJournal.undatedTodos,
  // Each listReminders call waits until the test settles it.
  DailyApps:{listReminders:()=>new Promise((resolve,reject)=>reads.push({ok:()=>resolve({reminders:[reminder]}),fail:()=>reject(Error('Secure store locked'))})),addListener:async()=>({remove(){}})},
  queueMicrotask,console};
 vm.createContext(context);
 vm.runInContext(presentationCode+'\n'+adapterCode+'\ninstallReminderAdapter(Shell,views);',context);
 const shell=new Shell();
 const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
 const read=async index=>{await settle();assert(reads[index],`listReminders call ${index} started`);return reads[index];};
 return {shell,opened,toasts,clock,document,read,settle};
}

test('a failed tap refresh tells the owner and a later successful refresh does not navigate',async()=>{
 const f=fixture();
 const tap=f.shell.refreshReminders('tapped','one');(await f.read(0)).fail();await tap;
 assert.deepEqual(f.toasts,["Couldn't open that reminder. Open Calendar to find it."]);
 const later=f.shell.refreshReminders();(await f.read(1)).ok();await later;
 assert.deepEqual(f.opened,[]);assert.equal(f.shell.view,'home');
});

test('a resume that supersedes the tap fetch within the window still opens the tapped reminder',async()=>{
 const f=fixture();
 const tap=f.shell.refreshReminders('tapped','one');const tapRead=await f.read(0);
 const resume=f.shell.refreshReminders();f.clock.now+=5_000;(await f.read(1)).ok();await resume;
 tapRead.ok();await tap;
 assert.equal(f.opened.length,1);assert.equal(f.opened[0].view,'calendar');assert.equal(f.opened[0].open,'reminder:tapped');
});

test('navigating after the tap cancels its navigation',async()=>{
 const f=fixture();
 const tap=f.shell.refreshReminders('tapped','one');const tapRead=await f.read(0);
 f.shell.view='notes';tapRead.ok();await tap;
 assert.deepEqual(f.opened,[]);assert.equal(f.shell.view,'notes');
 const later=f.shell.refreshReminders();(await f.read(1)).ok();await later;assert.deepEqual(f.opened,[]);
});

test('a tap whose fetch finishes after the window or in the background does not navigate',async()=>{
 const late=fixture();
 const tap=late.shell.refreshReminders('tapped','one');const tapRead=await late.read(0);
 late.clock.now+=31_000;tapRead.ok();await tap;assert.deepEqual(late.opened,[]);
 const hidden=fixture();
 const background=hidden.shell.refreshReminders('tapped','one');const backgroundRead=await hidden.read(0);
 hidden.document.hidden=true;backgroundRead.ok();await background;assert.deepEqual(hidden.opened,[]);
});
