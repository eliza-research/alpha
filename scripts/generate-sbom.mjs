#!/usr/bin/env node
/**
 * Release SBOM: a CycloneDX 1.6 JSON inventory of what the product ships, built offline and
 * deterministically from committed pins (no timestamp; the serial number is derived from content).
 *
 *   node scripts/generate-sbom.mjs                 # writes artifacts/sbom/alphaphone.cdx.json
 *   node scripts/generate-sbom.mjs --out <file>
 *   node scripts/generate-sbom.mjs --stdout
 *   node scripts/generate-sbom.mjs --packaged-runtime            # add the staged resident runtime
 *   node scripts/generate-sbom.mjs --apks artifacts              # add the APKs verify-apks recorded
 *
 * Sources, and the hash each one can prove:
 *   - package-lock.json production packages: registry tarball SHA-512 (lock integrity).
 *   - apps/app/public font files: SHA-256 of the committed bytes.
 *   - licenses/tesseract-core/sources.json: SHA-256 of the shipped OCR WebAssembly cores.
 *   - licenses/android-runtime-classpath.json: resolved Gradle runtime coordinates, each with the
 *     SHA-256 of its archive (or, for a coordinate with no archive, its metadata file) from
 *     android/gradle/verification-metadata.xml, the checksum Gradle enforces on every build.
 *     Gradle is not run here.
 *   - android/voice-host/qualified-voice-host.json: SHA-256 and size of each recorded
 *     libelizainference engine library per ABI and of every voice bundle file (Paradee GGUF, misaki
 *     lexicon, eSpeak NG data, the ASR slot pair, Silero VAD, notices).
 *   - android/embedding-host/qualified-host.json: SHA-256 of the reviewed ARM64 embedding host
 *     libraries and the pinned embedding model.
 *   - upstream.lock.json: the pinned elizaOS commit.
 * Licences (decision P-09): every component carries `alphaphone:licence-expression` (the declared
 * expression, or "not recorded in this inventory") and `alphaphone:licence-flags` (the flags of
 * scripts/licence-policy.mjs, or "none"). Flags are a record, never a failure of this script.
 *
 * The default document is a source-pin inventory: it needs no build and is identical on every
 * checkout of a commit. Two options extend it to a release candidate on the machine that built it:
 *   --packaged-runtime  reads the staged payload (after `npm run agent:stage-android`): SHA-256 of
 *     every staged file under android/app/src/main/assets/agent and android/app/src/main/jniLibs,
 *     and Bun plus every npm package bundled into the agent and the workflow worker (name, version
 *     and licence from the prepared source; those packages are bundled, so their bytes are covered
 *     by the hash of the bundle file, not by a hash of their own).
 *   --apks <dir>  reads <dir>/apk-manifest.json written by scripts/verify-apks.mjs and lists each
 *     APK with its SHA-256, signer and the distributable verdict recorded there. It refuses a
 *     manifest whose APK files are missing or no longer match. An APK is listed by its hash; its
 *     contents are not unpacked here (scripts/verify-apks.mjs and verify-packaged-runtime.py do that).
 * Neither option makes anything distributable: that verdict is verify-apks's alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AGENT_ASSETS, ANDROID_CLASSPATH, BUN_ENTRY, COMMERCIAL_FONT, FONT_LICENSES, HELD_OUTSIDE_REPOSITORY, KNOWN_LICENSES, NO_FONT_LICENCE, ROOT, TESSERACT_CORE_SOURCES, UNKNOWN, UNVERIFIED, VOICE_HOST, collectNotices, exists, fontLicense, fontNames, listFonts, mavenFamily, packagedRuntimePresent, pinnedVoiceModels, productionLockPackages, readJson, sha256, voiceHostProblems} from './generate-licenses.mjs';
import {METADATA as GRADLE_METADATA, coordinateChecksum, parseVerificationMetadata} from './gradle-verification.mjs';
import {classifyLicence, flagSummary} from './licence-policy.mjs';

export const LICENCE_NOT_RECORDED = 'not recorded in this inventory';

export const DEFAULT_OUTPUT = 'artifacts/sbom/alphaphone.cdx.json';
const NOT_COVERED = 'Staged resident runtime payload (Bun, bundled agent and workflow-worker packages, PGlite, musl loader): present only after agent:stage-android; add it with --packaged-runtime. Verified per APK by scripts/verify-packaged-runtime.py.';
const EMBEDDING_HOST = 'android/embedding-host/qualified-host.json';
const JNI_LIBS = 'android/app/src/main/jniLibs';

const property = (name, value) => ({name: `alphaphone:${name}`, value: String(value)});

function licenses(expression) {
  if (!expression) return undefined;
  if ([UNVERIFIED, NO_FONT_LICENCE, UNKNOWN, COMMERCIAL_FONT].includes(expression)) return [{license: {name: expression}}];
  if (KNOWN_LICENSES.has(expression) && !/\s/.test(expression)) return [{license: {id: expression}}];
  return [{expression}];
}

/** npm lock integrity ("sha512-<base64>") as a CycloneDX hash. */
export function integrityHash(integrity) {
  const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity || '');
  if (!match) return null;
  return {alg: {sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512'}[match[1]], content: Buffer.from(match[2], 'base64').toString('hex')};
}

function npmComponents(root, lock) {
  return productionLockPackages(lock, root).map(pkg => {
    const meta = lock.packages[pkg.key];
    const hash = integrityHash(meta.integrity);
    if (!hash) throw new Error(`${pkg.key}: package-lock.json records no integrity hash`);
    const purl = `pkg:npm/${pkg.name.startsWith('@') ? `%40${pkg.name.slice(1)}` : pkg.name}@${pkg.version}`;
    return {type: 'library', 'bom-ref': `${purl}#${pkg.key}`, name: pkg.name, version: pkg.version, purl, hashes: [hash], licenses: licenses(pkg.license),
      properties: [property('ships-in', 'web,apk'), property('source', `package-lock.json ${pkg.key}`)]};
  });
}

function fontComponents(root) {
  const records = exists(root, FONT_LICENSES) ? readJson(root, FONT_LICENSES).entries : [];
  return listFonts(root).map(rel => {
    const bytes = fs.readFileSync(path.join(root, rel));
    const names = fontNames(bytes);
    const digest = sha256(bytes);
    const stated = fontLicense(names);
    // A font whose own metadata names no open licence is proprietary: recorded (LicenseRef-Commercial-Font) or not.
    const record = stated === NO_FONT_LICENCE ? records.find(item => item.name === `${names.family} typeface` && item.sha256?.includes(digest) && item.license === COMMERCIAL_FONT) : null;
    return {type: 'file', 'bom-ref': `font:${rel}`, name: `${names.family} typeface (${names.fullName || path.basename(rel)})`, version: names.version.replace(/^Version\s+/i, ''),
      hashes: [{alg: 'SHA-256', content: digest}], licenses: licenses(record ? COMMERCIAL_FONT : stated), copyright: names.copyright || undefined,
      properties: [property('ships-in', 'web,apk'), property('path', rel.replace(/^apps\/app\/public\//, '')), property('source', rel),
        ...(stated === NO_FONT_LICENCE ? [property('open-source', false), property('licence-evidence', !record ? `none recorded in ${FONT_LICENSES}`
          : record.evidence === HELD_OUTSIDE_REPOSITORY ? `${HELD_OUTSIDE_REPOSITORY}: owner statement recorded in ${FONT_LICENSES}; the licence document is not in this repository` : `recorded in ${FONT_LICENSES}`)] : [])]};
  });
}

function ocrComponents(root) {
  const pinned = readJson(root, TESSERACT_CORE_SOURCES);
  return Object.entries(pinned.cores).sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => ({
    type: 'file', 'bom-ref': `ocr-core:${file}`, name: `${pinned.package} ${file}`, version: pinned.version, hashes: [{alg: 'SHA-256', content: digest}],
    licenses: licenses([...new Set(pinned.components.map(component => component.license))].map(item => /\s/.test(item) ? `(${item})` : item).join(' AND ')),
    properties: [property('ships-in', 'web,apk'), property('source', TESSERACT_CORE_SOURCES),
      property('statically-linked', pinned.components.map(component => `${component.name} ${component.version} (${component.license})`).join('; '))],
  }));
}

function gradleComponents(root) {
  const snapshot = readJson(root, ANDROID_CLASSPATH);
  const metadata = exists(root, GRADLE_METADATA) ? parseVerificationMetadata(fs.readFileSync(path.join(root, GRADLE_METADATA), 'utf8')) : null;
  return snapshot.coordinates.map(coordinate => {
    const [group, artifact, version] = coordinate.split(':');
    if (!group || !artifact || !version) throw new Error(`${ANDROID_CLASSPATH}: malformed coordinate ${coordinate}`);
    const purl = `pkg:maven/${group}/${artifact}@${version}`;
    const family = mavenFamily(group,artifact,version);
    const pinned = metadata ? coordinateChecksum(metadata, group, artifact, version) : null;
    return {type: 'library', 'bom-ref': purl, group, name: artifact, version, purl, hashes: pinned ? [{alg: 'SHA-256', content: pinned.sha256}] : undefined, licenses: licenses(family ? family.license : UNKNOWN),
      properties: [property('ships-in', 'apk'),
        property('hash', !pinned ? `not recorded: ${GRADLE_METADATA} has no checksum for this coordinate`
          : `${pinned.artifact} from ${GRADLE_METADATA}, enforced by Gradle dependency verification${pinned.archive ? '' : ' (this coordinate publishes no archive: the checksum is of its metadata file, and the code ships in the coordinate it points to)'}`),
        property('source', `${ANDROID_CLASSPATH} (${snapshot.configurations.join(', ')}; input fingerprint ${snapshot.inputFingerprint})`)]};
  });
}

/**
 * The reviewed embedding host: pins only. Whether the libraries are staged is not this document's
 * claim, and an APK built without the resident runtime (--allow-unpackaged-runtime) contains none
 * of them; each APK row says which it is (`resident-runtime`).
 */
const WITH_RESIDENT_RUNTIME = 'apk (only one that packages the resident runtime)';
function embeddingHostComponents(root) {
  if (!exists(root, EMBEDDING_HOST)) return [];
  const host = readJson(root, EMBEDDING_HOST);
  const hostScope = exists(root, 'vendor/eliza/plugins/plugin-local-inference/native/android/consumer.gradle') ? 'legacy qualification record; incompatible with current Paradee engine; not current packaged bytes' : WITH_RESIDENT_RUNTIME;
  const source = `${EMBEDDING_HOST} (elizaOS ${host.pin}, engine ${host.forkPin}, qualification receipt sha256 ${host.qualificationReceiptSha256})`;
  return [
    ...host.libraries.map(library => ({
      type: 'library', 'bom-ref': `embedding-host:${host.abi}/${library.name}`, name: `${library.name} (${host.abi})`, version: library.name === 'libc++_shared.so' ? 'Android NDK C++ runtime' : `engine ${host.forkPin}`,
      hashes: [{alg: 'SHA-256', content: library.sha256}], licenses: library.name === 'libc++_shared.so' ? licenses('Apache-2.0 WITH LLVM-exception') : undefined,
      properties: [property('ships-in', hostScope), property('abi', host.abi), property('bytes', library.bytes), property('source', source)],
    })),
    {type: 'machine-learning-model', 'bom-ref': `embedding-model:${path.basename(host.model.path)}`, name: path.basename(host.model.path), version: `${host.model.dimensions} dimensions`,
      hashes: [{alg: 'SHA-256', content: host.model.sha256}],
      properties: [property('ships-in', WITH_RESIDENT_RUNTIME), property('source', `${EMBEDDING_HOST} (staged to ${host.model.path})`)]},
  ];
}

function walkFiles(directory, base = directory, out = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Staged payload contains a symbolic link: ${child}`);
    if (entry.isDirectory()) walkFiles(child, base, out); else out.push(path.relative(base, child).split(path.sep).join('/'));
  }
  return out;
}

/**
 * The staged resident runtime: every staged file by SHA-256, and the packages bundled into it.
 * Reads the payload that Gradle would package from this checkout; throws when none is staged.
 */
function residentRuntimeComponents(root) {
  if (!packagedRuntimePresent(root)) throw new Error('--packaged-runtime: no resident runtime is staged. Run: npm run agent:build-workflow-worker && npm run agent:stage-android');
  const out = [];
  const embedding = exists(root, EMBEDDING_HOST) ? readJson(root, EMBEDDING_HOST) : null;
  for (const [base, kind] of [[AGENT_ASSETS, 'asset'], [JNI_LIBS, 'native library']])
    for (const rel of exists(root, base) ? walkFiles(path.join(root, base)) : []) {
      const file = `${base}/${rel}`;
      const bytes = fs.readFileSync(path.join(root, file));
      const digest = sha256(bytes);
      // Already listed from its committed pin; a staged file that differs from the pin is an error, not a second entry.
      const pinned = embedding && (file === embedding.model.path ? embedding.model : base === JNI_LIBS && rel.startsWith(`${embedding.abi}/`) ? embedding.libraries.find(library => `${embedding.abi}/${library.name}` === rel) : null);
      if (pinned) { if (pinned.sha256 !== digest) throw new Error(`${file} is staged but is not the bytes pinned in ${EMBEDDING_HOST}`); continue; }
      out.push({type: 'file', 'bom-ref': `resident-runtime:${file}`, name: file, hashes: [{alg: 'SHA-256', content: digest}],
        properties: [property('ships-in', 'apk'), property('bytes', bytes.length), property('kind', `staged resident runtime ${kind}`), property('source', 'staged by npm run agent:stage-android from the prepared pinned source')]});
    }
  const notices = collectNotices(root, {packagedRuntime: true});
  if (notices.errors.length) throw new Error(`--packaged-runtime: ${notices.errors.join('; ')}`);
  const bun = notices.entries.find(item => item.name === BUN_ENTRY);
  if (bun) out.push({type: 'application', 'bom-ref': 'resident-runtime:bun', name: bun.name, version: bun.version, licenses: licenses(bun.license), externalReferences: [{type: 'vcs', url: bun.source}],
    properties: [property('ships-in', 'apk'), property('hash', `the staged libeliza_bun.so files are listed by SHA-256 under ${JNI_LIBS}`), property('source', `${AGENT_ASSETS}/android-agent-runtime-provenance.json`), property('resident-notice-flags', bun.flags.join(',') || 'none')]});
  for (const entry of notices.entries.filter(item => /^Bundled in the on-device /.test(item.text ?? ''))) {
    const purl = `pkg:npm/${entry.name.startsWith('@') ? `%40${entry.name.slice(1)}` : entry.name}@${entry.version}`;
    out.push({type: 'library', 'bom-ref': `${purl}#resident-runtime`, name: entry.name, version: entry.version, purl, licenses: licenses(entry.license),
      properties: [property('ships-in', 'apk'), property('bundled-in', /^Bundled in the on-device (.*?)\./.exec(entry.text)[1]),
        property('hash', 'not recorded per package: bundled into the staged agent bundle or workflow-worker files, which are listed by SHA-256'),
        property('source', 'staged resident runtime (prepared source packages; scripts/generate-licenses.mjs --packaged-runtime)'), property('resident-notice-flags', entry.flags.join(',') || 'none')]});
  }
  return out;
}

