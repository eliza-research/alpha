import { NoticeOwnerCoordinator } from '../apps/app/src/runtime/notice-owner-coordinator.ts';
import { revalidateApprovalNotice } from '../apps/app/src/runtime/workflow-notice-return.ts';
// Loads the real authoring module into the same explicit boundary fixture as the
// legacy workflow tests. No native plugin or production account is contacted.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { normalizePhoneSpec, assertPhoneCapabilities } from '../apps/app/src/runtime/phone-workflow-authoring.ts';
import { workflowSha, workflowBytes } from '../apps/app/src/runtime/workflow-device-contract.ts';
import { alphaClient } from '../apps/app/src/runtime/alpha-client.ts';
const source = readFileSync(new URL('../apps/app/src/prototype/workflow-authoring.ts', import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
export function workflowRendererFixture(context) {
  // connection-ui's no-session wording (P-43) for a production build without the resident (the web
  // preview): the agent is the phone's own; there is no remote-agent copy outside test mocks.
  context={Capacitor:{isNativePlatform:()=>false,getPlatform:()=> 'android'},browserDevProfile:false,browserLocalAgentEnabled:false,testMocksEnabled:false,agentPendingText:(_snapshot,remote='Your agent runs on your phone, not here. Open Alpha on your Android phone to use it.')=>remote,agentAvailabilityNotice:(snapshot,remote='Your agent runs on your phone, not here. Open Alpha on your Android phone to use it.')=>snapshot?.kind==='starting'?'':remote,residentAlwaysPresent:false,...context};
  const scope = { NoticeOwnerCoordinator, revalidateApprovalNotice, document:{hidden:false,addEventListener(){},removeEventListener(){}}, window:{addEventListener(){},removeEventListener(){},dispatchEvent(){}}, Event, ...context, normalizePhoneSpec, assertPhoneCapabilities, workflowSha, workflowBytes, alphaClient, crypto:globalThis.crypto, TextEncoder, registerPlugin:()=>new Proxy({}, {get:()=>()=>Promise.reject(Error('Unexpected native authoring operation in existing-workflow fixture'))}) };
  vm.runInNewContext('{'+stripTypeScriptTypes(source,{mode:'strip'})+'\nglobalThis.createWorkflowAuthoring=createWorkflowAuthoring;}', scope);
  // Exercise the actual installed-slot adapter here; IndexedDB concurrency is
  // qualified by the owning browser suite, not this bounded HTTP fixture.
  const intents=readFileSync(new URL('../apps/app/src/runtime/workflow-intents.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  vm.runInNewContext('{'+stripTypeScriptTypes(intents,{mode:'strip'})+'\nglobalThis.WorkflowIntentStore=WorkflowIntentStore;globalThis.workflowIntentKey=workflowIntentKey;}',scope);
  return scope;
}
