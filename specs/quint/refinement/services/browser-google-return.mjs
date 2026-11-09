import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = join(root, 'scripts/browser-cloud-dev-bridge.ts');
const action = (name, ...args) => ({name, args});

/** The actual loopback callback branch; provider verification is a separate boundary. */
export async function checkBrowserGoogleReturn(extraSources = []) {
  const sources = [source, fileURLToPath(import.meta.url), join(root, 'test/support/strip-types.mjs'),
    join(root, 'specs/quint/refinement/services/index.mjs'), ...extraSources];
  const driverHashes = captureInputs(sources);
  const code = readFileSync(source, 'utf8');
  const start = code.indexOf("  if(req.url?.startsWith('/google-return?')");
  const end = code.indexOf('  if(req.url===GOOGLE_BROWSER_RETURN', start);
  assert.ok(start >= 0 && end > start, 'actual Google workspace callback boundary');
  const load = new Function('workspaceReturns', 'admitted', 'send', 'createHash', 'UUID', 'Date',
    stripTypeScriptTypes('const handler=async(req,res)=>{const host=req.headers.host;\n' + code.slice(start, end) + '\n};', {mode: 'strip'}) + '\nreturn handler;');
  const traces = [];
  for (const mode of ['connected', 'wrong-host', 'expired', 'changed-owner']) {
    let now = 1000, owner = 1;
    const pending = new Map(), signals = [];
    const handler = load(pending, async () => { if (owner !== 1) throw Error('Credential changed'); },
      (res, status, body) => {res.status = status; res.body = JSON.stringify(body);}, createHash,
      /^[0-9a-f-]{36}$/i, {now: () => now});
    const observe = () => ({'s.candidate': signals.length > 0});
    const trace = {name: mode, expect: observe(), steps: []};
    pending.set('nonce', {environment: 'production', reference: 'owned-reference', credentialId: 'owned-credential',
      origin: 'http://127.0.0.1:4000', expiresAt: 2000});
    trace.steps.push({action: action('begin'), expect: observe()});
    if (mode === 'expired') {now = 2001; trace.steps.push({action: action('expire'), expect: observe()});}
    if (mode === 'changed-owner') {owner = 2; trace.steps.push({action: action('switchOwner'), expect: observe()});}
    const deliver = async () => {
      const res = {status: 0, body: '', writeHead(status) {this.status = status;}, end(body) {this.body = body;}};
      await handler({method: 'GET', headers: {host: mode === 'wrong-host' ? '127.0.0.1:4001' : '127.0.0.1:4000'},
        url: '/google-return?state=nonce&google_connected=true&connection_id=11111111-1111-4111-8111-111111111111'}, res);
      if (res.status === 200) {
        const match = res.body.match(/\.postMessage\((\{.*?\})\);/);
        assert.ok(match, 'successful callback emits a bounded wakeup');
        const message = JSON.parse(match[1]);
        assert.equal(message.credentialId, 'owned-credential');
        assert.equal(message.result, 'connected');
        signals.push(message);
      } else assert.ok([409, 410].includes(res.status));
      trace.steps.push({action: action('callback', 1, mode === 'wrong-host' ? 2 : 1), expect: observe()});
    };
    await deliver();
    if (mode === 'connected') {await deliver(); assert.equal(signals.length, 1, 'replay cannot emit another wakeup');}
    else assert.equal(signals.length, 0, 'refused callback cannot wake an accepted connection');
    traces.push(trace);
  }
  return checkTraces({model: 'BrowserGoogleReturn', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The production callback branch executes unchanged against request/response objects and a controlled credential-admission port. Four traces cover accepted, replayed, wrong-host, expired and replaced-owner returns.',
    'Only emitted candidate wakeups are observed. Attempt creation is controlled setup; this projection does not claim real provider authorization, canonical account readback, panel dismissal, browser-tab closing or encrypted credential storage.',
  ]});
}
