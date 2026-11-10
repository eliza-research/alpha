import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pinned recovery and lifecycle sources match the reviewed upstream repair',()=>{
 for(const [name,expected] of [
 ['AndroidBunTarget','1ce791f9fbeeeea2a40bdf94b1b11e600df75c8fbee8649a5f47b3d919d7f675'],
 // elizaOS/eliza#38281 moves the strict credential stop into the shared CredentialShutdownLease: its
 // ACK proves absence but keeps starts fenced until the writer releases its exact request (commit) or
 // abandons it (no write), and a superseded credential stop intent is ignored. #38291 adds an owner
 // request epoch (read only by upstream's ElizaResidentCredentials, which Alpha does not compile) retired
 // on every stop, start and restart and reopened only when startAgentProcess reports a resident. IPC
 // AlphaLocalAgentPlugin releases its request after a
 // completed commit and abandons it when nothing was written (a shutdown Retry abandons at dispatch);
 // an uncertain commit keeps starts fenced until a later credential change or app restart.
 // android/consumer-host.json compiles the lease helper.
 // elizaOS/eliza#38821 adds only ELIZA_ANDROID_VOICE_BUNDLE_DIR to the agent's environment, from the
 // VoiceBundleAssets.bundleRoot the service already calls, which reads the manifest and writes nothing.
 // elizaOS/eliza#39007 also checks the durable update pause before resident start and recovery restart.
 // The reviewed86ab source also retains terminal failure notices, validates detached health,
 // and preserves the previous tree when replacement staging fails. The host descriptor keeps Stop.
 ['ElizaAgentService','b1f31509579329b3eaa09b89330873cb207bf19d2de116708276a18bd274c942'],
 // The reviewed source retains directory/inode checks and now rotates oldest well-formed IPC
 // evidence into a bounded reviewed archive after process classification. Malformed/changing
 // records and interrupted explicit archive still refuse admission.
 ['IpcStartupRecovery','c5eefbeea7be4b048227350e0cfd2fa82ececa0b8282fd6849a28d3fcf53e8b8'],
 ['WorkflowSurvivorInventory','3270bebe7e125705eda25e91ba9996f99cb80fbcb7e534c0d1ea47672a0fc42b'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
 const service=fs.readFileSync('vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAgentService.java','utf8');
 assert.match(service,/RuntimeUpdatePause\.beforeStart\(\); credentialShutdown\.beforeStart\(\)/);
 assert.match(service,/NOTIFICATION_PRIMARY_ACTION = "stop"/);
 const ipc=fs.readFileSync('vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/IpcStartupRecovery.java','utf8');
 assert.match(ipc,/interrupted evidence archive requires review/);
 const rotation=ipc.indexOf('for(;quarantines>=RETAINED_LIMIT;quarantines--)rotateOldestRetained()');
 const classification=ipc.lastIndexOf('WorkflowSurvivorInventory.requireClassified',rotation);
 assert.ok(classification>=0&&rotation>classification);
 assert.match(ipc,/if\(!observed\.get\(entry\.getName\(\)\)\.equals\(stat\.st_dev\+":"\+stat\.st_ino\)\)throw refused\("IPC entry replaced"\)/);
 assert.match(ipc,/RETAINED_LIMIT = 8, REVIEWED_LIMIT = 16/);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
