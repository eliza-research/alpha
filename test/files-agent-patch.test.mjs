// The files.browser.v1 agent tools are a proposed upstream plugin-assistant change kept as an
// explicit patch (patches/eliza/files-browser-agent.patch). This checks the patch against the
// pinned sources and runs the patched phone-side coordinator and contract beside Alpha's own
// Files contract. It is source evidence only: no build applies the patch until it lands upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'patches/eliza/files-browser-agent.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8'));
const vendor = path.join(root, 'vendor/eliza');
const vendorReady = fs.existsSync(path.join(vendor, manifest.patches[0].targets[0].path));
const featuresReady = fs.existsSync(path.join(root, '.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/client-coordinator.ts'));

function applied(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-files-agent-patch-'));
  t.after(() => fs.rmSync(work, {recursive: true, force: true}));
  const [patch] = manifest.patches;
  for (const target of patch.targets) {
    if (target.beforeSha256 === null) { assert.equal(fs.existsSync(path.join(vendor, target.path)), false, target.path); continue; }
    const bytes = fs.readFileSync(path.join(vendor, target.path));
    assert.equal(sha(bytes), target.beforeSha256, `pinned ${target.path}`);
    fs.mkdirSync(path.dirname(path.join(work, target.path)), {recursive: true});
    fs.writeFileSync(path.join(work, target.path), bytes);
  }
  execFileSync('patch', ['--batch', '--fuzz=0', '--forward', '-p1', '--input', path.join(root, 'patches/eliza', patch.file)], {cwd: work, stdio: 'pipe'});
  for (const target of patch.targets) assert.equal(sha(fs.readFileSync(path.join(work, target.path))), target.afterSha256, `patched ${target.path}`);
  return work;
}

test('the Files agent patch is pinned, digest-bound and applies exactly to the pinned plugin-assistant', {skip: !vendorReady && 'vendor/eliza is not checked out'}, t => {
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.baseCommit, lock.commit);
  const [patch] = manifest.patches;
  assert.equal(sha(fs.readFileSync(path.join(root, 'patches/eliza', patch.file))), patch.sha256);
  assert.ok(patch.targets.every(target => target.path.startsWith('plugins/plugin-assistant/src/services/device-actions/')));
  const work = applied(t);
  const at = name => fs.readFileSync(path.join(work, 'plugins/plugin-assistant/src/services/device-actions', name), 'utf8');
  // Agent side: the tool advertises the branches and guidance, and gates both on the capability.
  assert.match(at('action.ts'), /\.\.\.FILES_OPERATION_SCHEMAS,/);
  assert.match(at('action.ts'), /\.replace\(files \? "" : ` \$\{FILES_GUIDANCE\}`, ""\)/);
  assert.match(at('action.ts'), /type !== "camera_capture_photo" &&\n\s+!isFilesOperation\(\{ type \}\) &&/, 'unnegotiated phones never see Files tools');
  assert.match(at('contract.ts'), /if \(isFilesOperation\(\{ type \}\)\)\n\s+return capabilities\?\.includes\(FILES_CAPABILITY\) === true;/);
  assert.match(at('service.ts'), /\.\.\.FILES_OPERATION_TYPES,/);
  // Phone side: capability admission, review context and the direct (view-only) types.
  assert.match(at('client-coordinator.ts'), /isFilesOperation\(op\) && !this\.capability\(FILES_CAPABILITY\)/);
  assert.match(at('client-coordinator.ts'), /"photo_library_select",\n\s+\.\.\.FILES_DIRECT_TYPES,/);
  assert.match(at('files-browser-contract.ts'), /export const FILES_DIRECT_TYPES = \["files_filter", "files_open"\] as const;/);
});

