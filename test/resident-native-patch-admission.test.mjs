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
 // recovery, adoption and teardown are unchanged. AlphaLocalAgentPlugin releases its request after a
 // completed commit and abandons it when nothing was written (a shutdown Retry abandons at dispatch);
 // an uncertain commit keeps starts fenced until a later credential change or app restart.
 // android/consumer-host.json compiles the lease helper.
 ['ElizaAgentService','f8b1d2a3f6ee898e9afbb51584d7fd42d961d67fe0d49769c56ecf35c648afe1'],
 // PR37979/37981: verify directory timestamps after recovery publication.
 ['IpcStartupRecovery','c51152d8b6403622171e4baed30f55cb540cad2c3fd49a8be1171a4b2c015c27'],
 ['WorkflowSurvivorInventory','3270bebe7e125705eda25e91ba9996f99cb80fbcb7e534c0d1ea47672a0fc42b'],
 ])assert.equal(sha(fs.readFileSync(`vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/${name}.java`)),expected);
});
test('obsolete resident patch slot is refused rather than reapplied',()=>{
 assert.throws(()=>preparePatchedNative({manifestFile:'resident-native-manifest.json'}),/Unknown native patch slot/);
 assert.equal(fs.existsSync('patches/eliza/resident-ipc-recovery.patch'),false);
});
