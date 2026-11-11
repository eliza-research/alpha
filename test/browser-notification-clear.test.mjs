import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/browser/notifications.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''));
function fixture(options={}){
 const counts={reminders:0,alerts:0,edits:0,changed:0,focusEvents:0,alertActions:[],workflow:[],hosted:[]};
 const state={revision:'r',epoch:'e',enabled:true,paused:false,history:false,accessGranted:true,apps:[{packageName:'browser.mail',preview:true}],events:[],dismissed:[...(options.dismissed||[])],appEnabled:true,channels:{reminders:true,calendar:true},deviceEvents:[...(options.deviceEvents||[])]};
 const reminders=options.reminders||[];let hidden=false,lockDuringEdit=false;
 const listeners=new Map();
 const context={
  readDevicePreferences:async()=>({doNotDisturb:false}),
  notificationAction:()=>({signal:new AbortController().signal,dispose(){}}),
  layoutBrowserDialog(){},browserScreenLocked:()=>false,focusActive:()=>false,focusHoldsNotice:()=>false,
  focusAllowedNotices:()=>options.focus||[],
  listWorkflowNotices:async()=>[],actOnWorkflowNotice:async input=>{counts.workflow.push(input.id);},
  BrowserCalendar:class{},
  browserHostedResults:{list:async()=>[],action:async input=>{counts.hosted.push(input.id);}},
  browserApps:[{packageName:'browser.mail',label:'Mail',view:'inbox'}],
  WebPlugin:class{notifyListeners(name){if(name==='changed')counts.changed++;return Promise.resolve();}},
  revision:()=>'session',
  notificationDocument:{edit:async edit=>{counts.edits++;if(lockDuringEdit)hidden=true;const copy=structuredClone(state),result=await edit(copy);Object.assign(state,copy);return result;}},
  notificationState:async()=>structuredClone(state),
  NotificationPolicyChanged:class extends Error{},
  document:{get hidden(){return hidden;},documentElement:{dataset:{}},addEventListener(){}},
  window:{addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>{if(event.type==='focus')counts.focusEvents++;return true;}},
  crypto,Event,CustomEvent,AbortController,Date,JSON,console,
 };
 vm.runInNewContext(source+'\nglobalThis.BrowserNotifications=BrowserNotifications;globalThis.noticeRoute=noticeRoute;globalThis.retainDismissed=retainDismissed;',context);
 const daily={listReminders:async()=>{counts.reminders++;return {reminders};},notifyReminder:async()=>{}};
 const calendar={listAlerts:async()=>{counts.alerts++;return {items:options.alerts||[]};},alertAction:async input=>{if(options.failAlert===input.id)throw Error('changed');counts.alertActions.push(input.id);}};
 return {plugin:new context.BrowserNotifications(daily,calendar),counts,state,context,lock:()=>{hidden=true;},lockDuringEdit:()=>{lockDuringEdit=true;}};
}
const posted=count=>Array.from({length:count},(_,index)=>({id:'reminder-'+index,occurrenceId:'occurrence-'+index,title:'Reminder '+index,body:'',status:'posted',at:1000+index}));

test('clearing many reminders lists once, writes once and reports one change',async()=>{
 const app=fixture({reminders:posted(40)});
 const {items}=await app.plugin.list();assert.equal(items.length,40);
 const before={...app.counts};
 const result=await app.plugin.clear({items:items.map(({id,revision,source})=>({id,revision,source}))});
 assert.equal(Array.from(result.outcomes).every(row=>row.status==='requested'),true);
 // One listing for validation and one read of the posted marks, however many rows are cleared.
 assert.equal(app.counts.reminders-before.reminders,2);
 assert.equal(app.counts.alerts-before.alerts,1);
 assert.equal(app.counts.edits-before.edits,1);
 assert.equal(app.counts.changed-before.changed,1);
 assert.equal(app.counts.focusEvents-before.focusEvents,1);
 assert.equal((await app.plugin.list()).items.length,0);
});

