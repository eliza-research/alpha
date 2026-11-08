import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, read, root, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const fixture = 'test/fixtures/hosted-digest-refresh.jsx';
const implementation = 'apps/app/src/runtime/hosted-digest-ui.tsx';
const panelPath = resolve(root, implementation);
const ports = {
  './source-renewal-question': 'export const reviewSourceRenewalQuestion=()=>{throw Error("Unused renewal")}; export const renewalMatches=()=>false;',
  './hosted-notice-question': 'export const hostedTapResolver=()=>async run=>run(); export const reviewHostedNoticeQuestion=()=>{throw Error("Unused question")};',
  '../platform-plugins': 'export const registerPlugin=()=>({});',
  '../browser/domain-recovery': 'export const openDomainRecovery=()=>{throw Error("Unused domain recovery")};',
  '../browser/dev-profile': 'export const browserDevProfile=false;',
  '../browser/screen-locked': 'export const browserScreenLocked=()=>false;',
  '../browser/hosted-results': 'export const browserHostedResults={bind:(...args)=>globalThis.hostedDigestRefreshPorts.bind(...args)};',
  '../build-flags': 'export const devSurfacesEnabled=false, testMocksEnabled=false;',
  './local-agent': 'export const browserLocalAgentEnabled=false;',
  './hosted-background': 'export const NativeResultInbox=class {};export const configureHostedBackground=()=>{throw Error("Unused native setup")};',
  './digest-inbox': 'export const createDigestInbox=(...args)=>globalThis.hostedDigestRefreshPorts.inbox(...args);',
  '../native': 'export const isAndroid=false;',
  './cloud-delegation-ui': 'export const delegationNative={};',
  './hosted-live-source-ui': 'export const HostedLiveSourcePicker=()=>null;',
  './hosted-result-notices': `export const hostedResultNative={status:()=>globalThis.hostedDigestRefreshPorts.status(),
    addListener:async()=>({remove(){}})};
    export const publishHostedResult=()=>{throw Error('Unused publication')};
    export const resolveHostedResultTap=async()=>({kind:'none'});`,
  './connection-ui': `export const connectionController={
    subscribe:fn=>globalThis.hostedDigestRefreshPorts.subscribe(fn),
    getSnapshot:()=>globalThis.hostedDigestRefreshPorts.snapshot(),
    getWorkflowClient:()=>globalThis.hostedDigestRefreshPorts.workflow(), getCloudEnvironment:()=> 'production'};
    export const agentPendingText=()=> 'No fixture session';`,
  './cloud-protocol': 'export const cloudServiceName=()=> "Fixture Cloud";',
  './native-connection': 'export const secureConnectionStore={read:async()=>null};',
  './device-actions': 'export const actionScope=async input=>JSON.parse(input)[1];',
  '../daily': 'export const DailyApps={addListener:async()=>({remove(){}})};',
  '../browser/digest-storage': 'export const browserDigestStore=()=>{throw Error("Unused development storage")};',
  './local-agent-storage': 'export const developmentDigestStore=()=>{throw Error("Unused development storage")};',
  '../browser/development-digests': 'export const startDevelopmentDigestScheduler=()=>{throw Error("Unused development scheduler")};',
};

