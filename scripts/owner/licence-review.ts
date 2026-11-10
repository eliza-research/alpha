#!/usr/bin/env node
/**
 * Read-only licence review packet for issue #674 (owner prep, not legal advice).
 *
 * Reads, never writes, never contacts a network service:
 *   --notices <third-party-notices.json>   notices to review (default: the newest archived
 *                                          packaged-runtime snapshot under licenses/packaged-runtime)
 *   --apk-manifest <apk-manifest.json|evidence.json>  verify-apks rows with `licenceFlags`
 *   --sbom <sbom.json>                     CycloneDX SBOM with alphaphone:licence-flags properties
 *   --bundle <agent-bundle.js>             staged agent bundle: module presence and init sites
 *   --apk <file.apk>                       APK entry listing (via `unzip -Z1`): native ffmpeg binaries
 *   --eliza-git-dir <dir> --pin <sha>      upstream git objects: the source dependency chain markers
 *   --json                                 machine-readable output instead of the text packet
 *
 * Output is the flagged entries grouped as the runbook describes, distribution blockers (a shipped
 * Bun with no recorded written source offer), plus probe results. A flag is a
 * record of what was found; nothing printed here is a clearance. Absolute build-host paths found
 * in a bundle are counted, never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {errorMessage, isRecord, option, readJson} from './input.ts';
import {FLAGS, SOURCE_OFFER_FILE, SOURCE_OFFER_MISSING, readSourceOffer} from '../licence-policy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const BUN = 'Bun JavaScript runtime (libeliza_bun.so)';

/** Packages #674 names, and the role each review needs. */
export const WATCHED = [
  {name: '@metamask/sdk', topic: 'non-open-source terms (P-09 does not cover it)'},
  {name: 'ffmpeg-static', topic: 'GPL-3.0-or-later wrapper; does a GPL ffmpeg binary ship?'},
  {name: 'ua-parser-js', topic: 'AGPL-3.0-or-later; executed on the phone?'},
  {name: 'rpc-websockets', topic: 'LGPL-3.0-only; bundled (not separately replaceable)'},
  {name: BUN, topic: 'statically linked JavaScriptCore (LGPL)'},
  {name: /^eSpeak NG/, topic: 'GPL-3.0-or-later, statically linked into libelizainference'},
  {name: /^Phonon-2/, topic: 'CC-BY-4.0 weights; attribution and training-data terms'},
  {name: 'OpenStreetMap data', topic: 'ODbL-1.0 duties of the Maps service'},
  {name: 'url-template', topic: 'declared "BSD" (not an SPDX id); text is BSD-3-Clause'},
  {name: /^Android dependency com\.google\.android\.(gms|libraries\.identity)/, topic: 'Google Play services: Android SDK terms, not open source'},
  {name: /^Denton typeface/, topic: 'proprietary font, recorded on owner statement'},
];

/**
 * Owner decisions that accept a flagged package as shipped. An acceptance covers the exact version
 * named; any other version found in the notices is reported as not covered (re-decide). Recording
 * an acceptance here is not a licence review and not legal advice.
 */
export const OWNER_ACCEPTED = [
  {name: '@metamask/sdk', version: '0.33.1', decided: '2026-10-29', issue: '#674 (H-06)', note: 'owner accepts its terms and ships it in the resident runtime'},
];

const matches = (pattern: string | RegExp, name: string) => (typeof pattern === 'string' ? pattern === name : pattern.test(name));