test('a batch gives each row the outcome its own dismissal would have had',async()=>{
 const alerts=[{id:'calendar:a',revision:'ra',title:'Standup',text:'',at:5000},{id:'calendar:b',revision:'rb',title:'Review',text:'',at:5001}];
 const app=fixture({reminders:posted(2),alerts,failAlert:'calendar:b',focus:[{id:'focus:k',revision:'k',source:'own',appLabel:'Messages',title:'Maya',text:'hi',at:6000,clearable:true,canOpen:true}]});
 const result=await app.plugin.clear({items:[
  {id:'reminder-0',revision:'occurrence-0',source:'own'},
  {id:'reminder-1',revision:'stale',source:'own'},
  {id:'reminder-0',revision:'occurrence-0',source:'own'},
  {id:'calendar:a',revision:'ra',source:'own'},
  {id:'calendar:b',revision:'rb',source:'own'},
  {id:'focus:k',revision:'k',source:'own'},
  {id:'workflow:w',revision:'1',source:'own'},
  {id:'hosted-1',revision:'1',source:'hosted'},
  {id:'missing',revision:'1',source:'external'},
 ]});
 assert.deepEqual(Array.from(result.outcomes,row=>row.status),['requested','unavailable','unavailable','requested','unavailable','requested','requested','requested','unavailable']);
 assert.deepEqual(app.counts.alertActions,['calendar:a']);
 assert.deepEqual(app.counts.workflow,['workflow:w']);
 assert.deepEqual(app.counts.hosted,['hosted-1']);
 assert.deepEqual([...app.state.dismissed].sort(),['focus:k','occurrence-0']);
 assert.equal(app.counts.changed,1);
});

test('rows that never need the listing do not read it',async()=>{
 const app=fixture({reminders:posted(3)});
 await app.plugin.clear({items:[{id:'hosted-1',revision:'1',source:'hosted'},{id:'workflow:w',revision:'1',source:'own'}]});
 assert.equal(app.counts.reminders,0);assert.equal(app.counts.edits,0);assert.equal(app.counts.changed,1);
 await assert.rejects(app.plugin.clear({items:Array.from({length:101},()=>({id:'x',revision:'1'}))}),/Refresh/);
});

test('a lock that arrives between the check and the write dismisses nothing',async()=>{
 const app=fixture({reminders:posted(2)});
 app.lockDuringEdit();
 await assert.rejects(app.plugin.dismiss({id:'reminder-0',revision:'occurrence-0',source:'own'}),/Unlock/);
 assert.deepEqual(app.state.dismissed,[]);
 const locked=fixture({reminders:posted(2)});locked.lockDuringEdit();
 const result=await locked.plugin.clear({items:[{id:'reminder-0',revision:'occurrence-0',source:'own'},{id:'reminder-1',revision:'occurrence-1',source:'own'}]});
 assert.deepEqual(Array.from(result.outcomes,row=>row.status),['unavailable','unavailable']);
 assert.deepEqual(locked.state.dismissed,[]);
});

test('a dismissed reminder that is still posted stays dismissed when older marks fill the bound',async()=>{
 const stale=Array.from({length:499},(_,index)=>'gone-'+index);
 const app=fixture({reminders:posted(3),dismissed:['occurrence-0',...stale]});
 assert.deepEqual(Array.from((await app.plugin.list()).items,row=>row.id).sort(),['reminder-1','reminder-2']);
 await app.plugin.dismiss({id:'reminder-1',revision:'occurrence-1',source:'own'});
 await app.plugin.dismiss({id:'reminder-2',revision:'occurrence-2',source:'own'});
 assert.equal(app.state.dismissed.length,500);
 assert.equal(app.state.dismissed.includes('occurrence-0'),true);
 assert.equal((await app.plugin.list()).items.length,0);
});

test('dismissal marks are bounded, dropping marks for notices that are gone first',()=>{
 const {retainDismissed,noticeRoute}=fixture().context;
 const live=new Set(['a','z']);
 assert.deepEqual(Array.from(retainDismissed(['a','b','c','d','z'],live,3)),['a','d','z']);
 assert.deepEqual(Array.from(retainDismissed(['a','b'],live,3)),['a','b']);
 assert.equal(retainDismissed(Array.from({length:700},(_,index)=>'m'+index),new Set(),500).length,500);
 // More live marks than the bound: the newest are kept.
 const all=Array.from({length:6},(_,index)=>'l'+index);
 assert.deepEqual(Array.from(retainDismissed(all,new Set(all),4)),['l2','l3','l4','l5']);
 assert.equal(noticeRoute({id:'focus:x',revision:'1',source:'own'}),'focus');
 assert.equal(noticeRoute({id:'workflow:x',revision:'1',source:'own'}),'workflow');
 assert.equal(noticeRoute({id:'x',revision:'1',source:'hosted'}),'hosted');
 assert.equal(noticeRoute({id:'x',revision:'1',source:'external'}),'external');
 assert.equal(noticeRoute({id:'calendar:x',revision:'1',source:'own'}),'calendar');
 assert.equal(noticeRoute({id:'x',revision:'1',source:'own'}),'reminder');
});
