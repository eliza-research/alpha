import assert from 'node:assert/strict';
import test from 'node:test';
import {reminderOpenIntentFixture as fixture} from './fixtures/reminder-open-intent.mjs';
import {checkReminderOpenIntent} from '../specs/quint/refinement/application/reminder-open-intent.mjs';

test('a failed tap refresh tells the owner and a later successful refresh does not navigate',async()=>{
 const f=await fixture();
 const tap=f.shell.refreshReminders('tapped','one');(await f.read(0)).fail();await tap;
 assert.deepEqual(f.toasts,['Couldn’t open']);
 const later=f.shell.refreshReminders();(await f.read(1)).ok();await later;
 assert.deepEqual(f.opened,[]);assert.equal(f.shell.view,'home');
});

test('a resume that supersedes the tap fetch within the window still opens the tapped reminder',async()=>{
 const f=await fixture();
 const tap=f.shell.refreshReminders('tapped','one');const tapRead=await f.read(0);
 const resume=f.shell.refreshReminders();f.clock.now+=5_000;(await f.read(1)).ok();await resume;
 tapRead.ok();await tap;
 assert.equal(f.opened.length,1);assert.equal(f.opened[0].view,'calendar');assert.equal(f.opened[0].open,'reminder:tapped');
});

test('navigating after the tap cancels its navigation',async()=>{
 const f=await fixture();
 const tap=f.shell.refreshReminders('tapped','one');const tapRead=await f.read(0);
 f.shell.openView('notes');tapRead.ok();await tap;
 assert.deepEqual(f.opened.map(item=>item.view),['notes']);assert.equal(f.shell.view,'notes');
 const later=f.shell.refreshReminders();(await f.read(1)).ok();await later;assert.equal(f.opened.length,1);
});

test('a tap whose fetch finishes after the window or in the background does not navigate',async()=>{
 const late=await fixture();
 const tap=late.shell.refreshReminders('tapped','one');const tapRead=await late.read(0);
 late.clock.now+=31_000;tapRead.ok();await tap;assert.deepEqual(late.opened,[]);
 const hidden=await fixture();
 const background=hidden.shell.refreshReminders('tapped','one');const backgroundRead=await hidden.read(0);
 hidden.document.hidden=true;backgroundRead.ok();await background;assert.deepEqual(hidden.opened,[]);
});

for (const [origin, destination] of [['home','home'], ['home','calendar'], ['calendar','calendar']]) {
 test(`a tap from ${origin} cannot open after an intervening Notes visit and return to ${destination}`,async()=>{
  const f=await fixture(origin);
  const tap=f.shell.refreshReminders('tapped','one');const held=await f.read(0);
  f.shell.openView('notes');
  if(destination==='home')f.shell.goHome();else f.shell.openView(destination);
  const prior=f.opened.length;
  held.ok();await tap;
  assert.equal(f.shell.view,destination);
  assert.equal(f.opened.length,prior);
 });
}

test('direct Calendar entry while the tap waits still opens that reminder',async()=>{
 const f=await fixture();
 const tap=f.shell.refreshReminders('tapped','one');const held=await f.read(0);
 f.shell.openView('calendar');held.ok();await tap;
 assert.equal(f.opened.length,2);assert.equal(f.opened.at(-1).open,'reminder:tapped');
});

test('the Workflows device row starts its exact refresh before the Calendar entry commits',async()=>{
 const f=await fixture('workflows');
 const opened=f.selectDeviceReminder();const held=await f.read(0);
 assert.equal(f.shell.view,'workflows');
 assert.deepEqual(f.calls.slice(0,2),[{action:'openView',view:'calendar',current:'workflows'},
  {action:'refreshReminders',args:['tapped','one'],current:'workflows'}]);
 f.commitNavigation();held.ok();await opened;
 assert.equal(f.opened.length,2);assert.equal(f.opened.at(-1).open,'reminder:tapped');
});

test('the legacy reminder adapter refines Quint navigation ownership',async()=>{
 const receipt=await checkReminderOpenIntent();
 assert.equal(receipt.traces,12);
});
