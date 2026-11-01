#!/usr/bin/env node
import {HOST_DESCRIPTOR, readHostDescriptor} from './android-host.mjs';
import {preparePatchedNative} from './prepare-patched-native.mjs';
/**
 * Gradle dependency verification metadata (android/gradle/verification-metadata.xml).
 *
 *   node scripts/gradle-verification.mjs --check                 # offline; also run by `npm test`
 *   node scripts/gradle-verification.mjs --write [--allow-unpackaged-runtime | --runtime-profile=cloud]
 *                                                                # npm run android:deps:write-verification
 *
 * While the file exists Gradle refuses any plugin or dependency artifact whose SHA-256 is not
 * listed in it, in every build of the generated android/ host: nothing has to opt in and no
 * build step is added. `--check` verifies committed inputs and their authenticated patched
 * descriptors offline. `--write` is the one command that uses the
 * network: it runs the real build tasks with `--write-verification-metadata sha256` (Gradle adds
 * what they resolve and never removes an entry), then records the Linux and Windows builds of
 * aapt2, which a macOS build never resolves, from Google's Maven repository. Review the diff
 * before committing it: a new entry is a new trusted artifact.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const METADATA = 'android/gradle/verification-metadata.xml';
export const CLASSPATH = 'licenses/android-runtime-classpath.json';
/**
 * Every task a script or workflow runs on the android/ Gradle project that resolves artifacts.
 * (`generate-licenses.mjs` also runs `:app:dependencies`, which reads the dependency graph of the
 * same runtime classpaths and resolves no artifact, so Gradle verifies nothing in that run.)
 */
export const VERIFIED_TASKS = [
  ':app:assembleStandaloneDebug', ':app:assembleLauncherDebug', ':app:assembleStandaloneRelease', ':app:assembleLauncherRelease',
  ':app:assembleStandaloneDebugAndroidTest', ':app:assembleLauncherDebugAndroidTest', ':app:lint',
  ':notification-fixture:assembleSelectedDebug', ':notification-fixture:assembleExcludedDebug', ':notification-fixture:lint',
];
/** Named repositories a Gradle script of the build may declare. */
export const ALLOWED_REPOSITORIES = ['google()', 'mavenCentral()', 'gradlePluginPortal()'];
/**
 * URL repositories that included modules declare (the pinned upstream plugins name Maven Central
 * by URL, Capacitor names the plugin portal by URL). A `maven { }` block may name only these.
 */
export const ALLOWED_REPOSITORY_URLS = ['https://repo.maven.apache.org/maven2', 'https://plugins.gradle.org/m2/'];
/**
 * The pinned upstream plugins read this root property to replace Maven Central with a mirror.
 * Nothing in this repository may set it: a mirror is not a reviewed source. (A caller can still
 * pass it to Gradle as a property; the SHA-256 of every artifact is what is enforced.)
 */
export const MIRROR_PROPERTY = 'mavenCentralMirrorUrl';
/** The pinned upstream templates the generated android/ host is written from. */
export const HOST_TEMPLATES = 'vendor/eliza/packages/app/scripts/mobile/android/consumer-host';
// The generator script writes the host's gradle.properties and wrapper settings itself.
const MIRROR_FREE = [HOST_DESCRIPTOR, 'android/app/product.gradle', `${HOST_TEMPLATES}/settings.gradle`, `${HOST_TEMPLATES}/build.gradle`,
  `${HOST_TEMPLATES}/app.gradle`, `${HOST_TEMPLATES}/toolchain.json`, `${HOST_TEMPLATES}.mjs`, 'scripts/android-host.mjs',
  'scripts/build-android.mjs', 'scripts/build-notification-fixture.mjs', 'scripts/generate-licenses.mjs', 'scripts/toolchain.mjs'];
/**
 * Publisher groups reviewed for this build, with the date and what was looked at. A component in
 * another group fails --check until someone looks at where it comes from and adds the group.
 */
