import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mountedCalendarFixtureSources, startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';
import {checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'CalendarPreservationConfirmation';
const browserInputs = ['apps/app/src/prototype/template.html', 'apps/app/src/prototype/settings-adapter.ts',
  'apps/app/src/prototype/model.js', 'apps/app/src/runtime/agent-calendar.ts', 'apps/app/src/runtime/legacy-calendar-preservation.ts',
  'apps/app/src/browser/calendar-store.ts', 'apps/app/src/browser/documents.ts',
  '.eliza/client-features/packages/ui/src/platform/browser-document-store.ts'];

const owner = name => {
  assert.ok(['owner-a', 'owner-b'].includes(name));
  return name === 'owner-a' ? 1 : 2;
};
const session = name => {
  assert.ok(['session-a', 'session-b', 'session-c', 'session-d'].includes(name));
  return name.charCodeAt(name.length - 1) - 'a'.charCodeAt(0) + 1;
};
const validatedRead = id => [call('captureValidated', id), call('markerRead', id)];
const writeResult = id => [call('markerReceipt', id), call('dispatch', id), call('commit', id), call('markerReadback', id)];
const success = id => call('finish', id, 'success', '');
const aborted = id => call('finish', id, 'aborted', '');
const rejected = (id, notice) => call('finish', id, 'rejected', notice);

async function checkCalendarPreservationConfirmation(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...browserInputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    captureSources([path]);
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page({legacyTitle: 'Earlier retained event'});
      const fingerprints = new Map();
      const normalize = value => {
        if (!value) return 0;
        const index = fingerprints.get(value);
        assert.ok(index, 'A marker or review must refer to a captured inventory');
        return index;
      };
      async function observe() {
        const inventory = await f.invoke('inventory');
        if (!fingerprints.has(inventory)) fingerprints.set(inventory, fingerprints.size + 1);
        const s = await f.snapshot();
        for (const write of s.writes) {
          const attempt = s.attempts[write.attempt - 1];
          const key = 'alpha.calendar.retention.v1.' + createHash('sha256').update(attempt.ownerKey).digest('hex');
          assert.equal(write.key, key);
          assert.deepEqual(write.value, {version: 1, disposition: 'retained-read-only', fingerprint: attempt.review});
        }
        const notices = s.notices.map(notice => {
          if (notice === 'Saved app calendar changed; review preservation again') return 'review-changed';
          if (notice === 'Fixture marker storage failed') return 'storage-error';
          throw Error('Unexpected Calendar confirmation notice ' + notice);
        });
        const result = {'s.owner': owner(s.owner), 's.session': session(s.session),
          's.view': s.view === 'settings' && s.settingsPage === 'calendar', 's.hidden': s.hidden,
          's.inventory': normalize(inventory), 's.review': s.status === 'transition-required' ? normalize(s.fingerprint) : 0,
          's.active': s.active, 's.lastAttempt': s.attempts.length, 's.published': s.publications, 's.notices': notices,
          's.attempts': qmap(s.attempts.map(task => [task.id, {owner: owner(task.owner), session: session(task.session),
            review: normalize(task.review), stage: task.stage, result: task.result, aborted: task.aborted, expected: task.expected}])),
          's.writes': qset(s.writes.map(write => write.attempt)),
          's.committed': qset(s.writes.filter(write => write.committed).map(write => write.attempt)),
          's.markers': qmap(s.markers.map(([_key, marker]) => [owner(s.attempts[marker.receipt - 1].owner),
            {review: normalize(marker.value.fingerprint), receipt: marker.receipt}]))};
        assert.equal(await f.button('Review saved events').isVisible(), result['s.view'] && result['s.review'] !== 0);
        return result;
      }
      const t = trace(name, await observe());
      const review = f.button('Review saved events');
      const mark = async (label, action) => checkpoint(t, label, action, await observe());
      const held = id => f.page.waitForFunction(id => window.quintCalendar.held(id), id);
      const settled = id => f.page.waitForFunction(id => !!window.quintCalendar.snapshot().attempts[id - 1]?.result, id);
      const waitStatus = value => f.page.waitForFunction(value => {
        const s = window.quintCalendar.snapshot();
        return s.status === value && !s.refreshing;
      }, value);
      const open = async () => {await f.settings(); await review.waitFor(); await mark('Open the exact Settings review', call('openReview'));};
      const clickHeld = async (stage, actions, error) => {
        const gate = await f.invoke('hold', stage, error);
        await review.click();
        await held(gate);
        await mark('Click Review and hold ' + stage, actions);
        return gate;
      };
      const settle = async (gate, id, outcome) => {
        await f.invoke('release', gate);
        await settled(id);
        await mark('Release confirmation attempt ' + id, outcome);
      };
      const replace = async (name, binding, value = 'transition-required') => {
        await f.invoke('switchPort', name, binding);
        await f.status(value, binding);
        await waitStatus(value);
        await mark('Replace the exact app-record port', call('replacePort', owner(name)));
      };
      const back = () => f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
      const leave = async () => {await back();await review.waitFor({state: 'hidden'});await mark('Back retires this Settings visit', call('leaveReview'));};
      const reenter = async () => {await f.button('Calendar').click();await review.waitFor();await mark('Return to the same Settings page', call('openReview'));};
      const clickSuccess = async (id, value = 'ready') => {
        await review.click();
        await settled(id);
        await waitStatus(value);
        await mark('Current exact review commits and refreshes', [call('begin'), ...validatedRead(id), ...writeResult(id), success(id)]);
      };
      try {
        await run({f, review, mark, held, settled, waitStatus, open, clickHeld, settle, replace, leave, reenter, clickSuccess});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('exact review dispatches, commits, reads back, then refreshes', async c => {
      await c.open();
      const raw = await c.f.invoke('raw');
      const capture = await c.clickHeld('capture', call('begin'));
      const read = await c.f.invoke('hold', 'marker-read');
      await c.f.invoke('release', capture);await c.held(read);
      await c.mark('Capture validates the displayed fingerprint before marker read', validatedRead(1));
      const dispatch = await c.f.invoke('hold', 'marker-dispatch');
      await c.f.invoke('release', read);await c.held(dispatch);
      await c.mark('Absent exact marker receipt admits one compare-and-exchange', [call('markerReceipt', 1), call('dispatch', 1)]);
      const committed = await c.f.invoke('hold', 'committed-marker');
      await c.f.invoke('release', dispatch);await c.held(committed);
      await c.mark('IndexedDB commits the owner-keyed marker', call('commit', 1));
      const readback = await c.f.invoke('hold', 'marker-readback');
      await c.f.invoke('release', committed);await c.held(readback);
      await c.mark('Request exact committed marker readback', call('markerReadback', 1));
      await c.f.invoke('release', readback);await c.settled(1);await c.waitStatus('ready');
      await c.mark('Current readback refreshes Calendar', success(1));
      assert.equal(await c.f.invoke('raw'), raw);
    });
    await schedule('retired same-account port cannot dispatch before fresh review', async c => {
      await c.open();
      const gate = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)]);
      await c.replace('owner-a', 'session-b');
      await c.settle(gate, 1, aborted(1));
      await c.clickSuccess(2);
    });
    await schedule('old rejection cannot release the newer owner and duplicate tap', async c => {
      await c.open();
      const old = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)]);
      await c.replace('owner-b', 'session-b');
      const next = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(2)]);
      await c.settle(old, 1, aborted(1));
      await c.review.click();
      await c.mark('Duplicate tap leaves exactly one current attempt', null);
      await c.f.invoke('release', next);await c.settled(2);await c.waitStatus('ready');
      await c.mark('New owner writes only its own marker', [...writeResult(2), success(2)]);
    });
    await schedule('Back and same-page reentry cannot admit a held marker read', async c => {
      await c.open();
      const gate = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)]);
      await c.leave();await c.reenter();
      await c.settle(gate, 1, aborted(1));
      await c.clickSuccess(2);
    });
    await schedule('already committed same-owner marker remains available after Back', async c => {
      await c.open();
      const gate = await c.clickHeld('committed-marker', [call('begin'), ...validatedRead(1), ...writeResult(1).slice(0, 3)]);
      await c.leave();await c.reenter();
      await c.settle(gate, 1, aborted(1));
      await c.review.click();await c.settled(2);await c.waitStatus('ready');
      await c.mark('New approval reads an exact marker without overwriting it',
        [call('begin'), ...validatedRead(2), call('markerReceipt', 2), call('markerReadback', 2), success(2)]);
    });
    await schedule('retired dispatched CAS conflicts with new receipt and stays silent', async c => {
      await c.open();
      const gate = await c.clickHeld('marker-dispatch', [call('begin'), ...validatedRead(1), call('markerReceipt', 1), call('dispatch', 1)]);
      await c.replace('owner-a', 'session-b');
      await c.clickSuccess(2);
      await c.settle(gate, 1, rejected(1, ''));
    });
    await schedule('inventory changed before fresh capture must be reviewed again', async c => {
      await c.open();
      const gate = await c.clickHeld('capture', call('begin'));
      await c.f.invoke('seed', 'Replacement retained inventory');
      await c.mark('Legacy bytes change while the old capture is held', call('changeInventory'));
      await c.settle(gate, 1, rejected(1, 'review-changed'));
      await c.f.invoke('refresh');await c.waitStatus('transition-required');
      await c.mark('Re-read the current inventory', call('reload'));
      await c.clickSuccess(2);
    });
    await schedule('inventory changed after capture remains unapproved by old marker', async c => {
      await c.open();
      const gate = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)]);
      await c.f.invoke('seed', 'Replacement retained inventory');
      await c.mark('Legacy bytes change after exact capture', call('changeInventory'));
      await c.f.invoke('release', gate);await c.settled(1);await c.waitStatus('transition-required');
      await c.mark('Old marker does not approve replacement bytes', [...writeResult(1), success(1)]);
      await c.clickSuccess(2);
    });
    await schedule('hidden and visible pagehide each retire the current attempt', async c => {
      await c.open();
      const first = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)]);
      await c.f.invoke('visibility', true);
      await c.mark('Document becomes hidden', call('hide'));
      await c.settle(first, 1, aborted(1));
      await c.f.invoke('visibility', false);await c.waitStatus('transition-required');
      await c.mark('Foreground rechecks saved events', call('show'));
      const next = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(2)]);
      await c.f.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await c.mark('Visible pagehide retires the attempt', call('pageHide'));
      await c.settle(next, 2, aborted(2));
    });
    await schedule('current storage failure is visible and retryable', async c => {
      await c.open();
      const gate = await c.clickHeld('marker-read', [call('begin'), ...validatedRead(1)], 'Fixture marker storage failed');
      await c.settle(gate, 1, rejected(1, 'storage-error'));
      await c.clickSuccess(2);
    });
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['Chromium mounts Alpha Shell and Settings, executes the real Calendar adapter and controller, and reads and writes actual IndexedDB over a closed app-record port.',
      'Two synthetic owners, four exact port lifetimes and two concrete inventory fingerprints represent equality classes. Broader connection and provider behavior are checked separately.',
      'Source checkpoints group independently scheduled capture, marker read and CAS receipts around stable UI commits. Device process death and arbitrary storage failures remain outside this campaign.']}));
}

test('mounted Calendar preservation matches exact review and owner-keyed marker traces', {timeout: scaledTimeout(420_000)}, async () => {
  const receipt = await checkCalendarPreservationConfirmation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.checkpoints, 69);
});
