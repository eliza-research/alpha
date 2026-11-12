import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {residentSources} from '../specs/quint/refinement/native/resident-coordinator.mjs';
import {residentPlatform} from '../specs/quint/refinement/native/resident-platform.mjs';
import {app, directory, root, voice, javaTraceCampaign} from '../specs/quint/refinement/native/java.mjs';
import {jsonJar} from './fixtures/jvm-tools.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'ResidentSchedulingServiceAdmission';
const harness = join(directory, 'ResidentScheduleAdmissionTraces.java');

async function withResidentSchedulingAdmission(run, extraSources = [], mutation) {
  const platform = residentPlatform();
  const generated = [...platform.paths];
  const replace = (path, from, to) => {
    const text = readFileSync(path, 'utf8');
    assert.equal(text.split(from).length, 2, 'one exact external-port seam: ' + from);
    writeFileSync(path, text.replace(from, to));
  };
  const add = (name, text) => {
    const path = join(platform.directory, name); mkdirSync(dirname(path), {recursive:true});
    writeFileSync(path, text);generated.push(path);return path;
  };
  try {
    const port = 'ai.alphacompute.alphaphone.ResidentScheduleAdmissionTraces.Ports';
    replace(join(platform.directory, 'android/content/Context.java'), '    return null;\n  }',
      '    if(type==android.os.UserManager.class)return type.cast(new android.os.UserManager());\n    return null;\n  }');
    replace(join(platform.directory, 'android/os/UserManager.java'), 'return true;', `return ${port}.unlocked;`);
    replace(join(platform.directory, 'android/content/Intent.java'), 'public class Intent {',
      'public class Intent { private String action; public Intent(){} public Intent(String action){this.action=action;} public String getAction(){return action;}');
    replace(join(platform.directory, 'android/util/Log.java'), '  public static int w(String tag, String value) {\n    return 0;',
      `  public static int w(String tag, String value) {\n    ${port}.warning(tag,value); return 0;`);
    replace(join(platform.directory, 'ai/alphacompute/alphaphone/ElizaAgentService.java'),
      '    ResidentTestPorts.start();', `    ${port}.start();`);
    replace(join(platform.directory, 'ai/alphacompute/alphaphone/ElizaAgentService.java'),
      '  public static void start(Context context) {', `  public static boolean shouldAutoStart(Context context){return ${port}.enabled;}\n  public static void start(Context context) {`);
    add('android/content/BroadcastReceiver.java', 'package android.content; public abstract class BroadcastReceiver {public abstract void onReceive(Context context,Intent intent);}\n');
    const original = readFileSync(join(root, app, 'ResidentScheduleRearm.java'), 'utf8');
    const seam = 'Decision decision=decide(action,userUnlocked,runtimePackaged,ownerEnabled,lifecycleIdle.getAsBoolean());';
    assert.equal(original.split(seam).length, 2);
    let observed = original.replace(seam, seam + '\n   ResidentScheduleAdmissionTraces.Ports.decision=decision.name();');
    if (mutation === 'ignore-lifecycle') observed = observed.replace('ownerEnabled,lifecycleIdle.getAsBoolean());','ownerEnabled,true);');
    const rearm = add('ai/alphacompute/alphaphone/ResidentScheduleRearm.java', observed);
    let receiver = readFileSync(join(root, app, 'ResidentScheduleReceiver.java'), 'utf8');
    if (mutation === 'lose-refusal') receiver = receiver.replace('catch(RuntimeException deferred)', 'catch(IllegalArgumentException deferred)');
    const receiverCopy = add('ai/alphacompute/alphaphone/ResidentScheduleReceiver.java', receiver);
    const compile = [...residentSources.filter(path => path !== app + 'ResidentScheduleRearm.java'), ...generated,
      join(directory,'ResidentTestPorts.java'),join(directory,'FinitePolicyTraces.java'),voice+'LiveVadGate.java',app+'RendererRecoveryBudget.java'];
    const sources = [...residentSources,app+'ResidentScheduleReceiver.java',harness,join(directory,'ResidentTestPorts.java'),
      join(directory,'FinitePolicyTraces.java'),voice+'LiveVadGate.java',app+'RendererRecoveryBudget.java',
      driver,join(directory,'resident-coordinator.mjs'),join(directory,'resident-platform.mjs'),join(directory,'java.mjs'),
      join(directory,'Trace.java'),'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...generated,...extraSources];
    assert.ok(compile.includes(rearm)&&compile.includes(receiverCopy));
    const hashes = captureInputs(sources);
    const traces = javaTraceCampaign('ResidentScheduleAdmissionTraces.java', compile,
      ['table','deferred','foreground','stop'].map(scenario=>[scenario,platform.directory])).flat();
    return await run({traces,sources,driverHashes:hashes,generatedSources:generated});
  } finally {platform.close();}
}

async function checkResidentSchedulingServiceAdmission(extraSources = []) {
  return withResidentSchedulingAdmission(async inputs => ({
    receipt: await checkTraces({model,id:model+'-source',scope:'bounded-orchestration',...inputs,
      assumptions:[
        'The 120-case ordered admission table executes actual ResidentScheduleRearm methods under the same lock. Boolean fact setup is controlled environment input.',
        'The complete unmodified receiver and AlphaLocalAgentPlugin execute service refusal, later broadcast/foreground success, stop ACK, refused rearm after ACK and explicit restart. The helper has one read-only decision observation; all generated source and ports are hashed.',
        'Service allocation/idempotency, first-unlock/owner facts, runtime payload presence, status ACK and HTTP pairing responses are controlled Android/service ports. Physical runtime execution and native process durability are not established.',
        'Raw physical service state, source epoch, callback attempts and acknowledgements are retained. The abstract epoch and instantaneous physical stop are not asserted by this projection.',
      ]}),
    obligations:[
      {model,obligation:'Provider mutation and process-death integration',reason:'This projection executes ordinary stop/status/restart. Credential mutation is exercised by NativeCredentialMutation; process death, OS broadcasts and real foreground-service acceptance require installed evidence.'},
      {model,obligation:'Abstract epoch and physical stop latency',reason:'The native lifecycle epoch also advances on start. It is retained as raw source data, not equated with the model retirement counter. Physical service shutdown may remain pending until its ACK.'},
    ],
  }),extraSources);
}

test('resident admission executes real receiver refusals and closed lifecycle after stop acknowledgement',{timeout:120_000},async()=>{
  const {receipt}=await checkResidentSchedulingServiceAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.traces,123);assert.ok(receipt.checkpoints>500);
  assert.equal(verifyRefinementReceiptInputs(receipt),true,'generated Java ports remain verifiable after fixture cleanup');
});
for(const mutation of ['ignore-lifecycle','lose-refusal'])test(`resident admission refuses the ${mutation} source canary`,{timeout:120_000},async()=>{
  await assert.rejects(withResidentSchedulingAdmission(()=>assert.fail('mutant source reached receipt generation'),[],mutation),
    error=>{
      assert.match(error.message,/^(?:[^\n]*\/)?java failed \(status 1\)/,'the mutant must compile and fail during source execution');
      assert.match(error.message,mutation==='ignore-lifecycle'
        ? /admit\/decide disagreement|Start admitted while lifecycle closed/
        : /Controlled service refusal/);
      return true;
    });
});