async function compile(extraSources) {
  captureSources([driver, fixture, implementation, ...extraSources]);
  const built = await build({absWorkingDir: root, entryPoints: [fixture], bundle: true, platform: 'browser',
    format: 'iife', write: false, metafile: true, jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}'},
    plugins: [{name: 'hosted-digest-refresh-ports', setup(builder) {
      builder.onResolve({filter: /^\./}, args => args.importer === panelPath && Object.hasOwn(ports, args.path)
        ? {path: args.path, namespace: 'fixture-port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'fixture-port'}, args => ({contents: ports[args.path]}));
      builder.onLoad({filter: /\/runtime\/hosted-digest-ui\.tsx$/}, ({path}) => {
        if (path !== panelPath) return undefined;
        const source = read(path), marker = '\tconst mounted = useRef(true);';
        assert.equal(source.split(marker).length, 2, 'Exact mounted refresh state observer');
        return {loader: 'tsx', contents: source.replace(marker, `${marker}
          globalThis.inspectHostedDigestRefresh=()=>({session:connection.session?.sessionId??'',
            binding:binding.current?.sessionId??'', open, available, message, results:results.map(row=>row.runId),
            full:refreshFlight.current?.full??null});`)};
      });
    }}]});
  const sources = [...new Set([driver, fixture, implementation, ...extraSources,
    ...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<') && !path.startsWith('fixture-port:') && !path.startsWith('node_modules/'))])];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

export async function withHostedDigestRefresh(drive, extraSources = []) {
  const compiled = await compile(extraSources);
  const browser = await chromium.launch({headless: true});
  try {
    async function scenario(execute) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url() === 'http://127.0.0.1/'
        ? route.fulfill({contentType: 'text/html', body: '<div class="os"></div><div id="root"></div>'})
        : route.abort());
      await page.routeWebSocket(/.*/, socket => socket.close());
      const command = (operation, ...args) => page.evaluate(({operation, args}) =>
        globalThis.hostedDigestRefresh[operation](...args), {operation, args});
      try {
        await page.goto('http://127.0.0.1/');
        await page.addScriptTag({content: compiled.code});
        await command('mount');
        return await execute(command);
      } finally {
        try {await command('unmount');} finally {await page.close();}
        assert.deepEqual(errors, [], 'Mounted digest panel has no uncaught browser errors');
      }
    }
    return {observations: await drive(scenario), sources: compiled.sources};
  } finally {await browser.close();}
}

const owners = [1, 2];
const parseIdentity = (value, prefix) => {
  if (!value) return 0;
  const id = owners.find(owner => value === prefix+owner);
  assert.ok(id, 'The campaign uses declared synthetic owner identities');
  return id;
};

function observe(state) {
  const pending = kind => state.requests.filter(row => row.kind === kind && !row.done);
  const sync = pending('sync'), status = pending('status');
  assert.ok(sync.length <= 1 && status.length <= 1 && state.results.length <= 1);
  assert.equal(state.binding, state.session, 'The binding setup macro ends at its held inbox history');
  assert.equal(state.full !== null, sync.length === 1);
  return {'s.session': parseIdentity(state.session, 'session-'), 's.hidden': state.hidden, 's.open': state.open,
    's.available': state.available, 's.histories': qset(pending('history').map(row => row.id)), 's.visited': qset(state.visited),
    's.statusOwner': status[0]?.id ?? 0, 's.statusFull': status[0]?.full ?? false,
    's.flightOwner': sync[0]?.id ?? 0, 's.flightMode': sync.length === 0 ? '' : state.full ? 'full' : 'results',
    's.retired': sync[0]?.aborted ?? false, 's.resultOwner': parseIdentity(state.results[0], 'run-'),
    's.briefAgent': parseIdentity(state.brief?.agent, 'Fixture agent '),
    's.fullReads': qmap(owners.map(owner => [owner, state.capabilities.filter(id => id === owner).length]))};
}

async function schedule(run, name, steps) {
  const t = trace(name, observe(await run('observe')));
  for (const [transition, ...args] of steps) {
    if (transition === 'selectSession') await run('select', ...args);
    else if (transition === 'historyReply' || transition === 'syncReply') {
      const [owner, row, ok] = args;
      await run(transition === 'historyReply' ? 'history' : 'sync', owner, row ? owner : 0, !ok);
    } else if (transition === 'statusReply') await run('status', ...args);
    else await run(transition, ...args);
    checkpoint(t, [transition, ...args].join(' '), call(transition, ...args), observe(await run('observe')));
  }
  return t;
}

export async function checkHostedDigestRefresh(extraSources = []) {
  const bind = owner => ['selectSession', owner];
  const history = (owner, row = false, ok = true) => ['historyReply', owner, row, ok];
  const sync = (owner, row = true, ok = true) => ['syncReply', owner, row, ok];
  const poll = (held = false) => ['poll', held];
  const status = (owner, allow = true) => ['statusReply', owner, allow];
  const ready = [bind(1), history(1), sync(1)];
  const open = ['open'], close = ['close'], hide = ['visibility', true], show = ['visibility', false];
  const cases = [
    ['replacement-retires-an-older-open-promotion', [...ready, poll(), open, bind(2), history(2), sync(1), sync(2)]],
    ['replacement-retires-an-older-status-poll', [...ready, poll(true), bind(2), status(1), history(2), sync(2)]],
    ['same-session-open-promotes-result-only-flight', [...ready, poll(), open, sync(1), sync(1), close]],
    ['history-from-a-retired-binding-cannot-publish', [bind(1), bind(2), history(1, true), history(2, true), sync(2)]],
    ['hide-retires-transport-and-resume-waits-for-it', [bind(1), history(1), hide, poll(), show, sync(1), sync(1)]],
    ['native-status-refusal-skips-browser-background-sync', [...ready, poll(true), status(1, false), poll(true), status(1), sync(1)]],
    ['failed-sync-preserves-current-history-and-refused-history-still-refreshes', [bind(1), history(1, true), sync(1, false, false),
      bind(2), history(2, false, false), sync(2)]],
    ['disconnect-retires-live-refresh-and-clears-the-brief', [...ready, open, bind(0), sync(1), close]],
    ['open-before-history-starts-a-full-flight-and-history-waits', [bind(1), open, history(1, true), sync(1), sync(1), close]],
  ];
  const {observations: traces, sources} = await withHostedDigestRefresh(async scenario => {
    const results = [];
    for (const [name, steps] of cases) results.push(await scenario(run => schedule(run, name, steps)));
    return results;
  }, extraSources);
  return checkTraces(boundInputs({model: 'HostedDigestRefresh', traces, sources, scope: 'bounded-orchestration', assumptions: [
    'Actual mounted browser HostedDigestPanel and retained Home store. Cloud client, inbox transport, status and timer delivery are controlled. Scope construction projects two distinct synthetic sessions.',
    'Two session lifetimes, one result row per reply, successful capability replies, and no mutation or Android setup. Four closed-panel ticks are one checkpoint. A held status poll starts while no inbox flight is pending.',
    'Queued full demand is a hidden model variable. Its outcome is compared through actual dispatch, abort, state publication and retained Home attribution.',
  ]}));
}
