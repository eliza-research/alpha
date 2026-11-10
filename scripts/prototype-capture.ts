#!/usr/bin/env node
/** Exact presentation-fixture capture. Does not prove native or agent integration. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

interface DecodedAsset {
  url: string;
  decoded: boolean;
  width?: number;
  height?: number;
}
interface Capture {
  source: string;
  state: string;
  theme: string;
  url: string;
  file: string;
  viewport: {width: number; height: number};
  deviceScaleFactor: number;
  deterministic: boolean;
  fixedDate: string | null;
  elapsedMs: number;
  clockStepMs: number | null;
  errors: string[];
  failedRequests: {url: string; error?: string}[];
  httpErrors: {url: string; status: number; resourceType: string}[];
  responseStatus?: number;
  capturedDate?: string;
  assets?: DecodedAsset[];
  assetError?: string;
  fonts?: {status: string; denton: boolean; publicSans: boolean; faces: {family: string; status: string}[]};
  localMode?: string;
  modeObservation?: {connectionMode?: string; activeView?: string; mockBanner: boolean};
  bounds?: {x: number; y: number; width: number; height: number} | null;
  rendered?: {title: string; headings: (string | null)[]; state: unknown};
  sha256?: string;
  ok: boolean;
  failure?: string;
}

const options = Object.fromEntries(process.argv.slice(2).map((item) => {
  const at = item.indexOf('=');
  return [item.slice(2, at < 0 ? undefined : at), at < 0 ? true : item.slice(at + 1)];
}));
function option(name: string): string | undefined {
  const value = options[name];
  if (typeof value === 'boolean') throw Error(`--${name} needs a value`);
  return value;
}
const runtime = option('modules') || process.env.ALPHA_BROWSER_MODULES;
const require = createRequire(runtime ? path.join(path.resolve(runtime), '__capture__.cjs') : import.meta.url);
let chromium: typeof import('@playwright/test').chromium;
try { ({ chromium } = require('playwright')); }
catch { throw new Error('Install/provide Playwright: --modules=/absolute/path/to/node_modules (or ALPHA_BROWSER_MODULES). No automatic install is performed.'); }
const apps = {
  phone: ['', 'keypad', 'voicemail', 'call', 'incoming'], messages: ['', 'thread', 'new'],
  inbox: ['', 'mail', 'compose'], calendar: ['', 'event', 'new', 'month', 'invite', 'add'],
  browser: ['', 'book', 'tabs', 'agent'], camera: ['', 'video', 'scan'],
  photos: ['', 'viewer', 'albums', 'search'], maps: ['', 'search', 'place', 'route', 'nav'],
  notes: ['', 'editor', 'rec', 'voice'], contacts: ['', 'detail', 'edit'],
  files: ['', 'folder', 'preview'], wallet: ['', 'card', 'pay', 'secure', 'add', 'pass'],
  workflows: ['', 'flow', 'run', 'failed', 'new'], settings: ['', 'character', 'accounts', 'adding', 'privacy', 'wifi'],
};
const appStates = Object.entries(apps).flatMap(([app, subs]) => subs.map(sub => app + (sub ? ':' + sub : '')));
if (appStates.length !== 60) throw new Error('Expected sixty app fixture states');
const states = option('states')?.split(',') ?? [...appStates, 'home', 'boot', 'lock', 'shade', 'sheet', 'full', 'voice', 'heads'];
const themes = option('themes')?.split(',') ?? ['light', 'dark'];
if ([...states, ...themes].some(name => !/^[A-Za-z0-9_:-]+$/.test(name))) throw Error('Capture states and themes must be simple names');
const out = path.resolve(option('out') || 'test-results/prototype-captures');
const deterministic = options.deterministic === true || options.deterministic === 'true';
const fixedDate = '2026-09-29T18:00:00.000Z';
const elapsedMs = Number(option('settle') || 700);
if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('settle must be nonnegative milliseconds');
await fs.mkdir(out, { recursive: true });
const local = option('local');
const localMode = option('local-mode') || 'development-fixture';
const sources = [{ id: 'reference', url: option('reference') || 'https://alpha-phone-prototype.pages.dev/', width: 960, height: 1020 }];
if (local) sources.push({ id: 'local', url: local, width: 412, height: 915 });
// Local fixture captures need test mocks: the `npm run dev` server, or a bundle built with
// `npm run build:test-mocks`. A production bundle has no fixtures, so refuse it up front.
if (local) {
  let flags: {testMocks?: boolean} | null = null;
  try {
    const response = await fetch(new URL('build-flags.json', local));
    if (response.ok && /json/.test(response.headers.get('content-type') || '')) flags = await response.json();
  } catch { /* An unreachable server fails at capture time with its own error. */ }
  if (flags && flags.testMocks !== true) throw new Error(`${local} serves a production bundle (testMocks:false). Serve a test-mocks build (npm run build:test-mocks) or use npm run dev.`);
}
const browser = await chromium.launch({ headless: true, executablePath: option('executable') });
const results: Capture[] = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const referenceBytes = await fs.readFile('artifacts/design-reference/index.html').catch(() => null);
try {
  for (const source of sources) {
    const context = await browser.newContext({ viewport: { width: source.width, height: source.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
    for (const theme of themes) for (const state of states) {
      const page = await context.newPage();
      if (deterministic) {
        await page.clock.install({ time: new Date(fixedDate) });
        await page.clock.pauseAt(new Date(fixedDate));
      }
      const errors: Capture['errors'] = [];
      const failedRequests: Capture['failedRequests'] = [];
      const httpErrors: Capture['httpErrors'] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status(), resourceType: response.request().resourceType() }); });
      const url = new URL(source.url); url.searchParams.set('start', state); url.searchParams.set('theme', theme);
      if (source.id === 'local') {
        if(localMode === 'mock') url.searchParams.set('mode','mock');
        else url.searchParams.set('fixture', '1');
      }
      const file = `${source.id}/${theme}/${state.replaceAll(':', '--')}.png`;
      const row: Capture = { ok: false, source: source.id, state, theme, url: url.href, file, viewport: { width: source.width, height: source.height }, deviceScaleFactor: 1, deterministic, fixedDate: deterministic ? fixedDate : null, elapsedMs, clockStepMs: deterministic ? 50 : null, errors, failedRequests, httpErrors };
      try {
        const response = await page.goto(url.href, { waitUntil: 'load', timeout: 30000 });
        row.responseStatus = response?.status();
        const canvas = page.locator('[data-screen="1"]');
        await canvas.waitFor({ state: 'visible', timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        // Reduced motion removes entry animation; finite delay retains transient fixture states.
        if (deterministic) {
          // Advance in bounded frames so React can commit timer-driven state between ticks.
          // A single large clock jump can batch stale state differently across React versions.
          for (let elapsed = 0; elapsed < elapsedMs; elapsed += 50) {
            await page.clock.runFor(Math.min(50, elapsedMs - elapsed));
            await page.evaluate(() => new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(0); }));
          }
          row.capturedDate = await page.evaluate(() => new Date().toISOString());
        } else await page.waitForTimeout(elapsedMs);
        // Advancing the fixture clock does not wait for real network/decode work.
        // Resolve visible CSS backgrounds as well as <img> resources before capture;
        // use a host timeout because the page's deterministic timers are paused.
        let assetDeadline: NodeJS.Timeout | undefined;
        try {
          row.assets = await Promise.race([
            page.evaluate(async () => {
              const urls = new Set<string>();
              for (const element of document.querySelectorAll('[data-screen], [data-screen] *')) {
                if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
                if (element instanceof HTMLImageElement && element.currentSrc) urls.add(element.currentSrc);
                for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) urls.add(new URL(match[1], location.href).href);
              }
              return Promise.all([...urls].map(async url => {
                const img = new Image(); img.src = url;
                try { await img.decode(); return { url, decoded: img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight }; }
                catch { return { url, decoded: false }; }
              }));
            }),
            new Promise<never>((_, reject) => { assetDeadline = setTimeout(() => reject(new Error('Visible image decode did not settle within 15 seconds')), 15000); }),
          ]);
        } catch (error) { row.assetError = error instanceof Error ? error.message : String(error); }
        finally { clearTimeout(assetDeadline); }
        row.fonts = await page.evaluate(() => ({ status: document.fonts.status, denton: document.fonts.check('300 30px Denton'), publicSans: document.fonts.check('400 16px "Public Sans"'), faces: [...document.fonts].map(f => ({ family: f.family, status: f.status })) }));
        row.localMode = source.id === 'local' ? localMode : undefined;
        if(source.id === 'local') {
          row.modeObservation = await page.evaluate(() => ({connectionMode:document.documentElement.dataset.connectionMode,activeView:document.documentElement.dataset.activeView,mockBanner:!!document.querySelector('.mock-mode-banner')}));
          if(row.localMode === 'mock' && (row.modeObservation.connectionMode !== 'mock' || !row.modeObservation.mockBanner)) throw new Error('Explicit production mock mode did not activate');
          if(row.localMode !== 'mock' && row.modeObservation.activeView) throw new Error('Native adapters are active: fixture=1 is development-only. Use local-mode=mock for a compiled artifact.');
        }
        row.bounds = await canvas.boundingBox();
        row.rendered = await page.evaluate(() => {
          const phone = (window as Window & {__phone?: {S?: () => {screen?: unknown; view?: unknown; chat?: unknown}}}).__phone;
          const current = phone?.S?.();
          const state: unknown = current ? JSON.parse(JSON.stringify({screen: current.screen, view: current.view, chat: current.chat})) : null;
          return {title: document.title, headings: [...document.querySelectorAll('[data-screen] h1')].map(heading => heading.textContent), state};
        });
        await fs.mkdir(path.dirname(path.join(out, file)), { recursive: true });
        const png = await canvas.screenshot({ path: path.join(out, file), animations: 'disabled', timeout: 15000 });
        row.sha256 = hash(png); row.ok = errors.length === 0 && failedRequests.length === 0 && httpErrors.length === 0 && !row.assetError && row.assets?.every(asset => asset.decoded) === true && response?.ok() !== false;
      } catch (error) { row.ok = false; row.failure = error instanceof Error ? error.message : String(error); }
      results.push(row); await page.close();
      console.log(`${row.ok ? 'CAPTURED' : 'FAILED'} ${source.id} ${theme} ${state}`);
      await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({ purpose: 'Presentation fixture evidence only; not native/agent flow acceptance', referenceSnapshotSha256: referenceBytes && hash(referenceBytes), captures: results }, null, 2) + '\n');
    }
    await context.close();
  }
} finally { await browser.close(); }
const escape = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const cells = results.map(r => `<article><h2>${escape(r.source)} · ${escape(r.theme)} · ${escape(r.state)}</h2><p>${r.ok ? 'Captured' : 'FAILED'}${r.failure ? ': ' + escape(r.failure) : ''}</p>${r.sha256 ? `<a href="${escape(r.file)}"><img loading="lazy" src="${escape(r.file)}" alt="${escape(r.state)}"></a>` : ''}</article>`).join('');
await fs.writeFile(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Alpha prototype fixture matrix</title><style>body{font:14px system-ui;background:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:20px}article{background:white;padding:12px}h2{font-size:15px}img{width:100%;height:auto}</style><h1>Alpha prototype fixture matrix</h1><p>Presentation captures; native integrations and all interaction branches require separate tests. See manifest.json for viewport, fonts, errors, hashes and source URLs.</p><main>${cells}</main>`);
if (results.some(row => !row.ok)) process.exitCode = 1;
