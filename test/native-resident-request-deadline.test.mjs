import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fixture, jvmSkip, nativeSource, runJvm} from './fixtures/jvm-tools.mjs';

function between(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Missing production source: ' + start);
  return text.slice(first, last);
}

test('native request spends the explicit budget on queue and enrollment before issuing its exact IPC request',
  {skip: jvmSkip('json', 'javac')}, () => {
    const source = readFileSync(nativeSource('AlphaLocalAgentPlugin.java'), 'utf8');
    const request = between(source, ' private static void logRequestFailure(', ' /** Cancellation acknowledges transport closure');
    const raw = between(source, ' static String routeToken(', ' private static JSONObject json(');
    const ownership = between(source, ' private void requireCurrent(', ' private boolean runtimePackaged()');
    const reject = between(source, ' private void rejectPending(', '\n\n');
    const template = readFileSync(fixture('ResidentRequestDeadlineTest.java'), 'utf8');
    const temp = mkdtempSync(join(tmpdir(), 'alpha-request-deadline-'));
    const write = (name, text) => {
      const path = join(temp, name);
      writeFileSync(path, text);
      return path;
    };
    try {
      const clock = write('SystemClock.java', 'package android.os; public class SystemClock {public static long now; public static long elapsedRealtime(){return now;}}');
      const log = write('Log.java', 'package android.util; public class Log {public static void w(String tag,String message){}}');
      const harness = write('ResidentRequestDeadlineTest.java',
        template.replace(' // Production request methods.', () => [reject, ownership, raw, request].join('\n')));
      const result = runJvm([clock, log, harness, nativeSource('PluginWorkers.java')],
        'ai.alphacompute.alphaphone.ResidentRequestDeadlineTest', {json: true});
      assert.match(result, /^PASS resident explicit deadline/);
    } finally {
      rmSync(temp, {recursive: true, force: true});
    }
  });
