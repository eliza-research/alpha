import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, trace} from './support.mjs';

const implementation = 'apps/app/src/runtime/owner-reminder-notification-port.ts';
const driver = fileURLToPath(import.meta.url);
const model = 'BrowserOwnerReminderAction';
const start = 1893456000000;
const uuid = suffix => '00000000-0000-4000-8000-00000000000' + suffix;
const owners = {A: uuid(1), B: uuid(2)};
const conversationId = uuid(3);
const messageId = uuid(4);

function response(owner, revision = 'v1', outcome = 'unread') {
  const id = owners[owner];
  const row = {id, agentId: id, title: revision, source: 'lifeops', category: 'reminder',
    priority: 'normal', createdAt: start, readAt: outcome === 'read' ? start + 1 : null,
    groupKey: 'reminder:occurrence:' + id, deepLink: '/chat',
    data: {ownerType: 'occurrence', ownerId: id, subjectType: 'owner', conversationId, messageId,
      scheduledFor: new Date(start).toISOString()}};
  return {notifications: outcome === 'missing' ? [] : [row],
    unreadCount: outcome === 'unread' ? 1 : 0, serviceStatus: 'ready'};
}

function resultClass(error) {
  if (error.name === 'AbortError' || error.message === 'Reminder owner changed') return 'retired';
  if (error instanceof TypeError && /opened/.test(error.message)) return 'uiDetached';
  const byMessage = {
    'A reminder action is already pending': 'busy',
    'Reminder read status is unconfirmed. Refresh to check.': 'uncertain',
    'Reminder connection changed': 'unavailable',
    'Reminder is no longer available': 'gone',
    'Reminder changed': 'changed',
    'Stop voice before opening this reminder': 'voice',
    'Reminder source did not open': 'notOpened',
    'Fixture policy refused': 'policy',
    'Fixture response refused': 'refused',
  };
  const mapped = byMessage[error.message];
  if (!mapped) throw error;
  return mapped;
}

