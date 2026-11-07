// Alpha's Android host is data for the pinned upstream generator (AP-02). These checks run the
// real generator against a temporary copy of the descriptor's inputs; they do not run Gradle and
// are not APK, emulator or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateAndroidConsumerHost} from '../vendor/eliza/packages/app/scripts/mobile/android/consumer-host.mjs';
import {RESIDENT_NOTIFICATION_CLASSES, residentHelperKind, residentHostIdentity} from '../vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs';
import {HOST_DESCRIPTOR, PATCHED_NATIVE_ROOT, hostIdentity, hostProfile, mapReferences, readHostDescriptor} from '../scripts/android-host.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const identity = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
const descriptor = readHostDescriptor(ROOT);

function references(value, found = []) {
 if (Array.isArray(value)) value.forEach(item => references(item, found));
 else if (value && typeof value === 'object') {
  if (typeof value.root === 'string' && typeof value.path === 'string' && Object.keys(value).length === 2) found.push(value);
  else Object.values(value).forEach(item => references(item, found));
 }
 return found;
}

/** A temporary consumer holding exactly the descriptor's consumer inputs, with a fake patched staging. */
function consumer(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-android-host-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const staging = path.join(root, '.eliza/patched-native/test');
 for (const reference of references(descriptor.profile)) {
  const base = reference.root === 'consumer' ? root : reference.root === PATCHED_NATIVE_ROOT ? staging : null;
  if (!base || reference.path === '.') continue;
  const source = reference.root === 'consumer' ? path.join(ROOT, reference.path) : path.join(ROOT, 'vendor/eliza', reference.path);
  const target = path.join(base, reference.path);
  if (reference.path === '.source.json') { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, '{}\n'); }
  else if (fs.statSync(source).isDirectory()) fs.mkdirSync(target, {recursive: true});
  else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(source, target); }
 }
 fs.copyFileSync(path.join(ROOT, 'app.config.json'), path.join(root, 'app.config.json'));
 return {root, staging};
}

function generate(t) {
 const {root, staging} = consumer(t);
 const result = generateAndroidConsumerHost({
  consumerRoot: root, upstreamRoot: path.join(ROOT, 'vendor/eliza'), dependencyRoot: path.join(ROOT, 'node_modules'),
  output: path.join(root, 'android'), inPlace: true, identity: hostIdentity(root), profile: hostProfile(root, {patchedNativeRoot: staging}),
 });
 const profile = JSON.parse(fs.readFileSync(path.join(root, 'android/.eliza-consumer-profile.json'), 'utf8'));
 return {root, staging, result, profile};
}

test('the pinned generator accepts the descriptor and owns identity, version and signing policy', t => {
 const {root, profile} = generate(t);
 assert.deepEqual(profile.identity, {appId: identity.appId, appName: identity.appName, version: identity.version, versionCode: identity.versionCode});
 assert.deepEqual(profile.sdk, {min: 29, target: 36, compile: 36});
 assert.deepEqual(profile.signing, {storeFile: 'ELIZAOS_KEYSTORE_PATH', storePassword: 'ELIZAOS_KEYSTORE_PASSWORD', keyAlias: 'ELIZAOS_KEY_ALIAS', keyPassword: 'ELIZAOS_KEY_PASSWORD'});
 assert.deepEqual(profile.versionOverride, {versionCode: 'ELIZAOS_VERSION_CODE', versionName: 'ELIZAOS_VERSION_NAME'});
 assert.deepEqual(profile.manifestPlaceholders, {appOrientation: identity.orientation});
 // The four distribution APKs: standalone and launcher, each debug and release.
 assert.deepEqual(profile.flavors.map(flavor => [flavor.name, flavor.buildConfigFields.find(field => field.name === 'IS_LAUNCHER').value]), [['standalone', 'false'], ['launcher', 'true']]);
 assert.equal(profile.flavors[0].manifest, fs.realpathSync(path.join(root, 'android/app/src/standalone/AndroidManifest.xml')));
 assert.equal(profile.manifest, fs.realpathSync(path.join(root, 'android/app/src/main/AndroidManifest.xml')));
 assert.equal(profile.releaseMinify, true);
 assert.equal(profile.buildTypes.release.shrinkResources, true);
 assert.deepEqual(profile.buildTypes.release.abiFilters, ['arm64-v8a']);
 // Debug ABIs follow the explicit runtime selection in android/app/product.gradle
 // (ELIZA_ANDROID_TARGET_ABIS / ELIZA_ANDROID_BUN_TARGET), so the descriptor fixes none.
 assert.deepEqual(profile.buildTypes.debug.abiFilters, []);
 assert.equal(profile.preserveRuntimeBytes, true, 'packaged resident runtime bytes keep their provenance');
 assert.equal(profile.kotlin, false);
 const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
 assert.match(gradle, /keepDebugSymbols \+= \["\*\*\/libeliza_\*\.so", "\*\*\/libsigsys-handler\.so"\]/);
 assert.match(fs.readFileSync(path.join(root, 'android/eliza-consumer-host/res/values/eliza_consumer_identity.xml'), 'utf8'), new RegExp(`name="app_name"[^>]*>"${identity.appName}"<`));
});

