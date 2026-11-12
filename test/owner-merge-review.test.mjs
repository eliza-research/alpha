// The #659 merge review aid is pure parsing over git output; these checks use synthetic inputs,
// read no git history and are source checks only (no APK, emulator, image or device evidence).
import test from 'node:test';
import assert from 'node:assert/strict';
import {addedLinesFromDiff, binaryChanges, descriptorCoverage, diffScripts, forgedMarkers, FORGED_COMMITS, markerPatterns} from '../scripts/owner/merge-review.ts';

test('package scripts are reported as added, removed and changed', () => {
 const before = JSON.stringify({scripts: {build: 'vite build', old: 'node old.mjs', test: 'bun test'}});
 const after = JSON.stringify({scripts: {build: 'vite build', test: 'bun test test/*.mjs', 'android:host': 'bun scripts/android-host.ts'}});
 assert.deepEqual(diffScripts(before, after), {
  added: [{name: 'android:host', command: 'bun scripts/android-host.ts'}],
  removed: [{name: 'old', command: 'node old.mjs'}],
  changed: [{name: 'test', before: 'bun test', after: 'bun test test/*.mjs'}],
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
 assert.ok(names.includes('path:IOC path .vscode/tasks.json:.vscode/tasks.json'));
 assert.ok(names.includes('path:IOC path init:init'));
 assert.ok(names.includes('path:IOC path /(^|/)reminders/public/fonts//:apps/reminders/public/fonts/x.woff2'));
 assert.ok(names.includes('path:IOC path .env:.env'));
 assert.ok(names.some(name => name.startsWith('line:IOC /"runOn"') && name.endsWith(':.vscode/tasks.json')));
 assert.ok(names.includes('line:eval of fetched code:capacitor.config.ts'));
 assert.ok(names.includes('line:npm hook into init:package.json'));
 assert.ok(!names.some(name => name.endsWith(':src/a.ts') || name.includes('docs/initial.md') || name.includes('apps/app/public/fonts')));
 assert.deepEqual([...FORGED_COMMITS].sort(), ['0cefd6e47', '131cd0e63', '39ef59401', '61d293f61', 'cc3f7a709']);
});

test('the recorded loader shapes from the IOC file are flagged', () => {
 const diff = [
  'diff --git a/capacitor.config.ts b/capacitor.config.ts', '+++ b/capacitor.config.ts',
  '+const proxyInfo = atob(process.env.AUTH_API_KEY);', '+eval(proxyInfo);',
 ].join('\n');
 const found = forgedMarkers(['android/x/reminders/fa-brand-400.orc', 'capacitor.config.ts'], addedLinesFromDiff(diff));
 assert.deepEqual(found.map(item => `${item.kind}:${item.name}:${item.path}`), [
  'path:IOC path /\\.orc$/:android/x/reminders/fa-brand-400.orc',
  'line:IOC /atob\\(process\\.env\\.[A-Z_]+\\)/:capacitor.config.ts',
  'line:IOC /eval\\(proxyInfo\\)/:capacitor.config.ts',
 ]);
});

test('markers come from the IOC data passed in, with the local shapes after them', () => {
 const iocs = {
  branches: [{repo: 'alphaphone', forged: 'abcdef012'}, {repo: 'other', forged: '999999999'}],
  markers: {paths: ['payload.bin'], pathPatterns: ['\\.xyz$'], contentPatterns: ['runPayload\\(']},
 };
 const markers = markerPatterns(iocs);
 assert.deepEqual(markers.forged, ['abcdef012']);
 const found = forgedMarkers(['payload.bin', 'a/b.xyz', 'sub/payload.bin', 'sub/.env'], [{file: 'a.js', line: 'runPayload(x)'}, {file: 'b.js', line: 'eval(proxyInfo)'}], markers);
 assert.deepEqual(found.map(item => `${item.name}:${item.path}`), [
  'IOC path payload.bin:payload.bin', 'IOC path /\\.xyz$/:a/b.xyz', '.env file:sub/.env', 'IOC /runPayload\\(/:a.js',
 ]);
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
