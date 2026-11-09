import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, read, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/google-accounts.ts';
const writeGrant = 'google.calendar.write', readGrant = 'google.calendar.read';
const ownerEmail = 'owner@fixture.invalid', secondEmail = 'second@fixture.invalid';
const noReview = {revision: -1, destination: '', paused: false, pending: '', sources: qset([])};
const unconfirmed = 'Calendar sync was not confirmed; check it before another change.';
const notSent = 'Calendar sync was not finished; nothing was sent.';
const messages = new Map([
  ['Google Calendar is not connected.', 'not-connected'],
  ['Google Calendar is read only, so sync is off. Allow Calendar changes to sync.', 'read-only'],
  ['Calendar sync was not finished.', 'stopped'],
  ['Finish or close the Calendar draft, then connect Google Calendar again.', 'draft'],
  ['Waiting for Calendar. Nothing was sent; connect Google Calendar again when Calendar is ready.', 'not-ready'],
  ['Calendar sync changed elsewhere. Ask your agent to check it; saved events are unchanged.', 'changed'],
  ['The saved Google sync calendar is unavailable. Ask your agent to check Calendar sync; saved events are unchanged.', 'missing-destination'],
  ['The saved Google sync calendar is not on the Google account approved for Calendar changes. Ask your agent to check Calendar sync; saved events are unchanged.', 'unapproved'],
  ['Calendar sync is waiting on an earlier change. Ask your agent to check Calendar sync.', 'waiting'],
  ['Ask your agent to choose the Google calendar to sync.', 'choose-primary'],
  ['Some events need a decision before they sync: Dentist, Untitled event. Ask your agent to resolve them.', 'conflict-held'],
  ['Some events need a decision before they sync: A, B, C. Ask your agent to resolve them.', 'conflict-many'],
  [unconfirmed, 'unconfirmed'],
  ['Fixture abort. ' + unconfirmed, 'unconfirmed-abort'],
  ['Fixture review failed. ' + unconfirmed, 'unconfirmed-review'],
  ['Fixture preflight refused. ' + unconfirmed, 'unconfirmed-preflight'],
  ['Fixture control transport failed. ' + unconfirmed, 'unconfirmed-transport'],
  ['Fixture links failed. ' + unconfirmed, 'unconfirmed-links'],
  ['Fixture review failed. ' + notSent, 'unsent-review'],
  ['Fixture preflight refused. ' + notSent, 'unsent-preflight'],
]);

function candidates(key) {
  const secondary = key === 'second-primary';
  return {provider: 'google', side: 'owner', grantId: secondary ? 'grant-second' : 'grant-owner',
    connectorAccountId: secondary ? 'connector-second' : 'connector-owner',
    calendarId: key, accountEmail: secondary ? secondEmail : ownerEmail, summary: 'Fixture ' + key,
    primary: key !== 'owner-team', accessRole: key === 'owner-team' ? 'writer' : 'owner',
    selectionVersion: key === 'owner-team' ? 2 : 1, includeInFeed: true};
}
const profiles = {none: [], owner: ['owner-primary'], team: ['owner-team'], second: ['second-primary'],
  both: ['owner-primary', 'second-primary'], 'owner-and-team': ['owner-primary', 'owner-team']};
