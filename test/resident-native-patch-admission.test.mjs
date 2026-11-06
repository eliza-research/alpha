import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['ElizaAgentService','1cb89a4c1283fcd90f19d739ef3cf23d556ee9da184516583c41a128bb49e984'],
 ['IpcStartupRecovery','c51152d8b6403622171e4baed30f55cb540cad2c3fd49a8be1171a4b2c015c27'],
 ['WorkflowSurvivorInventory','3270bebe7e125705eda25e91ba9996f99cb80fbcb7e534c0d1ea47672a0fc42b'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
test('the pinned resident stop inventory skips vanished processes without a consumer repair',async()=>{
 const {UPSTREAM_REPAIRS,applyUpstreamRepair}=await import('../scripts/upstream-native-repairs.mjs');
 assert.deepEqual(UPSTREAM_REPAIRS,[]);
 const pinned=fs.readFileSync('vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/WorkflowSurvivorInventory.java','utf8');
 // processes() reads each identity through the absence proof; a vanished process no longer refuses the stop.
 assert.match(pinned,/Identity identity=observePresent\(pid,\(\)->processIdentity\(pid,deadline,observation\)\);if\(identity==null\)continue;/);
 assert.doesNotMatch(pinned,/result\.put\(pid,processIdentity\(pid,deadline\)\)/);
 // An exiting process's empty argv is validated inside the same proof instead of refusing the stop.
 assert.match(pinned,/cmdline may be readable but empty while a process exits/);
 assert.deepEqual(applyUpstreamRepair('other.java','x'),{value:'x',repair:null});
});