export const REVIEWED_GROUPS = 'android/gradle/verification-reviewed-groups.json';
const AAPT2_HOSTS = ['linux', 'osx', 'windows'];
const GOOGLE_MAVEN = 'https://dl.google.com/dl/android/maven2';
const AAPT2_ORIGIN = 'Fetched from dl.google.com/dl/android/maven2 by scripts/gradle-verification.mjs';

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Parse the metadata into {configuration, components[]}; throws on a shape this reader does not know. */
export function parseVerificationMetadata(text) {
  const configuration = {
    verifyMetadata: /<verify-metadata>\s*(true|false)\s*<\/verify-metadata>/.exec(text)?.[1] ?? null,
    verifySignatures: /<verify-signatures>\s*(true|false)\s*<\/verify-signatures>/.exec(text)?.[1] ?? null,
    trusted: /<trusted-artifacts>|<trusted-keys>|<ignored-keys>|<key-servers/.test(text),
  };
  const components = [];
  for (const match of text.matchAll(/<component\b([^>]*)>([\s\S]*?)<\/component>/g)) {
    const component = {group: attribute(match[1], 'group'), name: attribute(match[1], 'name'), version: attribute(match[1], 'version'), artifacts: []};
    if (!component.group || !component.name || !component.version) throw new Error(`Malformed component: ${match[1].trim()}`);
    for (const artifact of match[2].matchAll(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/g)) {
      const hashes = [...artifact[2].matchAll(/<(md5|sha1|sha256|sha512|pgp)\b([^>]*)\/>/g)].map(hash => ({algorithm: hash[1], value: attribute(hash[2], 'value'), origin: attribute(hash[2], 'origin') ?? null}));
      component.artifacts.push({name: attribute(artifact[1], 'name'), hashes, alsoTrust: /<also-trust\b/.test(artifact[2])});
    }
    components.push(component);
  }
  return {configuration, components};
}

/**
 * The pinned checksum of a coordinate: its archive (.aar or .jar) when it has one, otherwise the
 * metadata file Gradle resolved for it (a Kotlin multiplatform root module or a BOM publishes no
 * archive of its own). Returns {sha256, artifact, archive} or null when nothing is recorded.
 */
export function coordinateChecksum(metadata, group, name, version) {
  const component = metadata.components.find(item => item.group === group && item.name === name && item.version === version);
  for (const extension of ['aar', 'jar', 'module', 'pom']) {
    const artifact = `${name}-${version}.${extension}`;
    const hash = component?.artifacts.find(item => item.name === artifact)?.hashes.find(item => item.algorithm === 'sha256');
    if (hash) return {sha256: hash.value, artifact, archive: extension === 'aar' || extension === 'jar'};
  }
  return null;
}

/**
 * Repository declarations in a Gradle script, one entry per declaration with whitespace
 * collapsed, e.g. ['google()', "maven { url = 'https://example.org/m2' }"]. Nested blocks are
 * kept whole, so a `maven { }` or `flatDir { }` inside `repositories { }` is one entry.
 */
