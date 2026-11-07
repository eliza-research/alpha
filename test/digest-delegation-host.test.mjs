import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const picker=fs.readFileSync('apps/app/src/runtime/hosted-live-source-ui.tsx','utf8'),digest=fs.readFileSync('apps/app/src/runtime/hosted-digest-ui.tsx','utf8');
test('the Android Cloud delegation panel is not mounted in a browser host',()=>{
 // CloudDelegationPanel reads the cloud-delegation:v1 secure slot on mount. Browser hosts reject that
 // slot (the dev bridge with HTTP 400, the web store with an unavailable-slot error), so the panel
 // must only mount on Android; the ?mode=dev development profile keeps its browser delegation.
 assert.match(picker,/import \{ isAndroid \} from '\.\.\/native';/);
 const mount=/:isAndroid\?<CloudDelegationPanel /.exec(picker);assert(mount,'CloudDelegationPanel is gated on isAndroid');
 assert.equal(picker.match(/<CloudDelegationPanel /g).length,1);
 assert.ok(picker.indexOf('<BrowserDigestDelegation ')<mount.index,'the development profile branch is checked first');
});
test('the schedule note separates its two sentences',()=>{
 assert.match(digest,/run when you start them\.\{' '\}\n\s*\{interactiveDevelopment \? 'Digests use the configured development reply\.' : 'Model usage is billed by the connected agent\.'\}/);
});
