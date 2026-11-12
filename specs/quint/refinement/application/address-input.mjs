/** Replays AddressInput traces against the browser adapter's real `navigate` with the shared
 * address parser.
 *
 * The model describes typed text by the properties the decision reads. Each model submission is
 * replayed with a concrete text that has exactly those properties, taken from the corpus below;
 * the properties of a corpus text are computed from the real parser's verdict and the text itself.
 * Every corpus text is submitted to the model in one scripted run (so the model must accept its
 * properties as possible) and to the adapter, typed and as an approved destination. Submissions
 * from the model's own walks are replayed when some corpus text has their properties; the rest are
 * counted. The observed outcome is what the
 * adapter did: opened an address, opened a search for exactly the typed text, showed its refusal
 * message, or failed the approved request. `corrected` is derived in the model only. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {parseBrowserAddressInput} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts';
import {BrowserTabSession} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
import {modelTraces, plain, repositoryRoot} from './browser-model-traces.mjs';
import {scaledTimeout} from '../timeouts.mjs';

const model = {path: 'specs/quint/application/AddressInput.qnt', module: 'AddressInput'};
const witnesses = ['SchemeLikeWordSearchedWitness', 'SimpleAtSearchedWitness', 'DecimalSearchedWitness', 'ApprovedRefusedWitness'];
export const corpus = ['example.com', 'example.com/path?x=1', 'cats and dogs', 'weather', 'localhost', 'localhost/notes?a=1', 'localhost tips', '10:30', ' 12:00 ', '3:16/x',
  'nas:8080', '127.0.0.1:8080', '192.168.1.1', '[::1]:8080', 'site:example.com cats', 'define:serendipity', 'javascript:alert(1)', 'ftp://example.com/file',
  'file:///etc/hosts', 'user@example.com', 'user@host', 'user:password@example.com', 'mailto:someone@example.com', 'https://user@example.com',
  'https://user:password@example.com', 'http://user@example.com/x', '3.14', '1.2.3', '42', '1.2.3.4.5', 'https://example.com', 'http://example.com/x', 'HTTPS://EXAMPLE.COM/',
  'https://', 'http:', 'https:example.com', 'name@example.com/inbox', 'what is user@example.com', 'a b@c',
  'name+tag@example.com', 'name@example.com?token=private', 'name@example.com#private-fragment',
  'name@example.com/path?token=private#fragment', 'user%3Apassword@example.com',
  '＠project', 'name＠example.com／inbox', 'look up a＠b：secret', 'a＠b\u2028note', '10:30/a＠b', 'localhost/＠foo',
  '', '   ', 'x'.repeat(4097), 'https://example.com/' + 'y'.repeat(4096)];

/** The properties of a text that the model's `Input` records. */
export function describe(raw) {
  const typed = raw.trim();
  if (typed.length > 4096) return {tooLong: true};
  const atText = typed.normalize('NFKC');
  const input = parseBrowserAddressInput(raw, {defaultProtocol: 'https:'});
  const verdict = input.kind, reason = verdict !== 'rejected' ? 'none' : ['unsupported-protocol', 'credentials'].includes(input.reason) ? input.reason : 'other';
  let hostEmpty = false;
  if (verdict === 'url') { try { hostEmpty = !new URL(input.href).hostname; } catch { hostEmpty = true; } }
  return {tooLong: false, verdict, reason,
    timeLike: verdict === 'url' && /^\d+:\d+(?:[/?#]|$)/.test(typed),
    webScheme: /^https?:/i.test(typed), hasAt: atText.includes('@'),
    simpleAtSearch: /^[^/:@?#%]*@[^/:@?#%]*$/.test(atText) && !/[\p{C}\p{Zl}\p{Zp}\\]/u.test(atText),
    shortDecimal: /^\d+(?:\.\d+){0,2}$/.test(typed), hostEmpty,
    localhostAlias: verdict === 'search' && /^localhost(?:[/?#]\S*)?$/i.test(input.query)};
}
const key = input => input.tooLong ? 'too long' : JSON.stringify(Object.keys(input).sort().map(name => [name, input[name]]));

export function addressInputHarness() {
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const start = adapter.indexOf('  async function navigate('), end = adapter.indexOf('  async function command(');
  assert.ok(start >= 0 && end > start, 'the adapter no longer has the navigate region');
  const region = stripTypeScriptTypes(adapter.slice(start, end));
  /** One submission in a fresh Browser with one loaded tab; returns the model's outcome name. */
  return async (raw, approved) => {
    const state = {cur: 'owned', tabs: [{id: 'owned'}], editing: true}, navigations = [], reports = [];
    const tabs = new BrowserTabSession({session: 'session'});
    await tabs.ensure('owned', false, async () => undefined);
    const context = {URL, Error, MAX_TABS: 8, parseBrowserAddressInput, session: 'session', disposed: false, state: () => state, isPrivate: () => false,
      newTabId: () => 'new', restored: new Map(), tabs, restoreAttempts: new Map(), ensure: id => tabs.creation(id) ?? tabs.ensure(id, false, async () => undefined),
      shell: {vset(_key, patch) { Object.assign(state, patch); }}, Browser: {async navigate(input) { navigations.push(input); }, async close() {}},
      refresh() {}, report(error) { reports.push(error.message); }};
    const navigate = vm.runInNewContext(region + ';navigate', context);
    try { await navigate(raw, false, approved ? new AbortController().signal : undefined); }
    catch (error) { assert.match(error.message, /Invalid approved browser destination/); assert.ok(approved); assert.equal(navigations.length + reports.length, 0); return 'throw'; }
    if (reports.length) { assert.deepEqual(reports, ['Enter search words or a valid HTTP or HTTPS address without credentials.']); assert.equal(navigations.length, 0); return 'toast'; }
    assert.equal(navigations.length, 1, raw);
    const url = new URL(navigations[0].url);
    assert.ok(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.hostname, 'only a web address without credentials is ever opened');
    return url.origin + url.pathname === 'https://www.google.com/search' && url.searchParams.get('q') === raw.trim() ? 'search' : 'open';
  };
}

const quintValue = value => typeof value === 'string' ? JSON.stringify(value) : String(value);
const record = input => `{ ${Object.entries(input).map(([name, value]) => `${name}: ${quintValue(value)}`).join(', ')} }`;

/** The model's outcome for each given submission, from one scripted run of the model's `submit`. */
function modelOutcomes(submissions) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-address-'));
  try {
    const chain = submissions.map(({input, approved}) => `.then(submit(${record(input)}, ${approved}))`).join('\n    ');
    // The model's own text with one more scenario: the corpus, submitted in order.
    const source = readFileSync(join(repositoryRoot, model.path), 'utf8'), last = source.lastIndexOf('}');
    writeFileSync(join(directory, 'AddressInput.qnt'), `${source.slice(0, last)}  run corpusTest = init\n    ${chain}\n}\n`);
    const result = spawnSync(process.execPath, [join(repositoryRoot, 'node_modules/@informalsystems/quint/dist/src/cli.js'), 'test', join(directory, 'AddressInput.qnt'),
      '--main=AddressInput', '--backend=typescript', '--max-samples=1', '--match=^corpusTest$', `--out-itf=${join(directory, 'trace-{test}-{seq}.json')}`], {cwd: repositoryRoot, encoding: 'utf8', timeout: scaledTimeout(120000)});
    assert.equal(result.status, 0, `the model refuses a text that exists: ${result.stdout}\n${result.stderr}`);
    const trace = JSON.parse(readFileSync(join(directory, 'trace-corpusTest-0.json'), 'utf8'));
    assert.equal(trace.states.length, submissions.length + 1);
    return trace.states.slice(1).map(state => plain(state.s));
  } finally { rmSync(directory, {recursive: true, force: true}); }
}
const wordInput = {tooLong: false, verdict: 'search', reason: 'none', timeLike: false, webScheme: false, hasAt: false, simpleAtSearch: false, shortDecimal: false, hostEmpty: false, localhostAlias: false};

export async function checkAddressInput({random = 60, steps = 60} = {}) {
  const submit = addressInputHarness(), texts = new Map();
  // Every corpus text, typed and as an approved destination, against the model's outcome for its properties.
  const submissions = corpus.flatMap(raw => [false, true].map(approved => { const found = describe(raw); return {raw, approved, input: found.tooLong ? {...wordInput, tooLong: true} : found}; }));
  const expected = modelOutcomes(submissions);
  let corpusChecks = 0;
  for (const [index, {raw, approved}] of submissions.entries()) {
    assert.equal(await submit(raw, approved), expected[index].outcome, `${JSON.stringify(raw.slice(0, 60))} ${approved ? 'approved' : 'typed'}`);
    corpusChecks++;
  }
  for (const raw of corpus) { const name = key(describe(raw)); if (!texts.has(name)) texts.set(name, raw); }
  // Model walks: each submission that some corpus text can stand for is replayed as well.
  const traces = modelTraces({...model, witnesses, random, steps});
  let replayed = 0, unrepresented = 0;
  for (const trace of traces) for (const step of trace.steps) {
    if (step.action !== 'submit') continue;
    const {input, approved, outcome} = step.after, raw = texts.get(key(input));
    if (raw === undefined) { unrepresented++; continue; }
    replayed++;
    assert.equal(await submit(raw, approved), outcome, `${JSON.stringify(raw.slice(0, 60))} ${approved ? 'approved' : 'typed'}: ${key(input)}`);
  }
  return {corpusChecks, classes: texts.size, traces: traces.length, replayed, unrepresented};
}
