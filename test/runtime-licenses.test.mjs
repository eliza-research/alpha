// Runtime notice enumeration on a synthetic staged payload; not APK or legal evidence.
// Policy P-09: a copyleft, unknown or text-less package is listed and flagged; only broken input fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentBundleDependencyDirs, agentBundlePackageDirs, BUN_ENTRY, collectNotices, finishEntry, loadTemplates, packagedRuntimePresent, runtimeEntries, ROOT, shippedPackagedRuntime, UNKNOWN, UNVERIFIED } from '../scripts/generate-licenses.mjs';
import { licenceFlagLines } from '../scripts/licence-policy.mjs';

const canonicalTexts = { MIT: 'MIT terms', ISC: 'ISC terms', 'Apache-2.0': 'Apache terms', 'BSD-3-Clause': 'BSD terms' };
const templates = { mit: 'MIT terms', isc: 'ISC terms', apache: 'Apache terms', canonical: expression => canonicalTexts[expression] ?? '' };

function stagedRuntime(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-runtime-notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agent = path.join(root, 'android/app/src/main/assets/agent');
  const source = path.join(root, 'artifacts/local-agent-resident-' + 'a'.repeat(40));
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write(path.join(agent, 'agent-bundle.js'), [
    '// @bun', 'var x = 1;',
    '// ../../node_modules/.bun/zod@4.1.0/node_modules/zod/index.js',
    '// ../../node_modules/.bun/zod@4.1.0/node_modules/zod/v4/core.js',
    '// ../../node_modules/.bun/@scope+pkg@2.0.0+abc/node_modules/@scope/pkg/dist/a.js',
    '// ../../node_modules/hoisted/lib/index.js',
    '// ../../packages/core/src/index.ts',
    '  // ../../node_modules/.bun/indented@1.0.0/node_modules/indented/x.js',
  ].join('\n'));
  write(path.join(agent, 'android-agent-runtime-provenance.json'), JSON.stringify({ bun: { version: '1.4.2', revision: 'b'.repeat(40), architectures: ['x86_64', 'arm64-v8a'] } }));
  write(path.join(agent, 'alpha-source.json'), JSON.stringify({ base: 'a'.repeat(40) }));
  write(path.join(source, 'node_modules/.bun/zod@4.1.0/node_modules/zod/package.json'), JSON.stringify({ name: 'zod', version: '4.1.0', license: 'MIT' }));
  write(path.join(source, 'node_modules/.bun/zod@4.1.0/node_modules/zod/LICENSE'), 'zod license text');
  write(path.join(source, 'node_modules/.bun/@scope+pkg@2.0.0+abc/node_modules/@scope/pkg/package.json'), JSON.stringify({ name: '@scope/pkg', version: '2.0.0', license: { type: 'ISC' } }));
  write(path.join(source, 'node_modules/hoisted/package.json'), JSON.stringify({ name: 'hoisted', version: '0.1.0', license: 'Apache-2.0' }));
  write(path.join(agent, 'workflow-worker/dependencies.json'), JSON.stringify([
    { name: 'zod', version: '4.1.0', license: 'MIT', sourcePath: 'node_modules/zod', notices: ['licenses/1/LICENSE'] },
    { name: 'effect', version: '4.0.0', license: 'MIT', sourcePath: 'node_modules/effect', notices: [] },
  ]));
  write(path.join(agent, 'workflow-worker/licenses/1/LICENSE'), 'zod license text');
  return { root, agent, source };
}

test('bundle path comments name each contributing npm package once, never workspace sources', () => {
  assert.deepEqual(agentBundlePackageDirs([
    '// ../../node_modules/.bun/a@1.0.0/node_modules/a/x.js', '// ../../node_modules/.bun/a@1.0.0/node_modules/a/y.js',
    '// node_modules/.bun/@s+b@2.0.0/node_modules/@s/b/z.js', '// ../../plugins/plugin-sql/src/index.ts', 'var s = "// ../../node_modules/fake/x.js";',
  ].join('\n')), ['node_modules/.bun/@s+b@2.0.0/node_modules/@s/b', 'node_modules/.bun/a@1.0.0/node_modules/a']);
});

