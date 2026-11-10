import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {sourcePaths, filesWithin, relativePath} from '../../../../scripts/quint-lib.ts';
import {flagOffAndroid, fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {residentStub, setStub} from '../../../../test/browser/resident-stub.ts';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const self = fileURLToPath(import.meta.url);
const stepTimeout = 45_000;
// Each fresh browser context loads the module graph before the shell can establish a session.
const mountTimeout = 120_000;

/** Mount the real application and observe its installed shell/agent coordinator. */
export async function generateShellCoordinatorTraces(extraSources = []) {
  const sources = [...sourcePaths(), 'vite.config.ts', 'package.json', 'package-lock.json',
    'scripts/quint-lib.ts', 'test/browser/flag-off-android.ts', 'test/browser/resident-stub.ts',
    'test/browser/helpers/native-navigation-protocol.ts', 'upstream.lock.json',
    ...filesWithin(resolve(root, '.eliza/client-features'), path => /\.(?:ts|tsx|js|json|css|html)$/.test(path)).map(relativePath),
    'upstream.lock.json', 'scripts/prepare-client-features.ts',
    self, ...extraSources];
  const driverHashes = captureInputs(sources);
  const transformed = new Set();
  const prior = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({root: resolve(root, 'apps/app'), configFile: resolve(root, 'vite.config.ts'), logLevel: 'error',
      cacheDir: resolve(root, 'test-results/quint-refinement/shell-cache'),
      server: {host: '127.0.0.1', port: 0, strictPort: false},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-shell-observer', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root + '/') && !path.includes('/node_modules/') && existsSync(path)) {
          transformed.add(path);
          if (!driverHashes[path]) Object.assign(driverHashes, captureInputs([path]));
        }
        if (path === resolve(root, 'apps/app/src/main.tsx')) {
          const anchor = 'shell = value;';
          assert.ok(code.includes(anchor), 'The mounted shell ref must remain observable');
          return code.replace(anchor, anchor + ' window.quintShell = value;');
        }
        if (path === resolve(root, 'apps/app/src/prototype/agent-adapter.ts')) {
          return code + '\nwindow.quintActors = {alphaClient, connectionController};\n';
        }
      }}]});
  } finally {
    if (prior === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = prior;
  }
  const scenarios = [];
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({headless: true});
    for (const name of ['navigation', 'back-keeps-reply', 'view-retires-reply', 'hidden-retires-reply', 'pagehide-retires-reply']) {
      console.log(`Checking mounted shell ${name}`);
      const page = await browser.newPage();
      page.setDefaultTimeout(stepTimeout);
      const foreign = await fenceNetwork(page);
      // The TypeScript fixture callbacks carry esbuild's function-name helper. Install all
      // native boundary scripts together so their dependencies run in a fixed order.
      const initializers = [];
      const fixturePage = {addInitScript: async (script, argument) => {
        assert.equal(typeof script, 'function');
        initializers.push(`(${script.toString()})(${JSON.stringify(argument) ?? 'undefined'});`);
      }};
      await flagOffAndroid(fixturePage);
      await residentStub(fixturePage, {accounts:[{token:'quint-owner-a', userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5', email:'a@example.invalid', balance:5}]});
      await fixturePage.addInitScript(() => {
        for (const name of ['AlphaNotifications', 'AlphaHostedResults']) {
          const header = window.Capacitor.PluginHeaders.find(row => row.name === name);
          for (const method of ['addListener','removeListener']) {
            if (header && !header.methods.some(row => row.name === method)) header.methods.push({name:method,rtype:'callback'});
          }
        }
      });
      await page.addInitScript('const __name=(value,name)=>Object.defineProperty(value,"name",{value:name,configurable:true});\n' + initializers.join('\n'));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const pendingRequests = new Set();
      const requestStarted = request => pendingRequests.add(request);
      const requestEnded = request => pendingRequests.delete(request);
      page.on('request', requestStarted);
      page.on('requestfinished', requestEnded);
      page.on('requestfailed', requestEnded);
      const bootStarted = performance.now();
      let stage = 'document', documentMs;
      try {
        const response = await page.goto(origin + '/', {waitUntil:'commit', timeout:stepTimeout});
        assert.ok(response?.ok(), `Shell fixture document HTTP status ${response?.status() ?? 'unavailable'}`);
        documentMs = Math.round(performance.now() - bootStarted);
        stage = 'mounted shell and session';
        await page.waitForFunction(
          () => window.quintShell?.live && !!window.quintActors?.connectionController.getSnapshot().session,
          undefined,
          {timeout: mountTimeout},
        );
      } catch (cause) {
        let timer;
        let state;
        try {
          state = await Promise.race([
            page.evaluate(() => ({
              readyState: document.readyState,
              shell: !!window.quintShell,
              live: !!window.quintShell?.live,
              session: !!window.quintActors?.connectionController.getSnapshot().session,
            })).catch(() => null),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), 2_000); }),
          ]);
        } finally { clearTimeout(timer); }
        throw Error(`Shell fixture boot failed: ${JSON.stringify({
          name, stage, elapsedMs:Math.round(performance.now() - bootStarted), documentMs, state,
          pendingCount:pendingRequests.size,
          pending:[...pendingRequests].slice(0, 12).map(request => new URL(request.url()).pathname),
          errors:errors.slice(0, 8),
        })}`, {cause});
      } finally {
        page.off('request', requestStarted);
        page.off('requestfinished', requestEnded);
        page.off('requestfailed', requestEnded);
      }
      // These schedules exercise the installed shell and reply coordinator independently of Notes storage.
      const observations = [];
      const observe = async label => {
        const source = await page.evaluate(() => {
          const shell = window.quintShell, actors = window.quintActors, s = shell.S();
          const client = actors.alphaClient.getState(), connection = actors.connectionController.getSnapshot();
          return {view: s.view || 'home', chat: s.chat, shade: s.shade, drawer: s.drawer,
            draftPresent: !!s.draft, typing: s.typing, voice: s.voice, live: shell.live,
            hidden: document.hidden, pageSuspended: !!shell.pageSuspended,
            context: client.context, pending: client.pending, clientConnection: client.connection,
            session: client.session ? {ownerId: client.session.ownerId, sessionId: client.session.sessionId} : null,
            nativeSession: connection.session ? {ownerId: connection.session.ownerId, sessionId: connection.session.sessionId} : null,
            connectionKind: connection.kind, connectionOpen: connection.open,
            sendResult: window.quintSendResult ?? null,
            stopped: connection.stoppedReply ?? null,
            messages: s.msgs.map(message => ({from: message.from, text: message.text})),
            effects: {posts: window.flagOff.posts.slice(), recoveries: window.residentStub.recoveries.slice()},
          };
        });
        observations.push({label, source});
        return source;
      };
      await observe('mounted and connected');
      if (name === 'navigation') {
        for (const view of ['notes', 'notes', 'settings', 'home']) {
          await page.evaluate(view => view === 'home' ? window.dispatchEvent(new Event('launcher-home')) : window.quintShell.openView(view), view);
          await page.waitForFunction(view => (window.quintShell.S().view || 'home') === view, view);
          await observe('navigate ' + view);
        }
        await page.evaluate(() => window.quintShell.setState({chat:'full'}));
        await page.waitForFunction(() => window.quintShell.S().chat === 'full');
        await observe('expand chat');
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.dispatchEvent(new Event('alpha-back')));
          await observe('native Back ' + i);
        }
      } else {
        await setStub(page, {stream:'hold'});
        await page.evaluate(() => new Promise(resolve => window.quintShell.setState({draft:'Bounded shell trace'}, resolve)));
        await page.evaluate(() => { window.quintSend = window.quintShell.send().then(() => {
          window.quintSendResult = 'resolved';
        }, error => { window.quintSendResult = String(error); }); });
        try {
          await page.waitForFunction(() => window.residentStub.release && window.quintActors.alphaClient.getState().pending);
        } catch (error) {
          const source = await observe('send admission failed');
          throw Error(JSON.stringify({name, source, errors}), {cause:error});
        }
        await observe('transport holds actual shell send');
        if (name === 'back-keeps-reply') await page.evaluate(() => window.dispatchEvent(new Event('alpha-back')));
        if (name === 'view-retires-reply') await page.evaluate(() => window.quintShell.openView('notes'));
        if (name === 'hidden-retires-reply') await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', {configurable:true,get:()=>true});
          document.dispatchEvent(new Event('visibilitychange'));
        });
        if (name === 'pagehide-retires-reply') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await observe('coordinator event while transport held');
        await page.evaluate(() => window.residentStub.release());
        await page.waitForFunction(() => window.quintSendResult !== undefined);
        await page.waitForFunction(() => !window.quintActors.alphaClient.getState().pending && !window.quintShell.S().typing);
        await observe('late transport settles');
        if (name === 'hidden-retires-reply') await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', {configurable:true,get:()=>false});
          document.dispatchEvent(new Event('visibilitychange'));
        });
        if (name === 'pagehide-retires-reply') await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await observe('visible again');
      }
      assert.deepEqual(foreign, [], 'All external network requests must be fenced');
      scenarios.push({name, observations, errors});
      await page.close();
    }
    return {scenarios, sources: [...new Set([...sources, ...transformed])], driverHashes};
  } finally {
    await browser?.close();
    await server?.close();
  }
}