async function scenario(Port, name, drive) {
  const port = new Port(() => start);
  let binding, notify, unbindUi, held, arrival, pipeline, capturedOwner = '', wantedRevision = '';
  let wantsOpen = false, result = '', recovery, ui = 0, beforeUi = 0, openedUi = 0;
  let markCalls = 0, readbacks = 0, openCalls = 0, policyCalls = 0;
  const unbind = port.bind({
    binding: () => binding,
    subscribeBinding(listener) {
      notify = listener;
      return () => {notify = undefined;};
    },
  });
  function hold(phase, signal) {
    assert.equal(held, undefined);
    held = {...deferred(), phase, signal};
    arrival?.resolve();
    return held.promise;
  }
  function changeOwner(owner) {
    const id = owners[owner];
    const exact = {
      key: owner, identity: {origin: 'https://fixture.invalid', ownerId: id, agentId: id,
        sessionId: id, generation: 1},
      current: () => binding === exact,
      passiveAllowed: () => binding === exact,
      actionAllowed: () => binding === exact,
      listUnread: signal => port.actions.size ? hold('fresh', signal) : Promise.resolve(response(owner)),
      readback(signal) {
        readbacks++;
        if (!recovery) return hold('readback', signal);
        return recovery === 'refused' ? Promise.reject(Error('Fixture response refused')) :
          Promise.resolve(response(owner, 'v1', recovery));
      },
      markRead(markId, signal) {
        assert.equal(markId, id);
        markCalls++;
        return hold('mark', signal);
      },
      openConversation(conversation, message, signal) {
        assert.equal(conversation, conversationId);
        assert.equal(message, messageId);
        openCalls++;
        return hold('open', signal);
      },
    };
    binding = exact;
    notify();
  }
  function attachUi(value) {
    unbindUi?.();
    ui = value;
    unbindUi = ui ? port.bindUi({
      canOpen: () => true,
      beforeOpen() {beforeUi = value; port.surface(true, false);},
      opened() {openedUi = value;},
    }) : undefined;
  }
  function visibility(privacy, shade) {
    port.visibility({foreground: privacy, shadeOpen: shade, unlocked: privacy,
      appEnabled: privacy, reminderChannelEnabled: privacy});
  }
  let policyAtStart = 0;
  port.bindPolicy(() => {
    policyCalls++;
    return hold(policyCalls === policyAtStart + 1 ? 'firstPolicy' : 'lastPolicy');
  });
  changeOwner('A');
  visibility(true, true);
  attachUi(1);
  assert.equal((await port.list()).items[0].title, 'v1');

  function observe() {
    assert.ok(port.rows.length <= 1 && port.actions.size <= 1 && port.uncertain.size <= 1);
    const row = port.rows[0];
    if (row) {
      assert.equal(row.agentId, owners[port.binding.key]);
      assert.match(row.revision, /^[a-f0-9]{64}$/);
    }
    if (held?.signal && !port.actions.size) assert.ok(held.signal.aborted);
    return {'s.owner': port.binding.key, 's.capturedOwner': capturedOwner,
      's.phase': held?.phase ?? 'idle', 's.active': port.actions.size > 0,
      's.privacy': port.gate.foreground && port.gate.unlocked && port.gate.appEnabled && port.gate.reminderChannelEnabled,
      's.shade': port.gate.shadeOpen, 's.row': row?.title ?? '', 's.status': port.status,
      's.uncertain': port.uncertain.size > 0, 's.blocked': port.blocked, 's.wantsOpen': wantsOpen,
      's.wantedRevision': wantedRevision, 's.markCalls': markCalls, 's.readbacks': readbacks,
      's.openCalls': openCalls, 's.policyCalls': policyCalls, 's.ui': ui, 's.beforeUi': beforeUi,
      's.openedUi': openedUi, 's.result': result};
  }
  const schedule = trace(name, observe());
  const record = (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), observe());
  async function settle(phase, action, input, reply, error) {
    assert.equal(held?.phase, phase);
    assert.ok(pipeline);
    const old = held;
    held = undefined;
    arrival = deferred();
    if (error) old.reject(error);
    else old.resolve(reply);
    await Promise.race([arrival.promise, pipeline]);
    if (!held) {
      await pipeline;
      pipeline = undefined;
      capturedOwner = '';
      wantsOpen = false;
      wantedRevision = '';
    }
    arrival = undefined;
    record('A held source call settles through the actual action pipeline', action, input);
  }
  try {
    await drive({
      async begin(open, revision = 'v1') {
        const displayed = port.rows.find(row => row.title === revision);
        const owner = binding.key;
        const before = held;
        const promise = port.act({id: owners[owner], revision: displayed?.revision ?? 'invalid'}, open)
          .then(value => {result = value;}, error => {result = resultClass(error);});
        if (!before && held) {
          capturedOwner = owner;
          wantsOpen = open;
          wantedRevision = revision;
          policyAtStart = policyCalls;
          pipeline = promise;
        } else await promise;
        record('Explicit action admits the exact displayed revision or refuses immediately', 'begin', open, revision);
      },
      fresh(outcome = 'v1') {
        return settle('fresh', 'fresh', outcome, response(capturedOwner, outcome,
          outcome === 'missing' ? 'missing' : 'unread'), outcome === 'refused' ? Error('Fixture response refused') : undefined);
      },
      policy(ok = true) {
        assert.ok(['firstPolicy', 'lastPolicy'].includes(held?.phase));
        return settle(held.phase, 'policy', ok, undefined, ok ? undefined : Error('Fixture policy refused'));
      },
      opened(ok = true) {return settle('open', 'opened', ok, {opened: ok});},
      acknowledge(outcome) {
        const ack = outcome === 'exact' ? {ok: true} : outcome === 'extra' ? {ok: true, extra: true} : {ok: false};
        return settle('mark', 'acknowledge', outcome, ack, outcome === 'refused' ? Error('Fixture response refused') : undefined);
      },
      readback(outcome) {
        return settle('readback', 'readback', outcome, response(capturedOwner, 'v1', outcome),
          outcome === 'refused' ? Error('Fixture response refused') : undefined);
      },
      async recover(outcome) {
        recovery = outcome;
        port.refresh();
        await port.list();
        recovery = undefined;
        record('Explicit refresh reads back the unresolved ID without a mutation', 'recover', outcome);
      },
      owner(owner) {
        changeOwner(owner);
        record('The current source owner is replaced while held work settles separately', 'owner', owner);
      },
      visibility(privacy, shade) {
        visibility(privacy, shade);
        record('Shade close and loss of privacy have different action semantics', 'visibility', privacy, shade);
      },
      attachUi(value) {
        attachUi(value);
        record('The current UI callback object is replaced or detached', 'attachUi', value);
      },
      async seed() {
        port.refresh();
        assert.equal((await port.list()).items[0].title, 'v1');
        record('The replacement owner fetches a reviewed reminder', 'seed');
      },
    });
    assert.equal(held, undefined);
    return schedule;
  } finally {
    unbindUi?.();
    unbind();
  }
}

