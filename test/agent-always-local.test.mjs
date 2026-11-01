// Decision P-43 (owner, 2026-10-13): "there should NEVER be no agent connected since the agent
// should ALWAYS run locally on device, no exceptions." Eliza Cloud sign-in and plan state decide only
// whether Cloud inference is bound into the running agent. Structural source contracts for the
// renderer and the native start path. Evidence class: source/test only; not an APK, emulator, image
// or device run. The browser specs in test/browser/native-cloud-subscription.spec.ts exercise the
// composed flow with synthetic ports.
import test from 'node:test';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DENYLIST, RETIRED_NO_AGENT_TEXT, RETIRED_REMOTE_AGENT_TEXT} from '../scripts/audit-production-bundle.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const ui = read('apps/app/src/runtime/connection-ui.tsx');
const plugin = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java');
const store = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCredentialStore.java');
const between = (text, start, end) => { const from = text.indexOf(start), to = text.indexOf(end, from + start.length); assert.ok(from >= 0 && to > from, `${start} … ${end} located`); return text.slice(from, to); };

test('production bundles forbid the retired no-agent copy', () => {
  for (const text of ['without AI', 'Continue offline', 'Connect an agent']) {
    assert.ok(RETIRED_NO_AGENT_TEXT.includes(text), text);
    assert.ok(DENYLIST.includes(text), text);
  }
});