function destination(key) {
  const row = candidates(key);
  return {connectorAccountId: row.connectorAccountId, providerCalendarId: row.calendarId};
}
function account(label, grantedCapabilities, connected = true) {
  return {configured: true, connected, connectionId: 'fixture-' + label.toLowerCase(), label, grantedCapabilities};
}
function grantRows(profile) {
  const ownerWrite = account(ownerEmail.toUpperCase(), [readGrant, writeGrant]);
  const secondWrite = account(secondEmail, [readGrant, writeGrant]);
  const secondRead = account(secondEmail, [readGrant]);
  return {none: [], read: [account(ownerEmail, [readGrant])], disconnected: [{...ownerWrite, connected: false}],
    owner: [ownerWrite], second: [secondWrite], both: [ownerWrite, secondWrite], mixed: [ownerWrite, secondRead]}[profile];
}
function review(revision, key, paused, pending, profile) {
  return {binding: 'fixture-current-binding', control: {revision, destination: key ? destination(key) : null, paused,
    pendingDispatch: pending ? {linkId: pending} : null}, sources: profiles[profile].map(candidates), visibleLocalEventIds: ['built-in']};
}
function linkRows(profile, key) {
  const row = (title, state, owner = key) => ({...destination(owner), state, event: title === null ? null : {title}});
  if (profile === 'held') return [row(' Dentist ', 'conflicted'), row('Clean', 'clean'),
    row(null, 'quarantined'), row('Other', 'conflicted', 'removed')];
  if (profile === 'many') return ['A', 'B', 'C', 'D'].map(title => row(title, 'conflicted'));
  if (profile === 'foreign-conflict') return [row('Unrelated', 'conflicted', 'removed'), row('Valid', 'clean')];
  return [row('Valid', 'clean')];
}

