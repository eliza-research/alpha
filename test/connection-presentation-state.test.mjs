/** Actual connection state/ownership functions; no renderer, network, credential or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=await readFile(process.env.ALPHA_PRESENTATION_SOURCE||new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b).replace(/^export /gm,'');}
const functions=[
 section('function ownProviderSelected(', '\n'),
 section('function update(', '// P-43: where'),
 section('export function productionCloudSignInRequired(', 'export function ConnectionChooser('),
 section('async function refreshActionReview(', 'function boundNavigation('),
 section('function boundNavigation(', '/*\n * DEVELOPMENT INFRASTRUCTURE'),
].join('\n');
const code=stripTypeScriptTypes(functions,{mode:'transform'});
function fixture({android=true,dev=false,browserResident=false,account={expiresAt:Date.now()+60000},purpose='agent',open=false}={}){
 const entries=[{id:'review-1',state:'reconciliation_required'}];let release;
 const selected={request(){},actions:{}};
 const context=vm.createContext({isAndroid:android,testMocksEnabled:dev,browserCloudResidentEnabled:browserResident,developmentPageSuspended:false,sending:null,flushConversationEvents:()=>{},listeners:new Set(),state:{open,automaticRestore:false,busy:false,error:'',cloudAccount:account,purpose,signIn:null,message:'Finish signing in in your browser.',session:{}},active:selected,epoch:1,networkLostUnder:null,navigationContext:()=>({view:'home'}),errorMessage:()=> 'Sign-in expired',readActionHistory:async()=>entries,Date,
  ViewNavigationClient:class {constructor(request,current,context){this.current=current;this.context=context;}connectRenderer(){return()=>{};}}});
 vm.runInContext(code,context);
 return {context,entries,update:patch=>context.update(patch),snapshot:()=>context.state,review:()=>context.refreshActionReview(new AbortController().signal),navigation:()=>context.boundNavigation()};
}
test('hidden production agent state cannot block navigation; owner/session/epoch guards remain',()=>{
 const f=fixture();f.update({open:true});assert.equal(f.snapshot().open,false);
 const nav=f.navigation();assert.equal(nav.current(),true);
 f.context.epoch++;assert.equal(nav.current(),false);f.context.epoch--;
 f.context.state={...f.snapshot(),session:{}};assert.equal(nav.current(),false);
});
test('signed-out and expired production accounts remain modal even after close',()=>{
 for(const account of [null,{expiresAt:Date.now()-1000}]){const f=fixture({account});f.update({open:false});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);}
});
test('explicit account, plan and sign-in panels still block navigation',()=>{
 for(const purpose of ['cloud-account','plan']){const f=fixture({purpose});f.update({open:true});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);f.update({open:false});assert.equal(f.navigation().current(),true);}
 const f=fixture();f.update({open:true,signIn:{step:'choose'}});assert.equal(f.snapshot().open,true);assert.equal(f.navigation().current(),false);
});
test('automatic restore preserves explicit panel intent while rendering is suppressed',()=>{
 const f=fixture({purpose:'cloud-account'});f.update({open:true,automaticRestore:true,busy:true});assert.equal(f.snapshot().open,true);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);f.update({busy:false});assert.equal(f.context.connectionChooserVisible(f.snapshot()),true);
});
test('production review history refresh preserves browser instructions and modal ownership',async()=>{
 for(const account of [null,{expiresAt:Date.now()+60000}]){const f=fixture({account});f.update({});const before=f.snapshot();await f.review();assert.equal(f.snapshot().actionHistory,f.entries);assert.equal(f.snapshot().message,before.message);assert.equal(f.snapshot().open,before.open);}
});
test('stale action history replies cannot mutate the current connection',async()=>{
 const f=fixture();let resolve;f.context.readActionHistory=()=>new Promise(r=>{resolve=r;});const result=f.review();f.context.epoch++;resolve(f.entries);await result;assert.equal(f.snapshot().actionHistory,undefined);assert.equal(f.snapshot().message,'Finish signing in in your browser.');
});
test('background history preserves open panels and connection messages on every platform',async()=>{
 for(const options of [{},{dev:true},{android:false}])for(const open of [false,true]){
  const f=fixture({...options,open});f.update({error:'Retained connection notice'});const before=f.snapshot();
  await f.review();assert.equal(f.snapshot().actionHistory,f.entries);assert.equal(f.snapshot().open,before.open);assert.equal(f.snapshot().message,before.message);assert.equal(f.snapshot().error,before.error);
 }
});
test('mixed historical outcomes are retained without settlement, synchronization or execution',async()=>{
 const f=fixture({android:false});
 f.entries.splice(0,f.entries.length,{id:'done',state:'done',local:{status:'succeeded'}},{id:'started',state:'executing',local:{phase:'started'}},{id:'uncertain',state:'reconciliation_required',local:{status:'failed'}});
 let mutations=0;for(const name of ['syncReceipts','reconcile','reject','approve','execute'])f.context.active.actions[name]=()=>{mutations++;throw Error('No background mutation');};
 const before=f.snapshot();await f.review();assert.equal(f.snapshot().actionHistory,f.entries);assert.equal(f.snapshot().actionHistory.length,3);assert.equal(mutations,0);assert.equal(f.snapshot().open,before.open);assert.equal(f.snapshot().message,before.message);
});
test('a replaced active owner cannot publish a delayed history reply',async()=>{
 const f=fixture({android:false});let resolve;f.context.readActionHistory=()=>new Promise(r=>{resolve=r;});const pending=f.review();f.context.active={actions:{}};resolve(f.entries);await pending;assert.equal(f.snapshot().actionHistory,undefined);assert.equal(f.snapshot().open,false);
});
test('an aborted history read leaves presentation and records untouched',async()=>{
 const f=fixture({android:false});const controller=new AbortController();const prior=[{id:'retained',state:'done'}];f.context.state={...f.snapshot(),actionHistory:prior};
 f.context.readActionHistory=(_selected,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 const before=f.snapshot();const pending=f.context.refreshActionReview(controller.signal);controller.abort();await assert.rejects(pending);assert.equal(f.snapshot(),before);assert.equal(f.snapshot().actionHistory,prior);
});

test('unresolved saved-session restore does not start the earlier automatic sign-in probe',()=>{
 const f=fixture({account:null});f.update({startupResolved:false,automaticRestore:true,busy:false});
 const gate=source.includes('const signInEntryRequired=')?'signInEntryRequired':'productionSignInRequired';const a=source.indexOf('  useEffect(() => {\n    if (!'+gate+')'),b=source.indexOf('  }, [',a);assert.ok(a>=0&&b>a);
 let probes=0,automaticSignInProbe={current:false};
 const callback=source.slice(a,b).replace('  useEffect(() => {','(()=>{')+'})';
 const evaluate=()=>{f.context.snapshot=f.snapshot();f.context.productionSignInRequired=f.context.productionCloudSignInRequired(f.snapshot());f.context.signInEntryRequired=f.context.productionSignInRequired||(typeof f.context.explicitSignedOutCloudEntry==='function'&&f.context.explicitSignedOutCloudEntry(f.snapshot()));f.context.automaticSignInProbe=automaticSignInProbe;f.context.residentEnvironment=()=> 'production';f.context.connectionController={beginSignIn:()=>{probes++;}};vm.runInContext(stripTypeScriptTypes('var runProbe='+callback+';runProbe();',{mode:'transform'}),f.context);};
 evaluate();assert.equal(probes,0,'the sign-in effect is declared first but must leave restore alone');assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
 f.update({cloudAccount:{expiresAt:Date.now()+60000},startupResolved:true,automaticRestore:false});evaluate();assert.equal(probes,0);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
});
test('resolved signed-out and sign-out transitions still request sign-in',()=>{
 const f=fixture({account:null});f.update({startupResolved:false,automaticRestore:true});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);
 f.update({startupResolved:true,automaticRestore:false});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);assert.equal(f.snapshot().open,true);
 const returning=fixture();returning.update({startupResolved:true,cloudAccount:null});assert.equal(returning.context.productionCloudSignInRequired(returning.snapshot()),true);
});
test('expired and rejected restored sessions still require authentication; valid offline account stays nonmodal',()=>{
 for(const patch of [{cloudAccount:{expiresAt:Date.now()-1000},startupResolved:true},{cloudAccount:null,startupResolved:true,error:'Sign-in expired'},{cloudAccount:null,startupResolved:false,error:'Sign-in expired'}]){const f=fixture();f.update(patch);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);}
 const f=fixture();f.update({startupResolved:true,inferenceOffline:true});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);assert.equal(f.snapshot().open,false);
});

// Execute the actual controller preflights. Stop send immediately after its
// normal conversation binding, before preferences, transport or model work.
const preflightSource = [
  section('function residentSignInRequired()', '\n'),
  section('function fundingNeeded()', '\n'),
  'const preflightController = {',
  section('  close() {', '  cancel() {'),
  section('  async prepareVoiceConversation(', '  async send('),
  section('  async send(', '      if(expectedConversationId!==undefined&&id!==expectedConversationId)'),
  '      return id;',
  '    } catch (error) {',
  section('      const refused = !!error', '      // Stop (or leaving the chat) after dispatch'),
  '      throw error;',
  '    } finally { signal.removeEventListener("abort", cancel); if (sending === controller) sending = null; }',
  '  },',
  '}; globalThis.preflightController = preflightController;',
].join('\n');
const preflightCode = stripTypeScriptTypes(preflightSource, {mode: 'transform'});
function preflightFixture(balance, options = {}) {
  const f = fixture({purpose: 'plan', ...options});
  let bindings = 0;
  Object.assign(f.context, {
    AbortController, DOMException, document: {hidden: false}, navigator: {onLine: true}, setTimeout,
    FUNDING_NEEDED: 'Choose a monthly plan or enter a membership code to ask Alpha.',
    AlphaClientError: class AlphaClientError extends Error {constructor(code, message) {super(message); this.code = code;}},
    residentCloudFlow: () => true, residentAlwaysPresent: true,
    residentStartInBackground: false, pendingBillingReview: null,
    operation: null, requestedCameraContinuation: undefined, clientObservationSession: undefined,
    NO_AGENT_SEND: 'No selected session', NO_AGENT_VOICE: 'No selected session',
    noSessionError: () => Error('No selected session'),
    phoneContextMessage: (text, context) => ({text, context}),
    boundNavigation: () => undefined, cancelStoppedReply: () => {},
    clearPersonalSetup: () => {},
    ensureSelectedConversation: async (_selected, _session, _signal, current) => {
      current(); bindings++; return 'conversation-1';
    },
  });
  f.context.state = {...f.snapshot(), open: false, membershipBalance: balance,
    membershipDismissed: false, session: {sessionId: 'session-1'}};
  f.context.active = {kind: 'remote', remote: {session: {expiresAt: Date.now() + 60000}}};
  vm.runInContext(preflightCode, f.context);
  f.context.connectionController = f.context.preflightController;
  return {...f, get bindings() {return bindings;},
    voice: () => f.context.preflightController.prepareVoiceConversation(new AbortController().signal),
    send: () => f.context.preflightController.send('Hello', {}, 'request-1', new AbortController().signal),
    close: () => f.context.preflightController.close()};
}
for (const balance of ['zero', 'checking', 'unavailable', undefined, 'funded', 'member']) {
  test(`voice and send preflights distinguish ${String(balance)} from verified zero`, async () => {
    for (const method of ['voice', 'send']) {
      const f = preflightFixture(balance);
      if (balance === 'zero') {
        f.context.state.membershipDismissed = true;
        await assert.rejects(f[method](), error => {
          assert.equal(error.message, 'Choose a monthly plan or enter a membership code to ask Alpha.');
          // Nothing was sent, and the composer says why instead of a generic "Not sent".
          assert.equal(error.notDispatched, true);
          assert.equal(error.refusedBeforeTurn, true);
          return true;
        });
        assert.equal(f.bindings, 0);
        // The subscription sheet is offered again even after it was closed, once the refusal is delivered.
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(f.snapshot().membershipDismissed, false);
      } else {
        const result = await f[method]();
        assert.equal(method === 'voice' ? result.conversationId : result, 'conversation-1');
        assert.equal(f.bindings, 1);
        assert.equal(f.context.operation, null);
        assert.equal(f.context.sending, null);
      }
    }
  });
}
const adapter = await readFile(new URL('../apps/app/src/prototype/agent-adapter.ts', import.meta.url), 'utf8');
const adapterStatus = adapter.slice(adapter.indexOf('const residentPending='), adapter.indexOf('out.draftConflict='));
const composerStatus = ({connection, draft}) => {
  const out = {};
  vm.runInNewContext(adapterStatus, {out, connection, draft, residentAlwaysPresent: true, agentPendingText: () => 'Your agent stopped.'});
  return out.draftStatus;
};
const residentRunning = {kind: 'resident', session: {sessionId: 'session-1'}};
test('no network adds no composer text and drops no draft status', () => {
  const offline = {...residentRunning, inferenceOffline: true};
  assert.equal(composerStatus({connection: offline}), '');
  assert.equal(composerStatus({connection: offline, draft: {message: 'Draft was not saved.'}}), 'Draft was not saved.');
  assert.doesNotMatch(source + adapter, /AI needs a connection/);
});
test('an online composer keeps its empty status, draft status and recovery line', () => {
  assert.equal(composerStatus({connection: residentRunning}), '');
  assert.equal(composerStatus({connection: residentRunning, draft: {message: 'Draft was not saved.'}}), 'Draft was not saved.');
  assert.equal(composerStatus({connection: {kind: 'recovering'}}), 'Your agent stopped.');
});
for (const [name, offline] of [['the connection state', {inferenceOffline: true}], ['the browser', {onLine: false}]]) {
  test(`${name} reporting no network refuses a resident send before anything leaves the phone`, async () => {
    const f = preflightFixture('funded');
    f.context.active = {kind: 'resident'};
    f.context.state.inferenceOffline = !!offline.inferenceOffline;
    f.context.navigator = {onLine: offline.onLine !== false};
    await assert.rejects(f.send(), error => {
      // The composer keeps the text only for a refusal marked as never dispatched.
      assert.equal(error.notDispatched, true);
      return true;
    });
    assert.equal(f.bindings, 0);
    assert.equal(f.context.sending, null);
  });
}
test('a resident send with a network binds its conversation as before', async () => {
  const f = preflightFixture('funded');
  f.context.active = {kind: 'resident'};
  assert.equal(await f.send(), 'conversation-1');
  assert.equal(f.bindings, 1);
  assert.equal(f.context.sending, null);
});
// Owner, 2026-11-03: a refused composer send gets its text back with no toast; a refusal that
// carries its own reason, or a send from outside the composer, still says so. The real statement
// runs, including the preview gate read before the held send is released.
const refusalStart = adapter.indexOf('if(this.live){', adapter.indexOf('// Nothing reached the agent: put the text back'));
const refusal = stripTypeScriptTypes(adapter.slice(refusalStart, adapter.indexOf('\n        else if(fromComposer)this.composerDraft?.release();', refusalStart)), {mode: 'transform'});
class NotDispatched extends Error {}
class AlphaClientError extends Error { constructor(code, message) { super(message); this.code = code; } }
const toastsFor = (e, {fromComposer = true, preview = false, holding = true} = {}) => {
  const toasts = [], composerDraft = {holding};
  const shell = {live: true, composerDraft, setState() {}, toast: text => toasts.push(text)};
  vm.runInNewContext(`(function(){${refusal}})`, {e, message: e.message, fromComposer, privateLocalPreviewEnabled: preview, NotDispatched, AlphaClientError, userId: 'user-1', heldKey: 'one', heldText: 'Words', reviewedSource: null, releaseComposerSend: () => { composerDraft.holding = false; }}).call(shell);
  return toasts;
};
const reasonRefusals = [
  [Object.assign(new AlphaClientError('transport-failed', 'The agent is busy and did not accept this message. Wait, then send it again.'), {refusedBeforeTurn: true}), 'Not sent. The agent is busy and did not accept this message. Wait, then send it again.'],
  [new AlphaClientError('unconfigured', 'AI replies aren’t available right now.'), 'Not sent. AI replies aren’t available right now.'],
  [new AlphaClientError('sensitive', 'Agent observation is paused on this screen.'), 'Not sent. Agent observation is paused on this screen.'],
  [new NotDispatched('Agent changed. Review this message again.'), 'Agent changed. Review this message again.'],
];
test('a composer send refused before dispatch (offline, IPC reject, busy) shows no toast', () => {
  for (const preview of [false, true]) for (const refusal of [
    Object.assign(new AlphaClientError('transport-failed', 'The agent did not accept this message. Check its connection before trying again.'), {notDispatched: true}),
    new Error('Wait for the current reply before sending another message.'),
  ]) assert.deepEqual(toastsFor(refusal, {preview}), [], refusal.message);
  assert.doesNotMatch(adapter, /Not sent\. Your message is back in the composer/);
});
test('a refusal with its own reason, and a send from outside the composer, still show their toast', () => {
  for (const [refusal, toast] of reasonRefusals) {
    assert.deepEqual(toastsFor(refusal), [toast]);
    assert.deepEqual(toastsFor(refusal, {fromComposer: false, preview: true}), [toast]);
  }
  assert.deepEqual(toastsFor(new Error('Wait for the current reply before sending another message.'), {fromComposer: false}), ['Not sent.']);
  assert.deepEqual(toastsFor(new Error('Wait for the current reply before sending another message.'), {fromComposer: false, preview: true}), ['Not sent.']);
});
test('the private local preview keeps a held composer send\'s refusal out of toasts, as before', () => {
  for (const [refusal, toast] of reasonRefusals) {
    assert.deepEqual(toastsFor(refusal, {preview: true}), [], refusal.message);
    assert.deepEqual(toastsFor(refusal, {preview: true, holding: false}), [toast], 'a send no longer held still says why');
  }
});
// Owner, 2026-11-03: Cloud being unreachable shows no banner; a plan that is needed still does.
const planNoticeLine = section('    const notice=residentCloudFlow()&&snapshot.session', '\n');
const planNotice = snapshot => vm.runInNewContext(`${planNoticeLine};notice`, {residentCloudFlow: () => true, snapshot});
test('Cloud being unreachable shows no plan notice or text', () => {
  assert.equal(planNotice({session: {}, residentPlanNotice: 'offline', cloudAccount: null}), null);
  assert.equal(planNotice({session: {}, residentPlanNotice: 'offline', cloudAccount: {}}), null);
  assert.doesNotMatch(source, /Cloud cannot be reached right now/);
});
test('a needed plan still shows its notice beside the running agent', () => {
  assert.equal(planNotice({session: {}, residentPlanNotice: 'needs-plan', cloudAccount: {}}), 'needs-plan');
  assert.equal(planNotice({session: {}, residentPlanNotice: 'needs-plan', cloudAccount: null}), null);
  assert.equal(planNotice({session: null, residentPlanNotice: 'needs-plan', cloudAccount: {}}), null);
  assert.equal(planNotice({session: {}, residentPlanNotice: null, cloudAccount: {}}), null);
});
// With no Try again, the network's return is what brings AI back (Root, #743): a distinct offline to
// online change for the same owner, Cloud environment and provider lifts the once-a-minute limit for
// one return, at once while Alpha is shown or when the owner comes back to it. The window events run
// the real listeners, networkChanged and recheckPlanOnReturn.
const returnCode = stripTypeScriptTypes([
  section('function ownProviderSelected(', '\n'),
  ...source.match(/^(function planCheckScope\(|let networkLostUnder\b).*$/gm) ?? [],
  `globalThis.connectionController={${section('  recheckPlanOnReturn(', '  /**')}${section('  networkChanged(', '  openCloudAccount(')}};`,
  section('  useEffect(()=>{const offline=', '\n'),
  section('  useEffect(()=>{const visible=', '\n'),
].join('\n'), {mode: 'transform'});
function returnFixture({offline = false} = {}) {
  const listeners = {}, target = {addEventListener: (type, listener) => { (listeners[type] ??= []).push(listener); }, removeEventListener() {}};
  const box = {residentCloudFlow: () => true, operation: null, planRecheck: null, sending: null, state: {busy: false, session: {}, inferenceOffline: offline, cloudAccount: {credentialId: 'credential-1'}}, Date, planManagementReturn: false, lastPlanRecheck: -Infinity, PLAN_RECHECK_INTERVAL_MS: 60_000, environment: 'production', residentEnvironment: () => box.environment, ownCloudServiceRestore: null, residentBinding: 'kept', rechecks: 0, service: null, update: patch => { Object.assign(box.state, patch); }, retractReadiness() {}, useEffect: run => run(), document: {...target, hidden: false}, window: target};
  box.recheckResidentPlan = box.restoreOwnProviderCloudServices = () => { box.rechecks++; };
  vm.createContext(box); vm.runInContext(returnCode, box);
  box.fire = (type, hidden = false) => { box.document.hidden = hidden; for (const listener of listeners[type]) listener({type}); };
  return box;
}
test('returns to Alpha with no network change check the plan at most once a minute', () => {
  const box = returnFixture();
  box.fire('visibilitychange'); assert.equal(box.rechecks, 1);
  box.fire('pageshow'); box.fire('visibilitychange', true); box.fire('visibilitychange'); box.fire('pageshow');
  assert.equal(box.rechecks, 1);
});
test('a return from plan management still checks once inside the limit', () => {
  const box = returnFixture();
  box.fire('visibilitychange'); box.planManagementReturn = true; box.fire('pageshow'); assert.equal(box.rechecks, 2);
  box.fire('visibilitychange'); assert.equal(box.rechecks, 2);
});
test('the network coming back while Alpha is shown checks the plan at once, once, inside the limit', () => {
  const box = returnFixture();
  box.fire('visibilitychange'); box.fire('offline');
  box.fire('visibilitychange'); box.fire('pageshow'); box.fire('visibilitychange', true); box.fire('visibilitychange');
  assert.equal(box.rechecks, 1, 'returns while the network is still away stay inside the limit');
  box.fire('online'); assert.equal(box.rechecks, 2);
  box.fire('visibilitychange'); box.fire('pageshow'); assert.equal(box.rechecks, 2, 'the lifted limit is used once');
});
test('the network coming back while Alpha is in the background is checked once when the owner comes back', () => {
  for (const started of ['online', 'offline']) for (const own of [false, true]) {
    const box = returnFixture({offline: started === 'offline'}), name = `started ${started}, ${own ? 'own provider' : 'Cloud'}`;
    // The agent's start reads the provider. With its own provider, a Cloud services read that fails
    // while offline detaches the account; the owner is the same.
    if (own) { box.state.providerStatus = {selected: true, provider: 'cerebras'}; box.restoreOwnProviderCloudServices = () => { box.rechecks++; if (box.state.inferenceOffline) box.state.cloudAccount = null; }; }
    if (started === 'online') box.fire('offline');
    box.fire('visibilitychange'); box.fire('visibilitychange', true); box.fire('online', true);
    assert.equal(box.rechecks, 1, `${name}: nothing is checked while Alpha is hidden`);
    box.fire('visibilitychange'); assert.equal(box.rechecks, 2, name);
    box.fire('pageshow'); box.fire('visibilitychange', true); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, name);
  }
});
test('repeated online events lift the limit once', () => {
  const box = returnFixture();
  box.fire('visibilitychange'); box.fire('offline'); box.fire('online'); box.fire('online'); box.fire('online');
  assert.equal(box.rechecks, 2);
  box.fire('offline', true); box.fire('online', true); box.fire('online', true); box.fire('visibilitychange'); box.fire('online'); box.fire('pageshow');
  assert.equal(box.rechecks, 3);
});
test('an online event with no offline before it stays inside the limit', () => {
  const box = returnFixture();
  box.fire('visibilitychange'); box.fire('online'); box.fire('online', true); box.fire('visibilitychange');
  assert.equal(box.rechecks, 1);
});
test('a changed Cloud sign-in, environment or provider drops the lifted limit', () => {
  for (const [name, change] of Object.entries({
    'Cloud sign-in': box => { box.state.cloudAccount = {credentialId: 'credential-2'}; },
    'signed out': box => { box.state.cloudAccount = null; },
    'Cloud environment': box => { box.environment = 'staging'; },
    provider: box => { box.state.providerStatus = {selected: true, provider: 'cerebras'}; },
  })) {
    const between = returnFixture();
    between.fire('visibilitychange'); between.fire('offline'); change(between); between.fire('online'); between.fire('pageshow');
    assert.equal(between.rechecks, 1, `${name} between offline and online`);
    const pending = returnFixture();
    pending.fire('visibilitychange'); pending.fire('visibilitychange', true); pending.fire('offline', true); pending.fire('online', true); change(pending); pending.fire('visibilitychange');
    assert.equal(pending.rechecks, 1, `${name} before the owner came back`);
  }
});
test('a check already running when the network comes back answers it; no second check follows', () => {
  const cloud = returnFixture();
  cloud.recheckResidentPlan = () => { cloud.rechecks++; cloud.operation = cloud.planRecheck = {}; };
  cloud.fire('offline'); cloud.fire('visibilitychange'); cloud.fire('online'); assert.equal(cloud.rechecks, 1);
  cloud.operation = null; cloud.fire('pageshow'); cloud.fire('visibilitychange'); assert.equal(cloud.rechecks, 1);
  const own = returnFixture(); own.state.providerStatus = {selected: true, provider: 'cerebras'};
  own.restoreOwnProviderCloudServices = () => { own.rechecks++; own.ownCloudServiceRestore = {}; };
  own.fire('offline'); own.fire('visibilitychange'); own.fire('online'); assert.equal(own.rechecks, 1);
  own.ownCloudServiceRestore = null; own.fire('pageshow'); assert.equal(own.rechecks, 1);
});
test('a return while still offline, with a check running, leaves the network return its own check', () => {
  const cloud = returnFixture();
  cloud.recheckResidentPlan = () => { cloud.rechecks++; cloud.operation = cloud.planRecheck = {}; };
  cloud.fire('offline'); cloud.fire('visibilitychange'); cloud.fire('pageshow'); assert.equal(cloud.rechecks, 1);
  cloud.operation = cloud.planRecheck = null; cloud.fire('online'); assert.equal(cloud.rechecks, 2);
  const own = returnFixture(); own.state.providerStatus = {selected: true, provider: 'cerebras'};
  own.restoreOwnProviderCloudServices = () => { own.rechecks++; own.ownCloudServiceRestore = {}; };
  own.fire('offline'); own.fire('visibilitychange'); own.fire('pageshow'); assert.equal(own.rechecks, 1);
  own.ownCloudServiceRestore = null; own.fire('online'); assert.equal(own.rechecks, 2);
});
test('a network return held back by a reply, an edit or other work checks on the next return, once', () => {
  for (const [name, hold] of Object.entries({
    reply: (box, on) => { box.sending = on ? {} : null; },
    'edit, voice or connection step': (box, on) => { box.operation = on ? {} : null; },
    'busy step': (box, on) => { box.state.busy = on; },
    recovery: (box, on) => { box.state.residentRecoveryReason = on ? 'ipc-recovery' : undefined; },
  })) {
    const box = returnFixture();
    box.fire('visibilitychange'); box.fire('offline'); box.fire('visibilitychange');
    hold(box, true); box.fire('online'); box.fire('pageshow'); assert.equal(box.rechecks, 1, `${name}: nothing is checked while it runs`);
    hold(box, false); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, name);
    box.fire('pageshow'); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, `${name}: once`);
  }
});
// The network's return belongs to the admission it was lost under (Root, #743). Every Cloud sign-in,
// sign-out and provider change runs a new admission (residentSignedIn, then its own start of the
// agent, connectResident with that admission; otherwise connectResident), which retires a return
// still waiting, so an A→B→A change never spends it on a second plan read. An admission that runs
// with no network records its own. Both run here from source up to their first Cloud or agent read,
// which never settles; the provider read answers with the provider status shown.
const admissionCode = stripTypeScriptTypes(section('async function residentSignedIn(', '/** The key is stored;') + section('async function connectResident(', 'async function connectCloud('), {mode: 'transform'});
const signInAdmission = {binding: 'unbound'};
function admissions(box) {
  vm.runInContext(admissionCode, box);
  const pending = () => new Promise(() => {}), signal = new AbortController().signal;
  Object.assign(box, {isAndroid: true, localProviderStatus: async () => box.state.providerStatus, stopEntitlementRefresh() {}, testMocksEnabled: false, admitCloudResident: pending, applyResidentBinding: pending, localAgentPackaged: pending, cloudCredentialStore: {read: pending}});
  return {connect: admitted => void box.connectResident(signal, admitted), signIn: () => void box.residentSignedIn(signal, false)};
}
const settled = () => new Promise(resolve => setImmediate(resolve));
// The network comes back while a busy step holds the check, or while Alpha is hidden; `release` ends
// that and is the next return.
const waits = {
  busy: {hold: box => { box.fire('visibilitychange'); box.fire('offline'); box.state.busy = true; box.fire('online'); }, release: box => { box.state.busy = false; box.fire('visibilitychange'); }},
  hidden: {hold: box => { box.fire('visibilitychange'); box.fire('offline'); box.fire('visibilitychange', true); box.fire('online', true); }, release: box => box.fire('visibilitychange')},
};
const ownProvider = {selected: true, provider: 'cerebras'};
test('a Cloud account changed and changed back while a network return waits does not spend it', async () => {
  for (const [how, wait] of Object.entries(waits)) for (const provider of [undefined, ownProvider]) {
    const box = returnFixture(), name = `${how}, ${provider ? 'own provider' : 'Cloud'}`, {connect, signIn} = admissions(box);
    box.state.providerStatus = provider;
    wait.hold(box); assert.equal(box.rechecks, 1, name);
    for (const credentialId of ['credential-2', 'credential-1']) { signIn(); box.state.cloudAccount = {credentialId}; connect(signInAdmission); }
    await settled(); wait.release(box); assert.equal(box.rechecks, 1, `${name}: no second plan read`);
    box.fire('offline'); box.fire('online'); assert.equal(box.rechecks, 2, `${name}: a later network return checks`);
  }
});
test('a sign-out and sign-in, a provider round trip or a Cloud environment round trip retires a waiting network return', async () => {
  for (const [name, change] of Object.entries({
    'sign-out, then sign-in again': (box, {connect, signIn}) => { box.state.cloudAccount = null; connect(); signIn(); box.state.cloudAccount = {credentialId: 'credential-1'}; connect(signInAdmission); },
    'Cloud, own provider, Cloud': (box, {connect}) => { box.state.providerStatus = ownProvider; connect(); box.state.providerStatus = {selected: false}; connect(); },
    // setResidentQa reloads Alpha, which starts the agent again.
    'Cloud environment and back': (box, {connect}) => { box.environment = 'staging'; connect(); box.environment = 'production'; connect(); },
  })) for (const [how, wait] of Object.entries(waits)) {
    const box = returnFixture(), entries = admissions(box);
    wait.hold(box); change(box, entries); await settled(); wait.release(box);
    assert.equal(box.rechecks, 1, `${name}, ${how}`);
  }
});
test('a fresh start, restart, rebind, redeem or sign-in retires a waiting network return: no second plan read', async () => {
  for (const [admission, run] of Object.entries({connect: ({connect}) => connect(), signIn: ({connect, signIn}) => { signIn(); connect(signInAdmission); }})) for (const [how, wait] of Object.entries(waits)) {
    const box = returnFixture(), entries = admissions(box), name = `${admission}, ${how}`;
    wait.hold(box); run(entries); await settled(); wait.release(box); box.fire('pageshow');
    assert.equal(box.rechecks, 1, name);
    box.fire('offline'); box.fire('online'); box.fire('online'); assert.equal(box.rechecks, 2, `${name}: a later network return checks once`);
  }
});
// A provider status read outside any admission (Settings, a cancelled key check) runs the real
// public refreshProviderStatus and update (Root, #743). One that changes the provider class retires
// a waiting network return, so A→B→A seen by such reads alone never spends it; a same-class read (a
// failed one under Cloud included), a busy or render update and an optional Cloud detach keep it. A
// bound Cloud key reads as selected. A failed read retains the confirmed provider and marks it unavailable.
function statusReads(box) {
  Object.assign(box, {isAndroid: false, testMocksEnabled: false, developmentPageSuspended: false, listeners: new Set(), flushConversationEvents() {}, providerStatusGeneration: 0});
  vm.runInContext(stripTypeScriptTypes(section('function update(', '// P-43: where') + `Object.assign(connectionController,{${section('  async refreshProviderStatus(', '  /** Stops the running agent')}});`, {mode: 'transform'}), box);
  return status => { box.localProviderStatus = async () => { if (!status) throw Error('unavailable'); return status; }; return box.connectionController.refreshProviderStatus(); };
}
test('a provider class changed and changed back by status reads alone while a network return waits does not spend it', async () => {
  for (const [name, a, b] of [['own provider, Cloud, own provider', ownProvider, {selected: false}], ['Cloud, own provider, Cloud', {configured: true, provider: 'elizacloud', selected: true}, ownProvider]]) for (const [how, wait] of Object.entries(waits)) {
    const box = returnFixture(), read = statusReads(box), row = `${name}, ${how}`;
    box.state.providerStatus = a;
    wait.hold(box); await read(b); await read({...a}); assert.deepEqual(box.state.providerStatus, a, row); wait.release(box);
    assert.equal(box.rechecks, 1, `${row}: no second plan read`);
    box.fire('offline'); box.fire('online'); assert.equal(box.rechecks, 2, `${row}: a later network return checks`);
  }
});
test('same-class status reads, busy or render updates and an optional Cloud detach keep a waiting network return', async () => {
  for (const [name, provider, keep] of [
    ['own provider read again, then a failed read', ownProvider, async (read, box) => { await read({...ownProvider}); await read(null); assert.deepEqual(box.state.providerStatus, ownProvider); assert.equal(box.state.providerStatusError, true); }],
    ['Cloud read again, then a failed read', {selected: false}, async (read, box) => { await read({selected: false}); await read(null); assert.deepEqual(box.state.providerStatus, {selected: false}); assert.equal(box.state.providerStatusError, true); }],
    ['busy and render updates', undefined, (read, box) => { box.update({busy: true}); box.update({message: 'Render update', open: true}); box.update({busy: false}); }],
    ['Cloud detached with its own provider', ownProvider, (read, box) => { box.update({cloudAccount: null}); }],
  ]) for (const [how, wait] of Object.entries(waits)) {
    const box = returnFixture(), read = statusReads(box), row = `${name}, ${how}`;
    box.state.providerStatus = provider;
    wait.hold(box); await keep(read, box); wait.release(box);
    assert.equal(box.rechecks, 2, `${row}: the network return checks`);
    box.fire('pageshow'); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, `${row}: once`);
  }
});
// The network coming back while Alpha is shown, or while hidden and then when the owner comes back.
const networkReturns = {shown: box => box.fire('online'), hidden: box => { box.fire('visibilitychange', true); box.fire('online', true); box.fire('visibilitychange'); }};
test('the network lost during a sign-in is that sign-in\'s own: its return checks at once, once', async () => {
  // It may come back before the sign-in starts the agent, while the sign-in holds the check.
  for (const during of [false, true]) for (const [how, back] of Object.entries(networkReturns)) for (const provider of [undefined, ownProvider]) {
    const box = returnFixture(), {connect, signIn} = admissions(box), name = `back ${during ? 'during the sign-in' : 'after it'}, ${how}, ${provider ? 'own provider' : 'Cloud'}`;
    box.state.providerStatus = provider;
    box.fire('visibilitychange'); signIn(); box.fire('offline');
    if (during) { box.state.busy = true; box.fire('online'); }
    connect(signInAdmission); await settled(); box.state.busy = false;
    back(box); assert.equal(box.rechecks, 2, name);
    box.fire('pageshow'); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, `${name}: once`);
  }
});
test('an admission that runs with no network leaves the network\'s return its own check, once', async () => {
  for (const [admission, run] of Object.entries({
    'start, restart or rebind': ({connect}) => connect(),
    'sign-in': ({connect, signIn}) => { signIn(); connect(signInAdmission); },
  })) for (const [how, back] of Object.entries(networkReturns)) for (const provider of [undefined, ownProvider]) {
    const box = returnFixture(), entries = admissions(box), name = `${admission}, ${how}, ${provider ? 'own provider' : 'Cloud'}`;
    box.state.providerStatus = provider;
    box.fire('visibilitychange'); box.fire('offline'); run(entries); await settled();
    back(box); assert.equal(box.rechecks, 2, name);
    box.fire('pageshow'); box.fire('visibilitychange'); box.fire('online'); assert.equal(box.rechecks, 2, `${name}: once`);
  }
  // Alpha started offline: its start reads its own provider first, and the return made offline
  // after it is for that scope.
  const box = returnFixture({offline: true}), {connect} = admissions(box);
  box.state.cloudAccount = null; box.localProviderStatus = async () => ownProvider;
  connect(); await settled(); box.fire('visibilitychange'); assert.equal(box.rechecks, 1);
  box.fire('online'); assert.equal(box.rechecks, 2, 'started offline, own provider');
});
// The network lost while an admission reads a provider of another class (Root, #743): the read
// retires that return (the real update) and the same admission records no replacement for that
// offline episode, as when a scope captured unknown differs at the return; nor does a plan check with
// no network after such a status read. A later new admission in that episode records its own, as do
// the next offline edge (a new episode) and an offline admission with nothing captured.
const classChanges = [['unknown, own provider', undefined, ownProvider], ['own provider, Cloud', ownProvider, {selected: false}], ['Cloud, own provider', {selected: false}, ownProvider]];
function classReads(box, before, after) {
  const entries = {...admissions(box), read: statusReads(box)};
  Object.assign(box, {browserCloudResidentEnabled: true, localProviderStatus: async () => after});
  box.state.providerStatus = before;
  return entries;
}
for (const [admission, run] of Object.entries({
  start: (box, {connect}) => { connect(); box.fire('offline'); },
  'sign-in': (box, {connect, signIn}) => { signIn(); box.fire('offline'); connect(signInAdmission); },
})) for (const [name, before, after] of classChanges) {
  test(`a return lost while an admission reads a changed provider class is not replaced in that offline episode: ${admission}, ${name}`, async () => {
    const box = returnFixture(), entries = classReads(box, before, after);
    box.fire('visibilitychange'); run(box, entries); await settled();
    box.fire('online'); box.fire('pageshow'); assert.equal(box.rechecks, 1, 'no second plan read');
    box.fire('offline'); box.fire('online'); assert.equal(box.rechecks, 2, 'a later network return checks');
    box.fire('pageshow'); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, 'once');
  });
}
test('a plan check with no network after a status read changed the provider class records no network return', async () => {
  for (const [name, before, after] of classChanges) {
    const box = returnFixture(), read = statusReads(box);
    box.state.providerStatus = before;
    box.fire('offline'); await read(after); box.fire('visibilitychange'); assert.equal(box.rechecks, 1, `${name}: the check with no network`);
    box.fire('online'); box.fire('pageshow'); assert.equal(box.rechecks, 1, `${name}: no second plan read`);
    box.fire('offline'); box.fire('online'); assert.equal(box.rechecks, 2, `${name}: a later network return checks`);
  }
});
for (const [name, offline, before, after, run] of [
  // The rule 6aacec1be made: a new admission that runs offline records its own.
  ['a later fresh admission, still offline', false, ownProvider, {selected: false}, async (box, {connect}) => { box.fire('visibilitychange'); connect(); box.fire('offline'); await settled(); connect(); await settled(); box.fire('online'); }],
  ['a later sign-in, still offline', false, ownProvider, {selected: false}, async (box, {connect, signIn}) => { box.fire('visibilitychange'); connect(); box.fire('offline'); await settled(); signIn(); connect(signInAdmission); await settled(); box.fire('online'); }],
  ['a new offline episode before the return was seen', false, ownProvider, {selected: false}, async (box, {connect}) => { box.fire('visibilitychange'); connect(); box.fire('offline'); await settled(); box.fire('online', true); box.fire('offline', true); box.fire('online', true); box.fire('visibilitychange'); }],
  ['started offline, unknown, own provider', true, undefined, ownProvider, async (box, {connect}) => { connect(); await settled(); box.fire('visibilitychange'); box.fire('online'); }],
]) {
  test(`a later admission, a new offline episode or an offline admission with nothing captured records its own: ${name}`, async () => {
    const box = returnFixture({offline}); await run(box, classReads(box, before, after));
    assert.equal(box.rechecks, 2, 'the network return checks');
    box.fire('pageshow'); box.fire('visibilitychange'); assert.equal(box.rechecks, 2, 'once');
  });
}
// Continuations of the same admission are not a later one (Root, #743). After a status read retired
// the return with no network, none of these clears the retired marker or records an allowance, so a
// plan check with no network after it records nothing and the network's return is no second plan
// read. The automatic retry within an admission is its EntitlementRefresher (admitCloudResident,
// retry for an unavailable plan): a failed check writes the outage view through onView and never
// runs connectResident.
for (const [continuation, changes, run] of [
  // The sign-in's own follow-up runs from source, from its credential read to its own start with its
  // admission; admitCloudResident stands in with the patch it writes when admitted with no network.
  ['the sign-in\'s own follow-up and admitted start', classChanges, async (box, {signIn}, retire) => {
    let read; Object.assign(box, {cloudCredentialStore: {read: () => new Promise(resolve => { read = resolve; })}, retire() {}, showPostSignInSetup() {}, async bindResidentCloudProvider() {},
      async admitCloudResident() { box.update({residentPlanNotice: 'offline', residentSubscription: {kind: 'unavailable', reason: 'outage'}, planEndsAt: null}); return signInAdmission; }});
    signIn(); await retire(); read({credentialId: 'credential-1'}); await settled(); assert.equal(box.state.residentStarting, true);
  }],
  ['the admission\'s pending provider read completing', classChanges, async (box, {connect}, retire, after) => { let finish; box.localProviderStatus = () => new Promise(resolve => { finish = resolve; }); connect(); await retire(); finish(after); await settled(); }],
  ['the admission\'s pending provider read completing with the earlier class', classChanges, async (box, {connect}, retire, after, before) => { let finish; box.localProviderStatus = () => new Promise(resolve => { finish = resolve; }); connect(); await retire(); finish(before); await settled(); }],
  ['a same-class public status refresh', classChanges, async (box, {read}, retire, after) => { await retire(); await read({...after}); }],
  ['a public status refresh back to the earlier class', classChanges, async (box, {read}, retire, after, before) => { await retire(); await read(before); }],
  ['a busy step ending', classChanges, async (box, _, retire) => { await retire(); box.update({busy: true}); box.fire('visibilitychange'); box.update({busy: false}); }],
  ['Alpha hidden, then shown', classChanges, async (box, _, retire) => { await retire(); box.fire('visibilitychange', true); }],
  ['a render update', classChanges, async (box, _, retire) => { await retire(); box.update({message: 'Render update', open: true}); }],
  ['the optional Cloud account detached', classChanges.filter(([, , after]) => after === ownProvider), async (box, _, retire) => {
    Object.assign(box, {retireReadReplies() {}, clearPersonalSetup() {}, appRequests: new Set(), membershipRead: null, pendingBillingReview: null});
    vm.runInContext(stripTypeScriptTypes(section('function detachService()', '\n'), {mode: 'transform'}), box);
    await retire(); box.detachService(); assert.equal(box.state.cloudAccount, null);
  }],
  // The real onView of the admission's EntitlementRefresher, its account still the current service.
  ['the admission\'s automatic plan retry failing', classChanges.filter(([, , after]) => after !== ownProvider), async (box, _, retire) => {
    Object.assign(box, {planAdmission: (await import('../apps/app/src/runtime/subscription-entitlement.ts')).planAdmission, admitted: box.service});
    const onView = vm.runInContext(stripTypeScriptTypes(`({${section('    onView:next=>{', '\n    onAuthFailure')}}).onView`, {mode: 'transform'}), box);
    await retire(); onView({kind: 'unavailable', reason: 'outage'}); assert.deepEqual(box.state.residentSubscription, {kind: 'unavailable', reason: 'outage'});
  }],
]) {
  test(`a continuation of the same admission after a status read retired the return with no network records nothing: ${continuation}`, async () => {
    for (const [name, before, after] of changes) {
      const box = returnFixture(), entries = classReads(box, before, after);
      await run(box, entries, async () => { box.fire('offline'); await entries.read(after); }, after, before);
      box.fire('visibilitychange'); assert.equal(box.rechecks, 1, `${name}: the check with no network`);
      box.fire('online'); box.fire('pageshow'); assert.equal(box.rechecks, 1, `${name}: no second plan read`);
      box.fire('offline'); box.fire('online'); assert.equal(box.rechecks, 2, `${name}: a later network return checks`);
    }
  });
}
// The check the network's return allows may still not reach Cloud. Nothing unverified is admitted,
// recorded or shown as a valid plan; there is no sign-in or rebind. An identity read that fails shows
// no notice; a plan read that fails after it keeps the plan notice (Root, #743: that contract is
// tracked separately). The shared controller and entitlement check decide it.
const recheckCode = stripTypeScriptTypes([
  section('function cloudUnreachable(', '/** Notice shown when Cloud inference'),
  section('function signInClient(', '/**\n * A new key was stored'),
  section('async function admitCloudResident(', '/**\n * Cloud reported'),
  section('async function recheckResidentPlan(', '/** Bind or unbind'),
  section('function residentBindingController(', '/** The packaged-runtime refusal.'),
].join('\n'), {mode: 'transform'});
test('a plan check that cannot reach Cloud admits nothing and reports no plan as valid; a missing plan still shows its notice', async () => {
  const shared = await import('../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts');
  const entitlement = await import('../apps/app/src/runtime/subscription-entitlement.ts');
  const unreachable = async () => { throw new Error('Connection request failed'); }, outage = {kind: 'unavailable', reason: 'outage'}, marked = [];
  for (const [name, {identity = async () => {}, plan, recent = false, notice, subscription = outage, binding = 'unbound'}] of Object.entries({
    'identity read fails': {identity: unreachable, notice: 'offline'},
    'identity read fails, plan verified this week': {identity: unreachable, recent: true, notice: 'offline', binding: 'kept'},
    'plan read fails after the identity read': {plan: unreachable, notice: 'needs-plan'},
    'no plan': {plan: async () => null, notice: 'needs-plan', subscription: {kind: 'inactive', planName: null, status: 'none', source: 'billing-limits'}},
  })) {
    const account = {credentialId: 'credential-1'}, identityRow = {credentialId: 'credential-1', userId: 'user-1', organizationId: null}, calls = [], admitted = [], records = [];
    const client = {environment: 'production', entitlementSource: () => ({issuer: 'https://cloud.invalid', entitlement: plan, entitlementKeys: async () => [], fallbackPlan: async () => ({status: 'none', planName: null, periodEnd: null})})};
    const box = {operation: null, planRecheck: null, signInReadinessOwner: null, state: {session: {}, open: false, cloudAccount: account, residentPlanNotice: null}, active: {kind: 'resident'}, residentBinding: 'unbound', cloud: client, service: null, redeemedPlanEnd: null, AbortController, DOMException, Date, Error,
      CloudProtocolError: class extends Error {}, EntitlementError: entitlement.EntitlementError, checkEntitlement: entitlement.checkEntitlement, planAdmission: entitlement.planAdmission, isEntitlementSignInFailure: entitlement.isEntitlementSignInFailure,
      CloudResidentBindingController: shared.CloudResidentBindingController, CloudResidentBindingError: shared.CloudResidentBindingError, recentResidentPlanAdmission: shared.recentResidentPlanAdmission,
      cloudCredentialStore: {read: async () => ({credentialId: 'credential-1'})}, cloudServiceName: () => 'Cloud',
      verifyService: async () => { marked.push(box.operation !== null && box.operation === box.planRecheck); await identity(); box.service = {client, identity: identityRow}; },
      readPlanAdmission: () => recent ? {version: 1, environment: 'production', ...identityRow, status: 'active', planName: 'Synthetic plan', verifiedAt: Date.now() - 1000, endsAt: null} : null, writePlanAdmission: record => records.push(record),
      ownProviderSelected: () => false, residentBindable: () => true, residentEnvironment: () => 'production', makeCloud: () => client, stopEntitlementRefresh() {}, update: patch => { Object.assign(box.state, patch); },
      detachService: () => calls.push('detach'), queueResidentRebind: () => calls.push('rebind'), residentRebinds: () => ({queue: () => calls.push('rebind')}), runQueuedResidentRebind() {}};
    vm.createContext(box); vm.runInContext(recheckCode, box);
    const admit = box.admitCloudResident; box.admitCloudResident = async signal => { const admission = await admit(signal); admitted.push(admission.binding); return admission; };
    await box.recheckResidentPlan();
    assert.deepEqual({notice: box.state.residentPlanNotice, subscription: {...box.state.residentSubscription}, planEndsAt: box.state.planEndsAt, open: box.state.open, account: box.state.cloudAccount, operation: box.operation, calls, admitted, recorded: records.filter(Boolean)}, {notice, subscription, planEndsAt: null, open: false, account, operation: null, calls: [], admitted: [binding], recorded: []}, name);
  }
  assert.deepEqual(marked, [true, true, true, true], 'a network return shares this running check');
});
test('unknown balance does not bypass missing, expired or busy conversation guards', async () => {
  for (const balance of ['checking', 'unavailable', undefined]) {
    for (const method of ['voice', 'send']) {
      const missing = preflightFixture(balance, {account: null});
      missing.context.active = null; missing.context.state.session = null;
      await assert.rejects(missing[method](), /No selected session/);
      assert.equal(missing.bindings, 0);
      const expired = preflightFixture(balance);
      expired.context.active.remote.session.expiresAt = Date.now() - 1;
      await assert.rejects(expired[method](), /session.*expired/i);
      assert.equal(expired.bindings, 0);
      const busy = preflightFixture(balance);
      busy.context.operation = new AbortController();
      await assert.rejects(busy[method](), /Finish the.*operation/);
      assert.equal(busy.bindings, 0);
    }
  }
});
test('closing unknown balance uses ordinary close rules without claiming zero balance', () => {
  for (const balance of ['checking', 'unavailable', undefined, 'funded', 'member']) {
    const f = preflightFixture(balance);
    f.context.state.open = true;
    f.close();
    assert.equal(f.snapshot().open, false);
    assert.equal(f.snapshot().membershipDismissed, false);
    const busy = preflightFixture(balance);
    busy.context.state.open = true; busy.context.state.busy = true;
    busy.close();
    assert.equal(busy.snapshot().open, true);
  }
  const zero = preflightFixture('zero');
  zero.context.state.open = true; zero.close();
  assert.equal(zero.snapshot().open, false);
  assert.equal(zero.snapshot().membershipDismissed, true);
  // After a Cloud billing refusal the sheet closes the same way; the refusal stays until Cloud admits a turn.
  for (const balance of ['funded', 'member', 'checking']) {
    const refused = preflightFixture(balance);
    refused.context.state.open = true; refused.context.state.fundingRefused = true; refused.close();
    assert.equal(refused.snapshot().open, false);
    assert.equal(refused.snapshot().membershipDismissed, true);
    assert.equal(refused.snapshot().fundingRefused, true);
  }
});
test('closing unknown balance preserves required sign-in for signed-out and expired accounts', () => {
  for (const balance of ['checking', 'unavailable', undefined]) {
    for (const account of [null, {expiresAt: Date.now() - 1}]) {
      const f = preflightFixture(balance, {account});
      f.context.state.open = true; f.close();
      assert.equal(f.snapshot().open, true);
      assert.equal(f.snapshot().membershipDismissed, false);
      assert.equal(f.context.productionCloudSignInRequired(f.snapshot()), true);
    }
  }
});

const verifyServiceCode = stripTypeScriptTypes(
  section('async function verifyService(', 'let pendingBillingReview:'),
  {mode: 'transform'},
);
function serviceVerificationFixture({replaceCredential, identityPatch} = {}) {
  let credential = {credentialId: 'credential-1', credentialReference: 'native-reference-1'};
  let reads = 0, identityReads = 0, refreshes = 0;
  const updates = [], saved = [];
  const identity = {userId: 'owner-1', organizationId: 'organization-1', ...identityPatch};
  const client = {environment: 'production', identity: async () => {
    identityReads++;
    if (replaceCredential) credential = {...credential, ...replaceCredential};
    return identity;
  }};
  class CloudProtocolError extends Error {
    constructor(code) {super(code); this.code = code;}
  }
  const context = vm.createContext({
    service: null, membershipRead: null, pendingBillingReview: null,
    cloudCredentialStore: {read: async () => {reads++; return {...credential};}},
    residentCloudFlow: () => true,
    update: patch => updates.push(patch), CloudProtocolError,
    localStorage: {setItem: (key, value) => saved.push([key, value])},
    CLOUD_SERVICE: 'fixture-cloud-service', crypto: {randomUUID: () => 'session-1'},
    refreshMembershipBalance: async () => {refreshes++;},
  });
  vm.runInContext(verifyServiceCode, context);
  return {context, identity, updates, saved,
    get reads() {return reads;}, get identityReads() {return identityReads;},
    get refreshes() {return refreshes;},
    verify: expected => context.verifyService(client, new AbortController().signal, expected)};
}
const expectedServiceIdentity = {
  credentialId: 'credential-1', userId: 'owner-1', organizationId: 'organization-1',
};
test('service verification accepts a stable opaque reference when expected reference is omitted', async () => {
  const f = serviceVerificationFixture();
  assert.equal(await f.verify(expectedServiceIdentity), f.identity);
  assert.equal(f.reads, 2);
  assert.equal(f.identityReads, 1);
  assert.equal(f.context.service.credentialReference, 'native-reference-1');
  assert.equal(f.context.service.identity.userId, 'owner-1');
  assert.equal(f.updates.filter(patch => patch.cloudAccount).length, 1);
  assert.equal(f.saved.length, 1);
  assert.equal(f.refreshes, 1);
});
test('service verification still enforces an explicitly expected opaque reference', async () => {
  const valid = serviceVerificationFixture();
  await valid.verify({...expectedServiceIdentity, credentialReference: 'native-reference-1'});
  assert.equal(valid.context.service.credentialReference, 'native-reference-1');
  for (const credentialReference of ['other-reference', '']) {
    const f = serviceVerificationFixture();
    await assert.rejects(f.verify({...expectedServiceIdentity, credentialReference}), /Cloud account changed/);
    assert.equal(f.identityReads, 0);
    assert.equal(f.context.service, null);
    assert.equal(f.saved.length, 0);
  }
});
for (const replaceCredential of [
  {credentialId: 'credential-2'},
  {credentialReference: 'native-reference-2'},
]) {
  test(`service verification rejects ${Object.keys(replaceCredential)[0]} replacement during identity lookup`, async () => {
    const f = serviceVerificationFixture({replaceCredential});
    await assert.rejects(f.verify(expectedServiceIdentity), /Cloud account changed/);
    assert.equal(f.reads, 2);
    assert.equal(f.context.service, null);
    assert.equal(f.updates.filter(patch => patch.cloudAccount).length, 0);
    assert.equal(f.saved.length, 0);
    assert.equal(f.refreshes, 0);
  });
}
for (const identityPatch of [{userId: 'other-owner'}, {organizationId: 'other-organization'}]) {
  test(`service verification rejects an unexpected ${Object.keys(identityPatch)[0]}`, async () => {
    const f = serviceVerificationFixture({identityPatch});
    await assert.rejects(f.verify(expectedServiceIdentity), error => error.code === 'account-changed');
    assert.equal(f.context.service, null);
    assert.equal(f.updates.filter(patch => patch.cloudAccount).length, 0);
    assert.equal(f.saved.length, 0);
    assert.equal(f.refreshes, 0);
  });
}

// Actual saved-credential admission + production projection, with synthetic identity failures only.
const savedAdmissionCode=stripTypeScriptTypes([
 section('function cloudUnreachable(', '/** Notice shown when Cloud inference'),
 section('async function verifyService(', 'let pendingBillingReview:'),
 section('function signInClient(', '/**\n * A new key was stored'),
 section('async function admitCloudResident(', '/**\n * Cloud reported, on a background refresh'),
 section('async function applyResidentBinding(', '/** The packaged-runtime refusal.'),
 section('function residentSignInRequired()', '\n'),
].join('\n'),{mode:'transform'});
// The shared resident binding controller (projected from the pinned upstream source) decides the binding.
const residentBinding=await import('../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts');
const residentTail=source.slice(source.indexOf('  // Restore only the saved choice for this verified agent and owner;'),source.indexOf('async function connectCloud('));
async function offlineRestoreFixture({kind='offline',recent=false,newer=null}={}){
 const f=fixture({account:null});let historyReads=0,credentialWrites=0,unbinds=0,identityReads=0;
 class CloudProtocolError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
 const client={environment:'production',async identity(){identityReads++;if(kind==='expired')throw new CloudProtocolError('expired');if(kind==='revoked')throw new CloudProtocolError('http',401);if(kind==='changed')throw new residentBinding.CloudResidentBindingError('account-changed');throw new Error('Connection request failed');}};
 Object.assign(f.context,{Error,DOMException,CloudProtocolError,EntitlementError:class extends Error{},cloud:client,service:null,RESIDENT_UNBIND_UNCONFIRMED:'Unbind not confirmed',residentCloudFlow:()=>true,residentBindable:()=>true,residentEnvironment:()=> 'production',stopEntitlementRefresh:()=>{},CloudResidentBindingController:residentBinding.CloudResidentBindingController,CloudResidentBindingError:residentBinding.CloudResidentBindingError,recentResidentPlanAdmission:residentBinding.recentResidentPlanAdmission,readPlanAdmission:()=>recent?{version:1,environment:'production',credentialId:'synthetic-retained-credential',userId:'synthetic-user',organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-1000,endsAt:null}:null,writePlanAdmission:()=>{},isEntitlementSignInFailure:()=>false,LocalCloudProviderStopUnconfirmed:class extends Error{},cloudCredentialStore:{read:async()=>kind==='missing'?null:{credentialId:'synthetic-retained-credential'},write:async()=>{credentialWrites++;}},detachService:()=>{f.context.service=null;f.update({cloudAccount:null});},clearLocalProvider:async()=>{unbinds++;},restoreSavedHistory:async()=>{historyReads++;f.update({history:{messages:Array.from({length:15},(_,id)=>({id:'synthetic-'+id,text:'Fixture'}))}});},refreshActionReview:async()=>{},browserLocalAgentEnabled:false,residentBinding:null});
 if(newer)f.context.service=newer;
 vm.runInContext(savedAdmissionCode+';globalThis.admit=admitCloudResident;globalThis.bind=applyResidentBinding;',f.context);
 f.update({startupResolved:false,automaticRestore:true});
 f.context.admission=await f.context.admit(new AbortController().signal);f.context.bound=await f.context.bind(f.context.admission,new AbortController().signal);f.context.signal=new AbortController().signal;
 await vm.runInContext(stripTypeScriptTypes('(async function(){'+residentTail+')',{mode:'transform'}),f.context)();
 f.update({startupResolved:true,automaticRestore:false});
 return {...f,historyReads,credentialWrites,unbinds,identityReads};
}
test('retained credential with unreachable identity restores history without forcing fresh Welcome',async()=>{
 for(const recent of [false,true]){
  const f=await offlineRestoreFixture({recent});assert.equal(f.historyReads,1);assert.equal(f.snapshot().history.messages.length,15);assert.equal(f.snapshot().residentSavedCredential,true);assert.equal(f.snapshot().residentPlanNotice,'offline');assert.equal(f.snapshot().cloudAccount,null,'offline identity is never fabricated as authenticated');assert.equal(f.context.admission.notice,undefined,'Cloud being unreachable adds no notice or status text');assert.equal(f.context.service,null);assert.equal(f.context.admission.binding,recent?'kept':'unbound');assert.equal(f.credentialWrites,0);assert.equal(f.identityReads,1);assert.equal(f.context.residentSignInRequired(),false);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);assert.equal(f.snapshot().open,false);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
 }
});
test('retained offline exception cannot bypass missing, expired or revoked sign-in',async()=>{
 for(const kind of ['missing','expired','revoked']){const f=await offlineRestoreFixture({kind});assert.equal(f.snapshot().cloudAccount,null);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);assert.equal(f.snapshot().open,true);assert.equal(f.context.admission.binding,'unbound');assert.equal(f.credentialWrites,0);}
 for(const patch of [{residentSavedCredential:false,residentPlanNotice:'offline'},{residentSavedCredential:true,residentPlanNotice:null},{residentSavedCredential:true,residentPlanNotice:'offline',error:'Sign-in expired'},{residentSavedCredential:true,residentPlanNotice:'offline',cloudAccount:{expiresAt:Date.now()-1000}}]){const f=fixture({account:null});f.update({startupResolved:true,...patch});assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);}
});
test('an account change before identity is verified never detaches a newer connection',async()=>{
 const newer={client:{environment:'production'},identity:{credentialId:'synthetic-newer-credential'}};
 const f=await offlineRestoreFixture({kind:'changed',newer});
 assert.equal(f.context.admission.binding,'unbound');assert.equal(f.context.service,newer,'only a rejected read of this sign-in detaches the connection');assert.equal(f.credentialWrites,0);
});
test('retained offline account controls still open explicitly without claiming verified identity',async()=>{const f=await offlineRestoreFixture();f.update({purpose:'cloud-account',open:true});assert.equal(f.snapshot().cloudAccount,null);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);assert.equal(f.context.connectionChooserVisible(f.snapshot()),true);});

test('explicit signed-out entry waits for restore, probes once when settled, and never probes after close',()=>{
 const f=fixture({account:null,purpose:'cloud-account',open:true,android:false});let probes=0;const ref={current:false};
 const gate=source.includes('const signInEntryRequired=')?'signInEntryRequired':'productionSignInRequired',a=source.indexOf('  useEffect(() => {\n    if (!'+gate+')'),b=source.indexOf('  }, [',a);assert.ok(a>=0&&b>a);const callback=source.slice(a,b).replace('  useEffect(() => {','(()=>{')+'})';
 const evaluate=()=>{f.context.snapshot=f.snapshot();f.context.productionSignInRequired=f.context.productionCloudSignInRequired(f.snapshot());f.context.signInEntryRequired=f.context.productionSignInRequired||(typeof f.context.explicitSignedOutCloudEntry==='function'&&f.context.explicitSignedOutCloudEntry(f.snapshot()));f.context.automaticSignInProbe=ref;f.context.residentEnvironment=()=> 'production';f.context.connectionController={beginSignIn:()=>{probes++;}};vm.runInContext(stripTypeScriptTypes('var runProbe='+callback+';runProbe();',{mode:'transform'}),f.context);};
 f.update({startupResolved:false,automaticRestore:true});evaluate();assert.equal(probes,0);f.update({startupResolved:true,automaticRestore:false});evaluate();assert.equal(probes,1);evaluate();assert.equal(probes,1);f.update({open:false});evaluate();assert.equal(probes,1);assert.equal(ref.current,false);
});

test('a settled signed-out browser resident agent entry uses the approved sign-in route',()=>{
 const f=fixture({android:false,browserResident:true,account:null,purpose:'agent',open:true});
 f.update({startupResolved:true,residentSavedCredential:false});
 assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);
 assert.equal(f.context.explicitSignedOutCloudEntry(f.snapshot()),true);
 assert.equal(f.context.connectionChooserVisible(f.snapshot()),true);
 f.update({open:false});
 assert.equal(f.context.explicitSignedOutCloudEntry(f.snapshot()),false);
});
test('browser resident sign-in entry does not replace unresolved, retained or recovering agent state',()=>{
 for(const patch of [
  {startupResolved:false},
  {residentSavedCredential:undefined},
  {residentSavedCredential:true},
  {residentPlanNotice:'offline'},
  {residentStarting:true},
  {residentRecoveryReason:'ipc-recovery-retention-limit'},
  {error:'Saved source recovery required'},
 ]){
  const f=fixture({android:false,browserResident:true,account:null,purpose:'agent',open:true});
  f.update({startupResolved:true,residentSavedCredential:false,...patch});
  assert.equal(f.context.explicitSignedOutCloudEntry(f.snapshot()),false);
 }
});
test('non-resident browser, signed-in state and native required-sign-in policy retain their routes',()=>{
 const browser=fixture({android:false,account:null,purpose:'agent',open:true});
 browser.update({startupResolved:true,residentSavedCredential:false});
 assert.equal(browser.context.explicitSignedOutCloudEntry(browser.snapshot()),false);
 const signedIn=fixture({android:false,browserResident:true,purpose:'agent',open:true});
 signedIn.update({startupResolved:true,residentSavedCredential:false});
 assert.equal(signedIn.context.explicitSignedOutCloudEntry(signedIn.snapshot()),false);
 const native=fixture({android:true,browserResident:true,account:null,purpose:'agent',open:true});
 native.update({startupResolved:true,residentSavedCredential:false});
 assert.equal(native.context.explicitSignedOutCloudEntry(native.snapshot()),false);
 assert.equal(native.context.productionCloudSignInRequired(native.snapshot()),true);
});
test('the automatic entry is one full page with no Back on every platform; opened sign-ins stay dialogs',()=>{
 const native=fixture({account:null,purpose:'agent',open:true});native.update({startupResolved:true});
 assert.equal(native.context.signInEntryPage(native.snapshot()),true);
 const browser=fixture({android:false,browserResident:true,account:null,purpose:'agent',open:true});
 browser.update({startupResolved:true,residentSavedCredential:false});
 assert.equal(browser.context.signInEntryPage(browser.snapshot()),true);
 // An error during an attempt (a wrong code, a rejected key) keeps the page instead of a dismissible dialog.
 browser.update({signIn:{step:'code',environment:'production'},error:'That code did not work.'});
 assert.equal(browser.context.signInEntryPage(browser.snapshot()),true);
 // Without an attempt an error is not the first-run entry; startup and recovery views keep their place.
 browser.update({signIn:null});
 assert.equal(browser.context.signInEntryPage(browser.snapshot()),false);
 for(const purpose of ['cloud-account','plan'])for(const android of [false,true]){
  const opened=fixture({android,browserResident:!android,account:null,purpose,open:true});
  opened.update({startupResolved:true,residentSavedCredential:false,providerStatus:{provider:'cerebras',selected:true,configured:true}});
  assert.equal(opened.context.explicitSignedOutCloudEntry(opened.snapshot()),true);
  assert.equal(opened.context.signInEntryPage(opened.snapshot()),false,`${purpose} opened on ${android?'Android':'browser'} keeps its Back`);
 }
});
test('explicit signed-out account and plan entries remain available for a retained offline identity',()=>{
 for(const purpose of ['cloud-account','plan']){
  const f=fixture({android:false,browserResident:true,account:null,purpose,open:true});
  f.update({startupResolved:true,residentSavedCredential:true,residentPlanNotice:'offline'});
  assert.equal(f.context.explicitSignedOutCloudEntry(f.snapshot()),true);
 }
});


test('selected own inference does not require Cloud sign-in; changing back restores the gate',()=>{
 const f=fixture({account:null});
 f.update({providerStatus:{provider:'cerebras',selected:true,configured:true},startupResolved:true,open:false});
 assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);
 assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
 f.update({providerStatus:{provider:'cerebras',selected:false,configured:true}});
 assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),true);
 assert.equal(f.snapshot().open,true);
});

// Settings > AI provider during a streaming reply. Switching restarts the agent, and the actual
// retire() ends the reply in flight with "The connection changed.", so both switch handlers wait
// for the reply as they wait for a connection operation. Once it settles they switch as before.
const providerSwitchSource=stripTypeScriptTypes([
 section('function retire(', '/** Test mocks only'),
 section('async function restartAfterProviderChange(', '/** P-43: a startup path'),
 'globalThis.providerController={',
 section('  async configureLocal(', '  /** Stops the running agent'),
 '};',
].join('\n'),{mode:'transform'});
function providerSwitchFixture(){
 const events=[];
 const context=vm.createContext({AbortController,DOMException,
  operation:null,sending:null,providerStatusGeneration:0,epoch:1,active:null,state:{session:null},appRequests:new Set(),actionReceipts:new Map(),conversationMemory:new Map(),
  testMocksEnabled:false,residentAlwaysPresent:true,RESIDENT_NAME:'Alpha',isAndroid:true,browserCloudResidentEnabled:false,OWN_KEYS_NOT_SET_UP:'Own API keys could not be set up.',LOCAL_PROVIDER_MODEL:'model',
  signInReadinessOwner:null,OWN_KEY_BUSY:'Alpha is busy. Try again in a moment.',OWN_KEY_CHECKING:'Checking key…',connectionToast(){},
  clearClientObservationSupport(){},retireConversationEvents(){},retireReadReplies(){},pauseHostedBackground:async()=>{},retireClockReviews:async()=>{},cancelStoppedReply(){},
  secureConnectionStore:{remove:async()=>{}},update(){},showPostSignInSetup(){},
  work:async(label,run)=>{events.push(label);await run(new AbortController().signal);},
  configureLocalProvider:async()=>{events.push('check key');},clearLocalProvider:async()=>{events.push('clear own keys');return {configured:false};},
  localProviderStatus:async()=>({provider:'cerebras',selected:true,configured:true}),connectResident:async()=>{events.push('restart agent');},
 });
 vm.runInContext(providerSwitchSource,context);
 return {context,events,controller:context.providerController};
}
test('a provider switch during a streaming reply leaves the reply running; once it settles the switch works as before',async()=>{
 const switches={configureLocal:[f=>f.controller.configureLocal('synthetic-cerebras-key','model'),['Checking key…','check key','restart agent']],
  selectCloudProvider:[f=>f.controller.selectCloudProvider(),['Switching to Cloud…','clear own keys','restart agent']]};
 for(const [name,[run,idle]] of Object.entries(switches)){
  const f=providerSwitchFixture(),reply=new AbortController();
  f.context.sending=reply;await run(f);
  assert.equal(reply.signal.aborted,false,`${name} ended the reply in flight: ${reply.signal.reason?.message}`);
  assert.equal(f.context.sending,reply);assert.equal(f.context.epoch,1);
  assert.deepEqual(f.events,[],`${name}: no key check, key removal or agent restart while the reply streams`);
  // The reply settles (send clears sending); the same switch now runs unchanged.
  f.context.sending=null;await run(f);
  assert.deepEqual(f.events,idle,name);assert.equal(f.context.epoch,2,`${name} retired the old connection`);
 }
});
