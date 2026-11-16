import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadBrowserModule} from '../../../../test/fixtures/browser-source.mjs';
import {checkTraces} from '../check-traces.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';
import {browserAdapterHost} from './browser-adapter-host.mjs';
import {loadBundled} from './browser-model-traces.mjs';

const self = fileURLToPath(import.meta.url);
const turn = 'browser-agent-request';
const url = 'https://example.com/article';
const prefs = ['off', 'on', 'unreadable'];
const browserCalls = ['bookmarks', 'browsingState', 'saveBrowsingState', 'present', 'close', 'cancelReading', 'readingSupport', 'create', 'navigate'];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {resolve, promise};
}

function recorder(name, observe) {
  const trace = {name, expect:observe(), steps:[]};
  const action = (name, ...args) => ({name, args});
  return {trace, step: (...calls) => trace.steps.push({
    label:calls.map(call => call.name).join(' then '),
    action:calls.length === 1 ? calls[0] : calls,
    expect:observe(),
  }), action};
}

/** One view frame through the real renderer client, its whole installed Browser adapter and
 * the same command port used on Android. The fixture controls the server claim and ack. */
async function replayCommand(ViewNavigationClient, options) {
  const {name, native = true, preference = 'off', overlay = false, stale = false, wrongReceipt = false, acknowledge = true} = options;
  const host = await browserAdapterHost({native, instant:browserCalls});
  let client, receive, recordedResult, acknowledged = 0, readyResult = false;
  let claims = 0, grants = 0, revision = 0, asks = 'off', preferenceReads = 0;
  const claim = deferred(), result = deferred(), work = new AbortController();
  const scope = {requestId:turn, installationId:'synthetic-installation', viewId:'browser', viewType:'gui'};
  const frame = {type:'view:interact', ...scope, capability:'browser-command', params:{command:{subaction:'back'}}};
  const context = () => ({view:host.shellState.view, revision:1, sensitive:false, selectedObject:host.component.browserSelection()});
  try {
    host.rendered().onAddrKey({key:'Enter', preventDefault() {}, target:{value:url}});
    await host.sync();
    const tab = host.state().cur, session = host.session();
    const report = async () => {
      host.emit('stateChanged', {id:tab, sequence:revision + 1, navigation:'n' + revision,
        url:revision === 0 ? url : new URL('/changed', url).href, title:'Synthetic browser page', committed:true, loading:false, canBack:true, canForward:true, error:''});
      await host.sync();
    };
    await report();
    const originalNavigationRevision = Number(context().selectedObject.revision);
    client = new ViewNavigationClient(async (path, body, signal) => {
      assert.equal(signal.aborted, false);
      assert.deepEqual(body, {...scope, clientId:client.clientId, ...(path.endsWith('result') ? {
        claimId:'exact-command', success:body.success, ...(body.success ? {result:body.result} : {error:body.error}),
      } : {})});
      if (path.endsWith('claim')) {
        if (++claims !== 1) throw Error('This frame was already claimed');
        await claim.promise;
        grants++;
        return {claimId:'exact-command'};
      }
      assert.equal(path, '/api/views/interact-result');
      assert.equal(recordedResult, undefined, 'The client attempts one acknowledgment');
      recordedResult = body;
      await result.promise;
      readyResult = true;
      if (!acknowledge) throw Error('Controlled lost acknowledgment');
      acknowledged++;
      return {accepted:true};
    }, () => !work.signal.aborted, context, (_id, listener) => {
      receive = listener;
      return {ready:Promise.resolve(), close() {}};
    }, async (view, capability, params, signal, current) => {
      assert.deepEqual([view, capability], ['browser', 'browser-command']);
      return host.component.browserCommand(params.command, signal, current);
    }, async () => {
      preferenceReads++;
      if (asks === 'unreadable') throw Error('The preference is unavailable');
      return asks === 'on';
    });
    await client.ready();
    const commandCalls = () => host.calls.filter(row => row.name === 'command');
    const observe = () => {
      const sends = commandCalls(), navigation = sends.at(-1)?.input.navigation;
      return {'s.command':readyResult ? 'done' : sends.length ? 'sent' : recordedResult ? 'refused' : claims > 0 ? 'claimed' : 'none',
        's.claims':grants + Number(claims > 0 && grants === 0), 's.sends':sends.length, 's.acks':acknowledged,
        's.tabRevision':Number(context().selectedObject.revision) - originalNavigationRevision, 's.native':host.host.native, 's.overlay':!!host.state().menu,
        's.reviewFirst':asks, 's.sentRevision':navigation === undefined ? -1 : Number(navigation.substring(1))};
    };
    // The model initially describes a native foreground with its preference off.
    host.host.native = true;
    const r = recorder(name, observe);
    if (!native || overlay) {
      host.host.native = native;
      host.state().menu = overlay;
      await host.sync();
      r.step(r.action('place', native, true, overlay));
    }
    assert.ok(prefs.includes(preference));
    if (preference !== 'off') { asks = preference; r.step(r.action('prefer', asks)); }
    receive(frame);
    receive(frame);
    await host.settle();
    assert.equal(claims, 1, 'A duplicate in-flight frame cannot claim again');
    r.step(r.action('claim'));
    if (stale) {
      revision++;
      await report();
      r.step(r.action('tabNavigates'));
    }
    claim.resolve();
    await host.settle();
    if (stale || !native || overlay || asks !== 'off') {
      assert.equal(commandCalls().length, 0);
      assert.ok(recordedResult, 'A refusal settles this exact granted claim');
      if (stale) {
        assert.equal(preferenceReads, 0, 'Changed source refused before reading preference');
        assert.equal(recordedResult.success, false);
        assert.match(recordedResult.error, /outcome is unknown/);
        r.step(r.action('claimStale'));
      } else if (asks !== 'off') {
        assert.equal(recordedResult.success, false);
        assert.match(recordedResult.error, /^review-required:/);
        r.step(r.action('commandRefused'));
      } else {
        assert.equal(recordedResult.success, true, 'The renderer delivered a typed refusal');
        assert.equal(recordedResult.result.ok, false);
        assert.equal(recordedResult.result.code, 'UNAVAILABLE');
        r.step(r.action('commandUnavailable'));
      }
    } else {
      assert.equal(host.waiting('command'), 1);
      assert.deepEqual(commandCalls()[0].input, {session, id:tab, command:'back', navigation:'n' + revision});
      r.step(r.action('commandBind'), r.action('commandSend'));
      await host.settleCall('command', {value:{session, id:wrongReceipt ? 'another-tab' : tab}});
      if (wrongReceipt) {
        assert.equal(recordedResult.success, false, 'A reply for another tab cannot confirm the command');
        assert.match(recordedResult.error, /outcome is unknown/);
      } else {
        assert.deepEqual(recordedResult.result, {ok:true, data:{dispatched:true, completed:false, requiresReadback:true}});
      }
    }
    result.resolve();
    await host.settle();
    r.step(r.action('acknowledge', acknowledge));

    receive(frame);
    await host.settle();
    assert.equal(claims, 2, 'A redelivered frame needs a fresh server grant');
    assert.equal(grants, 1);
    assert.equal(commandCalls().length, stale || !native || overlay || asks !== 'off' ? 0 : 1);
    assert.equal(acknowledged, Number(acknowledge));
    return r.trace;
  } finally {
    work.abort();
    claim.resolve();
    result.resolve();
    client?.dispose();
    if (host.waiting('command')) await host.settleCall('command', {error:'Fixture closed'});
    await host.teardown();
  }
}

