// Real HTTP transport contract exercise, using an explicitly synthetic host.
// This does not establish acceptance against Eliza or the deployed enclave.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
if (!process.execArgv.includes('--experimental-transform-types')) {
  const child = spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
const { RemoteProtocol, normalizeRemoteOrigin } = await import('../apps/app/src/runtime/remote-protocol.ts');
let now = Date.now(), mode = 'ok', creates = 0, sends = 0, truncates = 0;
const routedRequests=[];
const conversation = { id: 'conversation-fixture', title: 'Contract flow' };
const token = 'synthetic-machine-session';
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  let response;
  if (req.url === '/api/auth/status') response = { required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'host-fixture', expiresAt: now + 10000 };
  else if (req.url === '/api/auth/pair') {
    assert.deepEqual(body, { code: 'synthetic-code', instanceId: 'host-fixture' });
    response = { token, identityId: 'owner-fixture', access: 'owner', instanceId: 'host-fixture' };
  } else {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (mode === 'unavailable') { res.writeHead(503); res.end('{}'); return; }
    if (mode === 'revoked') { res.writeHead(401); res.end('{}'); return; }
    if (req.url === '/api/auth/me') response = { identity: { id: mode === 'changed-owner' ? 'someone-else' : 'owner-fixture', displayName: 'Fixture owner', kind: 'owner' }, session: { id: token, kind: 'machine', expiresAt: now + 60000 }, access: { role: 'OWNER', mode: 'session' } };
    else if (req.url === '/api/conversations' && req.method === 'POST') { creates++; response = { conversation }; }
    else if (req.url === '/api/conversations') response = { conversations: [conversation] };
    else if(req.url.endsWith('/messages/truncate')){truncates++;assert.equal(req.method,'POST');assert.deepEqual(body,{messageId:'11111111-1111-4111-8111-111111111111',inclusive:true});response={ok:true,deletedCount:2};}
    else if (req.url.endsWith('/messages') && req.method === 'POST') {
      sends++;
      routedRequests.push({clientId:req.headers['x-elizaos-client-id'],body});
      assert.equal(body.channelType, 'DM');
      response = { text: 'Synthetic contract reply', agentName: 'Fixture' };
    } else response = { messages: [{ role: 'assistant', text: 'Synthetic contract reply' }], hasMore: false };
  }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let saved = null;
const store = { async read() { return saved; }, async write(value) { saved = structuredClone(value); }, async remove() { saved = null; } };
const request = async ({ url, method, headers, body, signal }) => {
  const response = await fetch(url, { method, headers, body, signal, redirect: 'error' });
  return { status: response.status, body: await response.json() };
};
const make = () => new RemoteProtocol(origin, request, store, { developmentOrigins: [origin], now: () => now });
try {
  assert.throws(() => normalizeRemoteOrigin(origin));
  assert.throws(() => normalizeRemoteOrigin('https://example.org/foreign/path'));
  assert.throws(() => normalizeRemoteOrigin('https://user:password@example.org'));
  const client = make();
  assert.equal((await client.pair('synthetic-code')).identityId, 'owner-fixture');
  const created = await client.createConversation('Contract flow');
  assert.equal(created.id, conversation.id);
  assert.equal((await client.listConversations()).length, 1);
  assert.equal((await client.send(created.id, 'Hello')).text, 'Synthetic contract reply');
  const metadata={viewClientId:'renderer-fixture',viewDelivery:'completed-action'};
  await client.send(created.id,'Open Notes',{metadata,clientMessageId:'header-request'});
  assert.equal(routedRequests.at(-1).clientId,metadata.viewClientId);
  assert.equal(routedRequests.at(-1).body.metadata.viewDelivery,'completed-action');
  let dropped=false;
  const recovering=new RemoteProtocol(origin,async input=>{const response=await request(input);if(input.url.endsWith('/messages')&&!dropped){dropped=true;throw new TypeError('fetch failed');}return response;},store,{developmentOrigins:[origin],now:()=>now});
  await recovering.restore();
  await recovering.send(created.id,'Open Notes',{metadata,clientMessageId:'same-id-recovery'});
  const attempts=routedRequests.slice(-2);assert.equal(attempts.length,2);
  assert.deepEqual(attempts.map(x=>x.clientId),['renderer-fixture','renderer-fixture']);
  assert.deepEqual(attempts.map(x=>x.body.clientMessageId),['same-id-recovery','same-id-recovery']);
  const beforeInvalid=sends;
  await assert.rejects(client.send(created.id,'Invalid',{metadata:{viewClientId:'bad/header'}}),error=>error.code==='invalid_view_client_id');
  assert.equal(sends,beforeInvalid);
  assert.equal((await client.messages(created.id)).messages.length, 1);
  await client.truncateMessages(created.id,'11111111-1111-4111-8111-111111111111',new AbortController().signal);assert.equal(truncates,1);
  assert.equal((await make().restore()).identityId, 'owner-fixture');
  mode = 'unavailable';
  await assert.rejects(make().restore(), error => error.status === 503);
  assert.ok(saved, 'temporary outage must preserve credential');
  await assert.rejects(client.send(created.id, 'No automatic replay'), error => error.status === 503);
  assert.equal(sends, 4);
  mode = 'changed-owner';
  await assert.rejects(make().restore(), error => error.code === 'identity_changed');
  assert.equal(saved, null);
  mode = 'ok'; await client.pair('synthetic-code');
  mode = 'revoked';
  await assert.rejects(client.listConversations(), error => error.status === 401);
  assert.equal(saved, null); assert.equal(client.session, null);
  mode = 'ok'; await client.pair('synthetic-code');
  now += 120000;
  await assert.rejects(make().restore(), error => error.code === 'session_expired');
  assert.equal(saved, null);
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(make().status(cancel.signal), error => error.name === 'AbortError');
  // A completed old HTTP response must not attach history after disconnect.
  let responseStarted, releaseResponse;
  const started = new Promise(resolve => { responseStarted = resolve; });
  const released = new Promise(resolve => { releaseResponse = resolve; });
  const staleClient = new RemoteProtocol(origin, async input => {
    const response = await request(input);
    if (input.url.endsWith('/api/conversations')) {
      responseStarted();
      await released;
    }
    return response;
  }, store, { developmentOrigins: [origin], now: () => now });
  await staleClient.pair('synthetic-code');
  const staleRead = staleClient.listConversations();
  await started;
  await staleClient.disconnect();
  releaseResponse();
  await assert.rejects(staleRead, error => error.code === 'connection_changed');
  assert.equal(staleClient.session, null);
  assert.equal(saved, null);
  // Pairing must reject a response from another instance before saving a token.
  const wrongInstance = new RemoteProtocol(origin, async input => {
    const response = await request(input);
    if (input.url.endsWith('/api/auth/pair')) response.body.instanceId = 'other-instance';
    return response;
  }, store, { developmentOrigins: [origin], now: () => now });
  await assert.rejects(wrongInstance.pair('synthetic-code'), error => error.code === 'pairing_identity_mismatch');
  assert.equal(saved, null);
  for (const operation of ['pair', 'restore']) {
    mode = 'ok';
    if (operation === 'restore') await make().pair('synthetic-code');
    let signalWriteStarted, releaseWrite;
    const writeStarted = new Promise(resolve => { signalWriteStarted = resolve; });
    const writeReleased = new Promise(resolve => { releaseWrite = resolve; });
    const deferredStore = { ...store, async write(record) {
      signalWriteStarted();
      await writeReleased;
      await store.write(record);
    } };
    const deferred = new RemoteProtocol(origin, request, deferredStore, { developmentOrigins: [origin], now: () => now });
    const controller = new AbortController();
    const pending = operation === 'pair' ? deferred.pair('synthetic-code', controller.signal) : deferred.restore(controller.signal);
    await writeStarted;
    controller.abort();
    // Serialization stays active while the non-cancellable native write finishes.
    await assert.rejects(deferred.pair('synthetic-code'), error => error.code === 'authentication_in_progress');
    releaseWrite();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(deferred.session, null, `${operation}: cancellation must not attach identity`);
    assert.equal(saved, null, `${operation}: cancellation must remove committed credential`);
  }
  assert.equal(creates, 1);
  process.stdout.write('PASS: HTTP contract pairing, owner validation, conversation/send/history, restart, outage, revocation, expiry, cancellation including deferred credential writes, no write retries. Synthetic host only.\n');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
