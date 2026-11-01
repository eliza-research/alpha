/** Actual connection state/ownership functions; no renderer, network, credential or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=await readFile(process.env.ALPHA_PRESENTATION_SOURCE||new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b).replace(/^export /gm,'');}
const functions=[
 section('function update(', '// P-43: where'),
 section('export function productionCloudSignInRequired(', 'export function ConnectionChooser('),
 section('async function refreshActionReview(', 'function boundNavigation('),
 section('function boundNavigation(', '/*\n * DEVELOPMENT INFRASTRUCTURE'),
].join('\n');
const code=stripTypeScriptTypes(functions,{mode:'transform'});
function fixture({android=true,dev=false,browserResident=false,account={expiresAt:Date.now()+60000},purpose='agent',open=false}={}){
 const entries=[{id:'review-1',state:'reconciliation_required'}];let release;
 const selected={request(){},actions:{}};
 const context=vm.createContext({isAndroid:android,testMocksEnabled:dev,browserCloudResidentEnabled:browserResident,developmentPageSuspended:false,sending:null,flushConversationEvents:()=>{},listeners:new Set(),state:{open,automaticRestore:false,busy:false,error:'',cloudAccount:account,purpose,signIn:null,message:'Finish signing in in your browser.',session:{}},active:selected,epoch:1,navigationContext:()=>({view:'home'}),errorMessage:()=> 'Sign-in expired',readActionHistory:async()=>entries,Date,
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
    FUNDING_NEEDED: 'Add credits or enter a membership code to ask Alpha.',
    AlphaClientError: class AlphaClientError extends Error {constructor(code, message) {super(message); this.code = code;}},
    residentCloudFlow: () => true, residentAlwaysPresent: true,
    residentStartInBackground: false, pendingBillingReview: null,
    operation: null, requestedCameraContinuation: undefined, clientObservationSession: undefined,
    NO_AGENT_SEND: 'No selected session', NO_AGENT_VOICE: 'No selected session',
    INFERENCE_OFFLINE_NOTICE: 'Offline',
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
          assert.equal(error.message, 'Add credits or enter a membership code to ask Alpha.');
          // Nothing was sent, and the composer says why instead of a generic "Not sent".
          assert.equal(error.notDispatched, true);
          assert.equal(error.refusedBeforeTurn, true);
          return true;
        });
        assert.equal(f.bindings, 0);
        // The Membership & credits sheet is offered again even after it was closed, once the refusal is delivered.
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
 section('function cloudUnreachable(', 'const OFFLINE_NOTICE'),
 section('async function verifyService(', 'let pendingBillingReview:'),
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
 Object.assign(f.context,{Error,DOMException,CloudProtocolError,EntitlementError:class extends Error{},cloud:null,service:null,OFFLINE_NOTICE:'Cloud unavailable; resident remains local.',RESIDENT_UNBIND_UNCONFIRMED:'Unbind not confirmed',residentCloudFlow:()=>true,residentBindable:()=>true,residentEnvironment:()=> 'production',makeCloud:()=>client,stopEntitlementRefresh:()=>{},CloudResidentBindingController:residentBinding.CloudResidentBindingController,CloudResidentBindingError:residentBinding.CloudResidentBindingError,recentResidentPlanAdmission:residentBinding.recentResidentPlanAdmission,readPlanAdmission:()=>recent?{version:1,environment:'production',credentialId:'synthetic-retained-credential',userId:'synthetic-user',organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-1000,endsAt:null}:null,writePlanAdmission:()=>{},isEntitlementSignInFailure:()=>false,LocalCloudProviderStopUnconfirmed:class extends Error{},cloudCredentialStore:{read:async()=>kind==='missing'?null:{credentialId:'synthetic-retained-credential'},write:async()=>{credentialWrites++;}},detachService:()=>{f.context.service=null;f.update({cloudAccount:null});},clearLocalProvider:async()=>{unbinds++;},restoreSavedHistory:async()=>{historyReads++;f.update({history:{messages:Array.from({length:15},(_,id)=>({id:'synthetic-'+id,text:'Fixture'}))}});},refreshActionReview:async()=>{},browserLocalAgentEnabled:false,residentBinding:null});
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
  const f=await offlineRestoreFixture({recent});assert.equal(f.historyReads,1);assert.equal(f.snapshot().history.messages.length,15);assert.equal(f.snapshot().residentSavedCredential,true);assert.equal(f.snapshot().residentPlanNotice,'offline');assert.equal(f.snapshot().cloudAccount,null,'offline identity is never fabricated as authenticated');assert.equal(f.context.service,null);assert.equal(f.context.admission.binding,recent?'kept':'unbound');assert.equal(f.credentialWrites,0);assert.equal(f.identityReads,1);assert.equal(f.context.residentSignInRequired(),false);assert.equal(f.context.productionCloudSignInRequired(f.snapshot()),false);assert.equal(f.snapshot().open,false);assert.equal(f.context.connectionChooserVisible(f.snapshot()),false);
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
test('explicit signed-out account and plan entries remain available for a retained offline identity',()=>{
 for(const purpose of ['cloud-account','plan']){
  const f=fixture({android:false,browserResident:true,account:null,purpose,open:true});
  f.update({startupResolved:true,residentSavedCredential:true,residentPlanNotice:'offline'});
  assert.equal(f.context.explicitSignedOutCloudEntry(f.snapshot()),true);
 }
});
