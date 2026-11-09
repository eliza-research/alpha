import test from 'node:test';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture, javaBinary, jsonJar, jsonJarSkip, nativeSource, root, runJvm} from './fixtures/jvm-tools.mjs';
import {materializeNativePatches} from '../scripts/prepare-patched-native.mjs';
import {upstreamNativeSource} from '../scripts/upstream-native-source.mjs';

const productPackage = 'ai.elizaresearch.alphaphone';

test('native Calendar writes bind exact provider state and preserve event dependencies', {skip: jsonJarSkip}, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-calendar-provider-'));
  t.after(() => rmSync(temporary, {recursive: true, force: true}));

  const patchRoot = join(root, 'patches/eliza');
  const source = upstreamNativeSource(process.env.ALPHA_NATIVE_UPSTREAM_ROOT || root);
  materializeNativePatches({
    source, patchRoot, temporary,
    manifest: JSON.parse(readFileSync(join(patchRoot, 'native-manifest.json'))),
  });

  const calendar = 'plugins/plugin-native-calendar';
  const shared = join(source.directory, calendar, 'test/jvm/android');
  const patched = join(temporary, calendar, 'android/src/main/java/ai/eliza/plugins/calendar');
  const sources = [
    fixture('calendar-provider-jvm/android/provider/CalendarContract.java'),
    ...['ContentResolver', 'ContentValues', 'ContentProviderOperation'].map(name =>
      fixture(`scoped-calendar-jvm/android/content/${name}.java`)),
    ...['content/ContentUris', 'database/Cursor', 'net/Uri'].map(name => join(shared, name + '.java')),
    ...['CalendarSyncSnapshot', 'CalendarSyncMutation', 'DeferredDeletionJournal', 'DeletionDeadline']
      .map(name => nativeSource(name + '.java')),
    ...['CalendarEventGuard', 'read/CalendarSourceIdentity', 'write/CalendarEventOptions']
      .map(name => join(patched, name + '.java')),
  ];
  const cases = [
    ['sync snapshots bind exact owned rows, tombstones and dependencies', productPackage, 'CalendarSyncSnapshotTest'],
    ['conditional sync mutations preserve rich metadata and refuse unsupported writes', productPackage, 'CalendarSyncMutationTest'],
    ['scoped deletion binds the occurrence and dependencies in one atomic transaction', 'ai.eliza.plugins.calendar', 'ScopedCalendarSnapshotTest'],
  ];
  execFileSync(javaBinary('javac'), [
    '--release', '11', '-cp', jsonJar, '-d', temporary, ...sources,
    ...cases.map(([, , name]) => fixture(name + '.java')),
  ], {timeout: 60_000});

  for (const [name, pkg, main] of cases) {
    await t.test(name, () => {
      execFileSync(javaBinary('java'), ['-cp', temporary + delimiter + jsonJar, `${pkg}.${main}`], {timeout: 20_000});
    });
  }
});

test('interrupted native writes recover only from the exact observed owner, event and postcondition', {skip: jsonJarSkip}, () => {
  runJvm(
    [nativeSource('CalendarSyncReceiptRecovery.java'), fixture('CalendarSyncReceiptRecoveryTest.java')],
    `${productPackage}.CalendarSyncReceiptRecoveryTest`,
    {json: true},
  );
});
