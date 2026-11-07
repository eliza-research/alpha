import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {jsonJar,jsonJarSkip} from './fixtures/jvm-tools.mjs';
const root=path.resolve(import.meta.dirname,'..');
const sqlite=(()=>{try{execFileSync('sqlite3',['-version'],{stdio:'pipe',timeout:20000});return true;}catch{return false;}})();
// On CI a missing sqlite3 fails the test rather than skipping it.
const skip=jsonJarSkip||(!sqlite&&!process.env.CI?'sqlite3 shell unavailable':false);
let timedNativeEvent;
test('native sync snapshots read exact owned rows and preserve all conditional dependencies',{skip},()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-calendar-sync-snapshot-'));
 const sourceRoot=process.env.ALPHA_NATIVE_UPSTREAM_ROOT||root;
 const shared=path.join(sourceRoot,'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android');
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');
 const binary=name=>java?path.join(java,'bin',name):name;
 try{
  const contract=path.join(temporary,'CalendarContract.java');
  fs.writeFileSync(contract,'package android.provider;import android.net.Uri;public final class CalendarContract {public static final String ACCOUNT_TYPE_LOCAL="LOCAL";public static final class Calendars {public static final Uri CONTENT_URI=new Uri("calendars");public static final int CAL_ACCESS_CONTRIBUTOR=500;}public static final class Events {public static final Uri CONTENT_URI=new Uri("events");}public static final class Attendees {public static final Uri CONTENT_URI=new Uri("attendees");}public static final class Reminders {public static final Uri CONTENT_URI=new Uri("reminders");}public static final class ExtendedProperties {public static final Uri CONTENT_URI=new Uri("properties");}}');
  const files=[contract,...['content/ContentValues.java','content/ContentUris.java','database/Cursor.java','net/Uri.java'].map(name=>path.join(shared,name)),...['ContentResolver.java','ContentProviderOperation.java'].map(name=>path.join(root,'test/fixtures/scoped-calendar-jvm/android/content',name)),path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarSyncSnapshot.java'),...['SqliteCalendarProvider.java','CalendarSyncSnapshotTest.java'].map(name=>path.join(root,'test/fixtures',name))];
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...files],{timeout:60000,stdio:'pipe'});
  const [verdict,timed]=execFileSync(binary('java'),['-cp',temporary+path.delimiter+jsonJar,'ai.elizaresearch.alphaphone.CalendarSyncSnapshotTest'],{encoding:'utf8',timeout:60000}).trim().split('\n');
  assert.equal(verdict,'PASS exact owned Calendar sync snapshots, tombstones and atomic assertions');
  timedNativeEvent=JSON.parse(timed);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

// The timed event the JVM harness read, through the renderer's native bridge snapshot, and the
// same Google event as the Cloud sync route returns it (eventInput in vendor/eliza/packages/cloud/
// shared/src/lib/services/agent-google-connector/calendar-sync-provider.ts rewrites timed
// instants with toISOString), through the shared provider port. A linked pair that already
// agrees must hash the same and reconcile clean twice, with nothing written on either side.
// Fails today: Java's Instant.toString drops zero milliseconds (19:00:00Z) and Cloud keeps them
// (19:00:00.000Z), and linkedCalendarSemanticText hashes timed startAt/endAt as raw strings. The fix
// is upstream normalization in packages/contracts/src/calendar-linked-sync.ts, with a migration
// note for stored lastCommonSemanticHash values. Remove todo when the pin carries it.
const timedDigestTodo='upstream: normalize timed startAt/endAt in linkedCalendarSemanticText';
test('a timed native event and its Cloud readback hash the same and reconcile without a write',{skip,todo:timedDigestTodo},async()=>{
 assert.ok(timedNativeEvent,'the JVM harness reported the timed event');
 assert.equal(timedNativeEvent.isAllDay,false);assert.equal(timedNativeEvent.timeZone,'America/New_York');
 const binding={environment:'production',userId:'owner',organizationId:'org',connectionId:'11111111-1111-4111-8111-111111111111',providerAccountId:'google',calendarId:'primary',agentId:'agent',localSourceId:'native:7',localSourceRevision:'22222222-2222-4222-8222-222222222222'};
 const nativeCalls=[],cloudCalls=[];
 const bridge={addListener:async()=>({remove:async()=>{}}),sync:async input=>{nativeCalls.push(input.kind);if(input.kind==='get')return {status:'ready',snapshot:{eventId:'42',revision:'a'.repeat(64),event:structuredClone(timedNativeEvent)}};throw Error('Unexpected native write');}};
 const context=vm.createContext({crypto:webcrypto,TextEncoder,document:{hidden:false},Event,DOMException,Date,AbortController,setTimeout,clearTimeout,window:{dispatchEvent(){}},Capacitor:{isNativePlatform:()=>true},registerPlugin:()=>bridge});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'apps/app/src/browser/calendar-sync-fields.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,''),context);
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'apps/app/src/runtime/native-calendar-sync.ts'),'utf8'),{mode:'transform'}).replace(/^import[^\n]+\n/gm,'').replace('export const nativeCalendarSync =','globalThis.nativeCalendarSync ='),context);
 const signal=new AbortController().signal;
 const local=context.nativeCalendarSync.port({lease:'33333333-3333-4333-8333-333333333333',binding,destination:{account:'owner@example.invalid',calendar:'Personal'},events:[],enabled:true},()=>true,signal);
 const cloudInstant=value=>new Date(Date.parse(value)).toISOString();
 const google={eventId:'google-event',etag:'"1"',visibility:'private',remindersDisabled:true,event:{title:timedNativeEvent.title,description:'',location:'',startAt:cloudInstant('2026-10-16T15:00:00-04:00'),endAt:cloudInstant('2026-10-16T16:00:00-04:00'),timeZone:'America/New_York',isAllDay:false,attendees:timedNativeEvent.attendees}};
 const client={async googleCalendarSync(input){cloudCalls.push(input.kind);const answer={version:1,calendarId:'primary',providerExactlyOnce:false};if(input.kind==='capabilities')return {...answer,accountId:'google',read:true,write:true,idempotentCreate:true,conditionalWrites:true};if(input.kind==='get')return {...answer,event:structuredClone(google)};throw Error('Unexpected Cloud write');}};
 const {googleCalendarSyncPort}=await tsImport('../apps/app/src/runtime/calendar-linked-provider.ts',import.meta.url);
 const provider=await googleCalendarSyncPort(client,binding,()=>true,signal);
 const {LinkedCalendarReconciler,linkedCalendarSemanticDigest}=await tsImport('../.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts',import.meta.url);
 const nativeSnapshot=await local.get('42'),cloudSnapshot=await provider.get({agentId:'agent',connectorAccountId:binding.connectionId,providerCalendarId:'primary',providerEventId:'google-event',providerEtag:'"1"',idempotencyKey:'retained-create'});
 assert.equal(await linkedCalendarSemanticDigest(nativeSnapshot.event),await linkedCalendarSemanticDigest(cloudSnapshot.event),`native ${nativeSnapshot.event.startAt} and Cloud ${cloudSnapshot.event.startAt} spell one instant`);
 const {CalendarLinkedStore}=await tsImport('../apps/app/src/runtime/calendar-linked-store.ts',import.meta.url);
 const slots=new Map(),storage={async read(slot){return structuredClone(slots.get(slot)??null);},async compareExchange(slot,expected,value){if(JSON.stringify(slots.get(slot)??null)!==JSON.stringify(expected))return {status:'conflict'};slots.set(slot,structuredClone(value));return {status:'saved'};}};
 const store=await CalendarLinkedStore.open(binding,()=>true,storage);
 await store.link('42','a'.repeat(64));
 const engine=new LinkedCalendarReconciler(store,local,provider);
 for(let pass=0;pass<2;pass++)assert.equal(await engine.reconcile((await store.list())[0]),'clean');
 assert.deepEqual(nativeCalls.filter(kind=>kind!=='get'),[]);
 assert.deepEqual(cloudCalls.filter(kind=>!['capabilities','get'].includes(kind)),[]);
});
