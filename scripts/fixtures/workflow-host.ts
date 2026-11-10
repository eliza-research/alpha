import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import type { RemoteCredential, RemoteRequest, RemoteResponse } from '../../apps/app/src/runtime/remote-protocol.ts';
import type { RemoteWorkflow, WorkflowApproval, WorkflowApprovalReceipt, WorkflowLifecycleReceipt, WorkflowMetadataReceipt, WorkflowRun } from '../../apps/app/src/runtime/workflow-protocol.ts';

type Execution = WorkflowRun & { cancellationRequestedAt?: string; approvals?: WorkflowApproval[] };
type WorkflowStatus = { manualSubmissionProtocol: number; lifecycleMutationProtocol: number; metadataMutationProtocol: number; approvalReceiptProtocol: number };
type WorkflowRoute = `/api/workflow/${string}`;
type ResponseBody<Route extends WorkflowRoute> =
  Route extends '/api/workflow/status' ? WorkflowStatus :
  Route extends `/api/workflow/executions/${string}/approvals${string}` ? WorkflowApprovalReceipt :
  Route extends `/api/workflow/executions/${string}` ? { execution: Execution } :
  Route extends `/api/workflow/workflows/${string}/submissions/${string}` ? { execution: Execution | null } :
  Route extends `/api/workflow/workflows/${string}/run` ? { execution: Execution; code?: string; workflowId?: string; submissionId?: string; expectedVersionId?: string } :
  Route extends `/api/workflow/workflows/${string}/executions` ? { executions: Execution[] } :
  Route extends `/api/workflow/workflows/${string}/lifecycle${string}` ? { receipt: WorkflowLifecycleReceipt } :
  Route extends `/api/workflow/workflows/${string}/metadata${string}` ? { receipt: WorkflowMetadataReceipt; code?: string } :
  Route extends `/api/workflow/workflows/${string}/revisions` ? { revisions: RemoteWorkflow[] } :
  Route extends '/api/workflow/removed-workflows' ? { workflows: RemoteWorkflow[] } :
  Route extends '/api/workflow/workflows' | `/api/workflow/workflows/${string}` ? RemoteWorkflow : unknown;

export type HostProcess = { pid: number; port: number; profile: string; source: string };
export type ApprovalFixture = { workflowId: string; versionId: string; runId: string; a: WorkflowApproval; dir: string; effect: string; pid: number };
export type HostReport = { testedAt: string; scope: string; passed: boolean; error?: string } & Record<string, unknown>;

export function workflowHost(port: number, profileName: string, options: { forwardedFor?: boolean; timeout?: number } = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const profile = path.join(os.homedir(), '.local/share/alphaphone', profileName);
  const pairedSession = 'paired-session.json';
  const timeout = options.timeout ?? 30_000;
  const headers = { Host: `10.0.2.2:${port}`, ...(options.forwardedFor ? { 'X-Forwarded-For': '192.0.2.1' } : {}) };
  let credential: RemoteCredential | null = null;

  const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8'));
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(profile, name), JSON.stringify(value), { mode: 0o600 });
  const restore = () => {
    assert.equal(fs.statSync(path.join(profile, pairedSession)).mode & 0o077, 0);
    credential = read<RemoteCredential>(pairedSession);
    return credential;
  };

  const request = (input: RemoteRequest): Promise<RemoteResponse> => new Promise((resolve, reject) => {
    const url = new URL(input.url);
    assert.equal(url.origin, origin, 'Workflow fixture must stay on its isolated loopback origin');
    const req = http.request(url, { method: input.method, headers: { ...input.headers, ...headers }, signal: input.signal ?? AbortSignal.timeout(timeout) }, res => {
      res.setEncoding('utf8');
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.ok(res.statusCode);
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(input.body);
  });

  const pair = async () => {
    const { RemoteProtocol }: typeof import('../../apps/app/src/runtime/remote-protocol.ts') = await tsImport('../../apps/app/src/runtime/remote-protocol.ts', import.meta.url);
    const remote = new RemoteProtocol(origin, request, {
      read: async () => credential,
      write: async value => { credential = value; },
      remove: async () => { credential = null; },
    }, { developmentOrigins: [origin] });
    const ownerToken = fs.readFileSync(path.join(profile, 'owner-token'), 'utf8').trim();
    const response = await fetch(origin + '/api/auth/pair-code', { headers: { Authorization: `Bearer ${ownerToken}` }, signal: AbortSignal.timeout(timeout), redirect: 'error' });
    assert.ok(response.ok, 'Expected a fixture pairing code');
    const pairCode: { code?: unknown } = await response.json();
    assert.ok(typeof pairCode.code === 'string', 'Expected a string pairing code');
    const identity = await remote.pair(pairCode.code);
    assert.ok(credential, 'Pairing must create a fixture credential');
    write(pairedSession, credential);
    return identity;
  };

  const call = async <Route extends WorkflowRoute>(route: Route, body?: object): Promise<{ status: number; body: ResponseBody<Route> }> => {
    assert.ok(credential, 'Pair or restore the fixture session before using it');
    const reply = await request({ url: origin + route, method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: reply.status, body: reply.body as ResponseBody<Route> };
  };
  const expectOk = async <Route extends WorkflowRoute>(route: Route, body?: object) => {
    const reply = await call(route, body);
    assert.ok(reply.status >= 200 && reply.status < 300, `Fixture request failed (HTTP ${reply.status})`);
    return reply.body;
  };
  const unauthenticatedStatus = async () => (await request({ url: origin + '/api/workflow/status', method: 'GET', headers: {} })).status;
  return { profile, read, write, restore, pair, call, expectOk, unauthenticatedStatus };
}

export function writeHostReport(directory: string, name: string, result: HostReport) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
