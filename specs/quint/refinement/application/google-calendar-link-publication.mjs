import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, read, root, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/google-connection-ui.tsx';
const fixture = 'specs/quint/refinement/application/google-calendar-link-publication-fixture.jsx';
const panelPath = resolve(root, implementation);
const virtual = {
  '../daily': 'export const DailyApps={addListener:async()=>({remove(){}})};',
  '../native': 'export const isAndroid=false;',
  './gmail-background': "export const GMAIL_BACKGROUND_CHANGED='alpha:fixture-background'; export async function gmailBackgroundStatus(){return {}}; export function gmailBackgroundMessage(){return ''}",
  './connection-ui': `export const connectionController={
    subscribe:fn=>globalThis.googleLinkPorts.subscribe(fn), getSnapshot:()=>globalThis.googleLinkPorts.getSnapshot(),
    getCloudClient:()=>globalThis.googleLinkPorts.getCloudClient(), rejectCloudSession(){}, openCloudAccount(){throw Error('Unexpected fixture sign-in')}
  };`,
  './google-accounts': `export const GOOGLE_ACCOUNTS_CHANGED='alpha:fixture-google-accounts';
    export function notifyGoogleAccountsChanged(){window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));}
    export function createGoogleAccounts(...args){return globalThis.googleLinkPorts.createAccounts(...args)}
    export function linkGoogleCalendar(...args){return globalThis.googleLinkPorts.link(...args)}
    export function googleCalendarDisconnectLifecycle(){throw Error('Unexpected fixture disconnect')}
    export function googleDisconnectConfirmation(){return ''}
    export function googleDisconnectMessage(){return ''}`,
  './google-calendar-selection': 'export function clearGoogleCalendarSelectionForConnection(){throw Error("Unexpected fixture persistence")}',
  './native-connection': `export const googleWorkspaceReturnPort=undefined;
    export function openConnectionBrowser(...args){return globalThis.googleLinkPorts.openBrowser(...args)}`,
  './cloud-protocol': "export function cloudServiceName(){return 'Fixture Cloud'}",
  './google-agent-access': `export function googleAgentAccess(){return {calendarEdits:true,gmailChanges:false}}
    export async function publishGoogleAgentAccess(...args){return globalThis.googleLinkPorts.publishAccess(...args)}
    export function captureGoogleCalendarAccess(...args){return globalThis.googleLinkPorts.captureAccess(...args)}
    export function setGoogleAgentAccess(...args){return globalThis.googleLinkPorts.saveAccess(...args)}`,
  './browser-cloud-resident': `export let browserCloudResidentEnabled=false;
    globalThis.configureGoogleLinkHost=value=>{browserCloudResidentEnabled=value};
    export function browserResidentCall(...args){return globalThis.googleLinkPorts.browserCall(...args)}`,
};
async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [fixture], bundle: true, platform: 'browser',
    format: 'iife', write: false, metafile: true, jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}'},
    plugins: [{name: 'mounted-google-link-ports', setup(builder) {
      builder.onResolve({filter: /^\./}, args => args.importer === panelPath && Object.hasOwn(virtual, args.path)
        ? {path: args.path, namespace: 'fixture-port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'fixture-port'}, args => ({loader: 'js', contents: virtual[args.path]}));
      builder.onLoad({filter: /\/runtime\/google-connection-ui\.tsx$/}, ({path}) => {
        const source = read(path), marker = ' function accountRead(){';
        assert.equal(source.split(marker).length, 2, 'Exact mounted Google link state observer');
        return {loader: 'tsx', contents: source.replace(marker,
          ' globalThis.inspectGoogleLinkPublication=()=>({read:accountRead(),verified:verifiedAccounts.current,accounts,accountBusy,linkBusy,busy,notice,active:active.current,linking:linking.current});\n' + marker)};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<') && !path.startsWith('fixture-port:')),
    implementation, fixture, driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

const open = ['open'], close = ['close'], reload = ['reload'], sync = ['sync'], authorize = ['authorize'];
const scope = current => ['setScope', current];
const owner = ['replaceOwner', 'all'], client = ['replaceOwner', 'client'];
const readReply = (id = 1, grant = 'write') => ['readReply', id, grant];
const host = (id = 1, allow = true) => ['hostReply', id, allow];
const link = (id = 1, outcome = 'synced', revision = id) => ['linkReply', id, outcome, revision];
const loaded = [open, readReply()];
const direct = [...loaded, sync];
const consent = [open, readReply(1, 'read'), authorize, reload, readReply(2)];
const cases = [
  ['direct-link-publishes-current-review', false, [...direct, link()]],
  ['current-host-permission-admits-link', true, [...direct, host(), link()]],
  ['current-host-refusal-publishes-no-review', true, [...direct, host(1, false)]],
  ['old-result-cannot-overwrite-replacement-review-in-same-intent', false, [...direct, owner, readReply(2), sync,
    link(2), link(1, 'unconfirmed', 1)]],
  ['old-finally-keeps-replacement-account-read-busy', false, [...direct, owner, link(1, 'not-linked', 0), readReply(2)]],
  ['old-finally-keeps-replacement-link-busy', false, [...direct, owner, readReply(2), sync, link(1), link(2)]],
  ['old-host-approval-cannot-start-helper', true, [...direct, owner, host(), readReply(2), sync, host(2), link(2)]],
  ['old-host-refusal-cannot-update-replacement-intent', true, [...direct, open, sync, host(1, false), host(2), link(2)]],
  ['lost-calendar-scope-refuses-held-host-admission', true, [...direct, scope(false), host(), scope(true), sync, host(2), link(2)]],
  ['lost-calendar-scope-releases-own-busy-and-keeps-review', false, [...direct, link(), sync, scope(false),
    link(2, 'unconfirmed', 0), scope(true), sync, link(3)]],
  ['close-retires-held-link-before-new-intent', false, [...direct, close, open, readReply(2), sync, link(), link(2)]],
  ['replacement-intent-retires-held-link-without-reloading-accounts', false, [...direct, open, sync, link(), link(2)]],
  ['replacement-client-alone-retires-held-link', false, [...direct, client, link(), readReply(2), sync, link(2)]],
  ['stale-read-cannot-publish-before-current-read', false, [open, owner, readReply(1, 'read'), readReply(2), sync, link()]],
  ['failed-read-stays-unverified-until-reload', false, [open, readReply(1, 'failed'), reload, readReply(2), sync, link()]],
  ['verified-return-keeps-read-busy-through-auto-link', false, [...consent, link()]],
  ['current-host-refusal-clears-authorizing-after-return', true, [...consent, host(1, false)]],
  ['unapproved-return-keeps-authorizing-for-fresh-readback', false, [open, readReply(1, 'read'), authorize, reload,
    readReply(2, 'read'), link(1, 'needs-grant', 0), reload, readReply(3), link(2)]],
  ['needs-grant-keeps-current-retained-review', false, [...direct, link(), sync, link(2, 'needs-grant', 0)]],
  ['unconfirmed-current-result-replaces-review-with-absence', false, [...direct, link(), sync, link(2, 'unconfirmed', 0)]],
  ['close-during-account-read-keeps-late-reply-inert', false, [open, close, readReply()]],
  ['old-auto-link-finally-cannot-clear-new-owner-account-read', false, [...consent, owner, link(1, 'not-linked', 0),
    readReply(3), link(2)]],
  ['same-owner-account-reload-and-link-have-independent-busy-state', false, [...direct, reload, link(), readReply(2)]],
];

function observe(value) {
  return {...value, 's.intents': qmap(value['s.intents']), 's.reads': qmap(value['s.reads']), 's.links': qmap(value['s.links'])};
}

export async function checkGoogleCalendarLinkPublication(extraSources = []) {
  const compiled = await compile(extraSources), traces = [], errors = [];
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 412, height: 915}});
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1/' ?
      route.fulfill({contentType: 'text/html', body: '<div class="os"><button id="prior">Calendar settings</button></div><div id="root"></div>'}) :
      route.abort());
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1/');
    await page.addScriptTag({content: compiled.code});
    for (const [name, browserHost, operations] of cases) {
      const initial = await page.evaluate(mode => globalThis.googleCalendarLinkPublication.reset(mode), browserHost);
      const t = trace(name, observe(initial), call('initWith', browserHost));
      for (const [operation, ...args] of operations) {
        const state = await page.evaluate(({operation, args}) => globalThis.googleCalendarLinkPublication.step(operation, args),
          {operation, args});
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...(operation === 'replaceOwner' ? [] : args)), observe(state));
      }
      traces.push(t);
    }
    await page.evaluate(() => globalThis.googleCalendarLinkPublication.close());
    assert.deepEqual(errors, [], 'The mounted panel has no browser errors');
  } finally {await browser.close();}
  return checkTraces(boundInputs({model: 'GoogleCalendarLinkPublication', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', batchSize: 15, assumptions: [
      'Mounts the actual GoogleConnectionsPanel and return watcher in Chromium. Exact account-read, browser-host and link ports hold independent synthetic replies.',
      'Three Cloud bindings, four intents, six account reads and five link attempts. One current and retired attempt can settle in either order. The driver observes actual refs, intent review, busy flags, notice and real inert state.',
      'The mounted campaign uses a known-on Calendar access receipt and controlled OAuth/browser and provider ports. Access persistence, actual Calendar control, provider effects and disconnect remain separate.',
    ]}));
}