test('production bundles forbid remote-agent fallback copy, which stays test-mocks only (#381)', () => {
  for (const text of ['Connect your remote agent', 'No remote agent connected', 'Connect a remote agent']) {
    assert.ok(RETIRED_REMOTE_AGENT_TEXT.includes(text), text);
    assert.ok(DENYLIST.includes(text), text);
  }
  // Every remote-agent sentence in renderer source sits behind a constant-folded testMocksEnabled
  // branch; production wording names the on-phone agent instead.
  const sources = ['apps/app/src/runtime/connection-ui.tsx', 'apps/app/src/prototype/native-adapter.ts', 'apps/app/src/prototype/workflow-adapter.ts'];
  for (const file of sources) {
    const lines = read(file).split('\n');
    for (const [index, line] of lines.entries()) {
      if (!RETIRED_REMOTE_AGENT_TEXT.some(text => line.includes(text)) || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      assert.match(line, /testMocksEnabled ?\?|!testMocksEnabled ?\?/, `${file}:${index + 1} gates remote-agent copy on testMocksEnabled`);
    }
  }
  assert.match(ui, /const PENDING_FALLBACK = testMocksEnabled \? 'Connect your remote agent in Settings\.' : LOCAL_AGENT_ELSEWHERE;/);
  assert.match(ui, /export const LOCAL_AGENT_ELSEWHERE = 'Your agent runs on your phone, not here\. Open Alpha on your Android phone to use it\.';/);
  assert.doesNotMatch(ui, /NO_REMOTE_(SEND|VOICE)/);
});

test('plan state never stops or withholds the on-device agent', () => {
  const admission = between(ui, 'async function admitCloudResident(', 'async function connectResident(');
  // Admission decides only the inference binding; nothing in it (or the refresh handlers) stops,
  // retires or skips the agent.
  for (const forbidden of ['stopLocalAgent(', "retire('Plan required')", "retire('Sign-in required')", 'return false', 'Promise<boolean>'])
    assert.ok(!admission.includes(forbidden), `admission/refresh must not ${forbidden}`);
  assert.match(admission, /Promise<ResidentAdmission>/);
  // The binding rules (account fences, the 7-day offline rule) are the shared controller's
  // (@elizaos/auth/auth/cloud-resident-binding, covered by its own tests); this file maps outcomes.
  assert.match(admission, /const admission=await binding\.admit\(signal\);/);
  for (const binding of ["return {binding:'unbound',notice:{open:true}};", "return {binding:admission.binding,notice:{message:OFFLINE_NOTICE}};", "return {binding:'unbound',account:admitted};", "return {binding:'cloud',credentialId:identity.credentialId,account:admitted};"])
    assert.ok(admission.includes(binding), `admission returns ${binding}`);
  // A plan that ends, or a rejected refresh, rebinds the running agent; it is never stopped.
  assert.match(between(ui, 'function residentPlanEnded(', 'function residentRefreshRefused('), /queueResidentRebind\(\);/);
  assert.match(between(ui, 'function residentRefreshRefused(', 'async function applyResidentBinding('), /queueResidentRebind\(\);/);
  // connectResident always reaches the start; only the test-mocks staging QA lane stops at admission.
  const connect = between(ui, 'async function connectResident(', 'async function connectCloud(');
  const start = connect.indexOf('await client.connect(signal)');
  assert.ok(start > 0);
  const beforeStart = connect.slice(0, start);
  assert.equal((beforeStart.match(/return;/g) || []).length, 1, 'only the QA lane returns before the start');
  assert.match(beforeStart, /if\(testMocksEnabled&&!residentBindable\(\)\)\{[^\n]*return;\}/);
  // Startup always starts the agent, signed in or not, and stores no local-only choice.
  assert.match(between(ui, 'async function startResidentGate(', 'function conversationKey('), /try\{save\(\{kind:'resident'\}\);\}catch\{[^}]*\}\n\s+await startResident\(\);/);
  assert.match(ui, /if \(residentCloudFlow\(\)\) \{ await startResidentGate\(\); return; \}/);
  // Product phones refuse disconnecting the resident or removing its provider; there is no Stop, only Restart.
  for (const method of ['async removeProvider()', 'async disconnect()'])
    assert.match(between(ui, method, '\n  },'), /if\(residentCloudFlow\(\)\)\{update\(\{error:ALWAYS_LOCAL,message:''\}\);return;\}/, method);
  assert.doesNotMatch(ui, /async stopLocal\(\)/);
  assert.match(ui, /async restartLocal\(\)/);
  // Sign-in and sign-out keep the agent running and reconnect it afterwards (native attaches when
  // the process already matches the binding, otherwise it restarts once).
  const login = between(ui, 'async residentCloudLogin()', 'async residentManagePlan()');
  assert.ok(!login.includes('stopLocalAgent('));
  // In-app sign-in (owner directive 2026-10-14) once Cloud is ready; the browser hand-off until then.
  assert.ok(login.includes('async residentCloudLogin() { await connectionController.beginSignIn(residentEnvironment()); }'));
  const browser = between(ui, 'async function residentBrowserLoginAction(', 'async function browserCloudLoginAction(');
  assert.ok(browser.indexOf('cloud.login(') >= 0 && browser.indexOf('await residentSignedIn(signal,') > browser.indexOf('cloud.login('), 'reconnect only after the browser sign-in returned');
  assert.match(browser, /catch\(error\)\{if\(kept\)residentRebinds\(\)\.queue\(\);throw error;\}/, 'a cancelled sign-in re-admits a kept sign-in');
  const signedIn = between(ui, 'async function signedIn(', '/** The development hosted-agent client.');
  assert.ok(signedIn.includes('if (residentCloudFlow()) { update({ accountCreated: created }); await residentSignedIn(signal, unconfirmed); return; }'), 'the in-app sign-in finishes through the shared resident step');
  // Both sign-ins reconnect once the key is stored, with the admission they made: access setup opens
  // as soon as the account is admitted and the agent restarts behind it, shown as starting (owner
  // report 2026-10-30); setup never waits for the agent's first boot.
  const resident = between(ui, 'async function residentSignedIn(', '/** The key is stored;');
  const at = (text) => { const index = resident.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(!resident.includes('stopLocalAgent('));
  assert.ok(at('retire();') < at("update({ residentInference: null, message: 'Signing in…' });"));
  assert.ok(at("update({ residentInference: null, message: 'Signing in…' });") < at('const admission = await admitCloudResident(signal);'));
  assert.ok(at('const admission = await admitCloudResident(signal);') < at("update({ signIn: null, message: '', ...(refused ? {} : { residentStarting: true }) });"));
  assert.ok(at("update({ signIn: null, message: '', ...(refused ? {} : { residentStarting: true }) });") < at('showPostSignInSetup(); setup = true;'));
  assert.ok(at('showPostSignInSetup(); setup = true;') < at('await connectResident(signal, admission);'));
  // A refused key is removed after the agent restarted without it, and never opens setup.
  assert.ok(at('if (!refused) { showPostSignInSetup(); setup = true; }') < at('await cloudCredentialStore.clear(residentEnvironment());'));
  assert.match(between(ui, 'async function connectResident(', 'async function connectCloud('), /admission=admitted\?\?await admitCloudResident\(signal\);/);
  const signOut = between(ui, 'async cloudSignOut()', 'async mock()');
  assert.ok(!signOut.includes('stopLocalAgent(') && signOut.includes('else{retire();try{await connectResident(signal);}'));
  // Cloud inference is unbound (native stops a process holding the key) before the key is revoked.
  assert.ok(signOut.indexOf('await clearLocalProvider()') > 0 && signOut.indexOf('await clearLocalProvider()') < signOut.indexOf('client.revokeSession(signal, expected)'));
});

test('the connection controller has no local-apps-only mode and migrates old selections to the resident', () => {
  assert.doesNotMatch(ui, /localAppsSelected|localApps\?: ?true|Use local apps without AI/);
  // A stored offline, local-apps or none selection reads as the resident where it is always present.
  assert.match(ui, /value\?\.kind === 'offline' \|\| value\?\.kind === 'none'\) return residentAlwaysPresent \? \{ kind: 'resident' \}/);
  // Saving a no-agent choice there stores the resident instead.
  assert.match(ui, /residentAlwaysPresent && \(selection\.kind === 'none' \|\| selection\.kind === 'offline'\) \? \{ kind: 'resident' \}/);
  assert.match(ui, /function residentCloudFlow\(\): boolean \{ return browserCloudResidentEnabled \|\| \(isAndroid && !testMocksEnabled\) \|\| residentQa\(\) !== null; \}/);
  assert.doesNotMatch(ui, /if\(!await admitCloudResident\(signal\)\)return;/);
});

