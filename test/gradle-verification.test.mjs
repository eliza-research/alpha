// Gradle refuses any dependency or plugin artifact whose SHA-256 is not in the committed metadata.
// These checks read committed inputs and pinned descriptors without Gradle or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ALLOWED_REPOSITORIES, ALLOWED_REPOSITORY_URLS, CLASSPATH, HOST_TEMPLATES, METADATA, REVIEWED_GROUPS, addArtifact, buildScripts, checkVerification, coordinateChecksum, declaredRepositories, parseVerificationArgs, parseVerificationMetadata, referencePath, repositoryProblem} from '../scripts/gradle-verification.ts';
import {HOST_DESCRIPTOR} from '../scripts/android-host.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const text = read(METADATA);
const metadata = parseVerificationMetadata(text);

const SYSTEM_PLUGIN = 'vendor/eliza/plugins/plugin-native-system/android/build.gradle';
const CAPACITOR = 'node_modules/@capacitor/android/capacitor/build.gradle';
const PRODUCT = 'android/app/product.gradle';

/** A copy of the files --check reads, with some replaced (a null replacement leaves the file out). */
function mutated(t, replacements) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-gradle-verification-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const rel of new Set([METADATA, CLASSPATH, REVIEWED_GROUPS, HOST_DESCRIPTOR, `${HOST_TEMPLATES}/toolchain.json`, ...buildScripts(ROOT), ...Object.keys(replacements)])) {
    if (replacements[rel] === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
    fs.writeFileSync(path.join(root, rel), replacements[rel] ?? read(rel));
  }
  return checkVerification(root).problems;
}

test('every coordinate that ships in the APKs is pinned, and the build tools are pinned for each CI host', () => {
  const classpath = JSON.parse(read(CLASSPATH));
  // No exact count: a dependency update changes it, and the per-coordinate pin and hash checks below
  // are the guarantee. The snapshot still names native Google sign-in and streaming speech.
  assert.ok(classpath.coordinates.length > 0, 'resolved runtime snapshot is empty');
  for (const coordinate of ['com.google.android.gms:play-services-auth:21.1.1', 'com.google.android.libraries.identity.googleid:googleid:1.1.1', 'com.squareup.okhttp3:okhttp-android:5.3.2', 'com.squareup.okio:okio-jvm:3.16.4'])
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
 assert.ok(buildScripts(ROOT).includes('vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/build.gradle'));
 assert.ok(!buildScripts(ROOT).some(name=>name.includes('android/elizaos-capacitor-secure-store/')));
});

test('dependency verification takes one mode and the unpackaged-runtime option', () => {
  assert.deepEqual(parseVerificationArgs(['--write']), {mode:'--write',allowUnpackagedRuntime:false});
  assert.deepEqual(parseVerificationArgs(['--write','--allow-unpackaged-runtime']), {mode:'--write',allowUnpackagedRuntime:true});
  assert.deepEqual(parseVerificationArgs(['--check']), {mode:'--check',allowUnpackagedRuntime:false});
  assert.throws(() => parseVerificationArgs(['--write','--other']), /Usage/);
});

test('pinned auth descriptor is scanned for unreviewed repositories', t => {
 const file = 'vendor/eliza/packages/auth/android/build.gradle';
 const withAuth = addition => mutated(t, {[file]: read(file) + addition});
 assert.deepEqual(withAuth("\ndependencies { implementation 'androidx.browser:browser:1.9.0' }\n"), []);
 assert.match(withAuth('\nrepositories { mavenLocal() }\n').join('\n'), /packages\/auth\/android\/build\.gradle declares repository mavenLocal\(\), which is not a reviewed form/);
 assert.match(withAuth("\nrepositories { maven { url 'https://unreviewed.example/m2' } }\n").join('\n'), /packages\/auth\/android\/build\.gradle declares repository maven .*unreviewed\.example/);
 assert.match(withAuth("\nrootProject.ext { mavenCentralMirrorUrl = 'https://unreviewed.example/m2' }\n").join('\n'), /packages\/auth\/android\/build\.gradle mentions mavenCentralMirrorUrl/);
});