/** Run the real coordinator and installed Browser open/presentation components. Journal,
 * approval and receipt IO are controlled; this executor port deliberately excludes the agent
 * adapter's separate foreground fences. */
async function replayOpen(DeviceActions, browserNavigationSummary, options) {
  const {name, direct = false, hidden = false, receiptSucceeds = true, invalidScheme} = options;
  const host = await browserAdapterHost({instant:browserCalls});
  host.shellState.view = 'home';
  await host.sync();
  const signal = new AbortController().signal;
  const session = {ownerId:'owner', agentId:'agent', sessionId:'session', origin:'https://agent.invalid'};
  const device = {installationId:'device', enrollmentId:'enrollment', key:'a'.repeat(64), capabilities:[]};
  const context = {view:'home', revision:1, sensitive:false};
  const proposalId = 'browser-proposal', digest = 'b'.repeat(64);
  const address = invalidScheme === 'http' ? url.replace('https:', 'http:')
    : invalidScheme === 'userinfo' ? url.replace('https://', 'https://user@') : url;
  const operation = {type:'browser_navigate', url:address};
  const proof = direct ? {messageId:turn, text:'open ' + address, current() {}} : undefined;
  const gate = deferred(), receiptEntered = deferred();
  const original = host.state().cur, expiresAt = new Date(Date.now() + 600_000).toISOString();
  let phase = 'pending', attempt, journalEntry, summary, receiptStarted = 0, receiptReturned = false, synced = false;
  const wire = () => ({id:proposalId, digest, state:phase, subjectUserId:session.ownerId,
    requestedBy:session.agentId, action:'device_action', expiresAt,
    payload:{version:1, action:'device_action', installationId:device.installationId, enrollmentId:device.enrollmentId,
      requestMessageId:turn, operation}, ...(attempt ? {execution:{attemptId:attempt}} : {})});
  const navigate = () => host.calls.filter(call => call.name === 'navigate');
  const client = new DeviceActions(session, device, 'c'.repeat(64), async (path, body, requestSignal) => {
    requestSignal.throwIfAborted();
    if (body === undefined) return {proposals:[wire()]};
    assert.ok(path.includes(proposalId), 'Every mutation names the reviewed proposal');
    if (path.endsWith('/decision')) phase = 'approved';
    else if (path.endsWith('/claim')) { phase = 'executing'; attempt = 'browser-approval-attempt'; }
    else {
      assert.ok(path.endsWith('/receipt'), 'Only the exact receipt route can synchronize the result');
      receiptStarted++;
      assert.equal(receiptStarted, 1);
      assert.equal(journalEntry.phase, 'terminal');
      assert.equal(journalEntry.status, 'succeeded');
      assert.equal(body.attemptId, attempt);
      assert.equal(body.receipt.operationId, journalEntry.operationId);
      assert.equal(host.viewOpens.length, 0, 'Receipt upload starts before presenting the tab');
      receiptEntered.resolve();
      await gate.promise;
      receiptReturned = true;
      if (!receiptSucceeds) throw Error('The receipt response is unavailable');
      synced = true;
      phase = 'done';
    }
    return {proposal:wire(), digest};
  }, {
    async get() {
      if (client.busy && !journalEntry) r.step(r.action(direct ? 'openDirect' : 'openReviewed'));
      return {entry:journalEntry};
    },
    async reserve(input) { journalEntry = {...input, phase:'reserved'}; return {created:true, entry:journalEntry}; },
    async markApplying(input) { Object.assign(journalEntry, input, {phase:'applying'}); },
    async finish(input) { Object.assign(journalEntry, input, {phase:'terminal'}); },
    async list() { return {entries:journalEntry ? [journalEntry] : []}; },
  }, async (actual, operationId, checkedContext, currentSignal) => {
    assert.deepEqual(actual, operation);
    assert.equal(operationId, journalEntry.operationId);
    assert.deepEqual(checkedContext, context);
    const presentBrowser = await host.component.browserNavigateApproved(actual.url, currentSignal, true);
    assert.equal(host.state().cur, original, 'Creating the tab must not select it');
    summary = browserNavigationSummary(actual.url);
    r.step(r.action('execute'));
    return {status:'succeeded', summary, presentBrowser};
  });
  let approval;
  const observe = () => ({
    's.card':client.proposals.has(proposalId), 's.tab':navigate().length > 0,
    's.journal':journalEntry?.phase === 'terminal' ? 'terminal' : 'empty',
    's.receiptTried':receiptReturned, 's.synced':synced, 's.foreground':!host.page.document.hidden,
    's.presented':host.viewOpens.length > 0, 's.claimedOpened':summary === 'Opened example.com.',
  });
  const r = recorder(name, observe);
  try {
    await client.pendingReview(context, signal, proof);
    r.step(r.action('propose', invalidScheme ?? 'https', direct));
    if (invalidScheme) {
      await assert.rejects(host.component.browserNavigateApproved(address, signal, true), /Only HTTPS destinations/);
      assert.equal(navigate().length, 0);
      return r.trace;
    }
    assert.equal(client.proposals.has(proposalId), true, name);
    // The public call consumes the card synchronously before its awaited journal operations.
    approval = direct ? client.performRequested(turn, context, signal, async () => true, undefined, proof)
      : client.approve(proposalId, context, signal);
    await Promise.race([receiptEntered.promise, approval.then(() => assert.fail(name + ': approval settled before receipt upload'))]);
    assert.equal(receiptStarted, 1, 'The real coordinator is awaiting its receipt response');
    assert.equal(host.state().cur, original, 'While the receipt is held the created tab stays unselected');
    assert.equal(host.viewOpens.length, 0);
    assert.deepEqual(navigate().map(row => row.input.url), [url]);
    r.step(r.action('journalFinish'));
    if (hidden) {
      host.page.setHidden(true);
      await host.sync();
      r.step(r.action('leaveForeground'));
    }
    gate.resolve();
    const completion = await approval;
    const receipt = direct ? completion[0] : completion;
    assert.equal(receipt.status, 'succeeded');
    assert.equal(host.viewOpens.length, hidden ? 0 : 1);
    if (!hidden) {
      assert.equal(host.state().cur, navigate()[0].input.id);
      assert.deepEqual(host.viewOpens[0], ['browser', null, null, {restore:true}]);
    }
    if (receiptSucceeds) assert.equal(receipt.summary, 'Opened example.com.');
    else assert.match(receipt.summary, /^Opened example\.com\. Not synced yet/);
    r.step(r.action('receipt', receiptSucceeds), r.action(hidden ? 'presentSkipped' : 'present'));
    return r.trace;
  } finally {
    gate.resolve();
    await approval?.catch(() => {});
    await host.teardown();
  }
}


