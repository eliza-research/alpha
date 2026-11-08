import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8');
const region=source.slice(source.indexOf('// host-modal:begin'),source.indexOf('// host-modal:end'));
assert.ok(region.length>100,'host-modal region is present');
const {hostModalOpen}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region.replace('const hostModalOpen','export const hostModalOpen'),{mode:'transform'})).toString('base64'));
const page=present=>({querySelector:selector=>selector.split(',').map(part=>part.trim()).some(part=>present.includes(part))?{}:null});

test('a modal host layer hides the native browser page',()=>{
 // Found on an API 36 emulator: the first-run access panel opened under a loaded page; the native
 // page covered the modal panel and still took touches while the host was inert.
 assert.equal(hostModalOpen(page(['dialog:modal']),true),true);
 assert.equal(hostModalOpen(page(['.alpha-connection-scrim']),true),true);
 assert.equal(hostModalOpen(page([]),true),false);
 assert.equal(hostModalOpen(page(['dialog[open]']),true),false,'a non-modal dialog does not make the host inert');
 // In a browser build the page is an element of the host document, below any modal: journey E keeps the
 // old document shown under the reading review.
 assert.equal(hostModalOpen(page(['dialog:modal','.alpha-connection-scrim']),false),false);
});
test('the presented geometry is withdrawn while such a layer is open',()=>{
 assert.match(source,/const hidden=questionReview \|\| confirming \|\| hostModalOpen\(document, Capacitor\.isNativePlatform\(\)\) \|\| /);
 assert.match(readFileSync('apps/app/src/startup-permissions.tsx','utf8'),/panel\.showModal\(\)/,'the access panel is a modal dialog');
 assert.match(readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),/className="alpha-connection-scrim"/);
});