test('a minified bundle names its packages from build metadata bound to the staged bundle bytes', t => {
  const agent = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-bundle-inventory-'));
  t.after(() => fs.rmSync(agent, { recursive: true, force: true }));
  const bundle = Buffer.from('var a=1;'), sha = createHash('sha256').update(bundle).digest('hex');
  const write = value => fs.writeFileSync(path.join(agent, 'plugins-manifest.json'), JSON.stringify({ bundleDependencies: value }));
  const packages = [{ directory: 'node_modules/.bun/b@2.0.0/node_modules/b' }, { directory: 'node_modules/.bun/a@1.0.0/node_modules/a' }, { directory: 'node_modules/.bun/a@1.0.0/node_modules/a' }];
  let errors = [];
  write({ version: 1, bundleSha256: sha, packages });
  assert.deepEqual(agentBundleDependencyDirs(agent, bundle, errors), ['node_modules/.bun/a@1.0.0/node_modules/a', 'node_modules/.bun/b@2.0.0/node_modules/b']);
  assert.deepEqual(errors, []);
  // Metadata for other bundle bytes is broken input, never a silently short inventory.
  write({ version: 1, bundleSha256: 'f'.repeat(64), packages });
  assert.deepEqual(agentBundleDependencyDirs(agent, bundle, errors), []);
  assert.match(errors[0], /does not describe the staged agent-bundle\.js/);
  errors = [];
  write({ version: 1, bundleSha256: sha, packages: [{ directory: 'node_modules/../../etc' }, { directory: '/abs' }] });
  assert.deepEqual(agentBundleDependencyDirs(agent, bundle, errors), []);
  assert.equal(errors.length, 2);
  // An older unminified bundle without recorded metadata keeps its path-comment inventory.
  fs.rmSync(path.join(agent, 'plugins-manifest.json'));
  assert.deepEqual(agentBundleDependencyDirs(agent, Buffer.from('// ../../node_modules/.bun/c@3.0.0/node_modules/c/x.js\n'), []), ['node_modules/.bun/c@3.0.0/node_modules/c']);
});

test('a PACKAGED runtime lists Bun with its LGPL notice and every bundled agent and worker package', t => {
  const { root, agent, source } = stagedRuntime(t);
  assert.equal(packagedRuntimePresent(root), true);
  const errors = [];
  const entries = runtimeEntries(root, templates, errors, { agentDir: agent, sourceDir: source });
  assert.deepEqual(errors, []);
  const byName = Object.fromEntries(entries.map(entry => [entry.name, entry]));
  const bun = byName['Bun JavaScript runtime (libeliza_bun.so)'];
  assert.ok(bun, 'Bun entry');
  assert.match(bun.version, /^1\.4\.2 \(oven-sh\/bun b{40}\)$/);
  assert.match(bun.text, /MIT terms/);
  assert.match(bun.text, /JavaScriptCore/);
  assert.match(bun.text, /LGPL/);
  assert.match(bun.text, /Corresponding source/);
  assert.match(bun.text, /Source offer/);
  assert.equal(bun.license, UNVERIFIED);
  assert.deepEqual(finishEntry(bun).flags, ['copyleft-weak', 'unverified'], 'statically linked LGPL JavaScriptCore is flagged');
  assert.match(finishEntry(bun).obligations[0].note, /user must be able to replace the library.*Corresponding source: https:\/\/github\.com\/oven-sh\/bun\/tree\/b{40}/);
  assert.equal(byName.zod.license, 'MIT');
  assert.deepEqual([byName.zod.textSource, finishEntry(byName.zod).flags], [undefined, []]);
  // A package or worker dependency with no licence file gets the canonical text of its declared licence, and a flag.
  for (const name of ['@scope/pkg', 'hoisted', 'effect']) assert.deepEqual([byName[name].textSource, finishEntry(byName[name]).flags], ['spdx-canonical', ['licence-text-missing-from-package']], name);
  assert.match(byName.hoisted.text, /ships no license file\. Its package\.json declares the Apache-2\.0 License\. The standard Apache-2\.0 terms follow\.\n\nApache terms/);
  assert.match(byName.effect.text, /workflow-worker artifact ships no license file/);
  assert.match(byName.zod.text, /agent bundle and workflow worker/);
  assert.equal(byName['@scope/pkg'].license, 'ISC');
  assert.equal(byName.hoisted.license, 'Apache-2.0');
  assert.match(byName.effect.text, /workflow worker/);
  assert.equal(entries.filter(entry => entry.name === 'zod').length, 1, 'deduplicated across bundles');
  // Isolate the fixture from a real prepared SDK override in the validation environment.
  const previousSource = process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
  try {
    delete process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
    assert.equal(runtimeEntries(root, templates, [], { agentDir: agent }).length, entries.length, 'default source comes from the staged stamp');
    const overridden = path.join(root, 'artifacts', 'custom-prepared-source');
    fs.renameSync(source, overridden);
    process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = overridden;
    assert.equal(runtimeEntries(root, templates, [], { agentDir: agent }).length, entries.length, 'explicit source override works without the default source');
  } finally {
    if (previousSource === undefined) delete process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
    else process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = previousSource;
  }
});

