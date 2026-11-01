// Gradle refuses any dependency or plugin artifact whose SHA-256 is not in the committed metadata.
// These checks read committed inputs and authenticate any patched descriptors: no Gradle run or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ALLOWED_REPOSITORIES, ALLOWED_REPOSITORY_URLS, CLASSPATH, HOST_TEMPLATES, METADATA, MIRROR_PROPERTY, REVIEWED_GROUPS, VERIFIED_TASKS, addArtifact, buildScripts, checkVerification, coordinateChecksum, declaredRepositories, parseVerificationMetadata, referencePath, repositoryProblem} from '../scripts/gradle-verification.mjs';
import {HOST_DESCRIPTOR} from '../scripts/android-host.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const text = read(METADATA);
const metadata = parseVerificationMetadata(text);

const SYSTEM_PLUGIN = 'vendor/eliza/plugins/plugin-native-system/android/build.gradle';
const CAPACITOR = 'node_modules/@capacitor/android/capacitor/build.gradle';
const PRODUCT = 'android/app/product.gradle';

/** A copy of the files --check reads, with some replaced (a null replacement leaves the file out). */
function mutated(t, replacements, prepare = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-gradle-verification-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const rel of new Set([METADATA, CLASSPATH, REVIEWED_GROUPS, HOST_DESCRIPTOR, `${HOST_TEMPLATES}/toolchain.json`, ...buildScripts(ROOT), ...Object.keys(replacements)])) {
    if (replacements[rel] === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
    fs.writeFileSync(path.join(root, rel), replacements[rel] ?? read(rel));
  }
  prepare(root);
  return checkVerification(root).problems;
}

test('the committed metadata verifies every artifact by SHA-256 and trusts nothing else', () => {
  assert.deepEqual(checkVerification(ROOT).problems, []);
  assert.deepEqual(metadata.configuration, {verifyMetadata: 'true', verifySignatures: 'false', trusted: false});
  assert.ok(metadata.components.length > 400, 'generated from the real build, not written by hand');
  for (const component of metadata.components)
    for (const artifact of component.artifacts) assert.ok(artifact.hashes.length >= 1 && artifact.hashes.every(hash => hash.algorithm === 'sha256' && /^[0-9a-f]{64}$/.test(hash.value)), `${component.group}:${component.name} ${artifact.name}`);
  // Gradle reads this file from the root project's gradle/ directory; no property can leave it lenient or off.
  // The generated host's gradle.properties is written by the pinned upstream generator.
  assert.doesNotMatch(read('vendor/eliza/packages/app/scripts/mobile/android/consumer-host.mjs'), /dependency\.verification/);
  for (const script of ['scripts/build-android.mjs', 'scripts/build-notification-fixture.mjs', 'scripts/generate-licenses.mjs'])
    assert.doesNotMatch(read(script), /dependency-verification|-F\b/, `${script} must not relax verification`);
  // Nor may the environment the scripts and workflows hand to Gradle (a system property turns it lenient or off).
  for (const file of ['scripts/toolchain.mjs', 'scripts/build-archive.mjs', ...fs.readdirSync(path.join(ROOT, '.github/workflows')).map(name => `.github/workflows/${name}`)])
    assert.doesNotMatch(read(file), /org\.gradle\.dependency\.verification|--dependency-verification/, `${file} must not relax verification`);
});

