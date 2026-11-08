import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {captureSources, read, root} from './support.mjs';

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
