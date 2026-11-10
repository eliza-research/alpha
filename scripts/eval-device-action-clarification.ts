#!/usr/bin/env node
// Measures how often the resident agent asks a clarifying question instead of proposing a
// device action for deliberately ambiguous phone requests, plus unambiguous controls.
//
// Live mode talks to a loopback resident runtime (for example `npm run dev`, which starts
// the local agent with hosted qwen-3.8-27b on Cerebras when CEREBRAS_API_KEY is set for
// that agent). It enrolls one fresh synthetic device, sends each case in its own
// conversation with the same device headers and current-turn context the phone uses, and
// counts durable proposals. Every proposal it causes is rejected immediately; nothing is
// approved or executed, and no phone effect can occur. The synthetic device is revoked when
// the run ends; its per-case conversations remain in the runtime's history.
// The result records the script's expected model (scripts/agent-model.ts); it does not
// prove which model the runtime used. Check the runtime's own configuration for that.
//
//   node scripts/eval-device-action-clarification.ts --origin http://127.0.0.1:47849 \
//     --token-file /path/to/paired-machine-token --output test-results/clarification.json
//   node scripts/eval-device-action-clarification.ts --self-test
//
// --self-test exercises classification, cleanup and the result format against an
// in-process synthetic agent. Its output is harness evidence only, never a model result.
//
// The device header is the phone's own selection (selectDeviceCapabilities) for a standalone
// Android APK. Case set revision 2 drops two notes controls that needed capabilities the phone
// never negotiates; its scores are not comparable with revision 1 results.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_MODEL } from './agent-model.ts';
import { selectDeviceCapabilities } from '../apps/app/src/runtime/phone-context.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
/** A standalone Android APK (not the Alpha system image), with the shell's foreground reviews. */
export const DEVICE_PROFILE = Object.freeze({ android: true, native: true, camera: false, foregroundReview: true, clockRepeatDays: false, aospImage: false });
/** Device-record capabilities an agent may offer, including two the phone never negotiates. */
const OFFERED = [
  'calendar.local-event.v1', 'calendar.availability-read.v1', 'notes.local-record.v1', 'notes.query.v1', 'notes.search.v1',
  'device.named-target.v1', 'reminders.local-record.v1', 'reminders.local-record.v2', 'reminders.create.v1',
];
const CAPABILITIES = selectDeviceCapabilities(OFFERED, DEVICE_PROFILE);
const CASESET_REVISION = 2;
/** Fixed, versioned case set. Changing it changes CASESET_SHA256 in every result. */
export const CASES = Object.freeze([
  { id: 'free-no-time', expect: 'clarify', view: 'home', text: 'Am I free?' },
  { id: 'free-ambiguous-day', expect: 'clarify', view: 'home', text: 'Am I free at 3?' },
  { id: 'delete-it-no-referent', expect: 'clarify', view: 'home', text: 'Delete it.' },
  { id: 'move-meeting-no-target', expect: 'clarify', view: 'home', text: 'Move my meeting to later.' },
  { id: 'remind-no-time', expect: 'clarify', view: 'home', text: 'Remind me about the thing.' },
  { id: 'edit-note-no-change', expect: 'clarify', view: 'home', text: 'Change my note.' },
  { id: 'cancel-reminder-which', expect: 'clarify', view: 'home', text: 'Cancel my reminder.' },
  { id: 'note-about-unspecified', expect: 'clarify', view: 'home', text: 'Find that note I wrote.' },
  { id: 'control-free-exact', expect: 'propose', view: 'home', text: 'Am I free tomorrow from 3pm to 4pm?' },
]);
const CASESET_SHA256 = createHash('sha256').update(JSON.stringify(CASES)).digest('hex');