export async function checkShellCoordinator(extraSources = []) {
  const generated = await generateShellCoordinatorTraces(extraSources);
  const output = resolve(root, 'test-results/quint-refinement/shell-coordinator-source.json');
  mkdirSync(dirname(output), {recursive:true});
  writeFileSync(output, JSON.stringify(generated, null, 2) + '\n');
  const traces = generated.scenarios.map(scenario => {
    const baseline = scenario.observations[0].source.context.revision;
    const project = source => ({
      's.view': source.view, 's.chat': source.chat, 's.shade': source.shade, 's.drawer': source.drawer,
      's.draft': source.draftPresent ? 'draft' : '', 's.revision': source.context.revision - baseline,
      's.hidden': source.hidden, 's.pageSuspended': source.pageSuspended,
      's.contextSensitive': source.context.sensitive, 's.pending': source.pending,
      's.sendEpoch': source.effects.posts.length,
      's.replyVisible': source.messages.some(message => message.from === 'agent' && /^Held reply \d+$/.test(message.text)),
    });
    assert.deepEqual(scenario.errors, [], `Unexpected browser errors in ${scenario.name}`);
    const actions = observation => {
      if (observation.label.startsWith('navigate ')) return {name:'open',args:[observation.source.view]};
      if (observation.label === 'expand chat') return {name:'expand'};
      if (observation.label.startsWith('native Back')) return {name:'back'};
      if (observation.label === 'transport holds actual shell send') return {name:'send'};
      if (observation.label === 'coordinator event while transport held') return {
        name: {'back-keeps-reply':'back','view-retires-reply':'open','hidden-retires-reply':'hide','pagehide-retires-reply':'pageHide'}[scenario.name],
        ...(scenario.name === 'view-retires-reply' ? {args:['notes']} : {}),
      };
      if (observation.label === 'late transport settles') return {name:'reply',args:[1]};
      if (observation.label === 'visible again' && scenario.name === 'hidden-retires-reply') return {name:'resume'};
      if (observation.label === 'visible again' && scenario.name === 'pagehide-retires-reply') return {name:'pageShow'};
      return null;
    };
    return {name:scenario.name, init:{name:'init'}, expect:project(scenario.observations[0].source),
      steps:scenario.observations.slice(1).map(observation => ({label:observation.label,
        action:actions(observation), expect:project(observation.source)}))};
  });
  return checkTraces({model:'ShellNavigation', id:'ShellCoordinator', traces,
    sources:generated.sources, driverHashes:generated.driverHashes, scope:'bounded-orchestration', assumptions:[
      'The real mounted application, installed agent adapter, AlphaClient and connectionController execute in Chromium. Only native/provider ports are synthetic, and external network is fenced.',
      'Revision numbers are translated by subtracting the initial source revision, preserving equality and increments. Composer text is projected to empty or draft, and the synthetic held reply is distinguished from local cancellation notices.',
      'Five schedules cover repeated same-view navigation, Home, Back during a pending reply, view retirement, visibility retirement and page suspension. Each pending schedule has one actual native stream.',
      'Claimed view delivery, arbitrary message/selection schedules, all sensitive subviews, physical Android lifecycle delivery and assistive technology remain separate obligations.',
    ]});
}

if (process.argv[1] === self) {
  const result = await checkShellCoordinator();
  console.log(JSON.stringify({model:result.model, traces:result.traces, checkpoints:result.checkpoints, receiptPath:result.receiptPath}));
}