test('patched coordinator admits Files tools only as reviewed, and agrees with Alpha\'s Files contract', {skip: (!vendorReady || !featuresReady) && 'vendor/eliza or prepared client features are missing'}, t => {
  const work = applied(t);
  // Run against a private copy of the prepared client features with the patch applied.
  const features = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-files-agent-features-'));
  t.after(() => fs.rmSync(features, {recursive: true, force: true}));
  fs.cpSync(path.join(root, '.eliza/client-features/plugins'), path.join(features, 'plugins'), {recursive: true});
  for (const target of manifest.patches[0].targets) fs.copyFileSync(path.join(work, target.path), path.join(features, target.path));
  const dir = path.join(features, 'plugins/plugin-assistant/src/services/device-actions');
  const script = path.join(dir, 'files-agent-check.ts');
  fs.writeFileSync(script, `
import assert from 'node:assert/strict';
import {validateDeviceOperation, proposalContextNotice} from './client-coordinator.ts';
import {deviceOperationSupportedByCapabilities} from './contract.ts';
import * as shared from './files-browser-contract.ts';
import * as alpha from ${JSON.stringify(path.join(root, 'apps/app/src/runtime/files-agent-contract.ts'))};
const policy = {admitView: () => true, parseWorkflowRead: () => { throw Error('no'); }};
const good = [
  {type: 'files_filter', text: 'lease', kind: 'pdf', folder: 'Download'},
  {type: 'files_filter', from: '2026-10-01', to: '2026-10-31'},
  {type: 'files_open', path: 'Download/lease.pdf'},
  {type: 'files_share', paths: ['Download/a.pdf', 'DCIM/Camera/b.jpg']},
  {type: 'files_move', paths: ['Download/a.pdf'], dest: ''},
  {type: 'files_trash', paths: ['Download/a.pdf']},
  {type: 'files_folder_create', parent: 'Documents', name: 'Taxes'},
];
const bad = [
  {type: 'files_trash', paths: ['../etc']}, {type: 'files_open', path: 'a', extra: 1}, {type: 'files_move', paths: ['a', 'a'], dest: 'x'},
  {type: 'files_folder_create', parent: '', name: '.hidden'}, {type: 'files_filter'}, {type: 'files_filter', kind: 'zip'},
  {type: 'files_filter', from: '2026-11-02', to: '2026-11-01'}, {type: 'files_move', paths: [], dest: 'x'},
];
for (const op of good) {
  const valid = validateDeviceOperation(op, policy);
  assert.deepEqual(valid, op);
  assert.deepEqual(validateDeviceOperation(valid, policy), valid, 'a validated operation validates again unchanged');
  assert.deepEqual(alpha.validateFilesOperation(op), valid, 'Alpha and the shared contract agree');
  assert.deepEqual(alpha.describeFilesOperation(valid), shared.describeFilesOperation(valid));
  assert.equal(deviceOperationSupportedByCapabilities(op.type, ['files.browser.v1']), true);
  assert.equal(deviceOperationSupportedByCapabilities(op.type, ['camera.capture-photo.v1']), false);
  assert.equal(deviceOperationSupportedByCapabilities(op.type, undefined), false);
}
for (const op of bad) {
  assert.throws(() => validateDeviceOperation(op, policy));
  assert.throws(() => alpha.validateFilesOperation(op));
}
assert.deepEqual([...shared.FILES_DIRECT_TYPES], [...alpha.FILES_DIRECT_TYPES]);
assert.deepEqual([...shared.FILES_OPERATION_TYPES], [...alpha.FILES_OPERATION_TYPES]);
assert.equal(shared.FILES_CAPABILITY, alpha.FILES_CAPABILITY);
const ports = {} as never;
assert.equal(proposalContextNotice({type: 'files_trash', paths: ['a']}, {view: 'home', revision: 1} as never, ports), 'Open Files to review this action.');
assert.equal(proposalContextNotice({type: 'files_trash', paths: ['a']}, {view: 'files', revision: 1} as never, ports), undefined);
assert.equal(proposalContextNotice({type: 'files_filter', text: 'a'}, {view: 'files', sensitive: true, revision: 1} as never, ports), 'Unlock the phone to review this action.');
assert.equal(proposalContextNotice({type: 'files_filter', text: 'a'}, {view: 'home', revision: 1} as never, ports), undefined);
console.log('files-agent-check ok');
`);
  const out = execFileSync(process.execPath, ['--import', 'tsx', script], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000});
  assert.match(out, /files-agent-check ok/);
});
