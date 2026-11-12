import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
// AP-13 / #422: Wallet is outside the MVP in both distributions and on the Alpha AOSP image. Its
// views, deep links, native/payment adapters and agent actions stay unavailable; no payment, card
// or pass-wallet effect can be reached from a product build.
const root=resolve(import.meta.dirname,'..');

// The resident runtime payload carries no browser wallet-connector closure (wagmi, RainbowKit,
// the MetaMask SDK, whose licence is not open source): the pinned mobile build resolves them to
// its throw-on-call stub, so they never appear in the staged runtime inventory (#674).
const WALLET_CONNECTOR=/^(?:wagmi|@wagmi\/[^/]+|@rainbow-me\/[^/]+|@metamask\/[^/]+)$/;
test('a staged resident runtime inventory lists no @metamask/*, wagmi or @rainbow-me/* package',t=>{
 const file=join(root,'android/app/src/main/assets/agent/agent-bundle-dependencies.json');
 if(!existsSync(file)){t.skip('no staged resident runtime (bun run agent:stage-android writes it)');return;}
 const {packages}=JSON.parse(readFileSync(file,'utf8'));
 assert.ok(Array.isArray(packages)&&packages.length>0,'staged inventory lists packages');
 assert.deepEqual(packages.filter(row=>WALLET_CONNECTOR.test(row.name)).map(row=>`${row.name}@${row.version}`),[]);
});