/** Modules whose presence and initialisation in the agent bundle decide runtime reachability. */
export const BUNDLE_PROBES = [
  {pkg: '@metamask/sdk', header: /^\/\/ .*@metamask[+/]sdk@[^/]*\/node_modules\/@metamask\/sdk\/dist\//m, init: /init_metamask_sdk\(\)/g},
  {pkg: 'ffmpeg-static', header: /^\/\/ .*ffmpeg-static@[^/]*\/node_modules\/ffmpeg-static\/index\.js$/m, init: /require_ffmpeg_static\(\)/g},
  {pkg: 'ua-parser-js', header: /^\/\/ .*ua-parser-js@[^/]*\/node_modules\/ua-parser-js\//m, init: /init_ua_parser\(\)/g},
  {pkg: 'rpc-websockets', header: /^\/\/ .*rpc-websockets@[^/]*\/node_modules\/rpc-websockets\//m, init: null},
  {pkg: '@rainbow-me/rainbowkit', header: /^\/\/ .*@rainbow-me[+/]rainbowkit@[^/]*\/node_modules\/@rainbow-me\/rainbowkit\/dist\/index\.js$/m, init: null},
  {pkg: '@wagmi/connectors (metaMask)', header: /^\/\/ .*@wagmi\/connectors\/dist\/esm\/metaMask\.js$/m, init: null},
  {pkg: 'prism-media FFmpeg', header: /^\/\/ .*prism-media\/src\/core\/FFmpeg\.js$/m, init: null},
  {pkg: 'plugin-discord', header: /^\/\/ (\.\.\/)+plugins\/plugin-discord\//m, init: null},
  {pkg: 'packages/ui login/EVMProvider', header: /^\/\/ (\.\.\/)+ui\/src\/login\/EVMProvider\.tsx$/m, init: null},
];

/** Upstream source markers of the chains documented in the runbook (git show <pin>:<file>). */
export const SOURCE_MARKERS = [
  {file: 'packages/agent/scripts/build-mobile-bundle.ts', needle: '"@elizaos/ui": path.resolve(repoRoot, "packages", "ui", "src", "index.ts")', means: 'mobile bundle pins @elizaos/ui to the whole packages/ui barrel'},
  {file: 'packages/ui/src/index.ts', needle: 'from "./login/wallet.js"', means: 'packages/ui barrel re-exports the wallet login (EVMProvider, LoginFormWithWallets)'},
  {file: 'packages/ui/src/login/EVMProvider.tsx', needle: 'metaMaskWallet', means: 'EVMProvider imports RainbowKit metaMaskWallet (-> @wagmi/connectors metaMask -> @metamask/sdk)'},
  {file: 'packages/ui/package.json', needle: '"wagmi"', means: 'packages/ui depends on wagmi'},
  {file: 'packages/ui/package.json', needle: '"@rainbow-me/rainbowkit"', means: 'packages/ui depends on RainbowKit (-> ua-parser-js)'},
  {file: 'packages/agent/src/api/inbox-routes.ts', needle: 'import(/* @vite-ignore */ "@elizaos/plugin-discord")', means: 'agent dynamic-imports plugin-discord (Bun bundles it; -> prism-media -> ffmpeg-static)'},
  {file: 'plugins/plugin-discord/package.json', needle: '"prism-media"', means: 'plugin-discord depends on prism-media'},
  {file: 'bun.lock', needle: '"@metamask/sdk": ["@metamask/sdk@0.33.1"', means: 'lockfile resolves @metamask/sdk 0.33.1'},
  {file: 'bun.lock', needle: '"@wagmi/connectors": ["@wagmi/connectors@6.2.0", "", { "dependencies": { "@base-org/account": "2.4.0", "@coinbase/wallet-sdk": "4.3.6", "@gemini-wallet/core": "0.3.2", "@metamask/sdk": "0.33.1"', means: '@wagmi/connectors 6.2.0 depends on @metamask/sdk 0.33.1'},
  {file: 'bun.lock', needle: '"ua-parser-js": "^2.0.9"', means: 'RainbowKit depends on ua-parser-js'},
];

type Notice = Record<string, unknown> & {name: string};

function noticeRows(value: unknown): Notice[] {
  const rows: unknown[] = Array.isArray(value) ? value : [];
  return rows.filter((row): row is Notice => isRecord(row) && typeof row.name === 'string');
}

function stringFlags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(flag => typeof flag === 'string') : [];
}

const noticeVersion = (value: unknown) => String(value ?? '').split('\n')[0];

export function newestSnapshot(root = ROOT) {
  const dir = path.join(root, 'licenses', 'packaged-runtime');
  if (!fs.existsSync(dir)) return null;
  const rows = fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'snapshot.json'))).map(name => {
    const value = readJson(path.join(dir, name, 'snapshot.json'));
    const snap = isRecord(value) ? value : {};
    const at = typeof snap.recordedAt === 'string' ? Date.parse(snap.recordedAt) : Number(snap.recordedAtEpoch ?? 0) * 1000;
    return {name, at, notices: path.join(dir, name, 'third-party-notices.json'), snapshot: snap};
  }).sort((a, b) => b.at - a.at);
  return rows[0] ?? null;
}

