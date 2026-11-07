// The #659 merge review aid is pure parsing over git output; these checks use synthetic inputs,
// read no git history and are source checks only (no APK, emulator, image or device evidence).
import test from 'node:test';
import assert from 'node:assert/strict';
import {addedLinesFromDiff, binaryChanges, descriptorCoverage, diffScripts, forgedMarkers, FORGED_COMMITS} from '../scripts/owner/merge-review.mjs';

test('package scripts are reported as added, removed and changed', () => {
 const before = JSON.stringify({scripts: {build: 'vite build', old: 'node old.mjs', test: 'node --test'}});
 const after = JSON.stringify({scripts: {build: 'vite build', test: 'node --test test/*.mjs', 'android:host': 'node scripts/android-host.mjs'}});
 assert.deepEqual(diffScripts(before, after), {
  added: [{name: 'android:host', command: 'node scripts/android-host.mjs'}],
  removed: [{name: 'old', command: 'node old.mjs'}],
  changed: [{name: 'test', before: 'node --test', after: 'node --test test/*.mjs'}],
 });
 assert.deepEqual(diffScripts(null, JSON.stringify({scripts: {a: 'b'}})).added, [{name: 'a', command: 'b'}]);
});

test('binary changes come from numstat "-" rows with their name-status code', () => {
 const numstat = '-\t-\tandroid/gradle/wrapper/gradle-wrapper.jar\n3\t1\tpackage.json\n-\t-\tapps/app/public/new.png\n';
 const nameStatus = 'D\tandroid/gradle/wrapper/gradle-wrapper.jar\nM\tpackage.json\nA\tapps/app/public/new.png\n';
 assert.deepEqual(binaryChanges(numstat, nameStatus), [
  {path: 'android/gradle/wrapper/gradle-wrapper.jar', status: 'D'},
  {path: 'apps/app/public/new.png', status: 'A'},
 ]);
});

test('forged payload shapes are found in paths and added lines; ordinary changes are not', () => {
 const diff = [
  'diff --git a/.vscode/tasks.json b/.vscode/tasks.json', '+++ b/.vscode/tasks.json', '+  "runOn": "folderOpen"',
  'diff --git a/capacitor.config.ts b/capacitor.config.ts', '+++ b/capacitor.config.ts', '+eval(await fetch(u).then(r=>r.text()))',
  'diff --git a/package.json b/package.json', '+++ b/package.json', '+    "predev": "node init",',
  'diff --git a/src/a.ts b/src/a.ts', '+++ b/src/a.ts', '+const evaluation = evaluate(rule);',
 ].join('\n');
 const paths = ['.vscode/tasks.json', 'init', 'apps/reminders/public/fonts/x.woff2', '.env', 'src/a.ts', 'docs/initial.md', 'apps/app/public/fonts/a.woff2'];
 const found = forgedMarkers(paths, addedLinesFromDiff(diff));
 const names = found.map(item => `${item.kind}:${item.name}:${item.path}`);
 assert.ok(names.includes('path:VS Code tasks:.vscode/tasks.json'));
 assert.ok(names.includes('path:init script:init'));
 assert.ok(names.includes('path:reminders public fonts:apps/reminders/public/fonts/x.woff2'));
 assert.ok(names.includes('path:.env file:.env'));
 assert.ok(names.includes('line:folderOpen task:.vscode/tasks.json'));
 assert.ok(names.includes('line:eval of fetched code:capacitor.config.ts'));
 assert.ok(names.includes('line:npm hook into init:package.json'));
 assert.ok(!names.some(name => name.endsWith(':src/a.ts') || name.includes('docs/initial.md') || name.includes('apps/app/public/fonts')));
 assert.equal(FORGED_COMMITS.length, 5);
});

test('descriptor coverage names the issue modules and helpers that are missing', () => {
 const helper = name => `plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/${name}.java`;
 const full = {profile: {modules: ['eliza-cloud-auth', 'eliza-messages', 'eliza-phone'].map(name => ({name}))},
  residentHost: {helpers: ['plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeRuntimeEmbeddings.java', ...Array.from({length: 16}, (_, i) => helper(`H${i}`))]}};
 assert.deepEqual(descriptorCoverage(JSON.stringify(full)), {modules: 3, missingModules: [], missingHelpers: [], browserSurfaceHelpers: 16, browserSurfaceShort: false});
 const partial = {profile: {modules: [{name: 'eliza-cloud-auth'}]}, residentHost: {helpers: [helper('Only')]}};
 const result = descriptorCoverage(JSON.stringify(partial));
 assert.deepEqual(result.missingModules, ['eliza-messages', 'eliza-phone']);
 assert.deepEqual(result.missingHelpers, ['NativeRuntimeEmbeddings.java']);
 assert.equal(result.browserSurfaceShort, true);
});
