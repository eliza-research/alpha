import {fileURLToPath} from 'node:url';
import {notesTrashReadFixture, notesTrashReadSources} from '../../../../test/fixtures/notes-trash-read.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'NotesTrashReadPublication';

function fields(observation) {
  const {pending, lastWrite, ...state} = observation;
  return {...Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value])),
    's.pending': qmap(pending),
    ...Object.fromEntries(Object.entries(lastWrite).map(([key, value]) => [`s.lastWrite.${key}`, value]))};
}

export async function checkNotesTrashReadPublication() {
  const sources = [fileURLToPath(import.meta.url), ...notesTrashReadSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url))];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, events) {
    const fixture = await notesTrashReadFixture();
    const observed = trace(name, fields(fixture.observe()));
    for (const [label, action, ...args] of events) {
      await fixture[action](...args);
      checkpoint(observed, label, call(action, ...args), fields(fixture.observe()));
    }
    traces.push(observed);
  }

  const legacy = ['Select Previous notes', 'chooseSource', 'legacy'];
  const canonical = ['Return to canonical Notes', 'chooseSource', 'canonical'];
  const read = ['Dispatch the real Trash change listener', 'signal'];
  await scenario('canonical source declines a legacy trash read', [read]);
  await scenario('an older storage snapshot cannot repaint a newer result', [legacy, read, read,
    ['Newer snapshot publishes its row', 'complete', 2, 'second'],
    ['Older snapshot finishes silently', 'complete', 1, 'first']]);
  await scenario('a pending successor fences the previous error immediately', [legacy, read, read,
    ['Superseded storage error stays silent', 'complete', 1, 'error'],
    ['Current read publishes its row', 'complete', 2, 'first']]);
  await scenario('canonical mode fences an already admitted legacy result', [legacy, read, canonical,
    ['Former source result cannot write the shell', 'complete', 1, 'first']]);
  await scenario('returning to Previous notes does not revive the old source epoch', [legacy, read, canonical, legacy,
    ['Old epoch error stays silent', 'complete', 1, 'error'], read,
    ['Fresh epoch snapshot publishes normally', 'complete', 2, 'second']]);
  await scenario('the current error and later empty result are both observable', [legacy, read,
    ['Current read initially shows a row', 'complete', 1, 'first'], read,
    ['Current failure clears rows and reports the read error', 'complete', 2, 'error'], read,
    ['An authoritative empty result clears the error', 'complete', 3, 'empty']]);
  await scenario('unmount removes the listener and fences the held completion', [legacy, read,
    ['Run actual adapter unmount', 'unmount'], read,
    ['Retired shell receives no publication', 'complete', 1, 'first']]);

  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'Actual installed Trash adapter reads through controlled Promise storage and dispatches real event handlers. Observations end at its shell patch call.',
    'One shell, three read identities, at most four source selections and a controlled lifecycle. The fixture supplies source transitions consistent with the agent adapter, and React batching and installed event delivery remain separate.',
    'The read port supplies the sorted document projection. Durable storage, Trash maintenance, restore, erase and the canonical Notes controller remain separate.',
  ]});
}
