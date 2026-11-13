import {fileURLToPath} from 'node:url';
import {loadWorkflowClockFixture, workflowClockSources} from '../../../../test/fixtures/workflow-clock-admission.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const fixture = 'test/fixtures/workflow-clock-admission.mjs';
const fields = state => Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value]));

export async function checkWorkflowClockAdmission(extraSources = []) {
  const sources = [...new Set([driver, fixture, ...workflowClockSources, ...extraSources, 'upstream.lock.json',
    fileURLToPath(new URL('./support.mjs', import.meta.url))])];
  const driverHashes = captureInputs(sources);
  const createFixture = await loadWorkflowClockFixture();
  const traces = [];
  async function scenario(name, run, {browser = false, mocks = false} = {}) {
    const f = createFixture(browser, mocks);
    await f.settle();
    const t = trace(name, fields(f.observe()), call('initFor', browser));
    const step = async (name, operation, ...args) => {
      await operation();checkpoint(t, name, call(name, ...args), fields(f.observe()));
    };
    const open = (source = 'chooser') => step('openClock', () => f.open(source), source === 'stale');
    const navigate = view => step(view === 'home' ? 'leave' : 'enter', () => f.navigate(view));
    const review = () => step('prepare', f.review);
    const approve = () => step('approve', f.approve);
    const opening = () => step('openingSaved', f.release);
    const finish = status => step('finish', () => f.finish(status), status);
    const remember = () => step('remember', f.remember);
    const close = (back = false) => step('closeClock', back ? f.back : f.close);
    const mock = value => step('setMock', () => f.mock(value), value);
    const visibility = value => step('setVisibility', () => f.visibility(value), value);
    const save = async () => {await open();await review();await approve();};
    try {
      await run({f, open, navigate, review, approve, opening, finish, remember, close, mock, visibility, save});
      traces.push(t);
    } finally {f.unmount();}
  }
  await scenario('actual workflow list entry publishes and settles a reviewed device handoff', async c => {
    await c.open('list');await c.review();await c.approve();await c.close();
    await c.opening();await c.finish('opened');await c.close();
  });
  await scenario('alarm chooser wins context and Back restores the underlying workflow selection', async c => {
    await c.open();await c.review();await c.close(true);
  });
  await scenario('retained opener is admitted only during the exact Workflows visit', async c => {
    await c.remember();await c.open('stale');await c.close();await c.navigate('home');c.f.assertDeparted();
    await c.open('stale');await c.navigate('workflows');await c.open('stale');await c.open();await c.close();
  });
  await scenario('departure and reentry cannot send a held opening write', async c => {
    await c.save();await c.navigate('home');await c.navigate('workflows');await c.open();
    await c.opening();await c.open();await c.close();
  });
  await scenario('an admitted result settles its exact receipt after departure without a replay', async c => {
    await c.save();await c.opening();await c.navigate('home');await c.finish('unknown');
    await c.navigate('workflows');await c.open();c.f.assertMessage(/^Unknown$/);await c.close();
  });
  for (const mocks of [false, true]) await scenario(`mock request retires a held write with the flag ${mocks ? 'on' : 'off'}`, async c => {
    await c.save();await c.mock(true);await c.opening();c.f.assertMessage(/^Not sent$/);await c.close();
  }, {mocks});
  await scenario('visibility loss retires a held write even after resuming', async c => {
    await c.save();await c.visibility(true);await c.visibility(false);await c.opening();await c.close();
  });
  await scenario('browser live entry is direct show and a retired opener cannot show again', async c => {
    await c.open();await c.remember();await c.navigate('home');await c.open('stale');
    await c.navigate('workflows');await c.open('stale');await c.open('list');
  }, {browser: true});
  await scenario('browser flag-off mock request stays in a closed review', async c => {
    await c.mock(true);await c.open();await c.review();await c.approve();
    c.f.assertMessage(/^Offline$/);await c.close();
  }, {browser: true});
  return checkTraces({model: 'WorkflowClockAdmission', scope: 'bounded-orchestration', sources, driverHashes, traces,
    assumptions: ['Bindings are read from the actual Workflows template. Its actions invoke the real Clock renderer, shell leave method, agent context projection and authenticated shared receipt code. A closed shell supplies committed routes and a synthetic current Workflow selection.',
      'The release of the opening write and the synthetic external Clock response are separate checkpoints. Two flags, a browser direct-show request, and held native-mode writes run without opening Android or browser Clock.',
      'The projection observes the selection offered to the agent client, without claiming client publication or privacy behavior. Physical modal focus, complete Scast commit timing, Android intent handling and browser alarm behavior are separate.']});
}
