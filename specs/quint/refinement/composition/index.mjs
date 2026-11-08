import {createServer} from 'vite';
import {sourcePaths, filesWithin, relativePath} from '../../../../scripts/quint-lib.mjs';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {flagOffAndroid, fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {residentStub, setStub} from '../../../../test/browser/resident-stub.ts';

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const accounts = [
  {token: 'quint-owner-a', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', email: 'a@example.invalid', balance: 5},
  {token: 'quint-owner-b', userId: '3c5e7a90-1b2d-4f6e-8a0c-2e4f6a8b0c1d', email: 'b@example.invalid', balance: 7},
];

export async function runCompositionRefinement() {
  const sources = [...sourcePaths(), 'vite.config.ts', 'package.json', 'package-lock.json',
    'scripts/quint-lib.mjs', 'test/browser/flag-off-android.ts', 'test/browser/resident-stub.ts', 'test/browser/helpers/native-navigation-protocol.ts', 'upstream.lock.json',
    ...filesWithin(resolve(root, '.eliza/client-features'), path => /\.(?:ts|tsx|js|json|css|html)$/.test(path)).map(relativePath),
    ...filesWithin(resolve(root, 'patches/eliza')).map(relativePath), 'scripts/prepare-client-features.mjs',
    fileURLToPath(import.meta.url)];
  const driverHashes = captureInputs(sources);
  const prior = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error',
      cacheDir: resolve(root, 'test-results/quint-refinement/composition-cache'),
      server: {host: '127.0.0.1', port: 0, strictPort: false},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-observe-controller',
        resolveId(id) { if (id === '/quint-composition-entry.js') return '\0quint-composition-entry'; },
        load(id) {
          if (id !== '\0quint-composition-entry') return;
          return `import {connectionController} from '/src/runtime/connection-ui.tsx';
            window.refinement = {controller: connectionController, events: []};
            const observe = () => { const s = connectionController.getSnapshot();
              const value = {owner: s.cloudAccount?.userId ?? null, connection: s.kind,
                provider: s.residentInference ?? null, busy: s.busy, step: s.signIn?.step ?? null};
              window.refinement.events.push(value); return value; };
            connectionController.subscribe(observe); observe();
            window.refinement.ready = connectionController.initialize();`;
        },
        configureServer(instance) {
          instance.middlewares.use('/quint-composition', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(await instance.transformIndexHtml('/quint-composition', '<main></main><script type="module" src="/quint-composition-entry.js"></script>'));
          });
        },
      }]});
  } finally {
    if (prior === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = prior;
  }
  const traces = [];
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({headless: true});
    for (const replaceDirectly of [false, true]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);
      const foreign = await fenceNetwork(page);
      await flagOffAndroid(page);
      await residentStub(page, {nativeSignIn: true, accounts});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/quint-composition');
      try {
        await page.waitForFunction(() => window.refinement?.controller.getSnapshot().cloudAccount &&
          window.refinement.controller.getSnapshot().kind === 'resident' && !window.refinement.controller.getSnapshot().busy);
      } catch (error) {
        const observed = await page.evaluate(() => window.refinement?.controller.getSnapshot());
        throw new Error(`Controller startup failed ${JSON.stringify({replaceDirectly, observed, errors, foreign})}`, {cause: error});
      }
      const observe = async () => {
        const state = await page.evaluate(() => {
          const c = window.refinement.controller, s = c.getSnapshot();
          return {owner: s.cloudAccount?.userId ?? null, provider: s.residentInference,
            credential: !!window.flagOff.slots['cloud:production'], kind: s.kind, service: !!c.getCloudClient()};
        });
        const owner = state.owner === null ? 0 : accounts.findIndex(account => account.userId === state.owner) + 1;
        if (state.owner !== null && owner === 0) throw Error('Unexpected implementation owner');
        return {'state.identity.owner': owner, 'credentialPresent': state.credential,
          'state.resident.provider': state.provider === 'cloud' ? 'cloud' : state.provider === 'unavailable' ? 'none' : 'unconfirmed'};
      };
      const trace = {name: replaceDirectly ? 'real-controller-direct-replacement' : 'real-controller-signout-and-replacement', init: {name: 'readySetup'}, expect: await observe(), steps: []};
      if (!replaceDirectly) {
      await page.evaluate(() => window.refinement.controller.cloudSignOut());
      await page.waitForFunction(() => !window.refinement.controller.getSnapshot().busy && !window.refinement.controller.getSnapshot().cloudAccount);
      trace.steps.push({label: 'actual sign-out clears credential and inference', action: [{name: 'signOut'}, {name: 'clearResidentBinding', args: [true]}], expect: await observe()});
      }
      await setStub(page, {nextToken: accounts[1].token});
      await page.evaluate(() => window.refinement.controller.beginSignIn());
      await page.evaluate(() => window.refinement.controller.signInEmail('b@example.invalid'));
      const code = await page.evaluate(() => window.refinement.controller.getSnapshot().signIn?.step);
      if (code !== 'code') throw Error(`Expected native code stage, observed ${code}`);
      trace.steps.push({label: 'replacement starts through real controller', action: {name: 'beginSignIn', args: ['email']}, expect: {...await observe(), 'state.identity.phase': code}});
      await page.evaluate(() => window.refinement.controller.verifySignInCode('123456'));
      await page.waitForFunction(() => window.refinement.controller.getSnapshot().cloudAccount?.email === 'b@example.invalid' &&
        window.refinement.controller.getSnapshot().kind === 'resident' && !window.refinement.controller.getSnapshot().busy);
      trace.steps.push({label: 'replacement key and binding delivered through real coordinator', action: [
        {name: 'verifyCode', args: [false]}, {name: 'identityExchanged'}, {name: 'saveIdentityReceipt'},
        {name: 'acceptIdentityKey'}, {name: 'acknowledgeIdentity', args: [true]},
        ...(replaceDirectly ? [{name: 'revokePreviousIdentity', args: [true]}, {name: 'releaseIdentitySession'}] : []),
        {name: 'beginBinding'}, {name: 'bindingReply', args: [replaceDirectly ? 2 : 3]},
      ], expect: await observe()});
      const order = await page.evaluate(() => window.residentStub.order);
      if ((!replaceDirectly && !order.includes('remove cloud key')) || foreign.length || errors.length) throw Error(`Unexpected coordinator evidence ${JSON.stringify({order,foreign,errors})}`);
      trace.implementationEvents = await page.evaluate(() => window.refinement.events);
      trace.transportOrder = order;
      traces.push(trace);
      await page.close();
    }
    const receipt = await checkTraces({model: 'ApplicationComposition', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
      'Actual flag-off renderer coordinator and protocol modules run in Chromium. Native ports and services use isolated synthetic fixtures.',
      'Checks account/credential/inference observations through sign-out and direct replacement, including the precommit code stage. Internal native authentication steps are a contract macro.',
      'Intermediate subscriber events, voice, Calendar/Inbox writes, reset erasure and native plugin implementations remain separate obligations.',
    ]});
    return {receipts: [receipt], obligations: [{model: 'ApplicationComposition', obligation: 'complete cross-domain source trace relation',
      reason: 'This first host campaign covers quiescent identity and inference only.', requires: ['intermediate event refinement','voice and durable-effect schedules','native credential/reset adapters']}]};
  } finally {
    await browser?.close();
    await server?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runCompositionRefinement(), null, 2));
