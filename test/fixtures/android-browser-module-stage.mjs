import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateAlphaAndroidHost, HOST_DESCRIPTOR, readHostDescriptor} from '../../scripts/android-host.mjs';
import {NATIVE_SOURCE_MANIFEST, preparePatchedNative, verifyNativePatchReceipt} from '../../scripts/prepare-patched-native.mjs';
import {sha, upstreamNativeSource} from '../../scripts/upstream-native-source.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeManifest = NATIVE_SOURCE_MANIFEST;
const ownerRoutes = '.eliza/generated-android/owner-routes.json';
const lock = 'upstream.lock.json';
const modulePath = 'plugins/plugin-native-browser-surface/android';
const resourcePath = 'plugins/plugin-native-browser-surface/resources';
const modules = [modulePath, resourcePath];
const preparedScript = 'scripts/prepare-patched-native.mjs';
const sdk = 'vendor/eliza/';
const generator = 'packages/app/scripts/mobile/android/consumer-host';
const wrapper = 'packages/app/platforms/android/';
const wrapperFiles = ['gradle/wrapper/gradle-wrapper.jar', 'gradlew', 'gradlew.bat'].map(name => wrapper+name);
const producerFiles = [generator+'.mjs', 'packages/app/scripts/lib/android-runtime-packaging.ts',
  ...['app.gradle', 'build.gradle', 'settings.gradle', 'toolchain.json'].map(name => `${generator}/${name}`)];
const write = (file, data) => {fs.mkdirSync(dirname(file), {recursive: true});fs.writeFileSync(file, data);};
const read = file => fs.readFileSync(join(root, file));
const gitEnv = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
const git = (directory, ...args) => execFileSync('git', ['--no-lazy-fetch', '-C', directory,
  '-c', 'user.name=Quint Fixture', '-c', 'user.email=quint-fixture@localhost', ...args], {env: gitEnv, encoding: 'utf8'}).trim();

function inputs() {
  const descriptor = readHostDescriptor(root);
  const profile = descriptor.profile;
  const inventory = JSON.parse(read(nativeManifest));
  const browser = profile.modules.find(row => row.name === 'eliza-browser');
  assert.deepEqual(browser.source, {root: 'patchedNative', path: modulePath});
  assert.equal(browser.relocateBuild, true);
  for (const module of modules) assert.ok(inventory.modules.includes(module));
  assert.deepEqual(inventory.patches.filter(patch=>modules.includes(patch.module)||patch.targets.some(target=>
    modules.some(module=>target.path===module||target.path.startsWith(module+'/')))), [],
  'This browser fixture compiles exact unpatched browser sources; unrelated native module patches remain independent');
  assert.ok(!descriptor.residentHost.helpers.some(file => file.startsWith(modulePath+'/')));
  const productFiles = [...new Set([...profile.generationInputs.map(row => row.path).filter(path => path !== ownerRoutes),
    profile.manifest.path, ...profile.flavors.map(row => row.manifest.path), 'scripts/upstream-native-source.mjs'])];
  return {descriptor, browser, productFiles};
}

export function androidBrowserModuleStageInputs() {
  const {productFiles} = inputs();
  const pin = JSON.parse(read(lock)).commit;
  const moduleFiles = git(join(root, sdk), 'ls-tree', '-r', '--name-only', pin, '--', ...modules).split('\n');
  return [...productFiles, ...[...wrapperFiles, ...producerFiles, ...moduleFiles].map(file => sdk+file)];
}

export function loadAndroidBrowserModuleFixture() {
  const {descriptor, browser, productFiles} = inputs();
  const source = upstreamNativeSource(root);
  const browserFiles = new Map(modules.flatMap(path => [...source.read(path)]));
  const wrapperInputs = wrapperFiles.flatMap(path => [...source.read(path)]);
  const expected = new Map([...browserFiles].map(([path, file]) => [path, file.sha256]));
  const manifests = productFiles.filter(path => path !== nativeManifest && path !== lock).map(path => [path, read(path)]);
  return directory => fixture({directory, descriptor, browser, browserFiles, wrapperInputs, expected, manifests});
}

