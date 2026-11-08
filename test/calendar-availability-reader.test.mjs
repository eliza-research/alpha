import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {root,jsonJar,javaBinary,jvmSkip,nativeSource,fixture} from './fixtures/jvm-tools.mjs';
// The Android free/busy reader, run on the JVM. Its provider queries are executed by the
// sqlite3 shell over tables with CalendarProvider's column names; the rows then go through
// the renderer parser and the shared contract. The journal policy for the shared answer is
// checked in the same run. No Android, CalendarProvider, Keystore journal or device.
test('Android free/busy reader: chosen calendars only, provider availability, civil all-day dates, bounds',{skip:jvmSkip(['json','javac','sqlite3'])},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'calendar-availability-reader-'));
 const shared=name=>join(root,'vendor/eliza/plugins/plugin-native-calendar',name);
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,
   ...['CalendarZones.java','CalendarSyncFreshness.java','CalendarAvailabilityJournalResult.java'].map(nativeSource),
   shared('android/src/main/java/ai/eliza/plugins/calendar/read/CalendarSourceIdentity.java'),shared('android/src/main/java/ai/eliza/plugins/calendar/read/SelectedCalendarReader.java'),
   ...['content/ContentResolver.java','content/ContentUris.java','content/ContentValues.java','database/Cursor.java','net/Uri.java'].map(name=>shared('test/jvm/android/'+name)),
   fixture('calendar-provider-jvm/android/provider/CalendarContract.java'),fixture('SqliteCalendarProvider.java'),fixture('CalendarAvailabilityReaderTest.java')],{timeout:180000,stdio:'pipe'});
  const output=execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.CalendarAvailabilityReaderTest'],{encoding:'utf8',timeout:300000,stdio:'pipe',maxBuffer:16*1024*1024});
  const [verdict,cases]=output.split('\n');
  assert.equal(verdict,'PASS calendar availability reader');
  const file=join(temporary,'cases.json');writeFileSync(file,cases);
  assert.match(execFileSync(process.execPath,['--import','tsx','scripts/test-calendar-availability-provider-rows.ts',file],{cwd:root,encoding:'utf8',timeout:120000,stdio:'pipe'}),/^PASS: \d+ Android reader results/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