export function declaredRepositories(text) {
  const found = [];
  for (const match of text.matchAll(/\brepositories\s*\{/g)) {
    let depth = 1, at = match.index + match[0].length, entry = '';
    const push = () => { const value = entry.replace(/\s+/g, ' ').trim(); if (value) found.push(value); entry = ''; };
    for (; at < text.length && depth > 0; at += 1) {
      const char = text[at];
      if (char === '{' || char === '(') depth += 1;
      else if (char === '}' || char === ')') depth -= 1;
      if (depth === 0) break;
      if (depth === 1 && (char === ';' || char === '\n')) push(); else entry += char;
      // A nested block that closes back to the top level ends its declaration.
      if (depth === 1 && char === '}') push();
    }
    if (depth !== 0) throw new Error('Unbalanced repositories block');
    push();
  }
  return found;
}

/** Why a repository declaration is not a reviewed one, or null when it is. */
export function repositoryProblem(entry) {
  if (ALLOWED_REPOSITORIES.includes(entry)) return null;
  if (/^maven\s*\{/.test(entry)) {
    const urls = [...entry.matchAll(/['"]([a-z][a-z0-9+.-]*:[^'"]*)['"]/gi)].map(match => match[1]);
    if (urls.length && urls.every(url => ALLOWED_REPOSITORY_URLS.includes(url))) return null;
    return urls.length ? `names ${urls.filter(url => !ALLOWED_REPOSITORY_URLS.includes(url)).join(', ')}` : 'names no literal URL';
  }
  return 'is not a reviewed form';
}

/** A descriptor reference as a checkout-relative path; patched descriptors are checked separately below. */
export function referencePath({root, path: relative}) {
  if (root === 'consumer') return relative;
  if (root === 'upstream' || root === 'patchedNative') return path.posix.join('vendor/eliza', relative);
  if (root === 'dependencies') return path.posix.join('node_modules', relative);
  throw new Error(`${HOST_DESCRIPTOR} names unknown root ${root}`);
}

/**
 * Every Gradle script that can declare a repository for the android/ build: the upstream host
 * templates the generated root, settings and app scripts come from, Alpha's product script and
 * the build.gradle of each module android/consumer-host.json includes (the fixtures, the speech
 * and listener modules, Capacitor from node_modules and the plugins from the pinned upstream checkout).
 * This is the canonical input list. The one patchable Gradle descriptor, shared auth's
 * build.gradle, is materialized and checked separately so its repositories cannot hide behind
 * the unchanged pinned copy.
 */
export function buildScripts(root) {
  const {profile} = readHostDescriptor(root);
  const modules = profile.modules.map(module => path.posix.join(referencePath(module.source), 'build.gradle'));
  if (new Set(modules).size !== modules.length) throw new Error(`${HOST_DESCRIPTOR} includes one module directory twice`);
  return [`${HOST_TEMPLATES}/settings.gradle`, `${HOST_TEMPLATES}/build.gradle`, `${HOST_TEMPLATES}/app.gradle`,
    ...(profile.appScripts ?? []).map(referencePath), ...modules.sort()];
}

/** Only shared auth's build.gradle may be patched; authenticate it before checking its declarations. */
function patchedBuildScripts(root) {
  const file = path.join(root, 'patches/eliza/native-manifest.json');
  if (!fs.existsSync(file)) return []; // Canonical-only fixture/checkouts have no native patch manifest.
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = 'packages/auth/android/build.gradle';
  if (!manifest.patches?.some(patch => patch.targets?.some(candidate => candidate.path === target))) return [];
  const staged = preparePatchedNative({root});
  return [path.relative(root, path.join(staged.root, target)).split(path.sep).join('/')];
}

export function checkVerification(root) {
  const problems = [];
  const file = path.join(root, METADATA);
  if (!fs.existsSync(file)) return {problems: [`${METADATA} is missing: Gradle dependency verification is off. Run: npm run android:deps:write-verification`], metadata: null};
  const metadata = parseVerificationMetadata(fs.readFileSync(file, 'utf8'));
  if (metadata.configuration.verifyMetadata !== 'true') problems.push('verify-metadata must be true (POM and module files are verified too)');
  if (metadata.configuration.verifySignatures !== 'false') problems.push('verify-signatures must be false: this build pins SHA-256 checksums and trusts no key server');
  if (metadata.configuration.trusted) problems.push('trusted-artifacts, trusted-keys, ignored-keys and key-servers are not used: every artifact is pinned by checksum');
  if (!metadata.components.length) problems.push('no components are recorded');
  const reviewed = new Set(JSON.parse(fs.readFileSync(path.join(root, REVIEWED_GROUPS), 'utf8')).groups);
  const seen = new Set();
  for (const component of metadata.components) {
    const id = `${component.group}:${component.name}:${component.version}`;
    if (seen.has(id)) problems.push(`${id} is listed twice`);
    seen.add(id);
    if (!reviewed.has(component.group)) problems.push(`${id}: publisher group ${component.group} has not been reviewed (${REVIEWED_GROUPS})`);
    if (!component.artifacts.length) problems.push(`${id} lists no artifact`);
    for (const artifact of component.artifacts) {
      const sha = artifact.hashes.filter(hash => hash.algorithm === 'sha256');
      // One checksum per artifact: a second value (Gradle writes it as also-trust) would accept other bytes.
      if (artifact.hashes.length !== sha.length || sha.length !== 1 || artifact.alsoTrust || sha.some(hash => !/^[0-9a-f]{64}$/.test(hash.value ?? '')))
        problems.push(`${id} ${artifact.name}: exactly one SHA-256 checksum is expected`);
      if (sha.some(hash => hash.origin !== 'Generated by Gradle' && hash.origin !== AAPT2_ORIGIN)) problems.push(`${id} ${artifact.name}: unexpected checksum origin ${sha.map(hash => hash.origin).join(', ')}`);
    }
  }
  // What ships: every coordinate of the four runtime classpaths is pinned.
  const classpath = JSON.parse(fs.readFileSync(path.join(root, CLASSPATH), 'utf8'));
  for (const coordinate of classpath.coordinates) {
    const [group, name, version] = coordinate.split(':');
    if (!coordinateChecksum(metadata, group, name, version)) problems.push(`${coordinate} ships in the APKs (${CLASSPATH}) but has no SHA-256 in ${METADATA}`);
  }
  // aapt2 is the one host-specific artifact: a macOS-only record would break Linux CI builds.
  for (const component of metadata.components.filter(item => item.group === 'com.android.tools.build' && item.name === 'aapt2'))
    for (const host of AAPT2_HOSTS)
      if (!component.artifacts.some(artifact => artifact.name === `aapt2-${component.version}-${host}.jar`)) problems.push(`aapt2 ${component.version} has no ${host} archive recorded`);
  if (!metadata.components.some(item => item.group === 'com.android.tools.build' && item.name === 'aapt2')) problems.push('aapt2 is not recorded: the metadata was not generated from a real build');
  const patchedScripts = patchedBuildScripts(root);
  for (const script of [...buildScripts(root), ...patchedScripts]) {
    const file = path.join(root, script);
    // An included project that cannot be read was not reviewed; the checkout or npm ci is incomplete.
    if (!fs.existsSync(file)) { problems.push(`${script} is missing: the repositories it declares cannot be checked (git submodule update --init vendor/eliza; npm ci)`); continue; }
    for (const repository of declaredRepositories(fs.readFileSync(file, 'utf8'))) {
      const problem = repositoryProblem(repository);
      if (problem) problems.push(`${script} declares repository ${repository}, which ${problem}; reviewed: ${ALLOWED_REPOSITORIES.join(', ')} and maven { } naming ${ALLOWED_REPOSITORY_URLS.join(' or ')}`);
    }
  }
  for (const file of [...MIRROR_FREE, ...patchedScripts])
    if (fs.existsSync(path.join(root, file)) && fs.readFileSync(path.join(root, file), 'utf8').includes(MIRROR_PROPERTY))
      problems.push(`${file} mentions ${MIRROR_PROPERTY}: a Maven Central mirror is not a reviewed source`);
  return {problems, metadata};
}

/** Insert an artifact into a component block, keeping artifacts sorted by name. Returns the new text. */
export function addArtifact(text, {group, name, version}, artifactName, sha256, origin) {
  const open = `<component group="${group}" name="${name}" version="${version}">`;
  const start = text.indexOf(open);
  if (start < 0) throw new Error(`${group}:${name}:${version} is not in the metadata`);
  const end = text.indexOf('</component>', start);
  const block = text.slice(start, end);
  if (block.includes(`<artifact name="${artifactName}">`)) return text;
  const indent = /\n(\s*)<artifact /.exec(block)?.[1] ?? '         ';
  const entry = `${indent}<artifact name="${artifactName}">\n${indent}   <sha256 value="${sha256}" origin="${origin}"/>\n${indent}</artifact>\n`;
  const artifacts = [...block.matchAll(/\n(\s*<artifact name="([^"]+)">[\s\S]*?<\/artifact>)/g)];
  const after = artifacts.find(item => item[2].localeCompare(artifactName) > 0);
  const at = after ? start + after.index + 1 : end - (/\n\s*$/.exec(block)?.[0].length ?? 0) + 1;
  return text.slice(0, at) + entry + text.slice(at);
}

async function recordOtherHostAapt2(root) {
  const file = path.join(root, METADATA);
  let text = fs.readFileSync(file, 'utf8');
  for (const component of parseVerificationMetadata(text).components.filter(item => item.group === 'com.android.tools.build' && item.name === 'aapt2'))
    for (const host of AAPT2_HOSTS) {
      const artifact = `aapt2-${component.version}-${host}.jar`;
      if (component.artifacts.some(item => item.name === artifact)) continue;
      const url = `${GOOGLE_MAVEN}/com/android/tools/build/aapt2/${component.version}/${artifact}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      text = addArtifact(text, component, artifact, digest, AAPT2_ORIGIN);
      console.log(`Recorded ${artifact} sha256 ${digest} from ${url}`);
    }
  fs.writeFileSync(file, text);
}

export function parseVerificationArgs(args) {
  const mode = args.filter(arg => ['--check', '--write'].includes(arg));
  if (mode.length !== 1 || args.some(arg => !['--check', '--write', '--allow-unpackaged-runtime', '--runtime-profile=cloud'].includes(arg)))
    throw new Error('Usage: node scripts/gradle-verification.mjs --check | --write [--allow-unpackaged-runtime | --runtime-profile=cloud]');
  const runtimeProfile=args.includes('--runtime-profile=cloud')?'cloud':'native';
  const allowUnpackagedRuntime=args.includes('--allow-unpackaged-runtime');
  if(runtimeProfile==='cloud'&&allowUnpackagedRuntime)throw new Error('Cloud profile requires a genuine packaged resident');
  return {mode:mode[0],runtimeProfile,allowUnpackagedRuntime};
}

async function write(root, {allowUnpackagedRuntime,runtimeProfile}) {
  const {androidEnv} = await import('./toolchain.mjs');
  const env = {...androidEnv()};
  for (const name of ['ELIZA_DEV_ALLOW_TEST_MOCKS', 'VITE_ELIZA_DEV_ALLOW_TEST_MOCKS', 'ORG_GRADLE_PROJECT_ELIZA_DEV_ALLOW_TEST_MOCKS']) delete env[name];
  env.VITE_ELIZA_RUNTIME_PROFILE=runtimeProfile;
  const profileArgs=runtimeProfile==='cloud'?['--runtime-profile=cloud']:[];
  const preflight = [path.join(root, 'scripts/android-build-preflight.mjs'), ...profileArgs, ...(allowUnpackagedRuntime ? ['--allow-unpackaged-runtime'] : [])];
  execFileSync(process.execPath, preflight, {cwd: root, stdio: 'inherit', env});
  execFileSync(process.execPath, [path.join(root, 'scripts/android-host.mjs')], {cwd: root, stdio: 'inherit', env});
  execFileSync('npm', ['run', 'android:sync'], {cwd: root, stdio: 'inherit', env});
  // No ALPHA_NOTIFICATION_FIXTURE_KEYSTORE here: the fixture then takes the default debug key, and
  // its dependencies resolve exactly as in scripts/build-notification-fixture.mjs.
  execFileSync('./gradlew', ['--no-daemon', '--write-verification-metadata', 'sha256', '-PELIZA_DEV_ALLOW_TEST_MOCKS=0',
    `-PELIZA_ALLOW_UNPACKAGED_RUNTIME=${allowUnpackagedRuntime ? '1' : '0'}`, ...(runtimeProfile==='cloud'?['-PELIZA_RUNTIME_PROFILE=cloud']:[]), ...VERIFIED_TASKS], {cwd: path.join(root, 'android'), stdio: 'inherit', env});
  await recordOtherHostAapt2(root);
  const {problems} = checkVerification(root);
  if (problems.length) throw new Error(`Written metadata does not pass --check:\n${problems.map(item => `  - ${item}`).join('\n')}`);
  console.log(`Wrote ${METADATA}. Review the diff before committing: every new entry is a newly trusted artifact.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = path.resolve(import.meta.dirname, '..');
  let options;
  try {options=parseVerificationArgs(args);}catch(error){console.error(error.message);process.exit(2);}
  if (options.mode === '--write') await write(root, options);
  else {
    const {problems, metadata} = checkVerification(root);
    if (problems.length) { console.error(`Gradle dependency verification problems:\n${problems.map(item => `  - ${item}`).join('\n')}`); process.exit(1); }
    console.log(`${METADATA}: ${metadata.components.length} components, ${metadata.components.reduce((sum, item) => sum + item.artifacts.length, 0)} artifacts, all SHA-256.`);
  }
}
