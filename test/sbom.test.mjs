// The release SBOM is built offline from committed pins and must be reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {ROOT, VOICE_HOST, collectNotices, productionLockPackages} from '../scripts/generate-licenses.mjs';
import {LICENCE_NOT_RECORDED, buildSbom, integrityHash, renderSbom} from '../scripts/generate-sbom.mjs';
import {METADATA as GRADLE_METADATA, coordinateChecksum, parseVerificationMetadata} from '../scripts/gradle-verification.mjs';
import {packagedRuntimePresent} from '../scripts/generate-licenses.mjs';
import {sbomArgs} from '../scripts/build-android.mjs';
import {FLAGS} from '../scripts/licence-policy.mjs';
import {stageAgentBundleDependencies} from '../scripts/agent-bundle-dependencies.mjs';
import {execFileSync} from 'node:child_process';
import {embeddingProducerInputPaths, nativeInputPaths, nativeBinding, nativeInputs, nativeGenerated} from '../scripts/embedding-native-contract.mjs';
import {verifyEmbeddingInputs} from '../scripts/stage-embedding-host.mjs';

const sbom = buildSbom(ROOT);
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const lock = read('package-lock.json');
const byRef = new Map(sbom.components.map(component => [component['bom-ref'], component]));
const prop = (component, name) => component.properties.find(item => item.name === `alphaphone:${name}`)?.value;