function insert(code, marker, next) {
  assert.equal(code.split(marker).length, 2, 'Exact Google Calendar link observation point');
  return code.replace(marker, next);
}
async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true, platform: 'node',
    format: 'cjs', write: false, metafile: true, define: {'import.meta.env': '{}'},
    plugins: [{name: 'google-calendar-link-observer', setup(builder) {
      builder.onLoad({filter: /\/runtime\/google-accounts\.ts$/}, ({path}) => {
        let code = read(path);
        const variables = " let sent=false,revision:number|undefined,latest:AgentCalendarSyncReview|undefined,dispatch:string|undefined;";
        code = insert(code, variables, variables + '\n __variables(()=>({sent,revision,latest,dispatch}));');
        const loop = '  for(let step=0;step<3;step++){';
        code = insert(code, loop, loop + '\n   __phase("wait-review");');
        const plan = '   const key=await linkOperationKey(owner,operation,control.revision,target.connectorAccountId,target.calendarId);';
        code = insert(code, plan, plan + '\n   __plan({owner,operation,revision:control.revision,target,key,sourceKey:calendarSourceKey(target)});\n   __phase("wait-write");');
        return {loader: 'ts', contents: code};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function fixture(compiled) {
  const module = {exports: {}}, aborter = new AbortController(), listeners = new Set(), digests = new Set();
  const plans = [], writes = [], dispatched = [];
  let grant = '', owner = 'A', current = true, canChange = true, phase = 'idle', reviews = 0, linkReads = 0;
  let read, pendingWrite, pendingLinks, result, inspect = () => ({});
  const cryptoPort = {subtle: {digest(...args) {
    const pending = crypto.subtle.digest(...args);
    digests.add(pending);
    void pending.then(() => digests.delete(pending), () => digests.delete(pending));
    return pending;
  }}};
  const planIdentity = raw => ({owner: raw.owner.slice('fixture-owner-'.length),
    operation: raw.operation, revision: raw.revision, destination: raw.target.calendarId});
  new Function('module', 'exports', 'crypto', '__variables', '__phase', '__plan', compiled.code)(
    module, module.exports, cryptoPort, get => {inspect = get;}, next => {phase = next;}, raw => {
      const exactHash = createHash('sha256').update(JSON.stringify([
        raw.owner, raw.operation, raw.revision, raw.target.connectorAccountId, raw.target.calendarId,
      ])).digest('hex');
      assert.equal(raw.key, 'alpha-calendar-connect:' + exactHash, 'Exact reviewed transition supplies the stable operation key');
      plans.push({observed: planIdentity(raw), raw});
    },
  );
  const {linkGoogleCalendar} = module.exports;
  const calendar = {
    state: {ownerKey: 'fixture-owner-A', status: 'ready', mutating: false},
    refreshing: false,
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    reviewSync() {
      reviews++;
      phase = 'review';
      read = deferred();
      return read.promise;
    },
    changeSync(captured, operation, key, fence, sourceKey, sending) {
      const latest = inspect().latest, plan = plans.at(-1);
      assert.equal(captured, latest, 'Exact most recent review reaches the mutation port');
      assert.equal(operation, plan.raw.operation);
      assert.equal(captured.control.revision, plan.raw.revision);
      assert.equal(key, plan.raw.key);
      assert.equal(sourceKey, operation === 'select' ? plan.raw.sourceKey : undefined);
      assert.equal(typeof sending, 'function');
      pendingWrite = {...deferred(), plan, fence, sending, captured};
      writes.push({...plan.observed, operation, revision: captured.control.revision});
      phase = 'write-check';
      return pendingWrite.promise;
    },
    async listLinkedEvents(signal) {
      assert.equal(signal, aborter.signal);
      linkReads++;
      phase = 'links';
      signal.throwIfAborted();
      pendingLinks = deferred();
      const records = await pendingLinks.promise;
      signal.throwIfAborted();
      return records;
    },
  };
  const scope = {calendar, current: () => current, canChange: () => canChange};
  async function flush() {
    await tick();
    await Promise.all([...digests]);
    await tick();
  }
  function projectReview(raw) {
    if (!raw) return noReview;
    const target = raw.control.destination;
    if (target) assert.deepEqual(target, destination(target.providerCalendarId));
    return {revision: raw.control.revision, destination: target?.providerCalendarId ?? '',
      paused: raw.control.paused, pending: raw.control.pendingDispatch?.linkId ?? '',
      sources: qset(raw.sources.map(row => row.calendarId))};
  }
  function projectMessage(value, state) {
    if (!value) return '';
    const summary = state.latest?.sources.find(row =>
      row.connectorAccountId === state.latest.control.destination?.connectorAccountId
      && row.calendarId === state.latest.control.destination?.providerCalendarId)?.summary;
    if (value.outcome === 'synced') {
      assert.ok(summary);
      assert.equal(value.message, 'Calendar syncs with ' + summary + ' in Google.');
      return 'synced';
    }
    if (value.outcome === 'syncing') {
      assert.ok(summary);
      assert.equal(value.message, 'Sync on. Calendar is syncing with ' + summary + ' in Google.');
      return 'syncing';
    }
    const key = messages.get(value.message);
    assert.ok(key, value.message);
    return key;
  }
  return {
    observe() {
      const state = inspect();
      if (result?.review) assert.equal(result.review, state.latest, 'Returned review keeps exact last trusted readback identity');
      assert.ok(listeners.size <= 1, 'At most one Calendar settlement waiter per link');
      return {'s.grant': grant, 's.owner': owner, 's.current': current, 's.canChange': canChange, 's.aborted': aborter.signal.aborted,
        's.status': calendar.state.status, 's.refreshing': calendar.refreshing, 's.mutating': calendar.state.mutating,
        's.phase': phase, 's.reviews': reviews, 's.sent': state.sent ?? false, 's.revision': state.revision ?? -1,
        's.latest': projectReview(state.latest), 's.pending': state.dispatch === undefined ? 'unseen' :
          state.dispatch ? JSON.parse(state.dispatch).linkId : '',
        's.plans': plans.map(plan => plan.observed), 's.writes': writes, 's.dispatched': dispatched,
        's.linkReads': linkReads, 's.outcome': result?.outcome ?? '', 's.message': projectMessage(result, state),
        's.resultReview': projectReview(result?.review), waiting: listeners.size === 1};
    },
    setCalendar(status, refreshing, mutating) {
      calendar.state.status = status;
      calendar.refreshing = refreshing;
      calendar.state.mutating = mutating;
      for (const fn of [...listeners]) fn();
      return flush();
    },
    setFence(active, draftAllowed) {current = active; canChange = draftAllowed;},
    setOwner(next) {owner = next; calendar.state.ownerKey = 'fixture-owner-' + next;},
    abort() {aborter.abort(new DOMException('Fixture abort', 'AbortError')); return flush();},
    start(profile) {
      grant = profile;
      void linkGoogleCalendar(scope, grantRows(profile), aborter.signal).then(value => {result = value; phase = 'done';});
      return flush();
    },
    reviewReply(...args) {read.resolve(review(...args)); return flush();},
    reviewFailed() {read.reject(Error('Fixture review failed')); return flush();},
    authorize() {
      const task = pendingWrite;
      if (!task.fence()) task.reject(Error('Fixture preflight refused'));
      else {
        task.sending();
        dispatched.push(task.plan.observed);
        phase = 'write';
      }
      return flush();
    },
    writeRefused() {pendingWrite.reject(Error('Fixture preflight refused')); return flush();},
    writeReply(revision) {pendingWrite.resolve({revision}); return flush();},
    writeFailed() {pendingWrite.reject(Error('Fixture control transport failed')); return flush();},
    linkReply(value) {
      if (value === 'failed') pendingLinks.reject(Error('Fixture links failed'));
      else pendingLinks.resolve(linkRows(value, inspect().latest.control.destination.providerCalendarId));
      return flush();
    },
  };
}

const start = (profile = 'owner') => ['start', profile];
const reviewReply = (revision, key = '', paused = true, pending = '', profile = 'owner') =>
  ['reviewReply', revision, key, paused, pending, profile];
const controlWrite = revision => [['authorize'], ['writeReply', revision]];
const clean = ['linkReply', 'clean'];
const select = [start(), reviewReply(0)];
const resume = [...select, ...controlWrite(1), reviewReply(1, 'owner-primary')];
const active = [start(), reviewReply(3, 'owner-primary', false)];
const cases = [
  ...['none', 'read', 'disconnected'].map(profile => ['grant-refusal-' + profile, [start(profile)]]),
  ['unique-primary-select-resume-readback', [...resume, ...controlWrite(2), reviewReply(2, 'owner-primary', false), clean]],
  ['returned-second-account-selects-only-its-own-primary', [start('second'), reviewReply(0, '', true, '', 'both'), ...controlWrite(1),
    reviewReply(1, 'second-primary', true, '', 'both'), ...controlWrite(2), reviewReply(2, 'second-primary', false, '', 'both'), clean]],
  ['existing-team-destination-resumes-without-replacement', [start(), reviewReply(3, 'owner-team', true, '', 'owner-and-team'),
    ...controlWrite(4), reviewReply(4, 'owner-team', false, '', 'owner-and-team'), clean]],
  ['already-active-sync-uses-readback-without-write', [...active, clean]],
  ['multiple-approved-primaries-need-explicit-choice', [start('both'), reviewReply(0, '', true, '', 'both')]],
  ['no-approved-primary-needs-explicit-choice', [start(), reviewReply(0, '', true, '', 'team')]],
  ['missing-saved-destination-stops', [start(), reviewReply(3, 'removed')]],
  ['saved-readonly-account-cannot-report-synced', [start('mixed'), reviewReply(3, 'second-primary', false, '', 'both')]],
  ['saved-readonly-account-cannot-resume', [start('mixed'), reviewReply(3, 'second-primary', true, '', 'both')]],
  ['newer-revision-after-select-stops', [...select, ...controlWrite(1), reviewReply(2, 'owner-primary')]],
  ['newer-revision-after-resume-stops', [...resume, ...controlWrite(2), reviewReply(3, 'owner-primary', false)]],
  ['last-read-is-read-only-even-if-still-paused', [...resume, ...controlWrite(2), reviewReply(2, 'owner-primary')]],
  ['paused-pending-dispatch-needs-review', [start(), reviewReply(3, 'owner-primary', true, 'pending-A')]],
  ['same-active-pending-dispatch-stays-unconfirmed', [start(), reviewReply(3, 'owner-primary', false, 'pending-A'),
    reviewReply(3, 'owner-primary', false, 'pending-A')]],
  ['advanced-active-dispatch-is-syncing', [start(), reviewReply(3, 'owner-primary', false, 'pending-A'),
    reviewReply(3, 'owner-primary', false, 'pending-B')]],
  ['new-resume-dispatch-reports-syncing-before-clean-links', [...resume, ...controlWrite(2),
    reviewReply(2, 'owner-primary', false, 'pending-A')]],
  ['conflict-with-an-untitled-event-blocks-synced', [...active, ['linkReply', 'held']]],
  ['four-conflicts-show-only-first-three-current-titles', [...active, ['linkReply', 'many']]],
  ['foreign-destination-conflict-does-not-block-synced', [...active, ['linkReply', 'foreign-conflict']]],
  ['helper-result-leaves-publication-to-current-caller', [...active, ['setFence', false, true], clean]],
  ['failed-link-readback-is-unconfirmed', [...active, ['linkReply', 'failed']]],
  ['draft-refuses-before-review', [['setFence', true, false], start()]],
  ['retired-owner-refuses-before-review', [['setFence', false, true], start()]],
  ['foreground-read-holds-review-until-settled', [['setCalendar', 'loading', true, false], start(),
    ['setCalendar', 'partial', false, false], reviewReply(0, 'owner-primary', false), clean]],
  ['not-ready-controller-sends-nothing', [['setCalendar', 'error', false, false], start()]],
  ['cancelled-wait-unsubscribes-without-read', [['setCalendar', 'loading', true, false], start(), ['abort'],
    ['setCalendar', 'ready', false, false]]],
  ['draft-changes-during-review-before-write', [start(), ['setFence', true, false], reviewReply(0)]],
  ['foreground-change-holds-write-until-settled', [start(), ['setCalendar', 'ready', false, true], reviewReply(0),
    ['setCalendar', 'ready', false, false], ...controlWrite(1), reviewReply(2, 'owner-primary')]],
  ['owner-retires-during-predispatch-check', [...select, ['setFence', false, true], ['authorize']]],
  ['predispatch-refusal-retains-review', [...select, ['writeRefused']]],
  ['accepted-dispatch-losing-result-has-no-current-review', [...select, ['authorize'], ['writeFailed']]],
  ['post-select-predispatch-failure-keeps-latest-review', [...resume, ['writeRefused']]],
  ['retired-while-write-settles-stops-next-review', [...select, ['authorize'], ['setFence', false, true], ['writeReply', 1]]],
  ['cancel-while-waiting-after-write-is-unconfirmed', [...select, ['authorize'], ['setCalendar', 'loading', true, false],
    ['writeReply', 1], ['abort']]],
  ['abort-before-successful-link-settlement-fails-readback', [...active, ['abort'], clean]],
  ['abort-before-link-method-admission-is-fenced-by-port', [start(), ['abort'], reviewReply(3, 'owner-primary', false)]],
  ['failed-review-without-send-is-not-linked', [start(), ['reviewFailed']]],
  ['later-failed-review-keeps-first-readback-with-no-send', [start(), reviewReply(3, 'owner-primary', false, 'pending-A'), ['reviewFailed']]],
  ['new-owner-derives-its-own-operation-key', [['setOwner', 'B'], ...select, ['authorize'], ['writeFailed']]],
];

export async function checkGoogleCalendarLinkFlow(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, steps] of cases) {
    const f = fixture(compiled), t = trace(name, f.observe());
    for (const [operation, ...args] of steps) {
      await f[operation](...args);
      checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
    }
    traces.push(t);
  }
  return checkTraces(boundInputs({model: 'GoogleCalendarLinkFlow', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', batchSize: 20, assumptions: [
      'Executes actual linkGoogleCalendar and its real hashing and settlement subscription. Controlled AgentCalendar methods expose held review, predispatch and provider replies independently.',
      'Two owners and authorized accounts, three candidate Calendar identities, three review rounds and two control writes. Result labels check exact current message text and retained review object identity.',
      'Control client preservation, owner and source revalidation are covered by AgentCalendarSyncControl. Returned helper results do not publish UI. The mounted caller owns that fence, and actual Calendar provider effects are separate.',
    ]}));
}
