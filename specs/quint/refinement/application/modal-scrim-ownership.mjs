import {fileURLToPath} from 'node:url';
import {observeModalScrim} from '../../../../test/fixtures/modal-scrim-chromium.mjs';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'ModalScrimOwnership';
const modelPath = 'specs/quint/application/'+model+'.qnt';
const driver = fileURLToPath(import.meta.url);

function modal(raw) {
  if (!raw.modal) return 'none';
  if (raw.modal === 'calendar-modal') return 'inline';
  if (!raw.topLayer) return 'nonmodal';
  return raw.phoneInert ? 'native' : 'native-only';
}

function observe(raw) {
  return {
    's.chat': raw.chat,
    's.press': !raw.press ? 'none' : raw.press.moved ? 'moved' : raw.press.released ? 'released' : 'held',
    's.pointer': raw.press?.id ?? 0,
    's.generation': raw.seen.filter(event => event.event === 'pointerdown' && event.target === 'scrim').length,
    's.modal': modal(raw),
    's.inputFocused': raw.inputFocused,
    's.draft': raw.draft === 'Retain this draft',
    's.activations': raw.activations,
    covered: raw.scrimInert || raw.phoneInert || raw.topLayer,
    capture: raw.captured, inlineInert: raw.scrimInert, phoneInert: raw.phoneInert, topLayer: raw.topLayer,
    cssPointer: raw.scrimPointer === 'auto',
  };
}

function scrimEvents(before, after) {
  return after.seen.slice(before.seen.length).filter(event => event.target === 'scrim')
    .map(event => {
      if (event.event === 'click') return call('click', event.id > 0 ? event.id : 0);
      if (event.event === 'pointerdown') return call('down', event.id);
      if (event.event === 'pointerup') return call('up', event.id);
      throw Error('Unexpected recorded scrim event '+event.event);
    });
}

function replay(row) {
  const t = trace(row.name, observe(row.initial));
  let previous = row.initial;
  const point = (label, raw, first = [], last = []) => {
    const actions = [...first, ...scrimEvents(previous, raw), ...last];
    checkpoint(t, label, actions.length ? actions : null, observe(raw));
    previous = raw;
  };
  point('Actual pointer dispatch and capture before modal or release', row.held, [],
    row.held.press?.moved ? [call('move', row.held.press.id)] : []);
  if (row.opened) point('Actual inline inert or native top layer changes coverage', row.opened, [call('open', modal(row.opened))]);
  if (row.closedEarly) point('Actual Escape closes Calendar before the old release or timeout', row.closedEarly, [call('close')]);
  if (row.sameTask) point('Modal opens and closes before the same task delivers old events', row.sameTask,
    [call('sameTaskModal', row.name.startsWith('native') ? 'native-only' : 'inline')]);
  point('Release reaches its actual hit owner', row.released);
  if (row.wrongPointer) point('A compatibility event carrying a different pointer cannot settle', row.wrongPointer);
  if (row.compatibility) point('The valid compatibility click settles without a reported pointer ID', row.compatibility);
  if (row.rearmed) point('A fresh release reuses the old pointer ID with independent authority', row.rearmed);
  const delayed = row.held.press?.released;
  point('Advance the old 350 ms compatibility deadline', row.afterWait, delayed ? [call('deadline', 1)] : []);
  if (previous.modal) point('The exact modal closes and returns focus under its own policy', row.afterClose, [call('close')]);
  if (row.fresh) point('Only a fresh press can lower the restored dock', row.fresh, row.rearmed ? [call('deadline', 2)] : []);
  return t;
}

export async function checkModalScrimOwnership(extraSources = []) {
  checkClientFeatures();
  let sources, driverHashes;
  const rows = await observeModalScrim({onInputs(inputs) {
    sources = [...inputs, 'apps/app/src/prototype/template.html', 'scripts/prepare-client-features.ts',
      '.eliza/client-features/.source.json', 'upstream.lock.json', 'package-lock.json', modelPath, driver, ...extraSources];
    driverHashes = captureInputs(sources);
  }});
  return checkTraces({model, modelPath, sources, driverHashes, traces:rows.map(replay), scope:'bounded-orchestration', assumptions:[
    'The exact motion adapter, Calendar month focus adapter, inline modal/inert helpers and phone stylesheet run in Chromium. Shell rendering and modal invocation use controlled ports. All network is closed.',
    'One raised input composer and up to two press generations. The replay checks trusted mouse and touch, controlled compatibility events and deadlines, Calendar inline and native top-layer coverage, and one nonmodal case.',
    'The synthetic shell binds the same React pointer callbacks and observes browser capture independently of the application press. Whole Alpha, other app modal entry points, half-sheet gestures and installed Android event delivery are separate.',
  ]});
}