test('test mocks reach debug variants only and product admission runs before every build', t => {
 const {root, staging, profile} = generate(t);
 assert.equal(profile.testMocks.property, 'ELIZA_DEV_ALLOW_TEST_MOCKS');
 assert.equal(profile.testMocks.buildConfigField, 'ELIZA_DEV_ALLOW_TEST_MOCKS');
 assert.deepEqual(Object.keys(profile.testMocks.debug), ['java', 'res', 'manifest']);
 assert.equal(profile.testMocks.debug.manifest, fs.realpathSync(path.join(root, 'android/app/src/testMocks/AndroidManifest.xml')));
 assert.deepEqual(profile.admission.map(step => [step.name, step.command, step.directory]), [
  ['stageLocalAgentSources', ['node', 'scripts/stage-local-agent-sources.mjs'], fs.realpathSync(root)],
  ['verifyCloudDeployment', ['node', 'scripts/cloud-deployment.mjs', '--check'], fs.realpathSync(root)],
 ]);
 assert.deepEqual(profile.settingsAdmission.map(step => step.command), [['node', 'scripts/prepare-patched-native.mjs']]);
 assert.deepEqual(profile.assetFiles, [
  {source: fs.realpathSync(path.join(staging, '.source.json')), name: 'native-patches.json'},
  {source: fs.realpathSync(path.join(root, 'config/owner-routes.json')), name: 'owner-routes.json'},
 ]);
 assert.deepEqual(profile.generatedSources, [{sourceSet: 'main', kind: 'java', path: 'generated/local-agent/java'}]);
 assert.deepEqual(profile.appScripts, [fs.realpathSync(path.join(root, 'android/app/product.gradle'))]);
 assert.deepEqual(profile.generationInputs.map(input => path.relative(fs.realpathSync(root), input.file)).sort(),
  ['android/consumer-host.json', 'app.config.json', 'patches/eliza/native-manifest.json', 'scripts/android-host.mjs', 'scripts/prepare-patched-native.mjs', 'upstream.lock.json']);
 // Product admission that depends on Gradle properties stays in Alpha's product script.
 const product = fs.readFileSync(path.join(ROOT, 'android/app/product.gradle'), 'utf8');
 for (const task of ['verifyEmbeddingHost', 'verifyParadeeAppLinkage', 'verifyVoiceHost', 'verifyRuntimeWebProfile'])
  assert.match(product, new RegExp(`tasks\\.register\\('${task}'`));
 assert.doesNotMatch(product, /\b(signingConfigs|productFlavors|applicationId|minSdk|targetSdk|compileSdk|keystore)\b/i, 'the product script holds no generator-owned policy');
});

