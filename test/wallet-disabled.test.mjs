import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {nativeViewDeclarationsJson} from '../scripts/native-view-policy.ts';
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

const dataModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');


test('the resident agent profile used by Alpha loads no Wallet actions in either distribution',async()=>{
 // Product view launch policy names no Wallet view.
 const views=JSON.parse(nativeViewDeclarationsJson);
 assert.ok(Array.isArray(views)&&views.length>0);
 for(const view of views)assert.doesNotMatch(`${view.id} ${view.path} ${view.fallbackFor}`,/wallet|payment/i);
 // The pinned upstream resident restricts every Android runtime (stock APK and the AOSP image
 // variant) to these lists, so @elizaos/plugin-wallet and its transfer/swap actions never load.
 const file=join(root,'vendor/eliza/packages/agent/src/runtime/core-plugins.ts');
 assert.ok(existsSync(file),'pinned upstream plugin policy');
 const policy=await import(dataModule(stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'strip'})));
 const lists=['MOBILE_CORE_PLUGINS','MOBILE_VIEW_PLUGINS','MOBILE_MODEL_PROVIDER_PLUGINS','ELIZAOS_ANDROID_CORE_PLUGINS','ELIZAOS_ANDROID_TERMINAL_PLUGINS'];
 for(const name of lists){
  assert.ok(Array.isArray(policy[name])&&policy[name].length>0,name);
  for(const plugin of policy[name])assert.doesNotMatch(plugin,/wallet|payment|solana|evm/i,`${name} admits ${plugin}`);
 }
});
