import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { createLocalAgentDevHandler } from '../local-agent-dev-bridge.ts';
import { startLoopback, stopLoopback } from './loopback.ts';

export async function speechBridgeFixture(
  handle: (req: IncomingMessage, res: ServerResponse, bytes: Buffer) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-speech-bridge-'));
  const tokenFile = join(directory, 'token');
  const token = 'synthetic-owner-token';
  writeFileSync(tokenFile, 'a'.repeat(64), {mode: 0o600});
  const host = http.createServer(async (req, res) => {
    const bytes = await buffer(req);
    let result: unknown;
    switch (req.url) {
      case '/api/auth/status': result = {instanceId: 'instance'}; break;
      case '/api/auth/pair-code': result = {code: 'fixture'}; break;
      case '/api/auth/pair': result = {token, instanceId: 'instance', identityId: 'owner', access: 'owner'}; break;
      case '/api/auth/me':
        result = {identity: {id: 'owner'}, access: {role: 'OWNER'}, session: {id: token, expiresAt: Date.now() + 60000}};
        break;
      default:
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        handle(req, res, bytes);
        return;
    }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(result));
  });
  try {
    const hostOrigin = await startLoopback(host);
    const proxy = http.createServer(createLocalAgentDevHandler({origin: hostOrigin, tokenFile}));
    const origin = await startLoopback(proxy);
    return {
      token,
      invoke(input: unknown, signal?: AbortSignal, source = origin) {
        return fetch(origin, {
          method: 'POST',
          headers: {Origin: source, 'Content-Type': 'application/json', 'X-Alpha-Local-Agent': '1'},
          body: JSON.stringify(input),
          signal,
        });
      },
      async close() {
        proxy.closeAllConnections();
        host.closeAllConnections();
        try { await Promise.all([stopLoopback(proxy), stopLoopback(host)]); }
        finally { rmSync(directory, {recursive: true, force: true}); }
      },
    };
  } catch (error) {
    host.closeAllConnections();
    if (host.listening) await stopLoopback(host);
    rmSync(directory, {recursive: true, force: true});
    throw error;
  }
}
