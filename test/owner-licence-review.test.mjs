import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acceptanceStatus, apkFfmpegEntries, apkManifestSummary, buildPacket, bundleProbe, flagCounts, formatPacket, newestSnapshot, reviewRows, sbomSummary, sourceChain, SOURCE_MARKERS,
} from '../scripts/owner/licence-review.mjs';

const entries = [
  {name: '@metamask/sdk', version: '0.33.1', license: 'UNKNOWN', flags: ['unknown-licence', 'non-open-source-terms'], obligations: [{flag: 'unknown-licence', note: 'x'}], text: 'Bundled in the on-device agent bundle.\n\nAll rights reserved.'},
  {name: 'ffmpeg-static', version: '5.3.0', license: 'GPL-3.0-or-later', flags: ['copyleft-strong'], text: 'Bundled in the on-device agent bundle.\n\nGPL'},
  {name: 'left-pad', version: '1.0.0', license: 'MIT', flags: [], text: 'MIT'},
  {name: 'murmurhash-js', version: '1.0.0', license: 'MIT', flags: ['licence-text-missing-from-package'], text: 'MIT'},
];

test('review rows keep only flagged entries and mark the ones #674 asks about', () => {
  const rows = reviewRows(entries);
  assert.equal(rows.length, 3);
  const sdk = rows.find(r => r.name === '@metamask/sdk');
  assert.match(sdk.watched, /non-open-source/);
  assert.equal(sdk.shippedBy, 'agent bundle');
  assert.equal(rows.find(r => r.name === 'murmurhash-js').watched, null);
  assert.deepEqual(flagCounts(rows), {'copyleft-strong': 1, 'unknown-licence': 1, 'non-open-source-terms': 1, 'licence-text-missing-from-package': 1});
});

test('apk manifest and SBOM summaries read licenceFlags and ignore "none"', () => {
  const apk = apkManifestSummary({results: [{file: 'a.apk', variant: 'launcher', mode: 'release', licenceFlags: entries.slice(0, 2), licenceBlockers: [], fontLicenceCheck: {status: 'resolved-by-owner-statement'}}]});
  assert.equal(apk[0].flagged, 2);
  assert.deepEqual(apk[0].watched, ['@metamask/sdk@0.33.1', 'ffmpeg-static@5.3.0']);
  const sbom = sbomSummary({components: [
    {name: 'ua-parser-js', version: '2.0.10', properties: [{name: 'alphaphone:licence-flags', value: 'copyleft-strong,network-copyleft'}]},
    {name: 'react', version: '19', properties: [{name: 'alphaphone:licence-flags', value: 'none'}]},
  ]});
  assert.deepEqual(sbom, [{name: 'ua-parser-js', version: '2.0.10', flags: ['copyleft-strong', 'network-copyleft']}]);
});

test('bundle probe finds module headers and init sites, counts host paths without printing them', () => {
  const bundle = [
    '// ../../node_modules/.bun/@metamask+sdk@0.33.1+abc/node_modules/@metamask/sdk/dist/browser/es/metamask-sdk.js',
    'await Promise.resolve().then(() => init_metamask_sdk());',
    '// ../../node_modules/.bun/ffmpeg-static@5.3.0+abc/node_modules/ffmpeg-static/index.js',
    'var require_ffmpeg_static = __commonJS(function(exports2, module2) {',
    '  var __dirname = "/home/someone/build/node_modules/.bun/ffmpeg-static@5.3.0+abc/node_modules/ffmpeg-static";',
    '});',
    'const s = require_ffmpeg_static();',
  ].join('\n');
  const probe = bundleProbe(bundle);
  const byPkg = Object.fromEntries(probe.modules.map(m => [m.pkg, m]));
  assert.equal(byPkg['@metamask/sdk'].bundled, true);
  assert.equal(byPkg['@metamask/sdk'].initCallSites, 1);
  assert.equal(byPkg['ffmpeg-static'].initCallSites, 1);
  assert.equal(byPkg['ua-parser-js'].bundled, false);
  assert.equal(probe.ffmpegStaticResolvesBuildHostPath, true);
  assert.equal(probe.absoluteBuildHostPathLiterals, 1);
  assert.doesNotMatch(JSON.stringify(probe), /someone/);
});

test('apk listing probe finds native ffmpeg binaries only', () => {
  assert.deepEqual(apkFfmpegEntries(['lib/arm64-v8a/libeliza_bun.so', 'assets/agent/agent-bundle.js', 'lib/arm64-v8a/libffmpeg.so', 'assets/bin/ffprobe', 'lib/x86_64/libavcodec.so.61']), ['lib/arm64-v8a/libffmpeg.so', 'assets/bin/ffprobe', 'lib/x86_64/libavcodec.so.61']);
  assert.deepEqual(apkFfmpegEntries(['assets/public/licenses/ffmpeg-static.txt.json']), []);
});

test('source chain reports present, absent and missing files', () => {
  const files = {'packages/ui/src/index.ts': 'export {x} from "./login/wallet.js";'};
  const out = sourceChain('unused', 'pin', file => files[file] ?? null);
  assert.equal(out.length, SOURCE_MARKERS.length);
  assert.equal(out.find(m => m.file === 'packages/ui/src/index.ts').present, true);
  assert.equal(out.find(m => m.file === 'bun.lock').present, null);
});

test('packet defaults to the newest archived snapshot and formats with the disclaimer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-review-'));
  for (const [name, at] of [['aaa', '2026-10-01T00:00:00Z'], ['bbb', '2026-10-20T00:00:00Z']]) {
    fs.mkdirSync(path.join(root, 'licenses/packaged-runtime', name), {recursive: true});
    fs.writeFileSync(path.join(root, 'licenses/packaged-runtime', name, 'snapshot.json'), JSON.stringify({recordedAt: at, upstreamCommit: name}));
    fs.writeFileSync(path.join(root, 'licenses/packaged-runtime', name, 'third-party-notices.json'), JSON.stringify(name === 'bbb' ? entries : []));
  }
  assert.equal(newestSnapshot(root).name, 'bbb');
  const packet = buildPacket([], root);
  assert.equal(packet.snapshot.upstreamCommit, 'bbb');
  assert.equal(packet.notices.flagged, 3);
  const text = formatPacket(packet);
  assert.match(text, /Not legal advice/);
  assert.match(text, /@metamask\/sdk \| UNKNOWN/);
  fs.rmSync(root, {recursive: true, force: true});
});

test('the repository archive yields a packet without any external input', () => {
  const packet = buildPacket([]);
  if (!packet.notices) return; // no archived snapshot in this checkout
  assert.ok(packet.notices.flagged > 0);
});

test('owner acceptance covers the exact @metamask/sdk version only', () => {
  assert.equal(acceptanceStatus(entries)[0].status, 'covered');
  const bumped = [{...entries[0], version: '0.34.0'}];
  assert.equal(acceptanceStatus(bumped)[0].status, 'version-not-covered');
  assert.deepEqual(acceptanceStatus(bumped)[0].foundVersions, ['0.34.0']);
  assert.equal(acceptanceStatus([])[0].status, 'not-present');
  assert.match(formatPacket({disclaimer: 'd', acceptance: acceptanceStatus(bumped)}), /re-decide/);
});
