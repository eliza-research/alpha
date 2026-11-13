import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {mountGoogleAccountPanel} from './fixtures/google-account-panel.mjs';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const panel = 'apps/app/src/runtime/google-connection-ui.tsx';
const fixturePath = 'test/fixtures/google-account-panel.mjs';
const noChoice = {owner: 0, intent: 0, read: 0, kind: ''};
const notices = new Map([
  ['', ''], ['Calendar includes the calendars you show in Google.', 'calendar-includes'],
  ['Connecting Calendar with Google…', 'connecting'],
  ['Edits off', 'off-choice'],
  ['Edits unknown', 'unreadable-choice'],
  ['Couldn’t read', 'unreadable-save'],
  ['Couldn’t verify', 'unverified'],
  ['Waiting for Google…', 'authorization'], ['Fixture Calendar synced', 'synced'],
]);

async function compile(extraSources) {
  const sources = [panel, fixturePath, driver, ...extraSources];
  captureSources(sources);
  const dependencies = {};
  for (const [key, path] of Object.entries({cloudProtocol: 'cloud-protocol', connectionReturn: 'google-connection-return',
    workspaceReturn: 'google-workspace-return', gmailGrants: 'gmail-grants', calendarLink: 'google-accounts'})) {
    const module = await bundledSource('apps/app/src/runtime/' + path + '.ts', {'import.meta.env': '{}'});
    dependencies[key] = module.exports;
    sources.push(...module.sources);
  }
  dependencies.cloudServiceName = dependencies.cloudProtocol.cloudServiceName;
  return {sources, dependencies};
}

async function fixture(compiled, saved) {
  const reads = new Map(), captures = new Map(), intents = [], saves = [], links = [], consents = [];
  const rowReads = new WeakMap();
  let nextGrant = 'read', trigger, consentIntent = 0;
  let p;
  const observe = () => p.inspectAdmission();
  const ownerOf = binding => binding.credentialId === 'cloud-credential' ? 1 : 2;
  const owner = () => ownerOf(p.currentBinding());
  const intentOf = raw => intents.findIndex(intent => intent === raw) + 1;
  const readOf = raw => raw ? rowReads.get(raw.rows) ?? 0 : 0;
  const port = {
    ...compiled.dependencies.calendarLink,
    async linkGoogleCalendar(scope, rows, signal) {
      const read = observe().read;
      assert.ok(read && scope.current() && !signal.aborted);
      assert.ok(rows.length && rows.every(row => read.rows.includes(row)),
        'Mounted link admission uses the exact verified rows');
      const id = readOf(read);
      assert.equal(reads.get(id).grant, 'write');
      links.push(id);
      return {outcome: 'synced', message: 'Fixture Calendar synced'};
    },
  };
  p = await mountGoogleAccountPanel([], {calendarEdits: saved, observeAdmission: true},
    {...compiled.dependencies, calendarLink: port});
  p.onList = binding => {
    const id = reads.size + 1, source = ownerOf(binding), grant = nextGrant;
    const rows = [{configured: true, connected: true, connectionId: 'fixture-owner-' + source,
      label: 'owner-' + source + '@fixture.invalid', grantedCapabilities: [
        'google.calendar.read', 'google.gmail.triage', ...(grant === 'write' ? ['google.calendar.write'] : []),
      ]}];
    reads.set(id, {owner: source, grant});
    rowReads.set(rows, id);
    return rows;
  };
  p.onCapture = () => {
    if (!trigger) return;
    const {stage, context} = trigger;
    trigger = undefined;
    const task = {...deferred(), stage, context, settled: false};
    captures.set(captures.size + 1, task);
    return task.promise;
  };
  p.onConsent = (binding, calendarPermission, gmailPermission) => {
    const id = readOf(observe().read);
    assert.equal(ownerOf(binding), owner());
    assert.equal(calendarPermission, 'write');
    assert.equal(gmailPermission, 'read');
    assert.equal(reads.get(id).grant, 'read');
    assert.equal(p.controller.calendar().authorizing, true);
    consentIntent = intentOf(p.controller.calendar());
    consents.push(id);
  };
  function projectChoice(choice) {
    if (!choice) return noChoice;
    const id = readOf(choice.read);
    assert.ok(id, 'Rendered choice retains its exact verified read object');
    if (choice.rows) assert.ok(choice.rows.every(row => choice.read.rows.includes(row)));
    return {owner: reads.get(id).owner, intent: intentOf(choice.calendar), read: id, kind: choice.rows ? 'link' : 'consent'};
  }
  function context() {
    const read = readOf(observe().read);
    assert.ok(read);
    return {owner: owner(), intent: intentOf(p.controller.calendar()), read, kind: reads.get(read).grant === 'write' ? 'link' : 'consent'};
  }
  function click(label) {
    const button = p.button(label);
    assert.ok(button && !button.disabled, label);
    button.click();
  }
  async function drive(action) {
    const previous = p.accessChanges.length;
    await p.act(action);
    for (const change of p.accessChanges.slice(previous)) {
      assert.deepEqual({...change}, {calendarEdits: true});
      const read = readOf(observe().read);
      assert.ok(read, 'Each observed native access save belongs to a current verified read');
      saves.push(read);
    }
  }
  return {
    observe() {
      const seen = observe(), notice = notices.get(seen.notice);
      assert.notEqual(notice, undefined, seen.notice);
      return {'s.owner': owner(), 's.intent': intentOf(p.controller.calendar()), 's.lastIntent': intents.length,
        's.read': readOf(seen.read), 's.lastRead': reads.size, 's.reads': qmap([...reads]),
        's.saved': p.access.calendarEdits, 's.choice': projectChoice(seen.choice),
        's.lastCapture': captures.size, 's.captures': qmap([...captures].map(([id, task]) =>
          [id, {context: task.context, stage: task.stage, settled: task.settled}])),
        's.consentIntent': consentIntent, 's.saves': saves, 's.links': links, 's.consents': consents, 's.notice': notice,
        choiceVisible: !!p.button('Allow Calendar changes'), busy: p.controller.getSnapshot() && seen.busy};
    },
    open(grant) {
      nextGrant = grant;
      return drive(() => {
        p.controller.openCalendar({calendar: {}, current: () => true, canChange: () => true});
        intents.push(p.controller.calendar());
      });
    },
    close() {return drive(() => click('Close Google accounts'));},
    reload(grant) {nextGrant = grant; return p.dispatch('alpha:test-google-accounts');},
    replaceOwner(grant) {nextGrant = grant; return drive(p.replaceCloud);},
    requestAccess() {
      const captured = context();
      trigger = {stage: 'ask', context: captured};
      return drive(() => click(captured.kind === 'link' ? 'Sync Calendar with Google' : 'Connect Google Calendar'));
    },
    allow() {
      trigger = {stage: 'allow', context: projectChoice(observe().choice)};
      return drive(() => click('Allow Calendar changes'));
    },
    reply(id, readable) {
      const task = captures.get(id);
      assert.ok(task && !task.settled);
      task.settled = true;
      p.unreadable = !readable;
      return drive(() => task.resolve());
    },
    async destroy() {
      await p.act(() => {
        p.controller.close();
        for (const task of captures.values()) if (!task.settled) task.resolve();
      });
      await p.close();
    },
  };
}