test('the SBOM is deterministic CycloneDX with no timestamp', () => {
  assert.equal(renderSbom(buildSbom(ROOT)), renderSbom(sbom));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.6');
  assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(sbom.metadata.timestamp, undefined);
  assert.doesNotMatch(renderSbom(sbom), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no build time in the document');
  assert.doesNotMatch(renderSbom(sbom), new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no machine path in the document');
  assert.equal(byRef.size, sbom.components.length, 'component references are unique');
  assert.deepEqual(sbom.components.map(component => component['bom-ref']), [...byRef.keys()].sort((a, b) => a.localeCompare(b)));
  for (const component of sbom.components) {
    assert.ok(component.name && component.type, component['bom-ref']);
    assert.ok(prop(component, 'ships-in') && prop(component, 'source'), `${component['bom-ref']} says where it ships and where the pin lives`);
    for (const hash of component.hashes ?? []) assert.match(hash.content, /^[0-9a-f]+$/);
  }
});

test('every shipped npm package is listed with its lockfile integrity, and no dev package is', () => {
  const shipped = productionLockPackages(lock, ROOT);
  const npm = sbom.components.filter(component => component.purl?.startsWith('pkg:npm/'));
  assert.equal(npm.length, shipped.length);
  for (const pkg of shipped) {
    const component = npm.find(item => prop(item, 'source') === `package-lock.json ${pkg.key}`);
    assert.ok(component, pkg.key);
    assert.equal(component.version, pkg.version);
    assert.deepEqual(component.hashes, [integrityHash(lock.packages[pkg.key].integrity)]);
    assert.equal(component.hashes[0].alg, 'SHA-512');
    assert.equal(component.hashes[0].content.length, 128);
  }
  for (const name of Object.keys(read('package.json').dependencies)) assert.ok(npm.some(component => component.name === name), name);
  for (const name of ['vite', 'typescript', '@capacitor/cli', 'source-map-js', 'uuid']) assert.ok(!npm.some(component => component.name === name), `${name} is build tooling`);
  assert.equal(prop(sbom.metadata, 'package-lock-sha256'), createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex'));
});

test('fonts and OCR cores carry the hashes of the pinned bytes, and no web speech files ship', () => {
  const denton = byRef.get('font:apps/app/public/denton-300.woff2');
  assert.deepEqual(denton.hashes, [{alg: 'SHA-256', content: read('licenses/font-licenses.json').entries.find(entry => entry.name === 'Denton typeface').sha256[0]}]);
  // Proprietary, recorded on the owner's statement: never an open-source identifier, and flagged so nobody assumes it is redistributable.
  assert.deepEqual(denton.licenses, [{license: {name: 'LicenseRef-Commercial-Font'}}]);
  assert.deepEqual([prop(denton, 'licence-expression'), prop(denton, 'licence-flags')], ['LicenseRef-Commercial-Font', 'proprietary-licence-held-outside-repo']);
  assert.equal(prop(denton, 'open-source'), 'false');
  assert.equal(prop(denton, 'licence-evidence'), 'held-outside-repository: owner statement recorded in licenses/font-licenses.json; the licence document is not in this repository');
  const fraunces = sbom.components.filter(component => component.name.startsWith('Fraunces typeface'));
  assert.equal(fraunces.length, 2);
  for (const font of fraunces) {
    assert.deepEqual(font.licenses, [{license: {id: 'OFL-1.1'}}]);
    assert.deepEqual([prop(font, 'licence-expression'), prop(font, 'licence-flags')], ['OFL-1.1', 'none']);
    assert.equal(font.hashes[0].content, createHash('sha256').update(fs.readFileSync(path.join(ROOT, prop(font, 'source')))).digest('hex'));
  }
  for (const [file, digest] of Object.entries(read('licenses/tesseract-core/sources.json').cores)) assert.equal(byRef.get(`ocr-core:${file}`).hashes[0].content, digest);
  // The web build ships no speech model or inference runtime: local speech runs on the agent's libelizainference.
  assert.deepEqual(sbom.components.filter(component => /^browser-speech/.test(component['bom-ref']) || prop(component, 'ships-in') === 'web').map(component => component['bom-ref']), []);
});

test('Android coordinates, the voice host and the upstream pin match their records', () => {
  const classpath = read('licenses/android-runtime-classpath.json');
  const maven = sbom.components.filter(component => component.purl?.startsWith('pkg:maven/'));
  assert.deepEqual(maven.map(component => `${component.group}:${component.name}:${component.version}`).sort(), [...classpath.coordinates].sort());
  // Each coordinate carries the checksum Gradle enforces (android/gradle/verification-metadata.xml).
  const verification = parseVerificationMetadata(fs.readFileSync(path.join(ROOT, GRADLE_METADATA), 'utf8'));
  for (const component of maven) {
    const pinned = coordinateChecksum(verification, component.group, component.name, component.version);
    assert.deepEqual(component.hashes, [{alg: 'SHA-256', content: pinned.sha256}], component.name);
    assert.match(prop(component, 'hash'), new RegExp(`^${component.name.replace(/[.+]/g, '\\$&')}-.* from android/gradle/verification-metadata\\.xml, enforced by Gradle dependency verification`));
    // A coordinate with no archive says its checksum is of a metadata file, not of shipped code.
    assert.equal(/publishes no archive/.test(prop(component, 'hash')), !pinned.archive, component.name);
  }
  assert.equal(prop(sbom.metadata, 'gradle-verification-metadata-sha256'), createHash('sha256').update(fs.readFileSync(path.join(ROOT, GRADLE_METADATA))).digest('hex'));
  // Speech is the libelizainference voice host only (fixture coverage: test/voice-host-record.test.mjs).
  const banned = new RegExp(['on' + 'nx', 'sher' + 'pa', 'k2' + 'fsa', 'ort-' + 'wasm'].join('|'), 'i');
  assert.deepEqual(sbom.components.filter(component => banned.test(JSON.stringify(component))).map(component => component['bom-ref']), []);
  if (fs.existsSync(path.join(ROOT, VOICE_HOST))) {
    const record = read(VOICE_HOST);
    for (const abi of record.abis) for (const library of abi.libraries) assert.equal(byRef.get(`voice-host:${abi.abi}/${library.name}`).hashes[0].content, library.sha256);
    // Every recorded bundle file (Paradee, misaki, eSpeak NG data, the ASR slot, VAD, notices) is a component.
    for (const model of record.models) assert.equal(byRef.get(`voice-model:${model.path}`).hashes[0].content, model.sha256, model.path);
  } else assert.deepEqual(sbom.components.filter(component => /^voice-(host|model):/.test(component['bom-ref'])), []);
  const upstream = read('upstream.lock.json');
  assert.equal(sbom.components.find(component => component.name === 'elizaOS').version, upstream.commit);
  assert.match(prop(sbom.metadata, 'not-covered'), /resident runtime payload/);
  assert.match(prop(sbom.metadata, 'evidence'), /^source-pin inventory; not a scan of the contents of built APK/);
});

test('the embedding host is listed from its reviewed pins, without claiming it is staged', () => {
  const host = read('android/embedding-host/qualified-host.json');
  for (const library of host.libraries) {
    const component = byRef.get(`embedding-host:${host.abi}/${library.name}`);
    assert.deepEqual(component.hashes, [{alg: 'SHA-256', content: library.sha256}]);
    assert.equal(prop(component, 'bytes'), String(library.bytes));
    assert.ok(prop(component, 'source').includes(`engine ${host.forkPin}`));
    // The foundation job's unpackaged APKs contain no embedding host; the pin must not read as if they did.
    assert.match(prop(component, 'ships-in'), /legacy qualification record; incompatible with current Paradee engine/);
  }
  assert.equal(byRef.get('embedding-model:bge-small-en-v1.5-f16.gguf').hashes[0].content, host.model.sha256);
  let current = false;
  try { verifyEmbeddingInputs(ROOT, host, {requireProducerInputs: true}); current = true; } catch {}
  assert.equal(prop(byRef.get('embedding-model:bge-small-en-v1.5-f16.gguf'), 'ships-in'), host.requalification?.required === true
    ? 'legacy qualification record; requalification pending; not current packaged bytes'
    : current ? 'apk (only one that packages the resident runtime)'
      : 'legacy source record; superseded inputs; not current packaged bytes');
  // No licence is recorded for the engine or the model in this repository: say so, flagged.
  assert.deepEqual([prop(byRef.get(`embedding-host:${host.abi}/libelizainference.so`), 'licence-expression'), prop(byRef.get(`embedding-host:${host.abi}/libelizainference.so`), 'licence-flags')], [LICENCE_NOT_RECORDED, 'unverified']);
});

test('release-candidate options list what was built and never upgrade it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sbom-apks-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const apk = path.join(dir, 'standalone-release-unsigned.apk'), debug = path.join(dir, 'standalone-debug.apk');
  fs.writeFileSync(apk, 'release bytes'); fs.writeFileSync(debug, 'debug bytes');
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const row = (file, mode, extra) => ({file, sha256: digest(file), packageName: 'ai.elizaresearch.alphaphone', variant: 'standalone', mode, versionCode: 1, versionName: '0.1.0', signed: mode === 'debug', signerSha256: mode === 'debug' ? 'a'.repeat(64) : null, runtime: 'PACKAGED', ...extra});
  // A debug row that claims to be distributable is still not: only verify-apks release rows carry a verdict.
  fs.writeFileSync(path.join(dir, 'apk-manifest.json'), JSON.stringify({testMocks: false, results: [row(debug, 'debug', {distributable: true}), row(apk, 'release', {distributable: false})]}));
  const withApks = buildSbom(ROOT, {apks: dir});
  const apps = withApks.components.filter(component => component['bom-ref'].startsWith('apk:'));
  assert.deepEqual(apps.map(component => [component.name, component.hashes[0].content, prop(component, 'distributable'), prop(component, 'signed')]),
    [['standalone-debug.apk', digest(debug), 'false', 'true'], ['standalone-release-unsigned.apk', digest(apk), 'false', 'false']]);
  assert.match(prop(withApks.metadata, 'evidence'), /APK files listed by the SHA-256 that scripts\/verify-apks\.mjs recorded; not a scan of the contents/);
  assert.equal(withApks.components.length, sbom.components.length + 2);
  assert.doesNotMatch(renderSbom(withApks), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no machine path');
  // An APK that is no longer the recorded bytes is refused, as is a directory verify-apks never wrote to.
  fs.writeFileSync(apk, 'rebuilt after verification');
  assert.throws(() => buildSbom(ROOT, {apks: dir}), /standalone-release-unsigned\.apk is missing or is not the APK verify-apks recorded/);
  assert.throws(() => buildSbom(ROOT, {apks: path.join(dir, 'none')}), /apk-manifest\.json is missing/);
  // The staged runtime is read, never assumed: without a staged payload the option fails by name.
  if (!packagedRuntimePresent(ROOT)) assert.throws(() => buildSbom(ROOT, {packagedRuntime: true}), /--packaged-runtime: no resident runtime is staged\. Run: npm run agent:build-workflow-worker && npm run agent:stage-android/);
  else {
    const staged = buildSbom(ROOT, {packagedRuntime: true});
    assert.ok(staged.components.some(component => component['bom-ref'] === 'resident-runtime:android/app/src/main/assets/agent/agent-bundle.js'));
    assert.ok(staged.components.filter(component => component['bom-ref'].endsWith('#resident-runtime')).length > 100);
    assert.equal(prop(staged.metadata, 'not-covered'), undefined);
  }
  // The build writes it beside the APKs it verified; the resident payload is added only when one is staged.
  assert.deepEqual(sbomArgs('artifacts', dir), ['--out', path.join('artifacts', 'sbom', 'alphaphone.cdx.json'), '--apks', 'artifacts']);
  fs.mkdirSync(path.join(dir, 'android/app/src/main/assets/agent'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'android/app/src/main/assets/agent/agent-bundle.js'), '');
  assert.deepEqual(sbomArgs('artifacts', dir).slice(-1), ['--packaged-runtime']);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/build-android.mjs'), 'utf8'), /else run\("node", \["scripts\/generate-sbom\.mjs", \.\.\.sbomArgs\(outDir, root\)\]\);/);
});

test('staged native candidates retain their actual hashes when the embedding source record is superseded', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sbom-source-record-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (file, bytes) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes);
  };
  // Reuse read-only source dependencies while keeping all staged inputs isolated.
  for (const file of ['package.json', 'package-lock.json', 'upstream.lock.json', 'app.config.json',
    'licenses', 'node_modules', 'vendor', '.eliza', 'apps/app/public', 'android/consumer-host.json',
    'android/local-speech', GRADLE_METADATA]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.symlinkSync(path.join(ROOT, file), target);
  }
  const host = read('android/embedding-host/qualified-host.json');
  host.producerInputs[0].sha256 = '0'.repeat(64);
  write('android/embedding-host/qualified-host.json', JSON.stringify(host));
  const agent = 'android/app/src/main/assets/agent';
  const source = path.join(root, 'artifacts/local-agent-resident-' + 'a'.repeat(40));
  const bundle = 'console.log("synthetic runtime");';
  const manifest = JSON.stringify({name: 'synthetic-sbom-runtime', version: '1.0.0', license: 'MIT'});
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  write(`${agent}/agent-bundle.js`, bundle);
  write(`${agent}/alpha-source.json`, JSON.stringify({base: 'a'.repeat(40)}));
  write(`${agent}/android-agent-runtime-provenance.json`, JSON.stringify({bun: {version: '1.4.2', revision: 'b'.repeat(40), architectures: ['arm64-v8a']}}));
  write(`${agent}/workflow-worker/dependencies.json`, '[]');
  const sourceRelative = path.relative(root, source);
  write(`${sourceRelative}/node_modules/synthetic-sbom-runtime/package.json`, manifest);
  write(`${sourceRelative}/node_modules/synthetic-sbom-runtime/LICENSE`, 'MIT terms');
  write(`${sourceRelative}/packages/agent/dist-mobile/plugins-manifest.json`, JSON.stringify({
    bundle: 'agent-bundle.js', platform: 'android', bundleDependencies: {
      version: 1, bundleSha256: hash(bundle), packages: [{directory: 'node_modules/synthetic-sbom-runtime',
        name: 'synthetic-sbom-runtime', version: '1.0.0', packageJsonSha256: hash(manifest)}],
    },
  }));
  stageAgentBundleDependencies(source, path.join(root, agent));
  const previous = process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
  process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = source;
  t.after(() => {
    if (previous === undefined) delete process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
    else process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = previous;
  });
  const library = `android/app/src/main/jniLibs/${host.abi}/${host.libraries[0].name}`;
  write(library, 'rebuilt native candidate');
  write(host.model.path, 'rebuilt model candidate');
  const candidate = buildSbom(root, {packagedRuntime: true});
  const historicalModel = candidate.components.find(row => row['bom-ref'] === `embedding-model:${path.basename(host.model.path)}`);
  assert.equal(prop(historicalModel, 'ships-in'), 'legacy source record; superseded inputs; not current packaged bytes');
  assert.deepEqual(historicalModel.hashes, [{alg: 'SHA-256', content: host.model.sha256}]);
  assert.equal(prop(historicalModel, 'source'), `android/embedding-host/qualified-host.json (staged to ${host.model.path})`);
  for (const file of [library, host.model.path]) {
    const component = candidate.components.find(row => row['bom-ref'] === `resident-runtime:${file}`);
    assert.ok(component, `${file} is enumerated independently of the superseded pin`);
    assert.deepEqual(component.hashes, [{alg: 'SHA-256', content: hash(fs.readFileSync(path.join(root, file)))}]);
  }
  // Historical pending metadata scopes the old model without changing its hash or provenance.
  host.requalification = {required: true};
  write('android/embedding-host/qualified-host.json', JSON.stringify(host));
  const pendingModel = buildSbom(root).components.find(row => row['bom-ref'] === historicalModel['bom-ref']);
  assert.equal(prop(pendingModel, 'ships-in'), 'legacy qualification record; requalification pending; not current packaged bytes');
  assert.deepEqual(pendingModel.hashes, historicalModel.hashes);
  assert.equal(prop(pendingModel, 'source'), prop(historicalModel, 'source'));
  // Current source inputs make the expected hashes authoritative without a manual approval.
  const pin = read('upstream.lock.json').commit;
  const upstream = path.join(ROOT, 'vendor/eliza');
  const show = file => execFileSync('git', ['-C', upstream, 'show', `${pin}:${file}`]);
  const identity = read('app.config.json').appId;
  const binding = nativeBinding(show(nativeInputPaths.at(-1)).toString(), show(nativeInputPaths.at(-2)).toString(), identity);
  host.pin = pin;
  host.forkPin = execFileSync('git', ['-C', upstream, 'ls-tree', pin, 'plugins/plugin-local-inference/native/llama.cpp'], {encoding: 'utf8'}).match(/^160000 commit ([a-f0-9]{40})\t/)[1];
  host.jniBinding = binding;
  host.inputs = nativeInputs(binding).map(file => ({path: file, sourceSha256: hash(show(file)), generatedSha256: hash(nativeGenerated(file, show(file).toString(), identity, binding))}));
  host.producerInputs = embeddingProducerInputPaths.map(file => ({path: file, sha256: hash(show(file))}));
  host.requalification.required = false;
  write('android/embedding-host/qualified-host.json', JSON.stringify(host));
  const currentModel = buildSbom(root).components.find(row => row['bom-ref'] === historicalModel['bom-ref']);
  assert.equal(prop(currentModel, 'ships-in'), 'apk (only one that packages the resident runtime)');
  assert.deepEqual(currentModel.hashes, historicalModel.hashes);
  assert.equal(prop(currentModel, 'source'), prop(historicalModel, 'source'));
  assert.throws(() => buildSbom(root, {packagedRuntime: true}), /staged but is not the bytes pinned/);
});

