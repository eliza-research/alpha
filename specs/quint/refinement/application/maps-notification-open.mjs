/** Replays MapsNotificationOpen model traces against the launcher's notification-tap latch.
 *
 * What runs: createMapsNotificationOpen of apps/app/src/runtime/maps-notification-open.ts, the
 * object the Maps adapter binds to the navigation transport and the shell. Its four ports are
 * controlled: `ready` is the launcher check, `consume` is a bridge read that stays pending until
 * the trace answers it, `clear` drops the native record at once and `open` is recorded. A tap
 * writes the native record and, as the adapter's event listener does while it is installed,
 * calls `request`; Home calls `cancel`.
 *
 * Observation after every step: the native record, the launcher check, whether a read is in
 * flight and what the native side answered it, bridge reads begun, reads begun inside the
 * settlement of another read, failed reads, opens, and taps a current reply consumed without
 * opening. The latch's own `requested`, epoch and revision are private; they are observed only
 * through the reads and opens they cause, and are not compared.
 *
 * Independent of the model, every open must happen with the launcher check passing and with
 * no Home press or disposal since its read began, and no read may begin while one is in flight
 * or while the launcher check fails. */
import assert from 'node:assert/strict';
import {createMapsNotificationOpen} from '../../../../apps/app/src/runtime/maps-notification-open.ts';
import {modelTraces, replayTraces} from '../services/maps-model-traces.mjs';

const model = {path: 'specs/quint/application/MapsNotificationOpen.qnt', module: 'MapsNotificationOpen'};
const tick = () => new Promise(resolve => setImmediate(resolve));

function driver() {
  let pending = false, ready = false, disposed = false, retirements = 0, settling = false;
  let taps = 0, cancels = 0, reads = 0, chained = 0, failures = 0, opened = 0, dropped = 0;
  let flight = null;
  const control = createMapsNotificationOpen({
    ready: () => ready,
    consume() {
      assert.equal(flight, null, 'one bridge read at a time');
      assert.ok(ready && !disposed, 'the bridge is read only while Maps can be shown');
      reads++;
      if (settling) chained++;
      flight = {read: false, found: false, retirements};
      return new Promise((resolve, reject) => Object.assign(flight, {resolve, reject}));
    },
    async clear() { pending = false; },
    open() {
      assert.ok(ready, 'Maps is opened only while the launcher can show it');
      assert.ok(settling && settling.found && settling.retirements === retirements, 'Maps is opened only for a current read that found a tap');
      opened++;
    },
  });
  const act = async run => { run(); await tick(); };
  return {
    coldTap: () => act(() => { pending = true; taps++; }),
    tap: () => act(() => { pending = true; taps++; if (!disposed) control.request(); }),
    setReady: on => act(() => { ready = on; }),
    flush: () => act(() => { void control.flush(); }),
    nativeReads: () => act(() => { flight.read = true; flight.found = pending; pending = false; }),
    async readSettles(ok) {
      const settled = settling = flight, before = opened;
      flight = null;
      if (ok) settled.resolve({open: settled.found}); else { failures++; settled.reject(Error('The bridge call failed.')); }
      await tick();
      settling = false;
      if (ok && settled.found && settled.retirements === retirements && opened === before) dropped++;
    },
    cancel: () => act(() => { cancels++; retirements++; control.cancel(); }),
    dispose: () => act(() => { disposed = true; retirements++; control.dispose(); }),
    observe: () => ({pending, ready, checking: !!flight, read: !!flight?.read, found: !!flight?.found, disposed,
      taps, cancels, reads, chained, failures, opened, dropped}),
  };
}

const project = ({requested, epoch, revision, captured, attempt, ...compared}) => compared;

export async function replayMapsNotificationOpen({scenarios, witnesses, random = 120, steps = 40}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, driver, {project});
}