function fixture({directory, descriptor, browser, browserFiles, wrapperInputs, expected, manifests}) {
  // The host generator records canonical paths, including macOS's /var -> /private/var alias.
  directory = fs.realpathSync(directory);
  const upstream = join(directory, sdk), output = join(directory, 'android');
  const manifestPath = join(directory, nativeManifest);
  const sourceProbe = modulePath + '/build.gradle';
  const sourceFile = join(upstream, sourceProbe);
  const sourceBytes = browserFiles.get(sourceProbe).bytes;
  const profilePath = join(output, '.eliza-consumer-profile.json');
  const markerPath = join(output, '.eliza-consumer-host.json'), settings = join(output, 'settings.gradle');
  const cacheParent = join(directory, '.eliza/patched-native');
  for (const [path, bytes] of manifests) write(join(directory, path), bytes);
  for (const [path, file] of [...browserFiles, ...wrapperInputs]) {
    const target = join(upstream, path);write(target, file.bytes);fs.chmodSync(target, parseInt(file.mode, 8)&0o777);
  }
  fs.mkdirSync(join(directory, 'node_modules'));
  git(upstream, 'init', '--quiet');git(upstream, 'add', '.');git(upstream, 'commit', '--quiet', '-m', 'Reviewed browser module fixture');
  const pin = git(upstream, 'rev-parse', 'HEAD');
  write(join(directory, lock), JSON.stringify({commit: pin}));
  const manifest = {schema: 1, modules, patches: []};
  const variants = [2, 4].map(space => Buffer.from(JSON.stringify(manifest, null, space)+'\n'));
  const preparer = read(preparedScript);
  const destinations = variants.map(bytes => join(cacheParent, sha(Buffer.concat([Buffer.from(pin), bytes, preparer]))));
  const base = descriptor.profile;
  const normalizedProjection = {
    schema: base.schema, sdk: base.sdk, releaseMinify: base.releaseMinify, kotlin: base.kotlin,
    preserveRuntimeBytes: base.preserveRuntimeBytes, manifest: base.manifest, flavors: base.flavors,
    modules: [browser], dependencies: base.dependencies, generatedSources: base.generatedSources, generationInputs: base.generationInputs,
    settingsAdmission: base.settingsAdmission, assetFiles: base.assetFiles,
  };
  function select(generation) {write(manifestPath, variants[generation-1]);}
  function route(reviewed) {
    const module = reviewed ? browser : {...browser, source: {...browser.source, path: modulePath+'/missing'}};
    write(join(directory, HOST_DESCRIPTOR), JSON.stringify({...descriptor, profile: {...normalizedProjection, modules: [module]}}));
  }
  function sourceValid(valid) {write(sourceFile, valid ? sourceBytes : Buffer.concat([sourceBytes, Buffer.from('\n')]));}
  select(1);route(true);
  const activeGeneration = () => variants.findIndex(bytes => fs.readFileSync(manifestPath).equals(bytes))+1;

  function stage(generation) {
    const directory = destinations[generation-1];
    if (!fs.existsSync(directory)) return 'absent';
    const receipt = JSON.parse(fs.readFileSync(join(directory, '.source.json'), 'utf8'));
    assert.equal(receipt.baseCommit, pin);
    assert.equal(receipt.preparerSha256, sha(preparer));
    assert.equal(receipt.manifestSha256, sha(variants[generation-1]));
    assert.deepEqual(receipt.modules, modules);
    assert.deepEqual(Object.entries(receipt.files).sort(), [...expected].sort());
    const files = fs.readdirSync(directory, {recursive: true, withFileTypes: true}).filter(entry => !entry.isDirectory());
    assert.ok(files.every(entry => entry.isFile()));
    assert.equal(files.length, expected.size+1);
    return [...expected].every(([file, digest]) => {
      const staged = join(directory, file);
      assert.equal(Boolean(fs.statSync(staged).mode&0o100), browserFiles.get(file).mode === '100755');
      return sha(fs.readFileSync(staged)) === digest;
    }) ? 'exact' : 'drift';
  }

  function observe() {
    const selected = activeGeneration();assert.ok(selected > 0);
    const desc = JSON.parse(fs.readFileSync(join(directory, HOST_DESCRIPTOR), 'utf8'));
    const reviewed = desc.profile.modules[0].source.path === modulePath;
    const host = !fs.existsSync(markerPath) ? fs.existsSync(settings) ? 'unowned' : 'absent'
      : JSON.parse(fs.readFileSync(markerPath)).files.every(file => fs.existsSync(join(output, file))) ? 'published' : 'ownedIncomplete';
    let hostGeneration = 0, fresh = false;
    if (fs.existsSync(profilePath)) {
      const profile = JSON.parse(fs.readFileSync(profilePath));
      assert.equal(profile.modules.length, 1);
      const selectedModule = profile.modules[0];
      hostGeneration = destinations.findIndex(path => selectedModule.directory === join(path, modulePath))+1;
      assert.ok(hostGeneration > 0);
      assert.deepEqual(selectedModule, {name: 'eliza-browser', directory: join(destinations[hostGeneration-1], modulePath),
        appDependency: true, relocateBuild: true});
      assert.deepEqual(profile.assetFiles, [
        {name: 'native-patches.json', source: join(destinations[hostGeneration-1], '.source.json')},
        {name: 'owner-routes.json', source: join(directory, ownerRoutes)},
      ]);
      assert.deepEqual(profile.settingsAdmission, [{command: ['node', preparedScript], directory}]);
      assert.deepEqual(profile.generatedSources, base.generatedSources);
      fresh = profile.generationInputs.every(input => sha(fs.readFileSync(input.file)) === input.sha256);
    }
    if (host === 'published') {
      assert.deepEqual(fs.readFileSync(settings), read(sdk+generator+'/settings.gradle'));
      assert.match(fs.readFileSync(join(output, 'build.gradle'), 'utf8'), /profile\.modules\.findAll \{ it\.relocateBuild \}/);
      assert.match(fs.readFileSync(join(output, 'app/build.gradle'), 'utf8'), /profile\.modules\.findAll \{ it\.appDependency \}/);
    }
    assert.ok(!fs.existsSync(cacheParent)||fs.readdirSync(cacheParent).every(path => destinations.includes(join(cacheParent, path))));
    return {selected, reviewed, sourceValid: fs.readFileSync(sourceFile).equals(sourceBytes), stage1: stage(1), stage2: stage(2),
      host, hostGeneration, fresh};
  }

  function generate(fault) {
    const rename = fs.renameSync, writeFile = fs.writeFileSync;
    const selected = destinations[activeGeneration()-1];
    if (fault === 'publish') fs.renameSync = (from, to) => {
      if (to === selected && dirname(from) === cacheParent) throw Error('fixture source publication refused');
      return rename(from, to);
    };
    if (fault === 'hostWrite') fs.writeFileSync = (target, ...args) => {
      if (target === settings) throw Error('fixture generated settings write refused');
      return writeFile(target, ...args);
    };
    try {return generateAlphaAndroidHost(directory);}
    finally {fs.renameSync = rename;fs.writeFileSync = writeFile;}
  }
  function verifyReceipt(generation) {
    const prepared = preparePatchedNative({root: directory});
    return verifyNativePatchReceipt(fs.readFileSync(join(destinations[generation-1], '.source.json')), prepared);
  }
  function occupy(value) {
    if (value) write(settings, '// Existing fixture-owned Gradle file.\n');
    else {assert.equal(fs.readFileSync(settings, 'utf8'), '// Existing fixture-owned Gradle file.\n');fs.unlinkSync(settings);}
  }
  function drift() {fs.appendFileSync(join(destinations[activeGeneration()-1], modulePath, 'build.gradle'), '\n');}
  const digestFiles = (root, names) => Object.fromEntries(names.map(name => {
    const path = join(root, name);return [name, fs.existsSync(path) ? sha(fs.readFileSync(path)) : null];
  }));
  function hostSnapshot() {
    const marker = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath)) : null;
    return digestFiles(output, marker ? ['.eliza-consumer-host.json', ...marker.files] : ['settings.gradle']);
  }
  function cacheSnapshots() {
    return destinations.map(path => fs.existsSync(path) ? digestFiles(path, ['.source.json', ...expected.keys()]) : null);
  }
  return {observe, select, route, sourceValid, generate, verifyReceipt, occupy, drift, hostSnapshot, cacheSnapshots};
}