export async function checkBrowserOwnerReminderAction(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const {exports: {OwnerReminderNotificationPort}, sources} = await bundledSource(implementation);
  const run = (name, drive) => scenario(OwnerReminderNotificationPort, name, drive);
  const toMark = async f => {await f.begin(false); await f.fresh(); await f.policy(); await f.policy();};
  const toOpen = async f => {await f.begin(true); await f.fresh(); await f.policy();};
  const traces = [
    await run('exact-dismiss-and-duplicate-action-refusal', async f => {
      await toMark(f); await f.begin(false); await f.acknowledge('exact');
    }),
    await run('changed-or-missing-reminder-never-dispatches', async f => {
      await f.begin(false, 'v2'); await f.begin(false); await f.fresh('v2');
      await f.begin(false, 'v2'); await f.fresh('missing'); await f.seed();
      await f.begin(false); await f.fresh('refused');
    }),
    await run('malformed-ack-stays-uncertain-until-exact-readback', async f => {
      await toMark(f); await f.acknowledge('extra'); await f.readback('unread');
      await f.begin(false); await f.recover('refused'); await f.recover('unread'); await f.recover('read');
    }),
    await run('normal-open-closes-shade-and-recovers-lost-acknowledgement', async f => {
      await toOpen(f); await f.opened(); await f.policy(); await f.acknowledge('refused'); await f.readback('read');
    }),
    await run('late-open-callback-uses-replacement-ui', async f => {
      await toOpen(f); f.attachUi(2); await f.opened(); await f.policy(false);
    }),
    await run('detached-ui-prevents-mark-read-after-open', async f => {
      await toOpen(f); f.attachUi(0); await f.opened(); f.visibility(true, true);
      await f.begin(true);
    }),
    await run('initial-policy-and-open-refusal-have-no-mutation', async f => {
      await f.begin(true); await f.fresh(); await f.policy(false); await toOpen(f); await f.opened(false);
    }),
    await run('privacy-loss-during-mark-keeps-the-uncertainty-marker', async f => {
      await toMark(f); f.visibility(false, true); await f.acknowledge('exact');
      f.visibility(true, true); await f.begin(false); await f.recover('read');
    }),
    await run('replacement-owner-cannot-consume-retired-mark-reply', async f => {
      await toMark(f); f.owner('B'); await f.acknowledge('exact'); await f.seed();
      await toMark(f); await f.acknowledge('false'); await f.readback('missing');
    }),
    await run('shade-close-alone-does-not-retire-explicit-review', async f => {
      await f.begin(false); f.visibility(true, false); await f.fresh(); await f.policy();
      await f.policy(); await f.acknowledge('false'); await f.readback('refused');
    }),
  ];
  const receipt = await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-component', assumptions: [
      'The actual owner-reminder port parses synthetic canonical responses, runs exact review and invokes controlled UI, policy and transport ports.',
      'The renderer has no mounted consumer for this component API. All opens and read mutations are synthetic callbacks, with one held explicit operation and one row per reply.',
      'Passive single-flight admission and caching use their own source projection. Server read effects, actual history restoration and any mounted notice UI remain separate.',
    ]}));
  return {receipt, obligations: [
    {model, obligation: 'Opening completion identity after replacement UI',
      reason: 'The source captures no UI token across the open await. The latest bound UI receives opened, or a detached UI makes the promise reject before marking read.'},
  ]};
}
