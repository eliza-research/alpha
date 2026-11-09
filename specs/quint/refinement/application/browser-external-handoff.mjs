import {fileURLToPath} from 'node:url';
import {browserExternalHandoffFixture, browserExternalHandoffSources} from '../../../../test/fixtures/browser-external-handoff.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'BrowserExternalHandoff';
const modelPath = 'specs/quint/application/BrowserExternalHandoff.qnt';
const fields = fixture => Object.fromEntries(Object.entries(fixture.observe()).map(([key, value]) => [`s.${key}`, value]));

export async function checkBrowserExternalHandoff(extraSources = []) {
  const sources = [...new Set([fileURLToPath(import.meta.url), ...browserExternalHandoffSources, ...extraSources])];
  const driverHashes = captureInputs([modelPath, ...sources]);
  const traces = [];
  async function scenario(name, initial, actions) {
    const fixture = await browserExternalHandoffFixture(initial);
    const t = trace(name, fields(fixture), call(initial.privateTab ? 'initPrivate' : initial.https === false ? 'initHttp' : 'initPublic'));
    for (const [action, ...args] of actions) {
      await fixture[action](...args);
      checkpoint(t, [action, ...args].join(' '), call(action, ...args), fields(fixture));
    }
    traces.push(t);
  }
  const start = ['start'], update = ['update'], approved = ['review', true], complete = ['complete', true];
  const privateTab = {privateTab: true};
  await scenario('normal page dispatches exact shared tab guard and restores presentation', {},
    [start, update, complete, update]);
  await scenario('private approval dispatches once while duplicate actions are busy', privateTab,
    [start, update, start, approved, update, start, complete, update]);
  await scenario('private cancellation restores presentation without dispatch', privateTab,
    [start, update, ['review', false], update]);
  await scenario('a private page changed during confirmation never prepares dispatch', privateTab,
    [start, update, ['navigate', true], approved, update]);
  await scenario('same address and navigation number still require the exact renderer revision', privateTab,
    [start, update, approved, ['navigate', true], update, update]);
  await scenario('the final presentation cannot hand off from another view', {},
    [start, ['leave', true], update, update]);
  await scenario('the exact tab cannot revive a private handoff from a preceding Browser visit', privateTab,
    [start, update, approved, ['leave', true], ['leave', false], update, update]);
  await scenario('the lock screen cannot dispatch a public handoff', {},
    [start, ['lock', true], update, update]);
  await scenario('backgrounding and returning before private review retires its admission', privateTab,
    [start, ['hide', true], ['hide', false], update, update]);
  await scenario('the final presentation cannot hand off after the selected tab changes', {},
    [start, ['selectTab', 'other'], update, update, start, update, complete, update]);
  await scenario('the final presentation cannot hand off a now-loading page', {},
    [start, ['navigate', false], update, update]);
  await scenario('the final presentation cannot hand off from a hidden document', {},
    [start, ['hide', true], update, update]);
  await scenario('the final presentation cannot hand off after session disposal', privateTab,
    [start, update, approved, ['dispose'], update, update, start]);
  await scenario('normal request from an already hidden document skips dispatch preparation', {},
    [['hide', true], start, update]);
  await scenario('the synthetic chooser refusal reports failure and permits a retry', {},
    [start, update, ['complete', false], update, start, update, complete, update]);
  await scenario('non-HTTPS page is refused before preparation', {https: false},
    [start]);
  return checkTraces({model, modelPath, traces, sources, driverHashes, scope: 'bounded-component',
    assumptions: ['Execute the actual browser external handoff and the pinned shared BrowserTabSession. Presentation, review and the native bridge are closed synthetic ports. A bridge call never launches an external app.',
      'Two synthetic tabs, at most three requests, two primary document revisions and one outstanding port. No new request during the final cleanup update; duplicate requests are exercised while approval and dispatch are pending.',
      'The view, visibility, tab selection, disposal and document transition are controlled inputs. DOM review behavior, real native presentation, Android chooser dispatch and activity lifecycle require separate evidence.']});
}
