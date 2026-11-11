import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import test from 'node:test';
import vm from 'node:vm';
import * as reminderJournal from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
import {buildClockRequest,validateClockOperation,describeClockHandoff} from '../apps/app/src/runtime/clock-contract.ts';

// Alpha's reminder presentation functions, run as written with only their imports supplied.
// The storage, scheduling and reopen cases stay in test/browser/reminder-lifecycle.spec.ts.
const source=readFileSync('apps/app/src/runtime/reminder-creations.ts','utf8');
const code=stripTypeScriptTypes(source.slice(source.indexOf('// ---- Reminder presentation')).replace(/^export /gm,''),{mode:'strip'});
const presentation=native=>{
 const context={Capacitor:{isNativePlatform:()=>native},Date,Math,
  sharedOverdue:reminderJournal.overdueReminders,sharedTodos:reminderJournal.undatedTodos,sharedRefusalMessage:reminderJournal.reminderRefusalMessage,
  reminderDueAt:reminderJournal.reminderDueAt,isUndatedReminder:reminderJournal.isUndatedReminder};
 vm.createContext(context);
 vm.runInContext(code+'\nthis.api={overdueReminders,undatedTodos,reminderEvents,reminderRefusalMessage};',context);
 return context.api;
};
const {overdueReminders,undatedTodos,reminderEvents,reminderRefusalMessage}=presentation(true);

test('each refusal shows a specific reason',()=>{
 const messages=['past','permission-denied','storage-full','failed'].map(status=>reminderRefusalMessage(status,true));
 assert.equal(new Set(messages).size,4);
 assert.match(messages[0],/passed/);assert.match(messages[1],/Android settings/);assert.match(messages[2],/storage is full/);
 for(const message of messages)assert.match(message,/Nothing was saved/);
 assert.match(presentation(false).reminderRefusalMessage('permission-denied'),/in Settings/,'the web build names its own settings');
});

test('overdue lists posted and late scheduled reminders only, oldest first',()=>{
 const now=Date.UTC(2026,9,8,12);
 const row=(id,status,dueAt,extra={})=>({id,title:id,body:'',at:dueAt,dueAt,status,mode:'inexact',createdAt:0,occurrenceId:id,...extra});
 const rows=[row('late-scheduled','scheduled',now-60000),row('posted','posted',now-3600000),row('future','scheduled',now+60000),row('completed','completed',now-7200000),row('pending-no-alert','pending',now-7200000),row('denied','permission-denied',now-7200000),row('snoozed','scheduled',now-120000,{at:now+480000,snoozedAt:now-120000}),row('todo','todo',NaN,{undated:true,at:undefined,dueAt:undefined})];
 assert.deepEqual(overdueReminders(rows,now).map(r=>r.id),['posted','snoozed','late-scheduled']);
});

test('undated to-dos never become calendar events and list open first',()=>{
 const rows=[{id:'a',title:'Done to-do',body:'',status:'completed',mode:'none',createdAt:1,undated:true},{id:'b',title:'Open to-do',body:'',status:'todo',mode:'none',createdAt:2,undated:true},{id:'c',title:'Dated',body:'',at:Date.now()+60000,dueAt:Date.now()+60000,status:'scheduled',mode:'inexact',createdAt:3,occurrenceId:'c'}];
 assert.deepEqual(undatedTodos(rows).map(r=>r.id),['b','a']);
 assert.deepEqual(reminderEvents(rows).map(e=>e.alphaReminderId),['c']);
});

test('Clock repeat days are validated and carried in the reviewed request',()=>{
 const once=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[]},'UTC');
 const weekdays=buildClockRequest({action:'set',time:'07:30',label:'Run',snooze:'10',days:[6,2,4,3,5]},'UTC');
 const set=days=>({type:'clock_handoff',action:'set',hour:7,minute:30,label:'Run',timeZone:'UTC',days});
 for(const days of [[0],[8],[2,2],[1.5]])assert.throws(()=>validateClockOperation(set(days)),JSON.stringify(days));
 assert.equal('days' in once,false);assert.equal('days' in validateClockOperation(set([])),false);
 assert.deepEqual(weekdays.days,[2,3,4,5,6]);
 assert.match(describeClockHandoff(validateClockOperation(set([1,7]))),/repeating weekends/);
});

// One-off reminders are absolute instants; only the rendered wall time follows the zone.
// TZ is set explicitly; Node reads it again on each change.
for(const [zone,hour] of [['America/New_York',9],['America/Los_Angeles',6]])test(`one-off reminder in ${zone} keeps its instant and re-renders the wall time`,t=>{
 const previous=process.env.TZ;process.env.TZ=zone;
 t.after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;});
 const instant=Date.UTC(2026,10,20,14,0);// 09:00 in New York (EST), 06:00 in Los Angeles (PST)
 const [row]=reminderEvents([{id:'zone',title:'Zone fixture',body:'',at:instant,dueAt:instant,alertMinutes:0,status:'scheduled',mode:'inexact',createdAt:0,occurrenceId:'zone'}],new Date(instant));
 assert.deepEqual({t:row.t,due:row.reminderDueAt,at:row.reminderAt,off:row.off},{t:hour,due:instant,at:instant,off:0});
});
