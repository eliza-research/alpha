import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture, jsonJarSkip, nativeSource, root, runJvm} from './fixtures/jvm-tools.mjs';

// Exercise the bounded provider read on the JVM; Android instrumentation tests the real provider.
test('Android Calendar range read returns at most 2,000 instances and reports a longer provider result', {skip: jsonJarSkip}, () => {
 const shared = join(root, 'vendor/eliza/plugins/plugin-native-calendar/test/jvm/android');
 runJvm([
  nativeSource('CalendarRangeReader.java'),
  ...['content/ContentResolver', 'content/ContentUris', 'database/Cursor', 'net/Uri']
    .map(name => join(shared, name + '.java')),
  fixture('calendar-provider-jvm/android/provider/CalendarContract.java'),
  fixture('CalendarRangeReaderTest.java'),
 ], 'ai.elizaresearch.alphaphone.CalendarRangeReaderTest', {json: true});
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
