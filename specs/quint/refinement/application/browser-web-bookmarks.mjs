import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {checkTraces} from '../check-traces.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';
import {scaledTimeout} from '../timeouts.mjs';
import {repositoryRoot} from './browser-model-traces.mjs';

const secureUrl = 'https://bookmark-fixture.example/saved';
const main = resolve(repositoryRoot, 'apps/app/src/main.tsx');

export async function checkBrowserWebBookmarks(owningTest) {
  const driverHashes = captureReplayClosure([owningTest, 'vendor/eliza/packages/core/src/utils/uuid.ts',
    ...['bindings.ts', 'client.ts', 'transfer.ts'].map(name => 'vendor/eliza/plugins/plugin-native-passwords/src/' + name)]);
  const profile = mkdtempSync(join(tmpdir(), 'alpha-bookmark-replay-'));
  const traces = [];
  let server, browser;
  try {
    const env = {ELIZA_DEV_ALLOW_TEST_MOCKS: '', VITE_LOCAL_AGENT: '', VITE_ALPHA_CLOUD_RESIDENT: '',
      ALPHA_BROWSER_CLOUD_PROFILE: join(profile, 'synthetic-cloud')};
    const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, env);
      server = await createServer({configLoader: 'runner', root: resolve(repositoryRoot, 'apps/app'),
        configFile: resolve(repositoryRoot, 'vite.config.ts'), logLevel: 'error', cacheDir: join(profile, 'vite'),
        server: {host: '127.0.0.1', port: 0, hmr: false},
        plugins: [{name: 'observe-actual-browser-history', enforce: 'pre', transform(code, id) {
          if (id.split('?')[0] === main) return code.replace('shell = value;', 'shell = value; window.quintBookmarkShell = value;');
        }}]});
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const plainUrl = origin + '/quint-bookmark-http';
    browser = await chromium.launch();

    async function replay(name, isPrivate, drive) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}});
      const loading = new Map();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(scaledTimeout(20_000));
      await page.route('**/*', async route => {
        const url = route.request().url();
        const response = loading.get(url);
        if (response) {
          await response;
          return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>Bookmark fixture</title><h1>Bookmark fixture</h1>'});
        }
        return new URL(url).origin === origin ? route.continue() : route.abort();
      });
      await page.addInitScript(() => {
        if (window === window.top) localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
      });
      let release;
      try {
        await page.goto(origin);
        await page.getByRole('button', {name: 'Browser', exact: true}).click();
        await page.evaluate(async () => {
          const {registerPlugin} = await import('/src/platform-plugins.ts');
          if (window.Capacitor?.getPlatform() !== 'web') throw Error('Expected the real web Browser surface');
          window.quintBookmarkPort = registerPlugin('AlphaBrowser');
          await window.quintBookmarkPort.addListener('stateChanged', state => { window.quintBookmarkPage = state; });
        });
        const menu = page.getByRole('dialog', {name: 'Browser menu', exact: true});
        const menuButton = page.getByRole('button', {name: 'Menu', exact: true});
        async function openMenu() {
          if (!await menu.isVisible()) await menuButton.click();
        }
        if (isPrivate) {
          await openMenu();
          await menu.getByRole('button', {name: 'New private tab', exact: true}).click();
        }

        async function start(url) {
          loading.set(url, new Promise(resolveResponse => { release = resolveResponse; }));
          const address = page.getByRole('textbox', {name: 'Address', exact: true});
          if (!await address.isVisible()) await page.getByRole('button', {name: 'Edit address', exact: true}).click();
          await address.fill(url);
          await address.press('Enter');
          await page.waitForFunction(url => window.quintBookmarkPage?.url === url && window.quintBookmarkPage.loading, url);
        }
        async function observe() {
          return page.evaluate(async secureUrl => {
            const current = window.quintBookmarkPage;
            const {urls} = await window.quintBookmarkPort.bookmarks();
            const visits = window.quintBookmarkShell.vget('browser').visits;
            return {'s.priv': current.private, 's.page': current.loading ? 'loading' : current.committed ? 'ready' : 'failed',
              's.secure': new URL(current.url).protocol === 'https:', 's.visited': visits.length > 0,
              's.marked': urls.includes(secureUrl), 's.bookmarkWrites': window.quintBookmarkWrites,
              's.bookmarkNotice': window.quintBookmarkNotice};
          }, secureUrl);
        }
        // Count completed calls at the real web document boundary without replacing their outputs.
        await page.evaluate(async () => {
          const {bookmarkDocument} = await import('/src/browser/preference-documents.ts');
          const edit = bookmarkDocument.edit;
          window.quintBookmarkWrites = 0;
          window.quintBookmarkNotice = false;
          bookmarkDocument.edit = async (...args) => {
            const result = await edit(...args);
            window.quintBookmarkWrites++;
            return result;
          };
        });

        await start(secureUrl);
        const trace = {name, init: {name: isPrivate ? 'initPrivate' : 'initNormal'}, expect: await observe(), steps: []};
        const mark = async (name, args = []) => trace.steps.push({action: {name, args}, expect: await observe()});
        await drive({
          async commit() {
            release();
            await page.waitForFunction(() => window.quintBookmarkPage?.committed === true);
            if (!isPrivate) await page.waitForFunction(() => window.quintBookmarkShell.vget('browser').visits.includes(window.quintBookmarkPage.url));
            await mark('commit');
          },
          async startPlain() {
            await start(plainUrl);
            await mark('startLoad', [false]);
          },
          async toggle(expected) {
            await openMenu();
            await menu.getByRole('button', {name: /^Bookmark(?:ed)?$/}).click();
            if (expected === 'refused') {
              await page.getByText('HTTPS only', {exact: true}).waitFor();
              await page.evaluate(() => { window.quintBookmarkNotice = true; });
              await page.keyboard.press('Escape');
            } else {
              // Success closes the menu and refreshes its visible mark from persisted state.
              await menu.waitFor({state: 'hidden'});
              await openMenu();
              await menu.getByRole('button', {name: expected, exact: true}).waitFor();
              await page.keyboard.press('Escape');
            }
            await menu.waitFor({state: 'hidden'});
            await mark('toggleBookmark');
          },
        });
        traces.push(trace);
        assert.deepEqual(errors, [], 'The real web Browser has no uncaught errors');
      } finally {
        release?.();
        await page.close();
      }
    }

    await replay('loading refusal, then save and remove the committed HTTPS address', false, async browser => {
      await browser.toggle('refused');
      await browser.commit();
      await browser.toggle('Bookmarked');
      await browser.toggle('Bookmark');
    });
    await replay('committed HTTP without bookmark authority', false, async browser => {
      await browser.commit();
      await browser.startPlain();
      await browser.commit();
      await browser.toggle('refused');
    });
    await replay('a private bookmark is saved without visiting history', true, async browser => {
      await browser.commit();
      await browser.toggle('Bookmarked');
    });
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(profile, {recursive: true, force: true});
  }
  return checkTraces({model: 'BrowserPageEgress', id: 'BrowserWebBookmarks', sources: Object.keys(driverHashes), driverHashes,
    traces, scope: 'bounded-component', assumptions: [
      'Chromium executes the whole flag-off app and registered BrowserSurface. The test intercepts a single HTTPS address and a loopback HTTP address, holds iframe responses, and blocks external traffic.',
      'The fixture observes page events, the real adapter history, rendered menu and refusal, and bookmark document writes and readback. Native share, historical externalOnly events and multi-tab storage concurrency are outside this projection.',
    ]});
}