test('every coordinate that ships in the APKs is pinned, and the build tools are pinned for each CI host', () => {
  const classpath = JSON.parse(read(CLASSPATH));
  assert.equal(classpath.coordinates.length, 103, 'resolved runtime snapshot includes native Google sign-in dependencies');
  for (const coordinate of ['com.google.android.gms:play-services-auth:21.1.1', 'com.google.android.libraries.identity.googleid:googleid:1.1.1'])
    assert.ok(classpath.coordinates.includes(coordinate), coordinate);
  let archives = 0;
  for (const coordinate of classpath.coordinates) {
    const pinned = coordinateChecksum(metadata, ...coordinate.split(':'));
    assert.ok(pinned, coordinate);
    assert.match(pinned.sha256, /^[0-9a-f]{64}$/);
    if (pinned.archive) archives += 1; else assert.match(pinned.artifact, /\.(module|pom)$/, `${coordinate} publishes no archive`);
  }
  assert.ok(archives >= 55, `${archives} coordinates carry an archive checksum`);
  const aapt2 = metadata.components.filter(item => item.name === 'aapt2');
  assert.equal(aapt2.length, 1);
  for (const host of ['linux', 'osx', 'windows']) assert.ok(aapt2[0].artifacts.some(artifact => artifact.name === `aapt2-${aapt2[0].version}-${host}.jar`), host);
  for (const [group, name] of [['com.android.tools.build', 'gradle'], ['org.jetbrains.kotlin', 'kotlin-gradle-plugin'], ['com.android.tools.lint', 'lint-gradle']])
    assert.ok(metadata.components.some(item => item.group === group && item.name === name), `${group}:${name}`);
});

test('archives that only a library module compiles against are pinned too', () => {
  // The shared Cloud sign-in module (eliza-cloud-auth, packages/auth/android) compiles against
  // androidx.credentials 1.6.0, which pulls kotlin-stdlib 2.1.20 and older Kotlin/annotation jars.
  // The app's runtime classpath resolves newer versions, so CLASSPATH never lists these and the
  // runtime check above cannot see them; Gradle still verifies them in :eliza-cloud-auth:compile*.
  // Only the module metadata of kotlin-stdlib 2.1.20 was once recorded, which failed the
  // flag-off distribution build with "kotlin-stdlib-2.1.20.jar ... failed verification".
  assert.ok(read(HOST_DESCRIPTOR).includes('"packages/auth/android"'), 'eliza-cloud-auth is an included module');
  for (const [group, name, version] of [
    ['org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.20'], ['org.jetbrains.kotlin', 'kotlin-stdlib', '1.7.10'],
    ['org.jetbrains.kotlin', 'kotlin-stdlib-common', '1.7.10'], ['androidx.annotation', 'annotation', '1.2.0'],
    ['com.google.android.libraries.identity.googleid', 'googleid', '1.1.1'],
  ]) assert.equal(coordinateChecksum(metadata, group, name, version)?.archive, true, `${group}:${name}:${version} archive`);
});