test('no startup path ends claiming "starting" with nothing starting', () => {
  // Every startup outcome is settled: the resident starts, or the state is `recovering` with Retry.
  assert.match(ui, /\}\)\(\)\.then\(settleResidentAfterStartup\)(\.finally\(\(\)=>update\(\{startupResolved:true(?:,automaticRestore:false)?\}\)\))?;/);
  assert.match(ui, /async function settleResidentAfterStartup\(\) \{[\s\S]{0,600}await ensureResident\(\);[\s\S]{0,80}update\(\{ kind: 'recovering' \}\);/);
  // A rebind that fails to reconnect leaves the agent recovering (Retry), never "no agent".
  assert.match(between(ui, 'function queueResidentRebind(', 'function runQueuedResidentRebind('), /catch \(error\) \{ if \(residentAlwaysPresent && !active\) update\(\{ kind: 'recovering' \}\); throw error; \}/);
});

test('Cloud inference is bound only for an admitted plan and unbound otherwise', () => {
  const bind = between(ui, 'async function applyResidentBinding(', 'function residentBindingController(');
  // The shared controller binds only an admitted identity; this file passes one only for an
  // admitted Cloud binding of this account.
  assert.ok(bind.includes("admission.binding==='cloud'&&admission.credentialId&&admission.account?{identity:{credentialId:admission.credentialId,"), 'an identity is passed only in the admitted branch');
  assert.ok(!bind.includes('bindResidentCloudProvider('), 'applyResidentBinding never binds directly');
  const ports = between(ui, 'function residentBindingController(', 'async function connectResident(');
  assert.equal(ports.split('bindResidentCloudProvider(').length, 2, 'one bind port');
  assert.equal(ui.split('bindResidentCloudProvider(').length, 2, 'the bind port is the only bind call');
  // Failed admitted binding explicitly clears (tombstone). Ordinary unbound startup only removes a
  // genuinely present provider, preserving legacy recovery when native observes absence.
  assert.match(ports, /clearProvider:async\(_signal,reason\)=>\{await clearLocalProvider\(reason==='unbound'\);\}/);
  // The running state the UI and tests read is derived from the binding actually applied.
  assert.match(between(ui, 'async function connectResident(', 'async function connectCloud('), /residentBinding=bound\.binding;\n\s+update\(\{residentInference:bound\.binding==='cloud'\?'cloud':bound\.binding==='unbound'\?'unavailable':'unknown'\}\);/);
});

