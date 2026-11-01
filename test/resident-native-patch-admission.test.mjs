import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['ElizaAgentService','f2377edd144e45365479783ad61acf47077519c6604ad0bf0c11862ad2a988a4'],
 ['IpcStartupRecovery','d77ea0883554991622a5a0b044a7cf373686eec15c5a705abbd69aaf5b94e80f'],
 ['WorkflowSurvivorInventory','72568e8f859c0453606100d0f94d26c4cec4c3b7811ad62b0eaea8ea76a66820'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
test('the resident stop-race repair reproduces its reviewed upstream file and refuses drift',async()=>{
 const {UPSTREAM_REPAIRS,applyUpstreamRepair}=await import('../scripts/upstream-native-repairs.mjs');
 const [repair]=UPSTREAM_REPAIRS;
 const pinned=fs.readFileSync(`vendor/eliza/${repair.path}`,'utf8');
 const {value,repair:recorded}=applyUpstreamRepair(repair.path,pinned);
 assert.equal(sha(value),repair.repairedSha256);
 assert.equal(recorded.commit,repair.commit);
 // processes() reads each identity through the absence proof; a vanished process no longer refuses the stop.
 assert.match(value,/Identity identity=observePresent\(pid,\(\)->processIdentity\(pid,deadline\)\);if\(identity==null\)continue;/);
 assert.doesNotMatch(value,/result\.put\(pid,processIdentity\(pid,deadline\)\)/);
 // An exited, unreaped process's empty argv goes through the same proof instead of refusing the stop.
 assert.match(value,/observePresent\(pid,\(\)->presentArguments\(bounded\(new File\(entry,"cmdline"\),65536\)\)\)/);
 assert.throws(()=>applyUpstreamRepair(repair.path,pinned+' '),/no longer matches/);
 assert.deepEqual(applyUpstreamRepair('other.java','x'),{value:'x',repair:null});
});