/** APKs recorded by scripts/verify-apks.mjs. Each file must still be the recorded bytes. */
function apkComponents(root, directory) {
  const manifestFile = path.join(directory, 'apk-manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`--apks: ${manifestFile} is missing; scripts/verify-apks.mjs writes it at the end of npm run android:build`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  return manifest.results.map(row => {
    const file = path.resolve(root, row.file);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== row.sha256) throw new Error(`--apks: ${row.file} is missing or is not the APK verify-apks recorded (${row.sha256})`);
    const name = path.basename(row.file);
    return {type: 'application', 'bom-ref': `apk:${name}`, name, version: `${row.versionName} (${row.versionCode})`, hashes: [{alg: 'SHA-256', content: row.sha256}],
      properties: [property('ships-in', 'apk'), property('package', row.packageName), property('variant', row.variant), property('mode', row.mode),
        property('signed', row.signed === true), property('signer-sha256', row.signerSha256 ?? 'none'), property('resident-runtime', row.runtime ?? 'not recorded'),
        property('test-mocks', manifest.testMocks === true),
        // Only release rows carry a verdict; a debug APK is never a distribution artifact.
        property('distributable', row.mode === 'release' ? row.distributable === true : false),
        property('source', 'apk-manifest.json written by scripts/verify-apks.mjs (evidence: apk-build)')]};
  });
}

