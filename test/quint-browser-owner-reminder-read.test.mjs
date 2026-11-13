import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const implementation = 'apps/app/src/runtime/owner-reminder-notification-port.ts';
const driver = fileURLToPath(import.meta.url);
const model = 'BrowserOwnerReminderRead';
const start = 1893456000000;
const ids = {
  A: '00000000-0000-4000-8000-000000000001',
  B: '00000000-0000-4000-8000-000000000002',
};

function response(owner, outcome) {
  const row = {id: ids[owner], agentId: ids[owner], title: 'Fixture reminder ' + owner,
    source: 'lifeops', category: 'reminder', priority: 'normal', createdAt: start,
    readAt: outcome === 'filtered' ? start : null, expiresAt: start + 200000,
    groupKey: 'reminder:occurrence:' + ids[owner],
    data: {ownerType: 'occurrence', ownerId: ids[owner], subjectType: 'owner',
      scheduledFor: new Date(start).toISOString()}};
  if (outcome === 'invalid') row.unrecognized = true;
  return {notifications: [row], unreadCount: row.readAt === null ? 1 : 0, serviceStatus: 'ready'};
}

async function scenario(Port, name, drive) {
  let owner = '', mode = 'ready', now = 0, active, binding, notify, dispatched = 0, lastReturn = '';
  const callers = [];
  const port = new Port(() => start + now);
  const unbind = port.bind({
    binding: () => binding,
    subscribeBinding(listener) {
      notify = listener;
      return () => {notify = undefined;};
    },
  });
  const baseEpoch = port.epoch;
  const rowOwner = rows => {
    if (rows.length === 0) return '';
    assert.equal(rows.length, 1);
    const match = Object.keys(ids).find(owner => rows[0].id === ids[owner]);
    assert.ok(match);
    assert.match(rows[0].revision, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].agentId, ids[match]);
    return match;
  };
  function observe() {
    assert.equal(!!port.flight, !!active);
    const cancelled = !!active && !port.controller;
    if (cancelled) assert.ok(active.signal.aborted, 'Retirement aborts the controlled transport');
    return {'s.owner': port.binding?.key ?? '', 's.mode': mode, 's.epoch': port.epoch - baseEpoch,
      's.privacy': port.gate.foreground && port.gate.unlocked && port.gate.appEnabled && port.gate.reminderChannelEnabled,
      's.shade': port.gate.shadeOpen, 's.rows': rowOwner(port.rows), 's.status': port.status,
      's.blocked': port.blocked, 's.reads': port.reads, 's.now': now,
      's.lastRead': Number.isFinite(port.lastRead) ? port.lastRead - start : -1,
      's.flightOwner': active?.owner ?? '', 's.cancelled': cancelled,
      's.waiters': callers.filter(caller => !caller.finished).length,
      's.dispatched': dispatched, 's.lastReturn': lastReturn};
  }
  const result = trace(name, observe());
  const record = (label, action, ...args) => checkpoint(result, label, call(action, ...args), observe());
  const unexpected = () => {throw Error('Passive campaign cannot mutate or open a reminder');};
  try {
    await drive({
      owner(value) {
        owner = value;
        mode = 'ready';
        const capturedOwner = owner;
        if (!owner) binding = null;
        else {
          const exactBinding = {
            key: owner, identity: {origin: 'https://fixture.invalid', ownerId: ids[owner], agentId: ids[owner],
              sessionId: ids[owner], generation: 1},
            current: () => binding === exactBinding,
            passiveAllowed: () => binding === exactBinding && mode === 'ready',
            actionAllowed: () => binding === exactBinding && mode !== 'blocked',
            listUnread(signal) {
              assert.equal(active, undefined, 'A held transport must not dispatch a second read');
              active = {...deferred(), owner: capturedOwner, signal};
              dispatched++;
              return active.promise;
            },
            readback: unexpected, markRead: unexpected, openConversation: unexpected,
          };
          binding = exactBinding;
        }
        notify();
        record('The actual binding subscription publishes owner replacement', 'owner', value);
      },
      visibility(privacy, shade) {
        port.visibility({foreground: privacy, unlocked: privacy, appEnabled: privacy,
          reminderChannelEnabled: privacy, shadeOpen: shade});
        record('The real port recomputes shade and privacy eligibility', 'visibility', privacy, shade);
      },
      mode(value) {
        mode = value;
        notify();
        record('The owner changes passive or explicit-action eligibility', 'mode', value);
      },
      refresh() {
        port.refresh();
        record('Explicit refresh resets the visible read window', 'refresh');
      },
      advance(ms) {
        now += ms;
        record('The injected wall clock advances to the cache boundary', 'advance', ms);
      },
      async read() {
        const caller = {finished: false};
        callers.push(caller);
        caller.promise = port.list().then(value => {
          lastReturn = rowOwner(value.items);
          caller.finished = true;
        });
        await tick();
        if (caller.finished) await caller.promise;
        record('The actual list caller dispatches, joins, or returns a cached view', 'read');
      },
      async settle(outcome) {
        assert.ok(active);
        if (outcome === 'refused') active.reject(Error('Synthetic read refused'));
        else active.resolve(response(active.owner, outcome));
        await Promise.all(callers.map(caller => caller.promise));
        active = undefined;
        record('The held transport settles through actual parsing and publication', 'settle', outcome);
      },
    });
    assert.equal(active, undefined, 'The schedule drains every source request');
    return result;
  } finally {
    unbind();
  }
}

