import assert from 'node:assert/strict';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred, sourceModule, until} from './support.mjs';
import {serviceInputs} from './source-inputs.mjs';

const grant = '11111111-1111-4111-8111-111111111111';
const account = {connectionId: grant, connected: true, configured: true, label: 'fixture', reason: 'connected',
  grantedCapabilities: ['google.gmail.triage', 'google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox', 'google.calendar.write']};
const nativeBinding = {environment: 'production', userId: 'user-A', organizationId: 'organization', credentialId: 'credential', sessionId: 'session'};

export async function googleAccountsLifecycleRefinement(extraSources = []) {
  const sources = serviceInputs(['apps/app/src/runtime/google-accounts.ts', 'apps/app/src/runtime/google-workspace-return.ts',
    'apps/app/src/runtime/google-connection-return.ts', 'apps/app/src/runtime/gmail-mailbox.ts',
    'specs/quint/refinement/services/google-accounts-lifecycle.mjs', 'specs/quint/refinement/services/support.mjs']);
  sources.push(...extraSources);
  let driverHashes = captureInputs(sources);
  const capture = inputs => {
    sources.push(...inputs.filter(input => !sources.includes(input)));
    const next = captureInputs(sources);
    for (const [path, hash] of Object.entries(driverHashes)) assert.equal(next[path], hash, `Source changed before import: ${path}`);
    driverHashes = next;
  };
  const flow = await sourceModule('apps/app/src/runtime/google-workspace-return.ts', {}, capture);
  const connectionReturn = await sourceModule('apps/app/src/runtime/google-connection-return.ts', {}, capture);
  const helpers = await sourceModule('apps/app/src/runtime/google-accounts.ts', {'./gmail-background': 'export const retireGmailBackground=()=>({settled:async()=>{}});'}, capture);
  const traces = [];
  for (const [name, requestLost, readback, outcome] of [
    ['disconnected', false, [], 'disconnected'],
    ['still-connected', false, [account], 'still-connected'],
    ['unreadable account list', false, null, 'unconfirmed'],
    ['lost request reply and verified absence', true, [], 'disconnected'],
    ['lost request reply and account still present', true, [account], 'unconfirmed'],
    ['selected account disconnected with other account rows', false, [
      {...account, connected: false},
      {...account, connectionId: '22222222-2222-4222-8222-222222222222'},
    ], 'disconnected'],
  ]) {
    const gate = deferred(); let disconnectCalls = 0;
    const client = {
      async initiateGoogle() { return 'https://accounts.example.invalid/authorize'; },
      async gmailAccounts() {
        if (!disconnectCalls) return [account];
        await gate.promise;
        if (readback === null) throw Error('offline readback');
        return readback;
      },
      async disconnectGmail() { disconnectCalls++; if (requestLost) throw Error('response lost'); },
    };
    const binding = {client, sessionId: 'session-A', credentialId: 'credential-A'};
    const facade = helpers.createGoogleAccounts(binding, () => binding, () => {});
    const rows = await facade.list(new AbortController().signal);
    const trace = {name: `current account disconnect ${name}`, expect: {'s.revokeCalls': 0}, steps: [{label: 'canonical current account readback', action: [action('refreshAccounts'), action('readback', 1, true, true, true)], expect: {'s.account': rows.length}}]};
    const disconnecting = facade.disconnect(grant, new AbortController().signal);
    await until(() => disconnectCalls === 1, 'one remote revocation');
    trace.steps.push({label: 'one request starts before optional cleanup', action: action('disconnect'), expect: {'s.disconnectSent': true, 's.revokeCalls': disconnectCalls}});
    gate.resolve(); const result = await disconnecting;
    assert.equal(result.outcome, outcome);
    assert.deepEqual(result.accounts, readback);
    const known = result.accounts !== null;
    const selected = (result.accounts ?? rows).some(row => row.connectionId === grant && row.connected);
    trace.steps.push({
      label: 'preserve the exact outcome and whether account rows were read',
      action: [action('cleanupReply', false, true), action('disconnectReadback', result.outcome, known)],
      expect: {'s.disconnectOutcome': result.outcome, 's.disconnectRowsKnown': known,
        's.revoked': result.outcome === 'disconnected', 's.account': selected ? 1 : 0,
        's.callbackRetirement': result.calendarLifecycle.callbackRetirement},
    });
    traces.push(trace);
  }
  for (const mode of ['normal', 'stale', 'queued']) {
    const gate = deferred(), seen = []; let current = nativeBinding, listener, reads = 0;
    const port = {async subscribe(fn) { listener = fn; return {remove() {}}; }, async consume() {reads++; if(reads === 1) return gate.promise; return {result:'connected',connectionId:grant};}};
    const watcher = flow.watchGoogleWorkspaceReturn(port, nativeBinding, () => current, result => seen.push(result), () => {});
    await until(() => reads === 1, 'native consume');
    const trace = {name: `native return ${mode}`, expect: {'s.published': 0}, steps: [{label:'actual identity-ready drain starts',action:action('startDrain'),expect:{'s.drainBusy':true,'s.published':seen.length}}]};
    if(mode === 'stale') {current = {...nativeBinding,sessionId:'new'};trace.steps.push({label:'binding retires while consume is pending',action:action('switchOwner'),expect:{'s.published':seen.length}});}
    if(mode === 'queued') {listener();listener();trace.steps.push({label:'duplicate notification queues a single later drain',action:[action('queueDrain'),action('queueDrain')],expect:{'s.published':seen.length}});}
    gate.resolve(mode === 'queued' ? {result:'none'} : {result:'connected',connectionId:grant});
    await watcher.ready; await new Promise(resolve => setImmediate(resolve));
    const actions = [action('finishDrain', mode === 'queued' ? 'none' : 'connected')];
    if(mode === 'queued') actions.push(action('startDrain'),action('finishDrain','connected'));
    trace.steps.push({label:'native consumption publishes only current nonempty results',action:actions,expect:{'s.published':seen.length,'s.refreshNeeded':seen.length>0,'s.readGrant':false}});
    assert.equal(reads, mode === 'queued' ? 2 : 1); watcher.close(); traces.push(trace);
  }
  for (const retire of [false,true]) {
    const captured={client:{},environment:'production',userId:'user',organizationId:'org',sessionId:'session',credentialId:'credential'};
    let current=captured,foreground=true,refreshes=0,visibility,focus;
    const watcher=connectionReturn.watchGoogleConnectionReturn({binding:captured,current:()=>current,foreground:()=>foreground,
      refresh:()=>refreshes++,onVisibilityChange:fn=>{visibility=fn;return()=>{};},onFocus:fn=>{focus=fn;return()=>{};}});
    await watcher.ready;watcher.arm();
    const trace={name:`browser foreground return retired ${retire}`,expect:{'s.refreshNeeded':false},steps:[{label:'existing foreground event cannot prove a browser return',action:action('connect'),expect:{'s.refreshNeeded':refreshes>0}}]};
    focus();trace.steps.push({label:'focus before leaving is ignored',action:{...action('browserResume'),reject:true},expect:{'s.refreshNeeded':refreshes>0}});
    foreground=false;visibility();trace.steps.push({label:'actual background event arms a later return',action:action('background'),expect:{'s.backgrounded':!foreground}});
    if(retire){current={...captured,credentialId:'new'};trace.steps.push({label:'credential change retires pending foreground refresh',action:action('switchOwner'),expect:{'s.refreshNeeded':refreshes>0}});}
    foreground=true;focus();focus();
    trace.steps.push({label:'foreground return consumes once under the captured owner',action:retire?null:action('browserResume'),expect:{'s.refreshNeeded':refreshes===1}});
    assert.equal(refreshes,retire?0:1);watcher.close();traces.push(trace);
  }
  for (const stale of [false,true]) {
    const nonce = 'A'.repeat(43); let current = nativeBinding, cancelled = 0;
    const port = {async prepare() {if(stale)current={...current,credentialId:'new'};return {supported:true,state:nonce,redirectUrl:flow.GOOGLE_WORKSPACE_CALLBACK+'?state='+nonce};},async cancel(state) {assert.equal(state,nonce);cancelled++;}};
    let offer; try {offer=await flow.prepareGoogleWorkspaceReturn(port,nativeBinding,()=>current);}catch(error){assert.equal(error.name,'AbortError');}
    traces.push({name:`native offer stale ${stale}`,expect: {'s.published': 0},steps:[{label:'exact returned nonce is scoped to the captured credential',action:stale?[action('connect'),action('switchOwner')]:[action('connect'),action('returnOffer',true)],expect:{'s.nativeReturn':!!offer,'s.readGrant':false}}]});
    assert.equal(cancelled, stale?1:0);
  }
  for (const mode of ['confirmed','timeout','changed-source','unmapped']) {
    const destination = {connectorAccountId:'alpha-google:'+'a'.repeat(64),providerCalendarId:'primary'};
    const control = {revision:0,paused:false,destination,pendingDispatch:null};
    const review = {lease:{origin:'https://fixture.invalid',ownerId:'owner',agentId:'agent',sessionId:'session',credentialBinding:'credential',sourceGeneration:'source'}, control,
      sources:[{provider:'google',side:'owner',grantId:destination.connectorAccountId,connectorAccountId:destination.connectorAccountId,calendarId:'primary',selectionVersion:1,managedGoogleConnectionId:mode==='unmapped'?'other':grant}]};
    let current=review, requests=0, pauses=0;
    const ports = {current:()=>current,privacyCurrent(){},async revoke(){requests++;return 'confirmed';},async retireCallbacks(){},async pause(){pauses++;if(mode==='timeout')return new Promise(()=>{});if(mode==='changed-source')current={...review,lease:{...review.lease,sourceGeneration:'new'}};return {...control,revision:1,paused:true};}};
    const result=await helpers.disconnectGoogleWithCalendar({review,connectionId:grant,pauseKey:'operation',signal:new AbortController().signal,ports,pauseObservationMs:1,retirementObservationMs:1});
    const mapped=mode!=='unmapped', actions=[action('refreshAccounts'),action('readback',1,true,true,true),action('calendarReview',mapped),action('disconnect')];
    if(mode==='changed-source')actions.push(action('calendarChanged'));
    actions.push(action('cleanupReply',result.calendarPause==='confirmed',result.callbackRetirement==='confirmed'),action('disconnectReadback','disconnected',true));
    traces.push({name:`canonical optional cleanup ${mode}`,expect: {'s.revokeCalls': 0},steps:[{label:'privacy revoke progresses independently of bounded optional cleanup',action:actions,expect:{'s.revokeCalls':requests,'s.calendarPause':result.calendarPause,'s.callbackRetirement':result.callbackRetirement,'s.revoked':result.privacy==='confirmed'}}]});
    assert.equal(pauses,mapped?1:0);assert.equal(result.providerDrain,'unavailable');
  }
  return checkTraces({model:'GoogleAccounts',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'Actual account facade, native return preparer/drainer and canonical Calendar-aware disconnect execute. Native storage, OAuth delivery and Calendar service are controlled ports.',
    'A connected return only requests canonical readback. Distinct credential/session identities invalidate late native results.',
    'Optional cleanup uses real bounded timers and never proves provider drain. Full Calendar select/resume linking and UI account selection remain separate obligations.',
    'Disconnect outcome and account-list availability are observed separately. A lost write response can leave present account rows unconfirmed, and an unreadable list is never evidence of absence.'
  ]});
}