test('every component carries its licence expression and flags, matching the notices', () => {
  const notices = new Map(collectNotices(ROOT, {packagedRuntime: false}).entries.map(entry => [`${entry.name}@${entry.version}`, entry]));
  for (const component of sbom.components) {
    assert.ok(prop(component, 'licence-expression'), component['bom-ref']);
    const flags = prop(component, 'licence-flags');
    assert.ok(flags === 'none' || flags.split(',').every(flag => FLAGS.includes(flag)), `${component['bom-ref']}: ${flags}`);
  }
  for (const component of sbom.components.filter(item => item.purl?.startsWith('pkg:npm/'))) {
    const notice = notices.get(`${component.name}@${component.version}`);
    assert.equal(prop(component, 'licence-expression'), notice.license, component.name);
    assert.equal(prop(component, 'licence-flags'), notice.flags.join(',') || 'none', component.name);
  }
  const npm = name => sbom.components.find(component => component.purl?.startsWith('pkg:npm/') && component.name === name);
  assert.deepEqual([prop(npm('mediabunny'), 'licence-expression'), prop(npm('mediabunny'), 'licence-flags')], ['MPL-2.0', 'copyleft-weak']);
  assert.equal(prop(npm('tr46'), 'licence-flags'), 'licence-text-missing-from-package');
  assert.deepEqual([prop(npm('react'), 'licence-expression'), prop(npm('react'), 'licence-flags')], ['MIT', 'none']);
  for (const component of sbom.components.filter(item => item.purl?.startsWith('pkg:maven/'))) {
    // Google native authentication artifacts have no reviewed licence family yet.
    // Keep that uncertainty visible rather than assuming every Maven dependency is Apache-2.0.
    const unreviewedGoogle = ['com.google.android.gms', 'com.google.android.libraries.identity.googleid'].includes(component.group);
    const expected = unreviewedGoogle ? ['UNKNOWN', 'unknown-licence']
      : [component.group === 'org.checkerframework' && component.name === 'checker-qual' ? 'MIT' : 'Apache-2.0', 'none'];
    assert.deepEqual([prop(component, 'licence-expression'), prop(component, 'licence-flags')], expected, component.name);
  }
  // A component whose licence this inventory does not record says so and is flagged, never left blank.
  const unrecorded = sbom.components.filter(component => prop(component, 'licence-expression') === LICENCE_NOT_RECORDED);
  assert.ok(unrecorded.length > 0);
  for (const component of unrecorded) assert.equal(prop(component, 'licence-flags'), 'unverified', component['bom-ref']);
  // Flags never fail the SBOM: the script exits 0 and prints them as warnings.
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sbom-')), 'sbom.json');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/generate-sbom.mjs'), '--out', out], {cwd: ROOT, encoding: 'utf8'});
  fs.rmSync(path.dirname(out), {recursive: true, force: true});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^LICENCE FLAG copyleft-weak: mediabunny@[^ ]+ \(MPL-2\.0\)$/m);
  assert.match(run.stderr, /^LICENCE FLAG proprietary-licence-held-outside-repo: Denton typeface /m);
});