test('the check rejects a missing pin, a weaker checksum, a trust exception, an unreviewed publisher and a new repository', t => {
  const without = text.replace(/<component group="androidx\.webkit" name="webkit"[\s\S]*?<\/component>\s*/, '');
  assert.notEqual(without, text);
  assert.match(mutated(t, {[METADATA]: without}).join('\n'), /androidx\.webkit:webkit:[\d.]+ ships in the APKs .* but has no SHA-256/);
  assert.match(mutated(t, {[METADATA]: text.replace('<sha256 value=', '<md5 value=')}).join('\n'), /exactly one SHA-256 checksum is expected/);
  // A second accepted value for an artifact, in either form Gradle reads, is a trust exception too.
  const first = /<sha256 value="([0-9a-f]{64})" origin="Generated by Gradle"\/>/.exec(text);
  assert.match(mutated(t, {[METADATA]: text.replace(first[0], `<sha256 value="${first[1]}" origin="Generated by Gradle"><also-trust value="${'e'.repeat(64)}"/></sha256>`)}).join('\n'), /exactly one SHA-256 checksum is expected/);
  assert.match(mutated(t, {[METADATA]: text.replace(first[0], `${first[0]}<sha256 value="${'e'.repeat(64)}" origin="Generated by Gradle"/>`)}).join('\n'), /exactly one SHA-256 checksum is expected/);
  assert.match(mutated(t, {[METADATA]: text.replace('</verify-signatures>', '</verify-signatures>\n      <trusted-artifacts><trust group="com.example"/></trusted-artifacts>')}).join('\n'), /trusted-artifacts.*are not used/);
  assert.match(mutated(t, {[METADATA]: text.replace('<verify-metadata>true', '<verify-metadata>false')}).join('\n'), /verify-metadata must be true/);
  assert.match(mutated(t, {[METADATA]: text.replace('<component group="androidx.webkit"', '<component group="com.example.unknown"')}).join('\n'), /publisher group com\.example\.unknown has not been reviewed/);
  assert.match(mutated(t, {[METADATA]: text.replace(/origin="Generated by Gradle"/, 'origin="pasted by hand"')}).join('\n'), /unexpected checksum origin pasted by hand/);
  assert.match(mutated(t, {[METADATA]: text.replace(/\s*<artifact name="aapt2-[^"]+-linux\.jar">[\s\S]*?<\/artifact>/, '')}).join('\n'), /aapt2 [^ ]+ has no linux archive recorded/);
  assert.deepEqual(mutated(t, {}), [], 'the unmodified copy passes');
  const rootScript = `${HOST_TEMPLATES}/build.gradle`;
  assert.match(mutated(t, {[rootScript]: read(rootScript).replace('allprojects { repositories { google(); mavenCentral() } }', "allprojects { repositories { google(); mavenCentral(); maven { url 'https://jitpack.io' } } }")}).join('\n'), /consumer-host\/build\.gradle declares repository maven \{ url 'https:\/\/jitpack\.io' \}, which names https:\/\/jitpack\.io/);
  // Included modules are part of the build: the pinned upstream plugins and Capacitor declare repositories of their own.
  const elsewhere = read(SYSTEM_PLUGIN).replace("'https://repo.maven.apache.org/maven2'", "'https://mirror.example/maven2'");
  assert.notEqual(elsewhere, read(SYSTEM_PLUGIN));
  assert.match(mutated(t, {[SYSTEM_PLUGIN]: elsewhere}).join('\n'), /plugin-native-system\/android\/build\.gradle declares repository maven .*which names https:\/\/mirror\.example\/maven2/);
  assert.match(mutated(t, {[CAPACITOR]: read(CAPACITOR).replace(/\nrepositories \{\n/, '\nrepositories {\n    flatDir { dirs \'libs\' }\n    mavenLocal()\n')}).join('\n'), /capacitor\/build\.gradle declares repository flatDir \{ dirs 'libs' \}, which is not a reviewed form[\s\S]*declares repository mavenLocal\(\), which is not a reviewed form/);
  assert.match(mutated(t, {[PRODUCT]: `${read(PRODUCT)}\nrepositories { maven { url = uri(System.getenv('SOMEWHERE')) } }\n`}).join('\n'), /android\/app\/product\.gradle declares repository maven .*which names no literal URL/);
  assert.match(mutated(t, {[SYSTEM_PLUGIN]: null}).join('\n'), /plugin-native-system\/android\/build\.gradle is missing: the repositories it declares cannot be checked/);
  // The upstream plugins swap Maven Central for a mirror when the root project names one; this repository never does.
  assert.match(read(SYSTEM_PLUGIN), new RegExp(`rootProject\\.ext\\.has\\('${MIRROR_PROPERTY}'\\)`));
  assert.match(mutated(t, {[PRODUCT]: `${read(PRODUCT)}\nrootProject.ext { ${MIRROR_PROPERTY} = 'https://mirror.example/maven2' }\n`}).join('\n'), /android\/app\/product\.gradle mentions mavenCentralMirrorUrl: a Maven Central mirror is not a reviewed source/);
  // The generator writes the host's gradle.properties itself, so its script is held to the same rule.
  const generator = `${HOST_TEMPLATES}.mjs`;
  assert.match(mutated(t, {[generator]: `${read(generator)}\n// ${MIRROR_PROPERTY}=https://mirror.example/maven2\n`}).join('\n'), /consumer-host\.mjs mentions mavenCentralMirrorUrl/);
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-gradle-none-'));
  t.after(() => fs.rmSync(missing, {recursive: true, force: true}));
  assert.match(checkVerification(missing).problems[0], /verification is off\. Run: npm run android:deps:write-verification/);
});

test('every Gradle script of the build declares only reviewed repositories and every reviewed group is in use', () => {
  // The generated root scripts name the three repositories; nothing else there.
  for (const script of [`${HOST_TEMPLATES}/settings.gradle`, `${HOST_TEMPLATES}/build.gradle`]) {
    const found = declaredRepositories(read(script));
    assert.ok(found.length > 0, script);
    for (const repository of found) assert.ok(ALLOWED_REPOSITORIES.includes(repository), `${script}: ${repository}`);
  }
  // Every module android/consumer-host.json includes is read, wherever its directory is.
  const scripts = buildScripts(ROOT);
  const {profile} = JSON.parse(read(HOST_DESCRIPTOR));
  assert.equal(scripts.length, 3 + profile.appScripts.length + profile.modules.length, 'host templates, the product script and one build.gradle per module');
  for (const expected of [PRODUCT, 'android/notification-fixture/build.gradle', CAPACITOR, SYSTEM_PLUGIN]) assert.ok(scripts.includes(expected), expected);
  assert.equal(referencePath({root: 'patchedNative', path: 'plugins/plugin-native-system/android'}), 'vendor/eliza/plugins/plugin-native-system/android');
  assert.throws(() => referencePath({root: 'elsewhere', path: 'x'}), /unknown root/);
  const urls = new Set();
  for (const script of scripts)
    for (const repository of declaredRepositories(read(script))) {
      assert.equal(repositoryProblem(repository), null, `${script}: ${repository}`);
      for (const url of repository.matchAll(/https?:[^'"]+/g)) urls.add(url[0]);
    }
  // The two URL forms are Maven Central and the Gradle plugin portal under their own names.
  assert.deepEqual([...urls].sort(), [...ALLOWED_REPOSITORY_URLS].sort());
  assert.deepEqual(declaredRepositories("repositories {\n google()\n maven {\n  url = 'https://a.example/m2'\n }\n flatDir{ dirs 'libs' }; mavenCentral()\n}\nbuildscript { repositories { gradlePluginPortal() } }"),
    ['google()', "maven { url = 'https://a.example/m2' }", "flatDir{ dirs 'libs' }", 'mavenCentral()', 'gradlePluginPortal()']);
  assert.throws(() => declaredRepositories('repositories { google()'), /Unbalanced repositories block/);
  const reviewed = JSON.parse(read(REVIEWED_GROUPS));
  assert.match(reviewed.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(reviewed.groups, [...new Set(metadata.components.map(item => item.group))].sort(), 'the reviewed list is exactly the groups in the metadata');
});

test('the write command covers every Gradle task the scripts run and is the only step that reaches the network', () => {
  const tasks = source => [...read(source).matchAll(/["'`](:[a-z-]+:[A-Za-z]+)["'`]/g)].map(match => match[1]);
  for (const task of [...tasks('scripts/build-android.mjs'), ...tasks('scripts/build-notification-fixture.mjs')]) assert.ok(VERIFIED_TASKS.includes(task), task);
  // build-android.mjs also composes per-variant task names in its low-disk path.
  for (const variant of ['Standalone', 'Launcher'])
    for (const suffix of ['Debug', 'Release', 'DebugAndroidTest']) assert.ok(VERIFIED_TASKS.includes(`:app:assemble${variant}${suffix}`));
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['android:deps:check'], 'node scripts/gradle-verification.mjs --check');
  assert.equal(scripts['android:deps:write-verification'], 'node scripts/gradle-verification.mjs --write');
  // verify and the push workflows never write metadata; they only read it (npm test) or let Gradle enforce it.
  assert.doesNotMatch(scripts.verify + scripts.test, /write-verification|--write/);
  for (const workflow of fs.readdirSync(path.join(ROOT, '.github/workflows'))) assert.doesNotMatch(read(`.github/workflows/${workflow}`), /write-verification|gradle-verification\.mjs --write/, workflow);
});

test('a host-specific archive is inserted in order and only once', () => {
  const sample = `<components>\n      <component group="g" name="aapt2" version="1">\n         <artifact name="aapt2-1-osx.jar">\n            <sha256 value="${'a'.repeat(64)}" origin="Generated by Gradle"/>\n         </artifact>\n         <artifact name="aapt2-1.pom">\n            <sha256 value="${'b'.repeat(64)}" origin="Generated by Gradle"/>\n         </artifact>\n      </component>\n</components>`;
  const component = {group: 'g', name: 'aapt2', version: '1'};
  let next = addArtifact(sample, component, 'aapt2-1-linux.jar', 'c'.repeat(64), 'origin');
  next = addArtifact(next, component, 'aapt2-1-windows.jar', 'd'.repeat(64), 'origin');
  assert.equal(addArtifact(next, component, 'aapt2-1-linux.jar', 'e'.repeat(64), 'origin'), next, 'an existing entry is never rewritten');
  assert.deepEqual(parseVerificationMetadata(next).components[0].artifacts.map(artifact => artifact.name), ['aapt2-1-linux.jar', 'aapt2-1-osx.jar', 'aapt2-1-windows.jar', 'aapt2-1.pom']);
  assert.throws(() => addArtifact(sample, {group: 'g', name: 'other', version: '1'}, 'x.jar', 'f'.repeat(64), 'origin'), /is not in the metadata/);
});

test('staged Java-only native patches retain their authenticated dependency descriptors', () => {
 assert.ok(buildScripts(ROOT).includes('vendor/eliza/plugins/plugin-native-secure-store/android/build.gradle'));
 assert.ok(!buildScripts(ROOT).some(name=>name.includes('android/elizaos-capacitor-secure-store/')));
});

/** A real Git-backed auth module: staging must authenticate both the source and patched bytes. */
function patchedAuth(t, addition, alterManifest = () => {}) {
 const target = 'packages/auth/android/build.gradle';
 return mutated(t, {}, root => {
  const upstream = path.join(root, 'vendor/eliza');
  const git = args => execFileSync('git', ['-C', upstream, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']);
  const pin = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'upstream.lock.json'), JSON.stringify({commit: pin}));
  const before = fs.readFileSync(path.join(upstream, target), 'utf8'), after = before + addition;
  assert.ok(before.endsWith('\n') && after.endsWith('\n'));
  const oldLines = before.slice(0, -1).split('\n'), newLines = after.slice(0, -1).split('\n');
  const patch = `--- a/${target}\n+++ b/${target}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${oldLines.map(line => '-'+line).join('\n')}\n${newLines.map(line => '+'+line).join('\n')}\n`;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = {schema: 1, baseCommit: pin, patches: [{module: 'packages/auth/android', file: 'auth.patch', sha256: sha(patch), targets: [{path: target, beforeSha256: sha(before), afterSha256: sha(after)}]}]};
  alterManifest(manifest);
  const patches = path.join(root, 'patches/eliza');
  fs.mkdirSync(patches, {recursive: true});
  fs.writeFileSync(path.join(patches, 'auth.patch'), patch);
  fs.writeFileSync(path.join(patches, 'native-manifest.json'), JSON.stringify(manifest));
 });
}

test('patched auth dependency descriptor is authenticated and scanned for unreviewed repositories', t => {
 assert.deepEqual(patchedAuth(t, "\ndependencies { implementation 'androidx.browser:browser:1.9.0' }\n"), []);
 assert.match(patchedAuth(t, '\nrepositories { mavenLocal() }\n').join('\n'), /\.eliza\/patched-native\/[^ ]+\/packages\/auth\/android\/build\.gradle declares repository mavenLocal\(\), which is not a reviewed form/);
 assert.match(patchedAuth(t, "\nrepositories { maven { url 'https://unreviewed.example/m2' } }\n").join('\n'), /packages\/auth\/android\/build\.gradle declares repository maven .*unreviewed\.example/);
 assert.match(patchedAuth(t, "\nrootProject.ext { mavenCentralMirrorUrl = 'https://unreviewed.example/m2' }\n").join('\n'), /packages\/auth\/android\/build\.gradle mentions mavenCentralMirrorUrl/);
 assert.throws(() => patchedAuth(t, '\nrepositories { google() }\n', manifest => {manifest.patches[0].sha256 = '0'.repeat(64);}), /Native patch digest mismatch/);
});
