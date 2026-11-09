import {fileURLToPath} from 'node:url';
import {appearancePreferenceFixture, appearancePreferenceSources} from '../../../../test/fixtures/appearance-preference.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const model = 'AppearancePreferenceAdmission';
const fields = state => Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value]));

export async function checkAppearancePreferenceAdmission() {
  const sources = [fileURLToPath(import.meta.url), ...appearancePreferenceSources,
    fileURLToPath(new URL('./support.mjs', import.meta.url))];
  const driverHashes = captureInputs(sources);
  const traces = [];
  function scenario(name, options, run) {
    const f = appearancePreferenceFixture(options);
    const initial = f.observe();
    const t = trace(name, fields(initial), call('initFor', initial.testMocks, initial.native,
      initial.query, initial.stored, initial.system));
    const methods = {...f, changeScheme: f.scheme};
    const act = (action, label, ...args) => {
      methods[action](...args);
      checkpoint(t, label, call(action, ...args), fields(f.observe()));
    };
    run(act);
    traces.push(t);
  }
  scenario('production browser query does not suppress System updates',
    {queryTheme: 'light', initialStorage: 'system', initialScheme: 'dark'}, act => {
      act('mount', 'Mount installs browser and system listeners');
      act('commit', 'Initial System readback keeps the saved choice');
      act('changeScheme', 'The system switches to light', 'light');
      act('commit', 'The marked render follows the system without saving Light');
    });
  scenario('native preference follows System without browser listeners',
    {native: true, queryTheme: 'dark', initialStorage: 'system'}, act => {
      act('mount', 'Mount listens for native system scheme changes');
      act('pageshow', 'A browser restore event does not queue native readback');
      act('changeScheme', 'The native media query switches to dark', 'dark');
      act('commit', 'Native System redraw has no storage write');
    });
  scenario('browser key, clear and resume events read current bytes', {queryTheme: 'dark', initialStorage: 'invalid'}, act => {
    act('mount', 'Invalid storage falls back to Light');
    act('commit', 'Fallback commits without writing');
    act('storage', 'The exact preference key queues Dark', 'dark', 'key');
    act('commit', 'The exact storage event renders Dark');
    act('storage', 'A clear event reads the missing key', '', 'clear');
    act('commit', 'Clear redraws Light without creating a stored choice');
    act('storage', 'An unrelated event cannot trigger readback', 'dark', 'other');
    act('pageshow', 'Page restore reads the current Dark bytes');
    act('commit', 'Page restore redraw does not echo the preference');
  });
  scenario('batched reads cannot echo the older visual choice', {}, act => {
    act('mount', 'Initial Light read queues a marked patch');
    act('storage', 'A later Dark read queues a different marker', 'dark', 'key');
    act('storage', 'The external store advances again before commit', 'system', 'silent');
    act('commit', 'The last queued read draws Dark without overwriting System');
    act('pageshow', 'Page restore picks up the newest stored System choice');
    act('commit', 'The latest System read now draws Light without a write');
  });
  scenario('choosing System saves once and tracks later OS changes', {initialScheme: 'dark'}, act => {
    act('mount', 'Mount queues the saved Light choice');
    act('commit', 'Initial stored theme becomes shell state');
    act('choose', 'The real Settings row writes System and marks its redraw', 'system');
    act('commit', 'The marked choice does not get overwritten by Dark');
    act('changeScheme', 'A later media change queues a System redraw', 'light');
    act('commit', 'System selection and bytes survive the redraw');
  });
  scenario('an explicit shell theme supersedes a different pending marked read', {}, act => {
    act('mount', 'Initial read queues a marked Light patch');
    act('commit', 'The marked Light patch commits');
    act('pageshow', 'A later page restore queues another Light patch');
    act('explicit', 'The actual shell switch queues unmarked Dark', 'dark');
    act('commit', 'The changed explicit theme writes Dark exactly once');
    act('explicit', 'Selecting Dark again queues the same theme', 'dark');
    act('commit', 'An unchanged explicit theme does not save again');
  });
  scenario('a same-theme explicit update retains the current marked read provenance', {}, act => {
    act('mount', 'Initial read queues Light');
    act('commit', 'Initial Light read commits');
    act('storage', 'Dark read queues the current storage marker', 'dark', 'key');
    act('storage', 'The saved preference advances independently to System', 'system', 'silent');
    act('explicit', 'An explicit shell update also requests Dark', 'dark');
    act('commit', 'A matching fresh marker prevents a write back to System storage');
  });
  scenario('failed Settings save keeps its immediate preview and prior stored choice', {initialScheme: 'dark'}, act => {
    act('mount', 'Mount reads the prior saved choice');
    act('commit', 'Initial read commits');
    act('failWrites', 'The storage primitive refuses later writes');
    act('choose', 'Choosing System reports the failed save and queues Dark', 'system');
    act('commit', 'Session Dark remains visible without an implicit retry');
    act('pageshow', 'Page restore reads the last saved choice');
    act('commit', 'The saved Light choice redraws after restore');
  });
  scenario('failed explicit theme save retains only the session appearance', {native: true}, act => {
    act('mount', 'Native mount leaves the boot fallback until a source update');
    act('failWrites', 'The storage primitive refuses later writes');
    act('explicit', 'The shell requests an explicit Dark theme', 'dark');
    act('commit', 'The failed commit reports once and leaves saved Light intact');
  });
  scenario('the enabled explicit development preview ignores ambient updates',
    {testMocksEnabled: true, queryTheme: 'other', initialStorage: 'system', initialScheme: 'dark'}, act => {
      act('mount', 'An admitted query preview installs no appearance listeners');
      act('storage', 'The browser storage signal cannot change the preview', 'dark', 'key');
      act('changeScheme', 'A media query signal cannot change the preview', 'light');
      act('pageshow', 'The browser resume signal cannot change the preview');
    });
  scenario('retirement removes all appearance listeners', {initialStorage: 'system'}, act => {
    act('mount', 'Mount installs and queues the initial read');
    act('commit', 'The initial read is settled before unmount');
    act('unmount', 'The actual cleanup removes all appearance listeners');
    act('storage', 'Storage clear cannot enqueue after retirement', '', 'clear');
    act('changeScheme', 'A system change cannot enqueue after retirement', 'dark');
    act('pageshow', 'Page restore cannot enqueue after retirement');
  });

  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'Actual source fragments run with controlled storage, media query, event, and shell commit primitives.',
    'Stable startup URL and one non-fixture shell with bounded object-state batches. React scheduling and startup navigation remain outside the replay.',
    'Browser event delivery, Android WebView media queries and durable storage behavior remain platform obligations.',
  ]});
}
