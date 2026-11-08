import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {materializeNativePatches} from '../scripts/prepare-patched-native.mjs';
import {upstreamNativeSource} from '../scripts/upstream-native-source.mjs';
import {jsonJar,javaBinary,jvmSkip} from './fixtures/jvm-tools.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('scoped Calendar snapshot binds occurrence, dependencies and one atomic provider transaction',{skip:jvmSkip(['json','javac','sqlite3'])},()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-scoped-provider-'));
 const sourceRoot=process.env.ALPHA_NATIVE_UPSTREAM_ROOT||root,source=upstreamNativeSource(sourceRoot);
 const json=jsonJar,binary=javaBinary;
 try{
  materializeNativePatches({source,manifest:JSON.parse(fs.readFileSync(path.join(root,'patches/eliza/native-manifest.json'))),patchRoot:path.join(root,'patches/eliza'),temporary});
  const stubs=path.join(temporary,'stubs');fs.mkdirSync(stubs);
  const values=path.join(stubs,'ContentValues.java');fs.writeFileSync(values,fs.readFileSync(path.join(sourceRoot,'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android/content/ContentValues.java'),'utf8').replace('public void put(String key,Long value)', 'public int size(){return values.size();}public void put(String key,Integer value){values.put(key,value);}public void put(String key,Long value)'));
  const contract=path.join(stubs,'CalendarContract.java');fs.writeFileSync(contract,`package android.provider;import android.net.Uri;public class CalendarContract {public static final String AUTHORITY="calendar",ACCOUNT_TYPE_LOCAL="LOCAL";public static class Calendars {public static final Uri CONTENT_URI=new Uri("calendars");public static final int CAL_ACCESS_CONTRIBUTOR=500;}public static class Events {public static final Uri CONTENT_URI=new Uri("events"),CONTENT_EXCEPTION_URI=new Uri("exceptions");public static final String DTSTART="dtstart",STATUS="eventStatus",ORIGINAL_INSTANCE_TIME="originalInstanceTime";public static final int STATUS_CANCELED=2;}public static class Instances {public static final Uri CONTENT_URI=new Uri("instances");public static final String EVENT_ID="event_id",BEGIN="begin",END="end";}public static class Attendees {public static final Uri CONTENT_URI=new Uri("attendees");}public static class Reminders {public static final Uri CONTENT_URI=new Uri("reminders");}}`);
  const shared=path.join(sourceRoot,'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android'),native=path.join(temporary,'plugins/plugin-native-calendar/android/src/main/java/ai/eliza/plugins/calendar');
  const files=[values,contract,...['content/ContentUris.java','database/Cursor.java','net/Uri.java'].map(name=>path.join(shared,name)),...['ContentResolver.java','ContentProviderOperation.java'].map(name=>path.join(root,'test/fixtures/scoped-calendar-jvm/android/content',name)),path.join(native,'CalendarEventGuard.java'),path.join(native,'read/CalendarSourceIdentity.java'),...['SqliteCalendarProvider.java','ScopedCalendarSnapshotTest.java'].map(name=>path.join(root,'test/fixtures',name))];
  execFileSync(binary('javac'),['--release','11','-cp',json,'-d',temporary,...files],{timeout:60000,stdio:'pipe'});
  assert.match(execFileSync(binary('java'),['-cp',temporary+path.delimiter+json,'ai.eliza.plugins.calendar.ScopedCalendarSnapshotTest'],{encoding:'utf8',timeout:20000}),/PASS scoped Calendar provider snapshots/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