/** The libelizainference voice host: its recorded engine libraries per ABI and every bundle file it pins. */
function voiceHostComponents(root) {
  if (!exists(root, VOICE_HOST)) return [];
  const record = readJson(root, VOICE_HOST);
  const problems = voiceHostProblems(record);
  if (problems.length) throw new Error(problems.join('\n'));
  const out = [];
  for (const abi of record.abis)
    for (const library of abi.libraries)
      out.push({type: 'library', 'bom-ref': `voice-host:${abi.abi}/${library.name}`, name: `${library.name} (${abi.abi})`, version: `elizaOS llama.cpp fork ${record.forkPin}`,
        hashes: [{alg: 'SHA-256', content: library.sha256}],
        properties: [property('ships-in', 'apk'), property('abi', abi.abi), property('bytes', library.bytes), property('source', VOICE_HOST), property('eliza-pin', record.pin), property('qualified', record.qualified === true)]});
  for (const model of pinnedVoiceModels(record))
    out.push({type: ['tts-model', 'asr-model', 'asr-mmproj', 'vad-model'].includes(model.role) ? 'machine-learning-model' : 'data', 'bom-ref': `voice-model:${model.path}`, name: model.name, version: model.sha256.slice(0, 12),
      hashes: [{alg: 'SHA-256', content: model.sha256}], licenses: licenses(!model.license || model.license === 'UNVERIFIED' ? UNVERIFIED : model.license),
      ...(model.url ? {externalReferences: [{type: 'distribution', url: model.url}]} : {}),
      properties: [property('ships-in', 'apk'), property('role', model.role), property('bytes', model.bytes), property('path', model.path), property('origin', model.source), property('source', VOICE_HOST)]});
  return out;
}

