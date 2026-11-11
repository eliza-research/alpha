import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture, jvmSkip, nativeSource, runJvm} from './fixtures/jvm-tools.mjs';
const {appId} = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));

test('Files native refusal cleanup runs before every refused answer, including a closed worker', {skip: jvmSkip('javac')}, () => {
  const plugin = readFileSync(nativeSource('AlphaFilesPlugin.java'), 'utf8');
  const methodsStart = plugin.indexOf('private interface StorageWork');
  const methodsEnd = plugin.indexOf('private static List<String> strings');
  const stateStart = plugin.indexOf('@PluginMethod public void storageState');
  const stateEnd = plugin.indexOf('/** Opens Android', stateStart);
  assert.ok(methodsStart >= 0 && methodsEnd > methodsStart && stateStart >= 0 && stateEnd > stateStart);
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-files-refusal-'));
  try {
    const source = join(temporary, 'FilesStorageRefusalTest.java');
    writeFileSync(source, readFileSync(fixture('FilesStorageRefusalTest.java'), 'utf8')
      .replaceAll('fixture.identity', appId)
      .replace('// STORAGE_METHODS', plugin.slice(methodsStart, methodsEnd))
      .replace('// STATE_METHOD', plugin.slice(stateStart, stateEnd)));
    assert.match(runJvm([source, nativeSource('PluginWorkers.java')], `${appId}.FilesStorageRefusalTest`), /^PASS files storage refusals/);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  const watch = plugin.slice(plugin.indexOf('public void storageWatch'), plugin.indexOf('public void storageUnwatch'));
  assert.match(watch, /long ticket=watch\.request\(\)/);
  assert.match(watch, /\},\(\)->watch\.fail\(ticket\)\);/, 'watch refusals retire only their own current request');
});
