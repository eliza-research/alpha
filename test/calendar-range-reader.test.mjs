import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
// The Android Calendar view's list: the pinned shared reader with Alpha's own configuration (its
// 2,000-instance bound and creation URI prefix), run on the JVM against a stand-in provider.
// CalendarTruncationInstrumentedTest is the CalendarProvider and rendered-warning check; this is
// neither Android nor a device run.
const root=resolve(import.meta.dirname,'..');
test('Android Calendar list returns at most 2,000 instances, reports a longer result and carries creationId',{skip:jvmSkip('json')},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'calendar-list-window-'));
 const plugin=join(root,'vendor/eliza/plugins/plugin-native-calendar');
 try{
  // AlphaCalendarPlugin needs Capacitor; its configuration expression runs here unchanged.
  const source=readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCalendarPlugin.java'),'utf8');
  const configuration=/static final CalendarConfiguration CONFIGURATION=(new CalendarConfiguration\([^;]*\));/.exec(source)?.[1];
  assert.ok(configuration,'AlphaCalendarPlugin declares CONFIGURATION');
  const generated=join(temporary,'AlphaCalendarConfiguration.java');
  writeFileSync(generated,`package ai.elizaresearch.alphaphone;\nimport ai.eliza.plugins.calendar.CalendarConfiguration;\nfinal class AlphaCalendarConfiguration{static final CalendarConfiguration CONFIGURATION=${configuration};}\n`);
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,
   join(plugin,'android/src/main/java/ai/eliza/plugins/calendar/CalendarConfiguration.java'),
   join(plugin,'android/src/main/java/ai/eliza/plugins/calendar/read/CalendarReadAccess.java'),
   ...['content/ContentResolver.java','content/ContentUris.java','database/Cursor.java'].map(name=>join(plugin,'test/jvm/android',name)),
   ...['content/Intent.java','net/Uri.java','provider/CalendarContract.java'].map(name=>join(plugin,'test/native-host/read-window/android',name)),
   generated,join(root,'test/fixtures/CalendarListWindowTest.java')],{timeout:180000,stdio:'pipe'});
  const output=execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.CalendarListWindowTest'],{encoding:'utf8',timeout:120000,stdio:'pipe'});
  assert.equal(output.trim(),'PASS calendar list window');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