function upstreamComponent(root) {
  const lock = readJson(root, 'upstream.lock.json');
  const repository = lock.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  return {type: 'framework', 'bom-ref': `pkg:github/${repository}@${lock.commit}`, name: 'elizaOS', version: lock.commit, purl: `pkg:github/${repository}@${lock.commit}`,
    hashes: [{alg: 'SHA-1', content: lock.commit}], licenses: licenses('MIT'),
    properties: [property('ships-in', 'web,apk'), property('source', 'upstream.lock.json (git commit; vendor/eliza submodule)')]};
}

const expressionOf = component => {
  const item = component.licenses?.[0];
  return item?.expression ?? item?.license?.id ?? item?.license?.name ?? LICENCE_NOT_RECORDED;
};

/**
 * Add the licence expression and flags to every component. npm packages and fonts take the flags
 * of their notice entry (which also knows when a package ships no licence file); everything else
 * is classified from its expression. A component with no recorded licence is flagged unverified.
 */
function withLicenceFlags(root, components) {
  const notices = new Map(collectNotices(root, {packagedRuntime: false}).entries.map(entry => [`${entry.name}@${entry.version}`, entry.flags]));
  const order = flags => flagSummary([{flags}]).map(group => group.flag);
  return components.map(component => {
    const expression = expressionOf(component);
    const resident = component.properties.find(item => item.name === 'alphaphone:resident-notice-flags');
    if (resident) return {...component, properties: [...component.properties.filter(item => item !== resident), property('licence-expression', expression), property('licence-flags', resident.value)]};
    const key = component['bom-ref'].startsWith('font:') ? `${component.name.replace(/ \(.*\)$/, '')}@${component.version}` : `${component.name}@${component.version}`;
    const flags = order([...(notices.get(key) ?? []), ...(expression === LICENCE_NOT_RECORDED ? ['unverified'] : classifyLicence(expression).flags)]);
    return {...component, properties: [...component.properties, property('licence-expression', expression), property('licence-flags', flags.join(',') || 'none')]};
  });
}

