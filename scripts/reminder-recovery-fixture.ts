import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {runNativeFixture, type NativeFixtureContext} from './native-test-fixture.ts';

/** Product reminder envelope and alarm assertions; upstream owns device lifecycle. */
type State = {
 status: string;
 at: number;
 postedAt: number | null;
 occurrenceId?: string;
 revision?: string;
 historyCount?: number;
 notification: boolean;
 stopped: boolean;
};
type Observation = { elapsedMs: number; state: State };
type Evidence = {
 recurring: boolean;
 observations: Record<string, Observation[]>;
 fixtureId?: string;
 initial?: State;
 afterGrant?: State;
 beforeReboot?: State;
 boot?: unknown;
};
export async function runReminderRecovery(recurring: boolean, appApk: string, testApk: string, output: string) {
 const gate=recurring?'recurrencePhase':'reminderPhase';
 const args=(name: string)=>['-e',gate,name];
 const details: Evidence={recurring,observations:{}};
 const permission=(c: NativeFixtureContext,action: 'grant' | 'revoke')=>c.run('shell','pm',action,'--user',String(c.androidUser),c.packageName,'android.permission.POST_NOTIFICATIONS');
 await runNativeFixture({
  scenario:recurring?'reminder-recurrence-recovery':'reminder-recovery',appApk,testApk,output,details,
  testClass:recurring?'ReminderRecurrenceRecoveryInstrumentedTest':'ReminderRecoveryInstrumentedTest',
  testMethod:recurring?'permissionAndActualRebootPhase':'permissionAndRebootPhase',
  runnerArgs:args('prepare'),
  evidence:'Actual permission-revoked alarm and changed-boot notification witnessed externally in an owned secondary emulator user; no physical-device acceptance.',
  prepareVariant:async c=>{
   assert.ok(Number((await c.run('shell','getprop','ro.build.version.sdk')).trim())>=33,'Notification fixture requires Android 13+');
   await permission(c,'grant');
  },
  collectVariant:async c=>{
   const {androidFixtureObserver}=await import('../vendor/eliza/packages/app/scripts/lib/android-fixture-observation.mjs');
   const {rebootAndroidFixture}=await import('../vendor/eliza/packages/app/scripts/lib/android-fixture-reboot.mjs');
   const observer=androidFixtureObserver(c);
   const phase=(name: string)=>c.instrumentPhase(name,args(name));
   const fixtureId=await observer.preferenceString(recurring?'alpha-recurring-recovery-test':'alpha-reminder-recovery-test','id');
   assert.ok(fixtureId, 'Reminder fixture ID required');
   assert.match(fixtureId,recurring?/^recurring_recovery_[A-Za-z0-9_-]+$/:/^recovery_[A-Za-z0-9_-]+$/);
   details.fixtureId=fixtureId;
   const records=async()=>{
    const raw=await observer.preferenceString('alpha-reminder-envelope-v1','envelope');
    assert.ok(raw, 'Current reminder envelope required');
    const envelope: { version: number; records: Record<string, string> }=JSON.parse(raw);
    assert.equal(envelope?.version,1,'Current reminder envelope required');
    assert.ok(envelope.records&&typeof envelope.records==='object'&&!Array.isArray(envelope.records));
    return envelope.records;
   };
   const witness=async(): Promise<State>=>{
    const raw=(await records())[fixtureId];
    assert.equal(typeof raw,'string','Selected reminder must exist');
    const row: { id: string; at: number; status: string; postedAt?: number; occurrenceId: string; revision: string; history: unknown[] }=JSON.parse(raw);
    assert.equal(row.id,fixtureId);assert.ok(Number.isSafeInteger(row.at)&&row.at>0);
    if(recurring){assert.equal(typeof row.occurrenceId,'string');assert.equal(typeof row.revision,'string');assert.ok(Array.isArray(row.history));}
    return {status:row.status,at:row.at,postedAt:row.postedAt??null,
     ...(recurring?{occurrenceId:row.occurrenceId,revision:row.revision,historyCount:row.history.length}:{}),
     notification:await observer.notification({id:0,tag:fixtureId}),stopped:await observer.stopped()};
   };
   const sameOccurrence=(state: State,prior: State)=>{
    assert.equal(state.stopped,false,'Alarm target unexpectedly stopped');
    if(recurring){assert.equal(state.occurrenceId,prior.occurrenceId);assert.equal(state.revision,prior.revision);assert.equal(state.historyCount,0);}
   };
   const observe=async(name: string,prior: State,accept: (state: State) => boolean)=>{
    // Inexact Android alarms can arrive several minutes after their due instant.
    const budget=Math.min(13*60000,Math.max(20000,prior.at-Date.now()+12*60000));
    const started=performance.now(),deadline=started+budget, observations=details.observations[name]=[] as Observation[];
    while(true){
     c.signal?.throwIfAborted();
     const state=await witness();sameOccurrence(state,prior);
     if(!observations.length||JSON.stringify(observations.at(-1)?.state)!==JSON.stringify(state))observations.push({elapsedMs:performance.now()-started,state});
     if(accept(state))return state;
     assert.ok(performance.now()<deadline,`${name} alarm witness timed out`);
     await delay(1000,undefined,{signal:c.signal});
    }
   };
   const initial=details.initial=await witness();
   assert.equal(initial.status,'scheduled');assert.equal(initial.notification,false);sameOccurrence(initial,initial);
   await permission(c,'revoke');
   // Do not start instrumentation until the actual denied alarm has been observed:
   // startInstrumentation force-stops its target and can cancel a pending alarm.
   await observe('denied',initial,state=>{
    assert.equal(state.notification,false,'Denied alarm posted a notification');
    assert.ok(['scheduled','permission-denied'].includes(state.status));
    return state.status==='permission-denied';
   });
   await phase('denied');await permission(c,'grant');
   const granted=details.afterGrant=await witness();
   sameOccurrence(granted,initial);assert.equal(granted.status,'permission-denied');assert.equal(granted.notification,false);
   await phase('retry');await phase('prepare-reboot');
   const before=details.beforeReboot=await witness();
   assert.equal(before.status,'scheduled');assert.equal(before.notification,false);sameOccurrence(before,before);
   const rebootOptions = { expectedAvdName: process.env.ALPHA_TEST_AVD, timeoutMs: 120000 };
   details.boot=await rebootAndroidFixture({...c, signal:c.signal},rebootOptions);
   await observe('reboot',before,state=>{
    assert.ok(['scheduled','posted'].includes(state.status));
    return state.status==='posted'&&state.notification&&state.postedAt!==null&&Number.isSafeInteger(state.postedAt)&&state.postedAt>=state.at;
   });
   if(recurring)await phase('after-reboot-actions');
   else assert.equal((await records())[fixtureId+'_damaged'],'invalid-json','Malformed neighbor must survive recovery');
  },
  cleanupVariant:async c=>{if(c.instrumentPhase)await c.instrumentPhase('cleanup',args('cleanup'));},
 });
}