/** Proposal beats prose: a durable proposal is a proposal even if the reply also asks. */
export function classify({ proposals, reply }: any) {
  if (proposals > 0) return 'proposal';
  const text = String(reply ?? '').trim();
  if (!text) return 'empty';
  return /\?\s*(?:["'”’)\]]\s*)?$/m.test(text) || /\?\s/.test(text) ? 'clarifying-question' : 'other';
}
export function summarize(rows: any) {
  const rate = (subset: any, outcome: any) => (subset.length ? subset.filter((row: any) => row.outcome === outcome).length / subset.length : null);
  const ambiguous = rows.filter((row: any) => row.expect === 'clarify'), controls = rows.filter((row: any) => row.expect === 'propose');
  return {
    ambiguous: { cases: ambiguous.length, clarifyingQuestionRate: rate(ambiguous, 'clarifying-question'), proposalRate: rate(ambiguous, 'proposal') },
    controls: { cases: controls.length, proposalRate: rate(controls, 'proposal'), clarifyingQuestionRate: rate(controls, 'clarifying-question') },
    errors: rows.filter((row: any) => row.outcome === 'error').length,
  };
}
function sha256File(file: any) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function git(args: any) { try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } }
/** Binds a result to the exact source and case set that produced it. */
export function sourceBinding() {
  return {
    head: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    upstreamPin: JSON.parse(fs.readFileSync(path.join(root, 'upstream.lock.json'), 'utf8')).commit,
    script: sha256File(fileURLToPath(import.meta.url)),
    caseSet: CASESET_SHA256,
    caseSetRevision: CASESET_REVISION,
    comparability: `Scores compare only with case set revision ${CASESET_REVISION} on the same device profile.`,
  };
}
function loopback(origin: any) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Error('Use an http(s) resident runtime origin');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/' || url.search || url.username) throw Error('The evaluation talks only to a loopback resident runtime origin');
  return url.origin;
}
async function client(origin: any, token: any) {
  const installationId = randomUUID(), key = randomBytes(32).toString('hex');
  const device = { 'X-Eliza-Device-Id': installationId, 'X-Eliza-Device-Key': key, 'X-Eliza-Device-Capabilities': CAPABILITIES.join(',') };
  const call = async (pathname: string, body?:unknown) => {
    const response = await fetch(origin + pathname, { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...device }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error(`${pathname} returned HTTP ${response.status}`);
    return response.json();
  };
  const registered = await call('/api/client-devices/register', { label: 'Alpha clarification eval', workflowProtocol: 0 });
  if (registered.installationId !== installationId) throw Error('Device registration was not verified');
  // The phone's own selection over what the agent offered.
  const negotiated = selectDeviceCapabilities(registered.capabilities, DEVICE_PROFILE);
  device['X-Eliza-Device-Capabilities'] = negotiated.join(',');
  return { call, negotiated, revoke: () => call('/api/client-devices/revoke', {}) };
}
/** Sends each case once and records its outcome; every proposal it caused is rejected. */
export async function evaluate({ origin, token, cases = CASES, now = () => new Date() }: any) {
  const { call, negotiated, revoke } = await client(loopback(origin), token);
  let revoked = false;
  try {
    const seen = new Set((await call('/api/client-devices/proposals')).proposals.map((p: any) => p.id));
    // Rejects every unseen proposal. Called before each case and at the end, so a late or
    // orphaned proposal (for example after a timed-out turn) is rejected and counted as stray,
    // never attributed to the next case.
    const sweep = async () => {
      let stray = 0;
      for (const proposal of (await call('/api/client-devices/proposals')).proposals.filter((p: any) => !seen.has(p.id))) {
        seen.add(proposal.id); stray++;
        if (proposal.state === 'pending') await call(`/api/client-devices/proposals/${encodeURIComponent(proposal.id)}/decision`, { digest: proposal.digest, decision: 'reject' });
      }
      return stray;
    };
    const rows: any[] = [];
    let strayProposals = 0;
    for (const item of cases) {
      const row = { id: item.id, expect: item.expect };
      try {
        strayProposals += await sweep();
        const { conversation } = await call('/api/conversations', { title: `Clarification eval ${item.id}` });
        const context = { view: item.view, revision: 1, sensitive: false, timeZone: 'America/New_York' };
        const reply = await call(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { text: item.text, channelType: 'DM', metadata: { uiTimeZone: context.timeZone, clientDevice: { context } }, clientMessageId: randomUUID() });
        const created = (await call('/api/client-devices/proposals')).proposals.filter((p: any) => !seen.has(p.id));
        for (const proposal of created) {
          seen.add(proposal.id);
          if (proposal.state === 'pending') await call(`/api/client-devices/proposals/${encodeURIComponent(proposal.id)}/decision`, { digest: proposal.digest, decision: 'reject' });
        }
        Object.assign(row, { outcome: classify({ proposals: created.length, reply: reply.text }), proposals: created.map((p: any) => p.payload?.operation?.type ?? 'unknown'), replyChars: String(reply.text ?? '').length });
      } catch (error: any) {
        Object.assign(row, { outcome: 'error', error: String(error.message).slice(0, 200) });
      }
      rows.push(row);
    }
    strayProposals += await sweep();
    // The synthetic enrollment never outlives the run.
    await revoke(); revoked = true;
    return { version: 1, kind: 'device-action-clarification', recordedAt: now().toISOString(), expectedModel: AGENT_MODEL, deviceProfile: { kind: 'android-apk', ...DEVICE_PROFILE }, negotiatedCapabilities: negotiated, source: sourceBinding(), summary: { ...summarize(rows), strayProposals }, rows };
  } finally {
    if (!revoked) await revoke().catch(() => {});
  }
}

async function selfTest() {
  // Synthetic agent: asks back for ambiguous text, proposes for the controls.
  const token = 'synthetic-eval-token', proposals: any[] = [];
  let late = false, revokes = 0;
  const server = http.createServer(async (req: any, res: any) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined, send = (value: any) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.url === '/api/client-devices/register') return send({ installationId: req.headers['x-eliza-device-id'], enrollmentId: 'enrollment', capabilities: CAPABILITIES.slice(0, 4) });
    if (req.url === '/api/client-devices/revoke') { revokes++; return send({ revoked: true }); }
    if (req.url === '/api/client-devices/proposals') {
      send({ proposals: proposals.map((p: any) => ({ ...p })) });
      // Arrives just after this case's listing: the next sweep must reject it as stray.
      if (late) { late = false; proposals.push({ id: 'late', digest: 'd', state: 'pending', payload: { operation: { type: 'notes_named' } } }); }
      return;
    }
    if (req.url === '/api/conversations') return send({ conversation: { id: 'c' + proposals.length + Math.random().toString(16).slice(2) } });
    if (req.url.endsWith('/decision')) { const p = proposals.find((item: any) => req.url.includes(item.id)); assert.equal(body.decision, 'reject'); p.state = 'rejected'; return send({ proposal: p, digest: p.digest }); }
    if (req.url.endsWith('/messages')) {
      assert.equal(body.metadata.clientDevice.context.sensitive, false);
      if (/tomorrow|passport|called/.test(body.text)) { proposals.push({ id: 'p' + proposals.length, digest: 'd', state: 'pending', payload: { operation: { type: 'calendar_availability' } } }); return send({ text: 'Review it on your phone.' }); }
      // A late proposal from an earlier turn lands after this reply: it is stray, not this case's.
      if (body.text === 'Delete it.') { late = true; return send({ text: 'Which item would you like to delete?' }); }
      return send({ text: 'Could you tell me which one, and when?' });
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve: any) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await evaluate({ origin: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, token });
    assert.deepEqual(result.summary, { ambiguous: { cases: 8, clarifyingQuestionRate: 1, proposalRate: 0 }, controls: { cases: 1, proposalRate: 1, clarifyingQuestionRate: 0 }, errors: 0, strayProposals: 1 });
    assert.ok(proposals.every((p: any) => p.state === 'rejected'), 'every caused proposal is rejected');
    assert.equal(revokes, 1, 'the synthetic device is revoked once at the end');
    assert.equal(result.expectedModel, AGENT_MODEL); assert.ok(!('model' in result), 'the runtime model is not claimed as observed');
    assert.deepEqual(result.negotiatedCapabilities, CAPABILITIES.slice(0, 4));
    assert.equal(result.deviceProfile.aospImage, false);
    for (const capability of ['notes.search.v1', 'device.named-target.v1']) assert.ok(!CAPABILITIES.includes(capability), `the phone never negotiates ${capability}`);
    assert.equal(result.source.caseSetRevision, CASESET_REVISION);
    assert.match(result.source.caseSet, /^[a-f0-9]{64}$/);
    assert.equal(classify({ proposals: 1, reply: 'Which one?' }), 'proposal');
    assert.equal(classify({ proposals: 0, reply: 'Done.' }), 'other');
    assert.equal(classify({ proposals: 0, reply: '' }), 'empty');
    assert.throws(() => loopback('https://agent.example.com'), /loopback/);
    console.log('PASS clarification eval harness: classification, per-case conversations, rejection of every caused proposal (late ones counted as stray, never misattributed), synthetic device revoked, loopback-only origin and source binding. Synthetic agent only; not a model result.');
  } finally { server.closeAllConnections(); await new Promise((resolve: any) => server.close(resolve)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name: any) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  if (args.includes('--self-test')) await selfTest();
  else {
    const origin = flag('--origin'), tokenFile = flag('--token-file'), output = flag('--output');
    if (!origin || !tokenFile || !output) { console.error('Usage: eval-device-action-clarification.ts --origin <loopback> --token-file <file> --output <json> | --self-test'); process.exit(2); }
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    const result = await evaluate({ origin, token });
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result.summary));
  }
}