export async function checkBrowserAgentOpen(extraSources = []) {
  const driverHashes = captureReplayClosure([self, ...extraSources]);
  const traces = [];
  const load = await loadBundled('apps/app/src/runtime/view-navigation.ts');
  const {ViewNavigationClient} = await load();
  for (const options of [
    {name:'exact native tab and lost acknowledgment', acknowledge:false},
    {name:'a receipt for another tab cannot confirm the native command', wrongReceipt:true},
    {name:'owner preference keeps the command uncalled', preference:'on'},
    {name:'unreadable preference keeps the command uncalled', preference:'unreadable'},
    {name:'the web Browser has no native command admission', native:false},
    {name:'a covering Browser menu prevents native dispatch', overlay:true},
    {name:'the exact navigation changes while the claim is pending', stale:true},
  ]) traces.push(await replayCommand(ViewNavigationClient, options));
  const [{DeviceActions}, {browserNavigationSummary}] = await loadBrowserModule([
    'apps/app/src/runtime/device-actions.ts', 'apps/app/src/runtime/action-message-presentation.ts',
  ]);
  for (const options of [
    {name:'typed open waits for the held receipt', direct:true},
    {name:'reviewed open presents after an unsynced receipt attempt', receiptSucceeds:false},
    {name:'AGENT-10: successful receipt says Opened while its hidden tab stays unselected', hidden:true},
    {name:'HTTP creates no proposal card or tab', invalidScheme:'http'},
    {name:'credentialed HTTPS creates no proposal card or tab', invalidScheme:'userinfo'},
  ]) traces.push(await replayOpen(DeviceActions, browserNavigationSummary, options));
  return checkTraces({model:'BrowserAgentOpen', traces, sources:Object.keys(driverHashes), driverHashes, scope:'bounded-component',
    assumptions:[
      'The whole view navigation client and installed Browser adapter execute over synthetic tab state, server claim and receipt ports.',
      'Claim count is the capture of an in-flight or granted view claim. A replayed frame may request another grant, which the synthetic server denies. It never duplicates the native call.',
      'The real proposal coordinator drives the installed Browser in its executor port using the actual receipt formatter, with synthetic agent and durable-journal IO. The model tracks source tab creation, receipt ordering and attempted presentation. The complete agent adapter, server or Android nav host are separate.',
      'The bound/send phases run synchronously before the native call. The replay checks the exact tab, session, and navigation passed to the bridge rather than modeling Android admission internals.',
    ]});
}
