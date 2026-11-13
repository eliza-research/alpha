import {fileURLToPath} from 'node:url';
import {previousNotesSourceOpeningFixture, previousNotesSourceOpeningSources} from '../../../../test/fixtures/previous-notes-source-opening.mjs';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'PreviousNotesSourceOpening';
function fields(fixture) {
  const {retention, retired, pending, finished, ...state} = fixture.observe();
  return Object.fromEntries(Object.entries({...state, retention: qset(retention), retired: qset(retired),
    pending: qmap(pending), finished: qmap(finished)}).map(([key, value]) => [`s.${key}`, value]));
}

export async function checkPreviousNotesSourceOpening(extraSources = []) {
  const sources = [...new Set([fileURLToPath(import.meta.url), ...previousNotesSourceOpeningSources, ...extraSources])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, device, actions) {
    const fixture = previousNotesSourceOpeningFixture(device);
    const t = trace(name, fields(fixture), call(device ? 'initDevice' : 'initBrowser'));
    for (const [action, ...args] of actions) {
      await fixture[action](...args);
      checkpoint(t, [action, ...args].join(' '), call(action, ...args), fields(fixture));
    }
    traces.push(t);
  }
  const legacy = ['choose', 'legacy'];
  const canonical = ['choose', 'canonical'];
  const browserReady = [legacy, ['settle', 1, 'saved'], ['settle', 1, 'target']];
  const deviceDraft = [...browserReady.slice(0, 2), ['settle', 1, 'saved'], browserReady[2]];
  await scenario('a retired browser open cannot report the later epoch success', false,
    [legacy, canonical, legacy, ['settle', 3, 'saved'], ['settle', 3, 'target'], ['settle', 1, 'saved']]);
  await scenario('source selection waits for the exact pending draft retention', false,
    [['startRetention', 1], legacy, ['finishRetention', 1], ['settle', 1, 'absent']]);
  await scenario('an older retention settlement cannot displace the latest task', false,
    [['startRetention', 1], legacy, ['startRetention', 2], ['finishRetention', 1],
      legacy, ['finishRetention', 2], ['settle', 2, 'saved'], ['settle', 2, 'target']]);
  await scenario('owner change while draft retention is pending refuses the old selection', false,
    [['startRetention', 1], legacy, ['changeOwner', 'b'], ['finishRetention', 1]]);
  await scenario('an owner change drops an in-flight empty collection fingerprint', false,
    [legacy, ['settle', 1, 'empty'], ['changeOwner', 'b'], ['settle', 1, 'fingerprint']]);
  await scenario('a browser record without a native target publishes its retained namespace', false,
    [legacy, ['settle', 1, 'saved'], ['settle', 1, 'none'], ['settle', 1, 'fingerprint'], canonical]);
  await scenario('a browser read failure routes to recovery without visible rows', false,
    [legacy, ['settle', 1, 'failed'], canonical]);
  await scenario('native draft metadata is admitted without applying the retained draft', true,
    [...deviceDraft, ['settle', 1, 'kept'], canonical]);
  await scenario('a native draft error leaves saved rows visible and read-only', true,
    [...deviceDraft, ['settle', 1, 'failed'], canonical]);
  await scenario('a retired native draft read cannot repopulate the canonical source', true,
    [...deviceDraft, ['changeOwner', 'b'], ['settle', 1, 'kept']]);
  await scenario('native draft-only storage asks for review without initializing a collection', true,
    [legacy, ['settle', 1, 'absent'], ['settle', 1, 'kept'], canonical]);
  await scenario('native absence and unreadable draft presence stay distinct', true,
    [legacy, ['settle', 1, 'absent'], ['settle', 1, 'clean'], canonical,
      legacy, ['settle', 3, 'absent'], ['settle', 3, 'failed']]);
  await scenario('canonical return refuses to discard an unretained edit', false,
    [...browserReady, ['failEdit', false], canonical]);
  await scenario('confirmed retained edit permits canonical return', false,
    [...browserReady, ['failEdit', true], canonical, canonical]);
  return checkTraces({model, traces, sources, driverHashes, scope: 'bounded-component',
    assumptions: ['Execute actual Previous Notes renderer selection, owner retirement, observation and read-only admission functions with closed collection, draft, note target and fingerprint ports.',
      'Two synthetic owners, three selections, two externally supplied retention tasks and at most one waiting selection per task. Selected transitions abstract React commits, recording and unrelated in-flight write/review guards.',
      'Storage projections preserve synthetic record identities and reject any write. Physical storage, canonical controller internals, draft writing, presence probing, Trash and mounted device behavior remain separate.']});
}
