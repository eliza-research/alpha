import {serviceInputs} from './source-inputs.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createReadingSupport} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred} from './support.mjs';

export async function readingRefinement(extraSources = []) {
  const sources = ['.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts', 'apps/app/src/browser/content-question.ts', 'specs/quint/refinement/services/reading.mjs', 'specs/quint/refinement/services/support.mjs'];
  const inputs = serviceInputs([...sources, ...extraSources]);
  const driverHashes = captureInputs(inputs);
  const traces = [];
  {
    const gate = deferred(); let queries = 0;
    const probe = createReadingSupport(() => { queries++; return gate.promise; });
    const first = probe.check(), second = probe.check(); assert.equal(first, second);
    gate.resolve({available: false}); await first;
    traces.push({name: 'unsupported native capability deduplicates concurrent probes', expect: {'s.draft': false}, steps: [{label: 'real explicit unavailable capability refuses isolated reading', action: action('unsupported'), expect: {'s.isolated': probe.state === 'available'}}]});
    assert.equal(queries, 1);
  }
  const compiled = await build({stdin: {contents: 'import {reviewContentQuestion} from "./apps/app/src/browser/content-question.ts";window.reviewContentQuestion=reviewContentQuestion;', resolveDir: process.cwd()}, bundle: true, write: false, platform: 'browser', format: 'iife', define: {'import.meta.env': '{}'},
    plugins: [{name: 'unused-image-ocr', setup(builder) { builder.onResolve({filter: /local-ocr$/}, () => ({path: 'ocr', namespace: 'port'})); builder.onLoad({filter: /.*/, namespace: 'port'}, () => ({contents: 'export const recognizeLocalText=async()=>{throw Error("No image input");};', loader: 'js'})); }}]});
  const browser = await chromium.launch({headless: true, ...(process.env.ALPHA_CHROMIUM_PATH ? {executablePath: process.env.ALPHA_CHROMIUM_PATH} : {}), args: ['--no-sandbox']});
  try {
    for (const retireDuringVerification of [false, true]) {
      const page = await browser.newPage(); await page.route('https://reading.refinement.invalid/**', route => route.fulfill({contentType: 'text/html', body: '<main class="os"></main>'})); await page.goto('https://reading.refinement.invalid/');
      await page.addScriptTag({content: compiled.outputFiles[0].text});
      await page.evaluate(() => {
        window.currentSelection = true; window.composed = [];
        window.reviewContentQuestion({name: 'Article', text: 'Reviewed article text', current: () => window.currentSelection,
          source: () => new Promise(resolve => { window.resolveSource = resolve; }), compose: text => window.composed.push(text)});
      });
      const trace = {name: `question source verification retirement ${retireDuringVerification}`, expect: {'s.draft': false}, steps: [{label: 'local excerpt review is open without composing', action: [action('worldHandshake', true), action('request', true), action('extracted', false)], expect: {'s.draft': await page.evaluate(() => window.composed.length > 0)}}]};
      await page.getByRole('button', {name: 'Use in conversation'}).click();
      await page.waitForFunction(() => typeof window.resolveSource === 'function');
      if (retireDuringVerification) {
        await page.evaluate(() => { window.currentSelection = false; window.resolveSource({kind: 'web'}); });
        await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('Selection changed'));
        trace.steps.push({label: 'late verified source cannot compose after selection changes', action: action('navigation'), expect: {'s.draft': await page.evaluate(() => window.composed.length > 0)}});
      } else {
        await page.evaluate(() => window.resolveSource({kind: 'web'}));
        await page.waitForFunction(() => window.composed.length === 1);
        trace.steps.push({label: 'explicit approval composes exact reviewed text once', action: action('approve'), expect: {'s.draft': await page.evaluate(() => window.composed.length > 0)}});
        assert.match(await page.evaluate(() => window.composed[0]), /Reviewed article text$/);
      }
      traces.push(trace); await page.close();
    }
  } finally { await browser.close(); }
  return checkTraces({model: 'BrowserReadingState', sources: inputs, driverHashes, traces, scope: 'bounded-component', assumptions: ['Real capability probing and question-review DOM execute. Native isolated extraction supplies the reviewed-text precondition for question traces.', 'The actual compose callback is observed; no chat-send API is supplied to the component.', 'Native extraction, speech-token lifetime and WebView isolated-world behavior remain Android instrumentation obligations.']});
}