async function checkBrowserOwnerReminderRead(extraSources = []) {
  captureSources([driver, 'apps/app/src/main.tsx', ...extraSources]);
  const {exports: {OwnerReminderNotificationPort}, sources} = await bundledSource(implementation);
  const run = (name, drive) => scenario(OwnerReminderNotificationPort, name, drive);
  const shown = f => {f.owner('A'); f.visibility(true, true);};
  const traces = [
    await run('retired-owner-holds-flight-until-actual-settlement', async f => {
      shown(f); await f.read(); f.owner('B'); await f.read(); await f.settle('exact');
      await f.read(); await f.settle('exact');
    }),
    await run('same-owner-coalescing-and-five-second-cache-boundary', async f => {
      shown(f); await f.read(); await f.read(); await f.settle('exact');
      f.advance(4999); await f.read(); f.advance(1); await f.read(); await f.settle('exact');
    }),
    await run('closed-shade-reopen-joins-aborted-transport', async f => {
      shown(f); await f.read(); f.visibility(true, false); await f.read();
      f.visibility(true, true); await f.read(); await f.settle('exact'); await f.read(); await f.settle('filtered');
    }),
    await run('malformed-response-blocks-until-explicit-refresh', async f => {
      shown(f); await f.read(); await f.settle('invalid'); await f.read();
      f.refresh(); await f.read(); await f.settle('filtered');
    }),
    await run('refused-response-reopens-with-a-fresh-budget', async f => {
      shown(f); await f.read(); await f.settle('refused'); await f.read();
      f.visibility(true, false); f.visibility(true, true); await f.read(); await f.settle('exact');
    }),
    await run('busy-and-action-refusal-retire-with-different-epochs', async f => {
      shown(f); await f.read(); f.mode('busy'); await f.read(); await f.settle('refused');
      f.mode('ready'); await f.read(); f.mode('blocked'); await f.read(); await f.settle('exact');
      f.mode('ready'); await f.read(); await f.settle('exact');
    }),
    await run('privacy-loss-and-owner-detach-block-publication', async f => {
      shown(f); await f.read(); f.visibility(false, true); await f.read(); await f.settle('exact');
      f.visibility(true, true); await f.read(); f.owner(''); await f.settle('exact'); await f.read();
    }),
    await run('exact-24-read-budget-and-explicit-reset', async f => {
      shown(f);
      for (let read = 0; read < 24; read++) {
        await f.read(); await f.settle('exact'); f.advance(5000);
      }
      await f.read(); f.refresh(); await f.read(); await f.settle('exact');
    }),
  ];
  const receipt = await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-component', assumptions: [
      'The actual Alpha browser owner-reminder port, abort helper and canonical reminder parser execute.',
      'The current renderer binds the port to its selected browser owner. The list/action API has no mounted shade consumer in this source snapshot.',
      'Synthetic transport ignores the cancel until the controlled reply. The current source keeps that canceled flight until it settles. No network, credentials or write calls execute.',
    ]}));
  return {receipt, obligations: [
    {model, obligation: 'Explicit open, mark-read, and readback reconciliation',
      reason: 'The passive projection includes initial list admission and response validation. Source-aware open, uncertain markers and replay refusal form a separate component projection.'},
    {model, obligation: 'Owner-independent passive transport progress',
      reason: 'A retired or hidden read remains the sole flight until transport settlement. The new owner can join that canceled flight and receive no rows until a subsequent read.'},
  ]};
}

test('browser owner-reminder passive reads refine real owner retirement, caching and budget', {timeout: scaledTimeout(120000)}, async () => {
  const {receipt} = await checkBrowserOwnerReminderRead([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.observedFields.length, 16);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