const strip = value => Array.isArray(value) ? value.map(strip)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, strip(item)])) : value;

export function buildSbom(root = ROOT, {packagedRuntime = false, apks = null} = {}) {
  const pkg = readJson(root, 'package.json');
  const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockText);
  const components = strip(withLicenceFlags(root, [
    ...npmComponents(root, lock), ...fontComponents(root), ...ocrComponents(root),
    ...gradleComponents(root), ...voiceHostComponents(root), ...embeddingHostComponents(root), upstreamComponent(root),
    ...(packagedRuntime ? residentRuntimeComponents(root) : []), ...(apks ? apkComponents(root, apks) : []),
  ])).sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  const refs = new Set();
  for (const component of components) {
    if (refs.has(component['bom-ref'])) throw new Error(`Duplicate SBOM component ${component['bom-ref']}`);
    refs.add(component['bom-ref']);
  }
  const identity = readJson(root, 'app.config.json');
  const digest = sha256(JSON.stringify(components));
  // Content-derived, so the same inputs always produce the same document.
  const serial = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const evidence = [packagedRuntime ? 'source-pin inventory plus the resident runtime payload staged on the generating machine' : 'source-pin inventory',
    apks ? 'APK files listed by the SHA-256 that scripts/verify-apks.mjs recorded' : null].filter(Boolean).join('; ');
  return {
    bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${serial}`, version: 1,
    metadata: {
      component: {type: 'application', 'bom-ref': 'alphaphone', name: pkg.name, version: pkg.version},
      tools: {components: [{type: 'application', name: 'scripts/generate-sbom.mjs'}]},
      properties: [
        property('evidence', `${evidence}; not a scan of the contents of built APK or web bundle bytes`),
        property('package-lock-sha256', sha256(lockText)),
        property('android-application-id', identity.appId ?? identity.applicationId ?? 'see app.config.json'),
        property('gradle-verification-metadata-sha256', exists(root, GRADLE_METADATA) ? sha256(fs.readFileSync(path.join(root, GRADLE_METADATA))) : 'absent'),
        ...(packagedRuntime ? [property('resident-runtime-source-stamp-sha256', sha256(fs.readFileSync(path.join(root, AGENT_ASSETS, 'alpha-source.json'))))] : [property('not-covered', NOT_COVERED)]),
      ],
    },
    components,
  };
}

export const renderSbom = sbom => `${JSON.stringify(sbom, null, 2)}\n`;

function main(argv) {
  const valued = ['--out', '--apks'];
  const value = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : null;
  const out = value('--out') ?? DEFAULT_OUTPUT, apks = value('--apks');
  const unknown = argv.filter((arg, index) => arg.startsWith('--') ? ![...valued, '--stdout', '--packaged-runtime'].includes(arg) : !valued.includes(argv[index - 1]));
  if (unknown.length || !out || valued.some(name => argv.includes(name) && !value(name))) { console.error('Usage: node scripts/generate-sbom.mjs [--out <file> | --stdout] [--packaged-runtime] [--apks <directory>]'); return 2; }
  let sbom;
  try { sbom = buildSbom(ROOT, {packagedRuntime: argv.includes('--packaged-runtime'), apks: apks ? path.resolve(apks) : null}); }
  catch (error) { console.error(error.message); return 1; }
  const text = renderSbom(sbom);
  if (argv.includes('--stdout')) { process.stdout.write(text); return 0; }
  fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
  fs.writeFileSync(out, text);
  const hashed = sbom.components.filter(component => component.hashes?.length).length;
  console.log(`Wrote ${out}: ${sbom.components.length} components, ${hashed} with hashes, ${sbom.components.length - hashed} without. sha256 ${sha256(text)}`);
  // Licence flags are warnings (decision P-09): printed, recorded per component, exit 0.
  // Staged payload files carry no licence of their own (the bundled packages and the payload notice do): count them, do not list each.
  const payloadFiles = sbom.components.filter(component => component['bom-ref'].startsWith('resident-runtime:android/'));
  if (payloadFiles.length) console.warn(`${payloadFiles.length} staged resident runtime files are listed by SHA-256 with no licence of their own; their packages are separate components.`);
  for (const component of sbom.components.filter(item => !payloadFiles.includes(item))) {
    const value = name => component.properties.find(item => item.name === `alphaphone:${name}`)?.value;
    if (value('licence-flags') !== 'none') for (const flag of value('licence-flags').split(',')) console.warn(`LICENCE FLAG ${flag}: ${component.name}@${component.version ?? 'unversioned'} (${value('licence-expression')})`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
