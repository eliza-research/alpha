/** Actual patched Eliza backend + model + typed phone client. Desktop file effect
 * is a journal harness, NOT Android/device acceptance. Never uses Cloud grants. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
if (!process.execArgv.includes('--experimental-transform-types')) process.exit(spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]], { stdio: 'inherit', env: process.env }).status ?? 1);
const { DeviceActions, actionScope } = await import('../apps/app/src/runtime/device-actions.ts');
const origin = process.env.ALPHA_DEVICE_ORIGIN || 'http://127.0.0.1:47840';
const parsed = new URL(origin);
if (parsed.origin !== origin || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Disposable loopback backend required');
const sessionFile = process.env.ALPHA_DEVICE_SESSION_FILE;
if (!sessionFile || (await fs.stat(sessionFile)).mode & 0o077) throw new Error('Owner-only session file required');
const saved = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
if (typeof saved.token !== 'string') throw new Error('Session token unavailable');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alpha-device-flow-'));
await fs.chmod(directory, 0o700);
const result = { scope: 'Actual patched loopback backend, model proposal and desktop journal harness; not Android or enclave acceptance', passed: false, checks: [] };
const signal = () => AbortSignal.timeout(180000);
let deviceHeaders = {};
const request = async (endpoint, body, requestSignal = signal()) => {
  if (!endpoint.startsWith('/api/')) throw new Error('Unexpected route');
  const response = await fetch(origin + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${saved.token}`, 'X-Forwarded-For': '192.0.2.1', 'Content-Type': 'application/json', ...deviceHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: requestSignal });
  if (!response.ok) throw Object.assign(new Error('Backend request rejected'), { status: response.status });
  return response.json();
};
const write = async (file, value) => { await fs.writeFile(file + '.new', JSON.stringify(value), { mode: 0o600 }); await fs.rename(file + '.new', file); };
const entries = new Map();
const journalFile = path.join(directory, 'journal.json');
const persist = () => write(journalFile, [...entries]);
const journal = {
  reserve: async value => { if (entries.has(value.proposalId)) return { created: false, entry: entries.get(value.proposalId) }; const entry = { ...value, phase: 'reserved' }; entries.set(value.proposalId, entry); await persist(); return { created: true, entry }; },
  markApplying: async value => { const entry = entries.get(value.proposalId); assert.equal(entry.phase, 'reserved'); Object.assign(entry, { phase: 'applying', attemptId: value.attemptId }); await persist(); },
  finish: async value => { const entry = entries.get(value.proposalId); assert.equal(entry.phase, 'applying'); Object.assign(entry, value, { phase: 'terminal' }); await persist(); },
  get: async value => ({ entry: entries.get(value.proposalId) || null }), list: async () => ({ entries: [...entries.values()] }),
};
try {
  const me = await request('/api/auth/me');
  assert.equal(me.access.mode, 'session'); assert.equal(me.access.role, 'OWNER'); assert.equal(me.session.kind, 'machine');
  const agents = await request('/api/agents'); assert.equal(agents.agents.length, 1);
  const agent = agents.agents[0]; assert.equal(agent.status, 'running');
  const session = { ownerId: me.identity.id, agentId: agent.id, sessionId: crypto.randomUUID(), origin };
  const credential = { installationId: crypto.randomUUID(), key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex') };
  // Ephemeral enrollment material remains in an owner-only fixture directory.
  deviceHeaders = { 'X-Eliza-Device-Id': credential.installationId, 'X-Eliza-Device-Key': credential.key };
  const registered = await request('/api/client-devices/register', { label: 'Alpha desktop device-flow fixture' });
  assert.equal(registered.installationId, credential.installationId); credential.enrollmentId = registered.enrollmentId;
  await write(path.join(directory, 'enrollment.json'), credential);
  result.checks.push('verified owner session and device enrollment');
  const scope = await actionScope(JSON.stringify([origin, session.ownerId, session.agentId, credential.installationId]));
  let effectCount = 0;
  const client = new DeviceActions(session, credential, scope, request, journal, async (operation, operationId) => {
    assert.equal(operation.type, 'create_note');
    assert.equal(operation.title, 'Alpha device flow fixture');
    assert.equal(operation.body, 'Synthetic desktop fixture only.');
    assert.equal([...entries.values()][0].phase, 'applying');
    await fs.writeFile(path.join(directory, operationId + '.note.json'), JSON.stringify(operation), { flag: 'wx', mode: 0o600 });
    effectCount++;
    return { status: 'succeeded', summary: 'Saved synthetic desktop note fixture' };
  });
  const created = await request('/api/conversations', { title: 'Alpha device flow fixture' });
  const conversationId = created.conversation.id;
  const modelReply = await request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { text: 'First discover the exact PROPOSE_DEVICE_ACTION tool using DISCOVER_ACTIONS if it is not already loaded. Then use PROPOSE_DEVICE_ACTION to propose exactly one create_note operation for this enrolled phone, with title "Alpha device flow fixture" and body "Synthetic desktop fixture only." Do not create any other object. Do not claim it is saved; wait for explicit device approval.', channelType: 'DM', clientMessageId: crypto.randomUUID() });
  await write(path.join(directory, 'reply.json'), modelReply);
  const context = { view: 'notes', sensitive: false, revision: 1 };
  const proposals = await client.pending(context, signal());
  await write(path.join(directory, 'proposals.json'), proposals);
  assert.equal(proposals.length, 1, 'Model must produce one structured pending device proposal');
  assert.equal(effectCount, 0); result.checks.push('model produced structured proposal with no preapproval effect');
  const receipt = await client.approve(proposals[0].id, context, signal());
  assert.equal(receipt.status, 'succeeded'); assert.equal(effectCount, 1);
  const history = await client.history(signal()); assert.equal(history.find(item => item.id === proposals[0].id).state, 'done');
  assert.equal(history[0].local.phase, 'terminal');
  result.checks.push('decision claim journal effect receipt reaches server done');
  const readBack = JSON.parse(await fs.readFile(journalFile, 'utf8')); assert.equal(readBack[0][1].status, 'succeeded');
  await client.syncReceipts(signal()); assert.equal(effectCount, 1);
  result.checks.push('durable harness journal readback and receipt resync without effect replay');
  result.passed = true;
} catch (error) {
  result.failure = error?.code === 'ERR_ASSERTION' ? 'Flow assertion failed; inspect private harness artifacts and backend log' : 'Backend or harness operation failed';
  if (Number.isInteger(error?.status)) result.httpStatus = error.status;
  process.exitCode = 1;
} finally {
  await write(path.join(directory, 'result.json'), result);
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks, artifacts: directory, ...(result.failure ? { failure: result.failure, httpStatus: result.httpStatus } : {}) }));
}
