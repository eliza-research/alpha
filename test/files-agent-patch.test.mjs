// The Files contract is part of the pinned SDK. The earlier proposed patch remains an archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';

const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'patches/eliza/files-browser-agent.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8'));
const sharedDirectory='plugins/plugin-assistant/src/services/device-actions';
const vendor=path.join(root,'vendor/eliza');
const features=path.join(root,'.eliza/client-features');
const vendorReady=fs.existsSync(path.join(vendor,sharedDirectory,'action.ts'));
const featuresReady=fs.existsSync(path.join(features,sharedDirectory,'files-browser-contract.ts'));

test('the pinned Files contract gates the schema, registration and reviewed operations', {skip:!vendorReady&&'vendor/eliza not checked out'}, ()=>{
  assert.equal(manifest.status,'integrated-in-pin');
  assert.equal(manifest.baseCommit,lock.commit);
  const [archive]=manifest.patches;
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'patches/eliza',archive.file))).digest('hex'),archive.sha256);
  const read=name=>fs.readFileSync(path.join(vendor,sharedDirectory,name),'utf8');
  assert.match(read('action.ts'),/\.\.\.FILES_OPERATION_SCHEMAS,/);
  assert.match(read('action.ts'),/capabilities\?\.includes\(FILES_CAPABILITY\)/);
  assert.match(read('contract.ts'),/if \(isFilesOperation\(\{ type \}\)\)\s+return capabilities\?\.includes\(FILES_CAPABILITY\) === true;/);
  assert.match(read('service.ts'),/\.\.\.FILES_OPERATION_TYPES,/);
  assert.match(read('service.ts'),/NOTES_SEARCH_CAPABILITY,\s+CALENDAR_AVAILABILITY_CAPABILITY,\s+FILES_CAPABILITY,/);
  const route=fs.readFileSync(path.join(vendor,'packages/agent/src/api/device-action-routes.ts'),'utf8');
  assert.equal((route.match(/CALENDAR_AVAILABILITY_CAPABILITY,\s+FILES_CAPABILITY,/g)||[]).length,2);
});

test('the shipped coordinator and Files view agree on approved operations', {skip:!featuresReady&&'prepared client features are missing'}, async()=>{
 const moduleAt=name=>tsImport(path.join(features,sharedDirectory,name),import.meta.url);
 const {validateDeviceOperation,proposalContextNotice}=await moduleAt('client-coordinator.ts');
 const {deviceOperationSupportedByCapabilities}=await moduleAt('contract.ts');
 const shared=await moduleAt('files-browser-contract.ts');
 const alpha=await tsImport(path.join(features,'plugins/plugin-files/src/browser/files-agent-contract.ts'),import.meta.url);
 const policy = {admitView: () => true, parseWorkflowRead: () => { throw Error('no'); }};
 const good = [
   {type: 'files_filter', text: 'lease', kind: 'pdf', folder: 'Download'},
   {type: 'files_filter', from: '2026-10-01', to: '2026-10-31'},
   {type: 'files_open', path: 'Download/lease.pdf'},
   {type: 'files_share', paths: ['Download/a.pdf', 'DCIM/Camera/b.jpg']},
   {type: 'files_move', paths: ['Download/a.pdf'], dest: ''},
   {type: 'files_trash', paths: ['Download/a.pdf']},
   {type: 'files_move', paths: ['Download/a.pdf'], dest: 'Documents', reviewed: ['a'.repeat(43)]},
   {type: 'files_folder_create', parent: 'Documents', name: 'Taxes'},
 ];
 const bad = [
   {type: 'files_trash', paths: ['../etc']}, {type: 'files_open', path: '/storage/emulated/0/file.txt'}, {type: 'files_open', path: 'a', extra: 1}, {type: 'files_move', paths: ['a', 'a'], dest: 'x'},
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
 const ports = {};
 assert.equal(proposalContextNotice({type: 'files_trash', paths: ['a']}, {view: 'home', revision: 1}, ports), 'Open Files to review this action.');
 assert.equal(proposalContextNotice({type: 'files_trash', paths: ['a']}, {view: 'files', revision: 1}, ports), undefined);
 assert.equal(proposalContextNotice({type: 'files_filter', text: 'a'}, {view: 'files', sensitive: true, revision: 1}, ports), 'Unlock the phone to review this action.');
 assert.equal(proposalContextNotice({type: 'files_filter', text: 'a'}, {view: 'home', revision: 1}, ports), undefined);
});
