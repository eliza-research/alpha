import test from 'node:test';
import assert from 'node:assert/strict';
import {modules,resetDocuments} from './fixtures/browser-daily-stores.mjs';
const {BrowserDaily,BrowserClock,reminderDocument}=modules;
const until=async(check,label)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Timed out waiting for '+label);};
const alarms=async()=>JSON.parse(await reminderDocument.readRaw()).reminders.filter(row=>row.id.startsWith('alarm_'));
function setup(){
 const harness=resetDocuments(),daily=new BrowserDaily({}),interval=globalThis.setInterval;
 // The clock's 1s refresh is driven by its events here, so the test process can exit.
 globalThis.setInterval=()=>0;const clock=new BrowserClock(daily,{list:async()=>({items:[]})});globalThis.setInterval=interval;
 return {harness,daily,clock};
}
// Stands in for the clock's 1s refresh, which a poll already in flight would otherwise wait for.
const refresh=()=>window.dispatchEvent(new Event('alpha:alarms-changed'));
const button=name=>[...document.querySelectorAll('dialog button')].find(b=>b.textContent===name);

test('an alarm saved with notifications off says so, is listed and can be deleted',async()=>{
 const {harness}=setup();harness.notifications=false;
 window.dispatchEvent(new Event('alpha:clock-open'));const dialog=document.querySelector('dialog');assert.ok(dialog);
 button('Save alarm').click();
 const status=dialog.querySelector('[role=status]');
 await until(()=>status.textContent!=='','the save status');
 assert.equal(status.textContent,'Alarm saved. Notifications are off, so it will not ring until you turn them on.');
 await until(()=>refresh()&&dialog.textContent.includes('Notifications off'),'the saved alarm row');
 const saved=await alarms();assert.equal(saved.length,1);assert.equal(saved[0].status,'permission-denied');
 button('Delete Alarm').click();
 await until(()=>refresh()&&dialog.textContent.includes('No alarms'),'the alarm to be deleted');
 assert.equal((await alarms())[0].status,'cancelled');
 dialog.close();
});

test('a future alarm saved while notifications were off is scheduled once they are on',async()=>{
 const {harness,daily}=setup();harness.notifications=false;
 const result=await daily.clockHandoff({action:'set',hour:7,minute:0,label:'Wake',reviewed:true});
 assert.equal(result.status,'opened');assert.match(result.message,/Notifications are off/);
 assert.equal((await alarms()).length,1);
 const writes=harness.documents.writes;await daily.listReminders();assert.equal(harness.documents.writes,writes,'no write while notifications stay off');
 harness.notifications=true;await daily.listReminders();
 const [alarm]=await alarms();assert.equal(alarm.status,'scheduled');
 const settled=harness.documents.writes;await daily.listReminders();assert.equal(harness.documents.writes,settled);
});