test('the listener, fixtures and test sources never link into either distribution APK', t => {
 const {profile} = generate(t);
 const linked = profile.modules.filter(module => module.appDependency).map(module => module.name);
 const separate = profile.modules.filter(module => !module.appDependency).map(module => module.name).sort();
 assert.deepEqual(separate, ['notification-fixture', 'sense', 'sense-speech', 'video-fixture']);
 // Shared checkouts, node_modules and the authenticated patched staging never receive build outputs.
 assert.deepEqual(profile.modules.filter(module => !module.relocateBuild).map(module => module.name).sort(),
  ['local-speech', 'notification-fixture', 'sense', 'sense-speech', 'video-fixture']);
 for (const name of ['capacitor-android', 'local-speech', 'eliza-system', 'eliza-contacts', 'elizaos-capacitor-secure-store']) assert.ok(linked.includes(name), name);
 assert.ok(!profile.sourceSets.main, 'main sources stay in the standard android/app/src layout');
 assert.deepEqual(profile.dependencies.find(dependency => dependency.coordinate.startsWith('androidx.webkit:webkit:')).coordinate, `androidx.webkit:webkit:${profile.toolchain.versions.androidxWebkitVersion}`);
});

test('generated files are build outputs: every one is git-ignored and none is authored', t => {
 const {result} = generate(t);
 const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map(line => line.trim()).filter(line => line.startsWith('android/'));
 for (const file of [...result.files, '.eliza-consumer-host.json']) {
  const relative = `android/${file}`;
  assert.ok(ignored.some(rule => rule.endsWith('/') ? relative.startsWith(rule) : relative === rule), `${relative} is git-ignored`);
  assert.equal(fs.existsSync(path.join(ROOT, 'android', file)) && !fs.statSync(path.join(ROOT, 'android', file)).isFile(), false);
 }
});

test('installed resident identities stay Alpha data-compatibility names', () => {
 const host = residentHostIdentity({packageName: identity.appId, ...descriptor.residentHost});
 assert.deepEqual(host.sockets, {agent: `${identity.appId}.agent.v1`, inference: `${identity.appId}.inference.v1`, secureStore: `${identity.appId}.secure-store`});
 assert.equal(host.notification.smallIcon, 'notification_icon');
 assert.deepEqual(host.environmentHook, {className: 'AlphaLocalAgentPlugin', method: 'configureEnvironment', unavailableStatus: 'provider-unavailable'});
 assert.deepEqual(host.lifecycleHooks, {rootPublication: {className: 'AlphaLocalAgentPlugin', method: 'publishNotificationRoot'}, ready: {className: 'AlphaCanonicalNotifications', method: 'resumeExisting'}});
 assert.equal(host.notification.channelLabel, 'Alpha');
 // Alpha's notification session compiles every shared notification class in its own package.
 assert.deepEqual([...descriptor.residentHost.classes].sort(), [...RESIDENT_NOTIFICATION_CLASSES].sort());
 for (const name of Object.values(host.notification.strings))
  assert.match(fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/alpha-system-entry.xml'), 'utf8'), new RegExp(`<string name="${name}"`), name);
 // Shared helpers keep their packages; only the reviewed BuildConfig reader is rewritten for Alpha.
 assert.equal(new Set(descriptor.residentHost.helpers).size, descriptor.residentHost.helpers.length);
 assert.deepEqual(descriptor.residentHost.helpers.filter(helper => residentHelperKind(helper) !== 'verbatim').map(helper => path.posix.basename(helper)), ['ChromiumBrowserConnection.java']);
 for (const helper of descriptor.residentHost.helpers) assert.ok(fs.statSync(path.join(ROOT, 'vendor/eliza', helper)).isFile(), helper);
});

test('patched-native references resolve to the staging or, for scanners, to the pinned descriptors', () => {
 const reference = {root: PATCHED_NATIVE_ROOT, path: 'plugins/plugin-native-system/android'};
 assert.deepEqual(mapReferences({a: [reference, {root: 'consumer', path: 'x'}], b: 1}, value => ({root: 'consumer', path: `s/${value.path}`})),
  {a: [{root: 'consumer', path: 's/plugins/plugin-native-system/android'}, {root: 'consumer', path: 'x'}], b: 1});
 const canonical = hostProfile(ROOT, {canonical: true});
 assert.equal(JSON.stringify(canonical).includes(PATCHED_NATIVE_ROOT), false);
 assert.deepEqual(canonical.modules.find(module => module.name === 'eliza-system').source, {root: 'upstream', path: 'plugins/plugin-native-system/android'});
 assert.throws(() => hostProfile(ROOT, {patchedNativeRoot: os.tmpdir()}), /inside this checkout/);
 assert.equal(HOST_DESCRIPTOR, 'android/consumer-host.json');
});