test('a chat turn without Cloud inference gets an honest answer with the plan actions', () => {
  const send = between(ui, '  async send(', 'export function ConnectionChooser');
  const honest = send.indexOf('inferenceUnavailableReply(notice, signedIn)');
  assert.ok(honest > 0 && honest < send.indexOf('responseFailure = replyFailure('), 'the plan answer precedes the generic failure');
  assert.match(send, /state\.residentInference === 'unavailable' \|\| \('failureKind' in reply && reply\.failureKind === 'no_provider' && state\.residentInference !== 'cloud'\)/);
  // A provider-less turn that ends as a stream failure frame gets the same answer, never "Set up AI".
  const failure = between(ui, 'function replyFailure(', '\n}\n');
  assert.match(failure, /if\(kind==='no_provider'&&selected\.kind==='resident'&&residentCloudFlow\(\)\)\{[\s\S]*inferenceUnavailableReply\(notice,signedIn\)[\s\S]*planAction:/);
  const reply = between(ui, 'export function inferenceUnavailableReply(', '\n}\n');
  const renderReply = new Function('cloudServiceName', 'cloud',
    reply.replace(/^export /, '').replace(/notice: ConnectionSnapshot\['residentPlanNotice'\], signedIn: boolean\): string/, 'notice, signedIn)')
      + '\n}; return inferenceUnavailableReply;')(() => 'Nebula', {environment:'production'});
  const replies = [renderReply('offline', true), renderReply(null, false), renderReply(null, true)].join('\n');
  for (const text of ['Check your Nebula account in Settings', "can't reach Nebula", 'Sign in with Nebula', 'Local apps keep working'])
    assert.ok(replies.includes(text), text);
  assert.doesNotMatch(reply, /no agent|without AI|credit|top.?up|upgrade|needs? (?:an? )?Eliza Cloud (?:account with a )?plan|on-device speech|Nothing was sent to Cloud/i);
  // Workflow text generation fails honestly instead of using the plan answer as generated text.
  const client = read('apps/app/src/runtime/alpha-client.ts');
  assert.match(between(client, 'async generateWorkflowText(', 'async send('), /if\(reply&&\(reply as AgentReply\)\.planAction\)throw new AlphaClientError\('unconfigured'/);
  const adapter = read('apps/app/src/prototype/agent-adapter.ts');
  assert.match(adapter, /if\(card\.planAction\)\{\n\s+if\(card\.planAction==='plan'\)connectionController\.openPlan\(\);\n\s+else if\(card\.planAction==='funding'\)connectionController\.openFunding\(\);/);
  assert.doesNotMatch(adapter, /title:'Set up AI'|connectionSetup/);
  const cards=adapter.slice(adapter.indexOf('function selectedCloudName('),adapter.indexOf('/** Context notices for proposals'));
  const renderCard=new Function('cloudServiceName','connectionController',stripTypeScriptTypes(cards,{mode:'transform'})+';return planActionCard;')(
    environment=>environment==='staging'?'Nebula':'Other service',
    {getCloudEnvironment:()=>null,getSnapshot:()=>({signIn:{environment:'staging'}})});
  assert.equal(renderCard('sign-in').title,'Sign in with Nebula');
  assert.equal(renderCard('retry').title,'Check Nebula again');
  assert.equal(renderCard('plan').planAction,'plan');
  assert.ok(renderCard('plan').sub.includes('Nebula account & plan'));
  // A Cloud billing refusal offers the one sheet with credits and the membership code.
  assert.equal(renderCard('funding').planAction,'funding');
  assert.equal(renderCard('funding').title,'Add credits or enter a membership code');
  assert.ok(renderCard('funding').sub.includes('Nebula membership and credits'));
  assert.equal(renderCard('unknown'),undefined);

  assert.match(adapter, /const planCard=planActionCard\(\(e as \{planAction\?:unknown\}\)\.planAction\);/);
});

test('the plan surface is a notice beside the running agent, not a gate', () => {
  const chooser = ui.slice(ui.indexOf('export function ConnectionChooser'));
  assert.match(chooser, /if \(!visible\) \{\n\s+\/\/ Never a gate: the agent is running\./);
  assert.ok(chooser.includes('<aside className="alpha-plan-notice" role="region" aria-label={`${serviceName} plan notice`}>'));
  // Admission without a plan opens nothing; only a required sign-in opens (and locks) the dialog.
  assert.ok(between(ui, 'async function admitCloudResident(', 'function residentPlanEnded(').includes("update({residentSubscription:plan.view,residentPlanNotice:'needs-plan',planEndsAt:null});\n    return {binding:'unbound',account:admitted};"));
  assert.ok(chooser.includes("const residentMustSignIn=residentCloudFlow()&&!snapshot.cloudAccount&&snapshot.residentPlanNotice!=='offline'&&!snapshot.residentStarting;"));
  assert.ok(chooser.includes('{!residentMustSignIn&&<button aria-label="Close connection settings"'));
  // Auth owns Back even while busy; the required top-level chooser remains protected.
  const close = between(ui, '  close() {', '  cancel() {');
  const cancelSignIn = close.indexOf('if(state.signIn){connectionController.cancelSignIn();return;}');
  const requiredSignIn = close.indexOf('if(residentSignInRequired()){');
  assert.ok(cancelSignIn >= 0 && requiredSignIn > cancelSignIn, 'Sign-in cancellation precedes the required-sign-in gate, after independent billing notices.');
  // No agent-less product choice remains in the phone's flow.
  const resident = between(chooser, 'if(residentCloudFlow())return', 'if(browserOnly)return');
  assert.doesNotMatch(resident, /Use local apps without AI|without AI|No agent connected/);  // The Membership & credits sheet replaces the plan dialog only off the phone's own agent: Settings ›
  // Plan and the post-redemption screen keep the resident plan headline, needs-plan notice, Check plan
  // again and Approve this phone again (the panel carries the sheet's controls itself).
  assert.ok(chooser.includes("if((fundingRequired||snapshot.purpose==='plan'&&!residentCloudFlow())&&snapshot.cloudAccount)return <div className=\"alpha-connection-scrim\" data-alpha-billing-overlay=\"true\" data-alpha-membership-sheet=\"true\">"), 'the resident plan panel stays reachable');
  for (const control of ['>Approve this phone again<', '>Check plan again<', '{residentPlan.headline}', '{NEEDS_PLAN_NOTICE}', '{residentMembershipVisible&&membershipControls&&cloneElement(membershipControls,{planShownByHost:true})}']) assert.ok(resident.includes(control), control);
});

test('native starts the agent without a provider and never offers it a Cloud key without an admitted plan', () => {
  const start = between(plugin, '@PluginMethod public void start(', '@PluginMethod public void cancelStart(');
  assert.doesNotMatch(start, /Configure your model provider/);
  assert.doesNotMatch(plugin, /Configure your model provider before starting the local agent|Configure a model provider before starting/);
  const configure = between(plugin, 'static void configureEnvironment(', '@PluginMethod public void start(');
  // The shared launch order applies the provider or, when none is usable, the unbound environment.
  assert.match(configure, /if\(!NativeProviderSlot\.applyLaunchEnvironment\(BuildConfig\.ELIZA_RUNTIME_PROFILE,provider,cloudSaved,[^\n]*\)\)\{provider=null;saved=null;cloudSaved=null;\}/);
  assert.match(configure, /launchedGeneration=LocalAgentProviderAdmission\.launchGeneration\(saved,cloudSaved\);/);
  const sharedSlot = read('vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderSlot.java');
  assert.match(between(sharedSlot, 'public static boolean applyLaunchEnvironment(', '\n  }\n'), /if \(!bound\) applyUnboundEnvironment\(env\);/);
  const unbound = between(sharedSlot, 'public static final String[] PROVIDER_ENVIRONMENT', '\n  }\n\n');
  for (const key of ['ELIZAOS_CLOUD_API_KEY', 'CEREBRAS_API_KEY', 'OPENAI_API_KEY', 'ELIZA_PROVIDER', 'ELIZAOS_CLOUD_BASE_URL'])
    assert.ok(unbound.includes(`"${key}"`), `unbound launch removes ${key}`);
  assert.match(unbound, /env\.put\("ELIZAOS_CLOUD_USE_INFERENCE", "false"\);/);
  assert.ok(!unbound.includes('readCredentialSlot'), 'the unbound launch reads no credential');
  // An empty provider slot is its own attachable generation (host-JVM tested in LocalAgentProviderAdmission).
  assert.match(between(plugin, 'private static InvocationOwnerCache.Owner readProviderOwner(', 'private void rejectPending('), /if\(saved==null\)return new InvocationOwnerCache\.Owner\(LocalAgentProviderAdmission\.NO_PROVIDER_GENERATION,Long\.MAX_VALUE\);/);
  assert.match(read('vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java'), /NO_PROVIDER_GENERATION="no-provider"/);
  // With no stored provider, no process holds a Cloud key: a sign-in change does not stop the agent.
  assert.match(store, /if\(java\.util\.Objects\.equals\(before,value\)\)return false;\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if\(provider==null\)return false;/);
});

test('browser speech has no Web Speech fallback', () => {
  for (const file of ['apps/app/src/browser/voice.ts', 'apps/app/src/browser/browser-surface.ts'])
    assert.doesNotMatch(read(file), /speechSynthesis|SpeechSynthesisUtterance/, file);
});

test('the on-device agent runs in the phone time zone', () => {
  const configure = between(plugin, 'static void configureEnvironment(', '@PluginMethod public void start(');
  assert.match(configure, /env\.put\("TZ",java\.util\.TimeZone\.getDefault\(\)\.getID\(\)\);/);
});
