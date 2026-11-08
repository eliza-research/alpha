import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
// The Android free/busy reader, run on the JVM. Its provider queries are executed by the
// sqlite3 shell over tables with CalendarProvider's column names; the rows then go through
// the renderer parser and the shared contract. The journal policy for the shared answer is
// checked in the same run. No Android, CalendarProvider, Keystore journal or device.
const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
const jsonJar=process.env.ALPHA_JSON_JAR||cached;
const sqlite=(()=>{try{execFileSync('sqlite3',['-version'],{stdio:'pipe',timeout:20000});return true;}catch{return false;}})();
test('Android free/busy reader: chosen calendars only, provider availability, civil all-day dates, bounds',{skip:!jsonJar?'Pinned JVM JSON dependency unavailable':!sqlite?'sqlite3 shell unavailable':false},()=>{
 const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(tmpdir(),'calendar-availability-reader-'));
 const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');const binary=name=>java?join(java,'bin',name):name;
 const shared=name=>join(root,'vendor/eliza/plugins/plugin-native-calendar',name);
 try{
  execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,
   join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarZones.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarSyncFreshness.java'),join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarAvailabilityJournalResult.java'),
   shared('android/src/main/java/ai/eliza/plugins/calendar/read/CalendarSourceIdentity.java'),shared('android/src/main/java/ai/eliza/plugins/calendar/read/SelectedCalendarReader.java'),
   ...['content/ContentResolver.java','content/ContentUris.java','content/ContentValues.java','database/Cursor.java','net/Uri.java'].map(name=>shared('test/jvm/android/'+name)),
   join(root,'test/fixtures/calendar-provider-jvm/android/provider/CalendarContract.java'),join(root,'test/fixtures/CalendarAvailabilityReaderTest.java')],{timeout:180000,stdio:'pipe'});
  const output=execFileSync(binary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.CalendarAvailabilityReaderTest'],{encoding:'utf8',timeout:300000,stdio:'pipe',maxBuffer:16*1024*1024});
  const [verdict,cases]=output.split('\n');
  assert.equal(verdict,'PASS calendar availability reader');
  const file=join(temporary,'cases.json');writeFileSync(file,cases);
  assert.match(execFileSync(process.execPath,['--import','tsx','--experimental-transform-types','scripts/test-calendar-availability-provider-rows.ts',file],{cwd:root,encoding:'utf8',timeout:120000,stdio:'pipe'}),/^PASS: \d+ Android reader results/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