/** Flagged entries as review rows; `watched` rows carry their topic. */
export function reviewRows(entries: unknown) {
  return noticeRows(entries).flatMap(entry => {
    const flags = stringFlags(entry.flags);
    if (!flags.length) return [];
    const watch = WATCHED.find(w => matches(w.name, entry.name));
    return [{
      name: entry.name, version: noticeVersion(entry.version).slice(0, 120), license: entry.license,
      flags, watched: watch ? watch.topic : null,
      shippedBy: /^Bundled in the on-device ([^.]+)\./.exec(typeof entry.text === 'string' ? entry.text : '')?.[1] ?? null,
      obligations: Array.isArray(entry.obligations) ? entry.obligations.filter(isRecord).map(obligation => obligation.flag) : [],
    }];
  });
}

/** Each owner acceptance against the notices: covered, version not covered, or not present. */
export function acceptanceStatus(entries: unknown, accepted = OWNER_ACCEPTED) {
  const list = noticeRows(entries);
  return accepted.map(a => {
    const found = list.filter(e => e?.name === a.name).map(e => noticeVersion(e.version));
    const status = !found.length ? 'not-present' : found.every(v => v === a.version) ? 'covered' : 'version-not-covered';
    return {name: a.name, acceptedVersion: a.version, decided: a.decided, issue: a.issue, foundVersions: found, status};
  });
}

/**
 * Distribution blockers the notices raise: shipped Bun (statically linked LGPL JavaScriptCore)
 * with no written source offer recorded in SOURCE_OFFER_FILE.
 */
export function distributionBlockers(entries: unknown, root = ROOT) {
  const list = noticeRows(entries);
  if (!list.some(entry => entry?.name === BUN)) return [];
  try { return readSourceOffer(root) ? [] : [`${SOURCE_OFFER_MISSING} (${SOURCE_OFFER_FILE})`]; }
  catch (error) { return [`${SOURCE_OFFER_MISSING}: ${errorMessage(error)}`]; }
}

export function flagCounts(rows: readonly {flags: readonly string[]}[]) {
  const counts: Record<string, number> = Object.fromEntries(FLAGS.map(flag => [flag, 0]));
  for (const row of rows) for (const flag of row.flags) counts[flag] = (counts[flag] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n));
}

/** verify-apks rows (apk-manifest.json or a docs/evidence copy): flags per APK for the watched packages. */
export function apkManifestSummary(manifest: unknown) {
  const result = isRecord(manifest) ? manifest : {};
  const rows: unknown[] = Array.isArray(result.results) ? result.results : Array.isArray(result.apks) ? result.apks : Array.isArray(manifest) ? manifest : [];
  return rows.filter(isRecord).map(row => {
    const flags = noticeRows(row.licenceFlags);
    const fontCheck = isRecord(row.fontLicenceCheck) ? row.fontLicenceCheck.status : null;
    return {
      file: row.file, variant: row.variant, mode: row.mode, flagged: flags.length,
      counts: flagCounts(flags.map(entry => ({flags: stringFlags(entry.flags)}))),
      watched: flags.filter(f => WATCHED.some(w => matches(w.name, f.name))).map(f => `${f.name.split(' (')[0]}@${noticeVersion(f.version).slice(0, 20)}`),
      licenceBlockers: row.licenceBlockers ?? null, fontCheck: fontCheck ?? null,
    };
  });
}

/** SBOM components with a licence flag (CycloneDX `properties`). */
export function sbomSummary(sbom: unknown) {
  const components = isRecord(sbom) ? noticeRows(sbom.components) : [];
  return components.flatMap(component => {
    const properties: unknown[] = Array.isArray(component.properties) ? component.properties : [];
    const prop = properties.filter(isRecord).find(property => property.name === 'alphaphone:licence-flags');
    const flags = prop?.value ? String(prop.value).split(/[,\s]+/).filter(flag => flag && flag !== 'none') : [];
    return flags.length ? [{name: component.name, version: component.version, flags}] : [];
  });
}