const open = (grant = 'write') => ['open', grant];
const owner = (grant = 'read') => ['replaceOwner', grant];
const reload = (grant = 'read') => ['reload', grant];
const ask = ['requestAccess'], allow = ['allow'], close = ['close'];
const reply = (id, readable = true) => ['reply', id, readable];
const choice = [open(), ask, reply(1)];
const cases = [
  ['fresh-write-choice-admits-exact-two-guarded-saves-and-link', false, [...choice, allow, reply(2)]],
  ['replacement-read-only-withdraws-old-choice', false, [...choice, owner()]],
  ['fresh-replacement-write-review-owns-re-admission', false, [...choice, owner(), ask, reply(2),
    reload('write'), ask, reply(3), allow, reply(4)]],
  ['replacement-read-only-choice-continues-consent-only', false, [...choice, owner(), ask, reply(2), allow, reply(3)]],
  ['newer-same-owner-read-retires-held-allow-before-native-save', false, [...choice, allow, reload(), reply(2)]],
  ['owner-change-retires-held-allow-before-native-save', false, [...choice, allow, owner(), reply(2)]],
  ['owner-change-retires-held-ask-before-choice-publication', false, [open(), ask, owner(), reply(1)]],
  ['newer-same-owner-read-retires-held-ask-before-choice-publication', false, [open(), ask, reload(), reply(1)]],
  ['replacement-intent-with-same-account-read-needs-fresh-choice', false, [...choice, open(), ask, reply(2), allow, reply(3)]],
  ['replacement-intent-fences-held-ask', false, [open(), ask, open(), reply(1)]],
  ['close-and-reopen-retires-held-allow', false, [...choice, allow, close, open(), reply(2), ask, reply(3), allow, reply(4)]],
  ['unreadable-access-prompts-but-unreadable-allow-saves-nothing', false, [open(), ask, reply(1, false), allow, reply(2, false)]],
  ['fresh-readable-allow-can-complete-after-unreadable-prompt', false, [open(), ask, reply(1, false), allow, reply(2)]],
  ['known-on-current-write-review-links-directly', true, [open(), ask, reply(1)]],
  ['known-on-current-read-only-review-goes-to-consent', true, [open('read'), ask, reply(1)]],
  ['old-allow-reply-keeps-the-replacement-choice-visible', false, [...choice, allow, owner('write'), ask, reply(3),
    reply(2), allow, reply(4)]],
  ['close-while-ask-is-held-retires-late-choice', false, [open(), ask, close, reply(1)]],
];

async function checkGoogleCalendarAccessChoice(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, saved, operations] of cases) {
    const f = await fixture(compiled, saved);
    try {
      const t = trace(name, f.observe(), call('initWith', saved));
      for (const [operation, ...args] of operations) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {await f.destroy();}
  }
  return checkTraces(boundInputs({model: 'GoogleCalendarAccessChoice', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', assumptions: [
      'The actual mounted React panel uses held access receipts and current readback. The driver observes exact row and Calendar intent object identities, retained and visible choice, access saves, consent and link admission.',
      'Two Cloud bindings, four Calendar intents, six verified reads and six permission captures. A current write grant can link; a read-only grant continues to synthetic consent. Post-consent return has separate scope.',
      'Native access persistence and external Google effects are controlled interfaces, with no live provider calls.',
    ]}));
}

test('Calendar access choice belongs to the exact verified account read and current intent', {timeout: 120000}, async () => {
  const receipt = await checkGoogleCalendarAccessChoice([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.checkpoints, 118);
});
