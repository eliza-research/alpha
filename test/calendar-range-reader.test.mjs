import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {jsonJar,jvmSkip,javaBinary} from './fixtures/jvm-tools.mjs';
// The Android Calendar view's bounded provider read, run on the JVM against a stand-in provider.
// CalendarTruncationInstrumentedTest is the CalendarProvider and rendered-warning check; this is
// neither Android nor a device run.
const root=resolve(import.meta.dirname,'..');
test('Android Calendar range read returns at most 2,000 instances and reports a longer provider result',{skip:jvmSkip('json')},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'calendar-range-reader-'));
 const shared=name=>join(root,'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android',name);
 try{
  execFileSync(javaBinary('javac'),['--release','11','-cp',jsonJar,'-d',temporary,
   join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/CalendarRangeReader.java'),
   ...['content/ContentResolver.java','content/ContentUris.java','database/Cursor.java','net/Uri.java'].map(shared),
   join(root,'test/fixtures/calendar-provider-jvm/android/provider/CalendarContract.java'),join(root,'test/fixtures/CalendarRangeReaderTest.java')],{timeout:180000,stdio:'pipe'});
  const output=execFileSync(javaBinary('java'),['-cp',temporary+':'+jsonJar,'ai.elizaresearch.alphaphone.CalendarRangeReaderTest'],{encoding:'utf8',timeout:120000,stdio:'pipe'});
  assert.equal(output.trim(),'PASS calendar range reader');
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
test('the Android Calendar plugin answers list through the bounded reader, not the unbounded shared one',()=>{
 const plugin=readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCalendarPlugin.java'),'utf8');
 const list=/@Override @PluginMethod public void list\(PluginCall c\)\{([\s\S]*?)\n \}\n/.exec(plugin)?.[1];
 assert.ok(list,'AlphaCalendarPlugin overrides list');
 assert.match(list,/CalendarRangeReader\.read\(resolver,begin,end\)/);
 assert.match(list,/value\.put\("truncated",read\.getBoolean\("truncated"\)\)/);
 assert.doesNotMatch(list,/\.events\(|super\.list/,'the shared reader returns every instance and reports truncated:false');
 assert.match(list,/if\(!granted\(\)\)\{c\.resolve\(status\("permission-required"\)\);return;\}/);
 // The renderer shows the warning the instrumentation waits for only when the native result says so.
 const adapter=readFileSync(join(root,'apps/app/src/prototype/calendar-adapter.ts'),'utf8');
 assert.match(adapter,/truncated=!!result\.truncated/);
 assert.match(adapter,/rangeReady&&truncated\?'Calendar results incomplete\. Some events may be missing\.'/);
});