/** Module presence, init call counts and build-host path count in a staged agent bundle. */
export function bundleProbe(text: string) {
  const results = BUNDLE_PROBES.map(probe => ({
    pkg: probe.pkg, bundled: probe.header.test(text),
    initCallSites: probe.init ? (text.match(probe.init) ?? []).length : null,
  }));
  // ffmpeg-static resolves a binary next to its build-host __dirname; report whether that is the case.
  const ffmpegDirname = /var __dirname = "([^"]*ffmpeg-static)";/.exec(text);
  const hostPaths = (text.match(/"\/(home|Users)\/[^"]+"/g) ?? []).length;
  return {modules: results, ffmpegStaticResolvesBuildHostPath: Boolean(ffmpegDirname && path.isAbsolute(ffmpegDirname[1])), absoluteBuildHostPathLiterals: hostPaths};
}

/** Native ffmpeg/ffprobe executables or FFmpeg shared libraries in an APK entry list. */
export function apkFfmpegEntries(names: readonly string[]) {
  return names.filter(name => /^(lib)?(ffmpeg|ffprobe|avconv|avcodec|avformat|avutil|avfilter|avdevice|swscale|swresample)(\.so(\.\d+)*|\.exe)?$/i.test(path.posix.basename(name)));
}

export function listApk(file: string) {
  const res = spawnSync('unzip', ['-Z1', file], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (res.status !== 0) throw new Error(`unzip -Z1 ${file} failed: ${res.stderr?.trim() || res.status}`);
  return res.stdout.split('\n').filter(Boolean);
}

/** Check the documented source chain at an upstream pin from git objects (no checkout needed). */
export function sourceChain(gitDir: string, pin: string, show = (file: string): string | null => {
  const res = spawnSync('git', ['--git-dir', gitDir, 'show', `${pin}:${file}`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  return res.status === 0 ? res.stdout : null;
}) {
  const cache = new Map<string, string | null>();
  return SOURCE_MARKERS.map(marker => {
    if (!cache.has(marker.file)) cache.set(marker.file, show(marker.file));
    const body = cache.get(marker.file);
    return {file: marker.file, means: marker.means, present: body == null ? null : body.includes(marker.needle)};
  });
}

interface Packet {
  disclaimer: string;
  snapshot?: {dir: string; upstreamCommit: unknown; sourceCommit: unknown};
  acceptance?: ReturnType<typeof acceptanceStatus>;
  blockers?: string[];
  notices?: {file: string; flagged: number; counts: Record<string, number>; watched: ReturnType<typeof reviewRows>; otherFlagged: number};
  apkManifest?: ReturnType<typeof apkManifestSummary>;
  sbom?: {flaggedComponents: number; counts: Record<string, number>; watched: ReturnType<typeof sbomSummary>};
  bundle?: ReturnType<typeof bundleProbe>;
  apk?: {file: string; entries: number; nativeLibs: number; ffmpegBinaries: string[]};
  sourceChain?: {pin: string; markers: ReturnType<typeof sourceChain>};
}

export function buildPacket(argv: readonly string[], root = ROOT): Packet {
  const packet: Packet = {disclaimer: 'Owner prep for #674. Not legal advice. A licence flag is a record of what was found, not a clearance.'};
  let noticesFile = option(argv, '--notices');
  if (!noticesFile) {
    const snap = newestSnapshot(root);
    if (snap) { noticesFile = snap.notices; packet.snapshot = {dir: path.relative(root, path.dirname(snap.notices)), upstreamCommit: snap.snapshot.upstreamCommit ?? null, sourceCommit: snap.snapshot.sourceCommit ?? null}; }
  }
  if (noticesFile) {
    const all = readJson(noticesFile);
    const rows = reviewRows(all);
    packet.acceptance = acceptanceStatus(all);
    packet.blockers = distributionBlockers(all, root);
    packet.notices = {file: path.relative(root, path.resolve(noticesFile)), flagged: rows.length, counts: flagCounts(rows), watched: rows.filter(r => r.watched), otherFlagged: rows.filter(r => !r.watched).length};
  }
  const apkManifest = option(argv, '--apk-manifest');
  if (apkManifest) packet.apkManifest = apkManifestSummary(readJson(apkManifest));
  const sbom = option(argv, '--sbom');
  if (sbom) { const s = sbomSummary(readJson(sbom)); packet.sbom = {flaggedComponents: s.length, counts: flagCounts(s), watched: s.filter(c => WATCHED.some(w => matches(w.name, c.name)))}; }
  const bundle = option(argv, '--bundle');
  if (bundle) packet.bundle = bundleProbe(fs.readFileSync(bundle, 'utf8'));
  const apk = option(argv, '--apk');
  if (apk) { const names = listApk(apk); packet.apk = {file: path.basename(apk), entries: names.length, nativeLibs: names.filter(n => /^lib\//.test(n)).length, ffmpegBinaries: apkFfmpegEntries(names)}; }
  const gitDir = option(argv, '--eliza-git-dir');
  if (gitDir) {
    let pin = option(argv, '--pin');
    if (pin === undefined) {
      const lock = readJson(path.join(root, 'upstream.lock.json'));
      if (!isRecord(lock) || typeof lock.commit !== 'string') throw new Error('upstream.lock.json has no commit');
      pin = lock.commit;
    }
    packet.sourceChain = {pin, markers: sourceChain(gitDir, pin)};
  }
  return packet;
}

export function formatPacket(packet: Packet) {
  const lines = [packet.disclaimer, ''];
  if (packet.snapshot) lines.push(`Notices: archived packaged-runtime snapshot ${packet.snapshot.dir} (upstream ${packet.snapshot.upstreamCommit})`);
  if (packet.notices) {
    lines.push(`Flagged entries: ${packet.notices.flagged} in ${packet.notices.file}`);
    for (const [flag, n] of Object.entries(packet.notices.counts)) lines.push(`  ${flag}: ${n}`);
    lines.push('', 'Entries #674 asks about:');
    for (const r of packet.notices.watched) lines.push(`  ${r.name.slice(0, 70)} | ${r.license} | ${r.flags.join(', ')}${r.shippedBy ? ` | ${r.shippedBy}` : ''}\n    -> ${r.watched}`);
    lines.push(`  (${packet.notices.otherFlagged} other flagged entries, mostly licence-text-missing-from-package / unverified)`);
  }
  if (packet.blockers?.length) {
    lines.push('', 'Distribution blockers:');
    for (const blocker of packet.blockers) lines.push(`  ${blocker}`);
  }
  if (packet.acceptance) {
    lines.push('', 'Owner acceptances (exact version only):');
    for (const a of packet.acceptance) lines.push(`  ${a.name}@${a.acceptedVersion} (${a.issue}, ${a.decided}): ${a.status}${a.foundVersions.length ? ` [found ${a.foundVersions.join(', ')}]` : ''}${a.status === 'version-not-covered' ? ' -> the owner must re-decide for the new version' : ''}`);
  }
  if (packet.apkManifest) {
    lines.push('', 'verify-apks licenceFlags:');
    for (const r of packet.apkManifest) lines.push(`  ${r.file} (${r.variant} ${r.mode}): ${r.flagged} flagged; licenceBlockers ${JSON.stringify(r.licenceBlockers)}; font ${r.fontCheck}`);
  }
  if (packet.sbom) lines.push('', `SBOM: ${packet.sbom.flaggedComponents} components with licence flags (${Object.entries(packet.sbom.counts).map(([f, n]) => `${f} ${n}`).join(', ')}); watched: ${[...new Set(packet.sbom.watched.map(c => c.name.split(/[ :(]/)[0]))].join(', ') || 'none'}`);
  if (packet.bundle) {
    lines.push('', 'Agent bundle probe:');
    for (const m of packet.bundle.modules) lines.push(`  ${m.pkg}: ${m.bundled ? 'bundled' : 'not bundled'}${m.initCallSites == null ? '' : `, init call sites ${m.initCallSites}`}`);
    lines.push(`  ffmpeg-static resolves a build-host binary path: ${packet.bundle.ffmpegStaticResolvesBuildHostPath}`);
    lines.push(`  absolute build-host path literals in bundle: ${packet.bundle.absoluteBuildHostPathLiterals} (values not printed)`);
  }
  if (packet.apk) lines.push('', `APK ${packet.apk.file}: ${packet.apk.entries} entries, ${packet.apk.nativeLibs} native libs, ffmpeg binaries: ${packet.apk.ffmpegBinaries.length ? packet.apk.ffmpegBinaries.join(', ') : 'none'}`);
  if (packet.sourceChain) {
    lines.push('', `Upstream source chain at ${packet.sourceChain.pin}:`);
    for (const m of packet.sourceChain.markers) lines.push(`  [${m.present == null ? 'file missing' : m.present ? 'yes' : 'NO'}] ${m.means} (${m.file})`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const packet = buildPacket(argv);
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(packet, null, 2)}\n` : formatPacket(packet));
}