test('copyleft, unknown, undeclared and text-less runtime packages are listed and flagged, never an error', t => {
  const { root, agent, source } = stagedRuntime(t);
  const real = loadTemplates(ROOT);
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const pkg = (name, manifest, files = {}) => {
    const dir = path.join(source, 'node_modules', name);
    write(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
    for (const [file, text] of Object.entries(files)) write(path.join(dir, file), text);
    return `// ../../node_modules/${name}/index.js`;
  };
  const lines = [
    pkg('gpl-binary', { license: 'GPL-3.0-or-later', repository: 'github:example/gpl-binary' }, { LICENSE: real.canonical('GPL-3.0-or-later') }),
    pkg('agpl-lib', { license: 'AGPL-3.0-or-later' }, { 'LICENSE.md': real.canonical('AGPL-3.0-or-later') }),
    pkg('lgpl-lib', { license: 'LGPL-3.0-only' }, { LICENSE: 'lgpl-lib is licensed under the terms of the LGPLv3 license. See the website for the text.' }),
    pkg('blue-oak', { license: 'BlueOak-1.0.0' }, { 'LICENSE.md': '# Blue Oak Model License\n\nVersion 1.0.0' }),
    pkg('source-available', {}, { LICENSE: 'Copyright Example Inc. All rights reserved.\n\nYou may use the Program solely for Non-Commercial Use.' }),
    pkg('undeclared-mit', {}, { 'LICENSE.md': real.mit }),
    pkg('no-file-bsd', { license: 'BSD-3-Clause' }),
    pkg('nothing-at-all', {}),
    pkg('custom-id', { license: 'Example-Custom-1.0' }, { LICENSE: 'Example custom terms.' }),
  ];
  fs.appendFileSync(path.join(agent, 'agent-bundle.js'), `\n${lines.join('\n')}\n`);
  write(path.join(agent, 'workflow-worker/dependencies.json'), JSON.stringify([
    { name: '@worker/undeclared', version: '0.35.0', license: null, sourcePath: 'node_modules/@worker/undeclared', notices: ['licenses/2/LICENSE'] },
  ]));
  write(path.join(agent, 'workflow-worker/licenses/2/LICENSE'), real.mit);
  const errors = [];
  const entries = runtimeEntries(root, real, errors, { agentDir: agent, sourceDir: source }).map(finishEntry);
  assert.deepEqual(errors, []);
  const by = Object.fromEntries(entries.map(entry => [entry.name, entry]));
  const facts = name => [by[name].license, by[name].flags, by[name].textSource];
  assert.deepEqual(facts('gpl-binary'), ['GPL-3.0-or-later', ['copyleft-strong'], undefined]);
  assert.match(by['gpl-binary'].obligations[0].note, /Corresponding source: https:\/\/www\.npmjs\.com\/package\/gpl-binary\/v\/1\.0\.0 \(repository: https:\/\/github\.com\/example\/gpl-binary\)/);
  assert.match(by['gpl-binary'].text, /GNU GENERAL PUBLIC LICENSE/);
  assert.deepEqual(facts('agpl-lib'), ['AGPL-3.0-or-later', ['copyleft-strong', 'network-copyleft'], undefined]);
  // The licence file only names the LGPL: the canonical LGPL and GPL texts are added so the text itself ships.
  assert.deepEqual(facts('lgpl-lib'), ['LGPL-3.0-only', ['copyleft-weak', 'licence-text-missing-from-package'], 'package-and-spdx-canonical']);
  assert.match(by['lgpl-lib'].text, /licensed under the terms of the LGPLv3[\s\S]*GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3[\s\S]*GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.deepEqual(facts('blue-oak'), ['BlueOak-1.0.0', ['permissive-not-previously-listed'], undefined]);
  // Not open source: said so, never passed off as an open licence.
  assert.deepEqual(facts('source-available'), [UNKNOWN, ['unknown-licence', 'non-open-source-terms'], undefined]);
  assert.match(by['source-available'].obligations[1].note, /limits use to non-commercial use\. These are not open-source terms, so the open-source licence policy does not cover this item/);
  assert.match(by['source-available'].text, /solely for Non-Commercial Use/);
  assert.deepEqual(facts('undeclared-mit'), ['MIT', ['unverified'], undefined]);
  assert.match(by['undeclared-mit'].obligations[0].note, /manifest declares no licence\. MIT was identified from the text of the package's own licence file/);
  assert.deepEqual(facts('no-file-bsd'), ['BSD-3-Clause', ['licence-text-missing-from-package'], 'spdx-canonical']);
  assert.match(by['no-file-bsd'].text, /Neither the name of the copyright holder/);
  assert.deepEqual(facts('nothing-at-all'), [UNKNOWN, ['unknown-licence', 'licence-text-missing-from-package'], undefined]);
  assert.deepEqual(facts('custom-id'), ['Example-Custom-1.0', ['unknown-licence'], undefined]);
  assert.deepEqual(facts('@worker/undeclared'), ['MIT', ['unverified'], undefined]);
  for (const entry of entries) assert.ok(entry.text.trim() && entry.source.includes(entry.name.startsWith('Bun') ? 'oven-sh/bun' : `/package/${entry.name}/v/${entry.version}`), entry.name);
  const lines2 = licenceFlagLines(entries);
  assert.ok(lines2.includes('LICENCE FLAG copyleft-strong: gpl-binary@1.0.0 (GPL-3.0-or-later)'));
  assert.ok(lines2.includes('LICENCE FLAG network-copyleft: agpl-lib@1.0.0 (AGPL-3.0-or-later)'));
  assert.ok(lines2.includes('LICENCE FLAG unknown-licence: nothing-at-all@1.0.0 (UNKNOWN)'));
});

test('broken input still fails: a corrupted or nameless package manifest is an error, not a flag', t => {
  const { root, agent, source } = stagedRuntime(t);
  fs.writeFileSync(path.join(source, 'node_modules/.bun/zod@4.1.0/node_modules/zod/package.json'), '{"name": "zod", ');
  let errors = [];
  runtimeEntries(root, templates, errors, { agentDir: agent, sourceDir: source });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^agent bundle: .*node_modules\/zod: unreadable or corrupted package\.json/);
  fs.writeFileSync(path.join(source, 'node_modules/.bun/zod@4.1.0/node_modules/zod/package.json'), JSON.stringify({ license: 'MIT' }));
  errors = [];
  runtimeEntries(root, templates, errors, { agentDir: agent, sourceDir: source });
  assert.match(errors.join('\n'), /package\.json has no name and version/);
});

test('a missing prepared package or worker inventory fails generation', t => {
  const { root, agent, source } = stagedRuntime(t);
  fs.rmSync(path.join(source, 'node_modules/hoisted'), { recursive: true });
  fs.rmSync(path.join(agent, 'workflow-worker/dependencies.json'));
  const errors = [];
  runtimeEntries(root, templates, errors, { agentDir: agent, sourceDir: source });
  assert.ok(errors.some(error => /not in the prepared runtime source/.test(error)));
  assert.ok(errors.some(error => /dependencies\.json is missing/.test(error)));
});

test('without a staged runtime only the umbrella payload entry is shipped', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-no-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(packagedRuntimePresent(root), false);
  assert.deepEqual(runtimeEntries(root, templates, []), []);
});

test('runtime enumeration follows explicit modes independently of current checkout notices', () => {
  const isBun = entry => entry.name === BUN_ENTRY;
  // Baseline and packaged enumeration are both valid; this checkout may currently
  // carry either form after a real APK build. The isolated mode fixture below tests detection.
  const committed = collectNotices(ROOT, {packagedRuntime: false});
  assert.equal(committed.entries.some(isBun), false);
  assert.ok(committed.entries.some(entry => entry.name === 'On-device elizaOS agent runtime payload'));
  const packaged = collectNotices(ROOT, { packagedRuntime: true });
  if (packagedRuntimePresent(ROOT)) assert.ok(packaged.entries.some(isBun));
  else assert.ok(packaged.errors.some(error => /--packaged-runtime needs a staged runtime/.test(error)), 'refuses without a staged runtime');
});

test('generation follows the shipped mode, and --packaged-runtime is wired into the PACKAGED build', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-shipped-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(shippedPackagedRuntime(root), false, 'no shipped notices');
  fs.mkdirSync(path.join(root, 'apps/app/public/licenses'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/app/public/licenses/third-party-notices.json'), JSON.stringify([{ name: BUN_ENTRY }]));
  assert.equal(shippedPackagedRuntime(root), true);
  const resident = fs.readFileSync(path.join(ROOT, '.github/workflows/resident-android.yml'), 'utf8');
  assert.match(resident, /node scripts\/generate-licenses\.mjs --packaged-runtime\n/);
});

test('compiled Google host enumerates its actual scoped package inputs and deduplicates shared packages', t => {
 const {root,agent,source}=stagedRuntime(t);
 const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
 const packageRoot='node_modules/.bun/@noble+curves@2.2.0/node_modules/@noble/curves';
 write(path.join(root,packageRoot,'package.json'),JSON.stringify({name:'@noble/curves',version:'2.2.0',license:'MIT'}));
 write(path.join(root,packageRoot,'LICENSE'),'actual curves notice');
 const shared=path.relative(root,path.join(source,'node_modules/.bun/zod@4.1.0/node_modules/zod'));
 write(path.join(agent,'workflow-worker/manifest.json'),JSON.stringify({nativeGoogleHost:{inputs:{[packageRoot+'/esm/curve.js']:'a'.repeat(64),[packageRoot+'/esm/utils.js']:'b'.repeat(64),[shared+'/index.js']:'c'.repeat(64),'apps/app/src/host.ts':'d'.repeat(64)}}}));
 const errors=[];const entries=runtimeEntries(root,templates,errors,{agentDir:agent,sourceDir:source});assert.deepEqual(errors,[]);
 const curves=entries.filter(entry=>entry.name==='@noble/curves');assert.equal(curves.length,1);assert.equal(curves[0].version,'2.2.0');assert.match(curves[0].text,/actual curves notice/);assert.match(curves[0].text,/native Google host/);
 assert.equal(entries.filter(entry=>entry.name==='zod').length,1);assert.match(entries.find(entry=>entry.name==='zod').text,/agent bundle and workflow worker and native Google host/);
 fs.unlinkSync(path.join(root,packageRoot,'package.json'));const missing=[];runtimeEntries(root,templates,missing,{agentDir:agent,sourceDir:source});assert(missing.some(error=>error.includes('native Google host')&&error.includes('not in the prepared runtime')));
});
