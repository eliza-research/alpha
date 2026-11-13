// Compiles CalendarSyncSnapshot with CalendarSyncSnapshotTest and returns its stdout: the verdict,
// then the semantic form of a timed event read through the SQLite provider stand-in.
import {scaledTimeout} from '../../specs/quint/refinement/timeouts.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {root,jsonJar,javaBinary,nativeSource,fixture} from './jvm-tools.mjs';

export function calendarSyncSnapshotJvm(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-calendar-sync-snapshot-'));
 const shared=path.join(root,'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android');
 try{
  const contract=path.join(temporary,'CalendarContract.java');
  fs.writeFileSync(contract,'package android.provider;import android.net.Uri;public final class CalendarContract {public static final String ACCOUNT_TYPE_LOCAL="LOCAL";public static final class Calendars {public static final Uri CONTENT_URI=new Uri("calendars");public static final int CAL_ACCESS_CONTRIBUTOR=500;}public static final class Events {public static final Uri CONTENT_URI=new Uri("events");}public static final class Attendees {public static final Uri CONTENT_URI=new Uri("attendees");}public static final class Reminders {public static final Uri CONTENT_URI=new Uri("reminders");}public static final class ExtendedProperties {public static final Uri CONTENT_URI=new Uri("properties");}}');
  const files=[contract,...['content/ContentValues.java','content/ContentUris.java','database/Cursor.java','net/Uri.java'].map(name=>path.join(shared,name)),...['ContentResolver.java','ContentProviderOperation.java'].map(name=>fixture('scoped-calendar-jvm/android/content/'+name)),nativeSource('CalendarSyncSnapshot.java'),fixture('SqliteCalendarProvider.java'),fixture('CalendarSyncSnapshotTest.java')];
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,...files],{timeout:scaledTimeout(60000),stdio:'pipe'});
  return execFileSync(javaBinary('java'),['-cp',temporary+path.delimiter+jsonJar,'ai.alphacompute.alphaphone.CalendarSyncSnapshotTest'],{encoding:'utf8',timeout:scaledTimeout(60000),stdio:'pipe'});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
