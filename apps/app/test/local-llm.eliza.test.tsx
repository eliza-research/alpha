// @vitest-environment node
// spec/agent/index.md, "Story: Run Alpha's agent on the phone"
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

interface UdsCallAnswer {
  readonly status: number;
  readonly body: unknown;
}

interface RunningLocalAgent {
  readonly socket: string;
  readonly token: string;
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

const agentPackDir = path.resolve(import.meta.dirname, "../../agent/dist");
const scratchDirs: string[] = [];

function makeScratch(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function writeOfflineLaunchDocument(stateDir: string, environment: Record<string, string>): string {
  const readHostJson = (name: string) => JSON.parse(fs.readFileSync(path.join(agentPackDir, "host", name), "utf8")) as Record<string, unknown>;
  const host = readHostJson("host.json");
  const policy = readHostJson("policy.json") as { actions: { allowed: string[] }; plugins: { load: string[]; product?: string } };
  const launchFile = path.join(stateDir, "launch-local.json");
  fs.writeFileSync(
    launchFile,
    JSON.stringify({
      schema: 1,
      character: readHostJson("character.json"),
      policy: { actions: { allowed: policy.actions.allowed }, plugins: policy.plugins },
      model: { backend: "none" },
      embeddings: "none",
      persistMemory: true,
      callerRole: "owner",
      views: host.views,
      privacy: host.privacy,
      google: host.google,
      environment,
    }),
    { mode: 0o600 },
  );
  return launchFile;
}

function startOfflineLocalAgent(stateDir: string, launchFile: string): RunningLocalAgent {
  const agentHome = path.join(stateDir, "agent-state");
  fs.mkdirSync(agentHome, { recursive: true, mode: 0o700 });
  const socket = path.join(stateDir, "agent.sock");
  const token = randomBytes(32).toString("base64url");
  const child: ChildProcess = spawn(
    process.execPath,
    [path.join(agentPackDir, "bundle/agent.mjs"), "serve", "--launch", launchFile, "--state", agentHome, "--socket", socket],
    {
      env: {
        PATH: process.env.PATH,
        HOME: agentHome,
        TMPDIR: agentHome,
        HTTP_PROXY: "http://127.0.0.1:1",
        HTTPS_PROXY: "http://127.0.0.1:1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (d: string) => { stderr += d; });
  const exited = new Promise<number | null>((done) => child.once("close", (code) => done(code)));
  child.stdin?.end(`${JSON.stringify({ version: 1, token, epoch: Date.now() })}\n`);
  return {
    socket,
    token,
    exited,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      void stderr;
    },
  };
}

function exchangeSocket(socket: string, frame: object, onLine: (line: Record<string, unknown>) => boolean): Promise<void> {
  return new Promise((done, fail) => {
    const conn = net.createConnection(socket);
    let pending = "";
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(`${JSON.stringify(frame)}\n`));
    conn.on("data", (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
        const parsed = JSON.parse(pending.slice(0, end)) as Record<string, unknown>;
        pending = pending.slice(end + 1);
        if (onLine(parsed)) {
          conn.end();
          done();
          return;
        }
      }
    });
    conn.on("error", fail);
    conn.on("close", () => fail(new Error("Agent socket closed before completion")));
  });
}

async function agentCall(agent: RunningLocalAgent, method: string, route: string, body?: unknown): Promise<UdsCallAnswer> {
  let answer: UdsCallAnswer = { status: 0, body: undefined };
  await exchangeSocket(
    agent.socket,
    {
      id: randomUUID(),
      method: "http_request",
      payload: {
        path: route,
        method,
        headers: { authorization: `Bearer ${agent.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    },
    (line) => {
      const result = line.result as { status: number; body: string } | undefined;
      if (result === undefined) {
        answer = { status: 0, body: line.error };
      } else {
        let parsed: unknown;
        try {
          parsed = result.body === "" ? undefined : JSON.parse(result.body) as unknown;
        } catch {
          parsed = result.body;
        }
        answer = { status: result.status, body: parsed };
      }
      return true;
    },
  );
  return answer;
}

async function agentStream(agent: RunningLocalAgent, route: string, body: unknown): Promise<{ readonly status: number; readonly sseText: string }> {
  let status = 0;
  let sseText = "";
  await exchangeSocket(
    agent.socket,
    {
      id: randomUUID(),
      method: "http_request_stream",
      payload: {
        path: route,
        method: "POST",
        headers: { authorization: `Bearer ${agent.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    },
    (line) => {
      if (line.stream === "response") {
        status = Number(line.status ?? 0);
        return false;
      }
      if (line.stream === "chunk") {
        const encoded = typeof line.dataBase64 === "string" ? line.dataBase64 : "";
        sseText += Buffer.from(encoded, "base64").toString("utf8");
        return false;
      }
      return true;
    },
  );
  return { status, sseText };
}

async function waitForReady(agent: RunningLocalAgent, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exitCode: number | null | undefined;
  void agent.exited.then((code) => { exitCode = code; });
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new Error(`Offline agent exited early with code ${exitCode}`);
    }
    const health = await agentCall(agent, "GET", "/api/health").catch(() => ({ status: 0, body: undefined }));
    if (health.status === 200) return;
    await Effect.runPromise(Effect.sleep("100 millis"));
  }
  throw new Error("Offline local-LLM agent did not become ready in time");
}

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Offline zero-sign-in Local LLM resident agent E2E", () => {
  // spec/agent/index.md, "Story: Run Alpha's agent on the phone"
  it("boots agent.mjs with zero cloud sign-in, streams Gemma 4 UDS replies, dispatches DEVICE_CONTROL, and serves local-llm routes with zero outbound cloud traffic", async () => {
    const stateDir = makeScratch("alpha-local-llm-e2e-");
    const localLlmSocket = path.join(stateDir, "local-llm.sock");
    const observedOps: string[] = [];
    let toolDispatched = false;

    const mockUdsServer = net.createServer((conn) => {
      let buf = "";
      conn.on("error", () => {});
      conn.setEncoding("utf8");
      conn.on("data", (chunk: string) => {
        buf += chunk;
        for (let idx = buf.indexOf("\n"); idx >= 0; idx = buf.indexOf("\n")) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line === "") continue;
          const req = JSON.parse(line) as {
            id?: string;
            op?: string;
            modelId?: string;
            messages?: { role?: string; content?: string }[];
            tools?: { function?: { name?: string } }[];
          };
          const id = req.id ?? "";
          const op = req.op ?? "";
          observedOps.push(op);

          if (op === "status") {
            conn.write(`${JSON.stringify({ id, ok: true, loadedModelId: "gemma-4-e2b-it-q4" })}\n`);
            continue;
          }
          if (op === "load" || op === "unload") {
            conn.write(`${JSON.stringify({ id, ok: true, modelId: req.modelId ?? "gemma-4-e2b-it-q4" })}\n`);
            continue;
          }
          if (op === "generate" || op === "generate_stream") {
            const joined = (req.messages ?? []).map((m) => `${m.role ?? ""}:${m.content ?? ""}`).join("\n");
            const wantsControl = joined.includes("Click More information in Firefox") && !joined.includes("role=tool") && !toolDispatched;
            if (wantsControl) {
              toolDispatched = true;
              const gemmaToolRaw = '<|tool_call>call:DEVICE_CONTROL{"op":{"type":"ui_click","snapshotId":1,"expectedPackage":"org.mozilla.firefox","nodeId":"w1_n0"}}<tool_call|><end_of_turn>';
              if (op === "generate_stream") {
                conn.write(`${JSON.stringify({ id, event: "done", ok: true, text: gemmaToolRaw, finishReason: "stop", usage: { promptTokens: 48, completionTokens: 20, totalTokens: 68 } })}\n`);
              } else {
                conn.write(`${JSON.stringify({ id, ok: true, text: gemmaToolRaw, finishReason: "stop", usage: { promptTokens: 48, completionTokens: 20, totalTokens: 68 } })}\n`);
              }
              continue;
            }
            const replyText = joined.includes("Click More information in Firefox")
              ? "[answer] I clicked More information in Firefox completely offline."
              : "[answer] Hello from on-device Gemma 4 without any cloud sign-in.";
            if (op === "generate_stream") {
              const midpoint = Math.floor(replyText.length / 2);
              conn.write(`${JSON.stringify({ id, event: "delta", text: replyText.slice(0, midpoint) })}\n`);
              conn.write(`${JSON.stringify({ id, event: "delta", text: replyText.slice(midpoint) })}\n`);
              conn.write(`${JSON.stringify({ id, event: "done", ok: true, text: replyText, toolCalls: [], finishReason: "stop", usage: { promptTokens: 32, completionTokens: 14, totalTokens: 46 } })}\n`);
            } else {
              conn.write(`${JSON.stringify({ id, ok: true, text: replyText, toolCalls: [], finishReason: "stop", usage: { promptTokens: 32, completionTokens: 14, totalTokens: 46 } })}\n`);
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => mockUdsServer.listen(localLlmSocket, resolve));
    const launchFile = writeOfflineLaunchDocument(stateDir, {
      ALPHA_AI_MODE: "local",
      ALPHA_LOCAL_MODEL: "gemma-4-e2b-it-q4",
      ALPHA_LOCAL_LLM_SOCKET: localLlmSocket,
    });
    const agent = startOfflineLocalAgent(stateDir, launchFile);

    try {
      await waitForReady(agent);

      const scope = await agentCall(agent, "GET", "/api/alpha-runtime/scope");
      expect(scope.status).toBe(200);
      expect(scope.body).toMatchObject({ userId: "local", organizationId: "device" });

      const catalog = await agentCall(agent, "GET", "/api/alpha/local-llm/catalog");
      expect(catalog.status).toBe(200);
      const catalogBody = catalog.body as { readonly defaultModelId: string; readonly models: readonly { readonly id: string; readonly license: string }[] };
      expect(catalogBody.defaultModelId).toBe("gemma-4-e2b-it-q4");
      expect(catalogBody.models.some((m) => m.id === "gemma-4-e2b-it-q4" && m.license === "Apache-2.0")).toBe(true);
      expect(catalogBody.models.some((m) => m.id === "qwen3.5-4b-q4" && m.license === "Apache-2.0")).toBe(true);

      const statusBefore = await agentCall(agent, "GET", "/api/alpha/local-llm/status");
      expect(statusBefore.status).toBe(200);
      expect(statusBefore.body).toMatchObject({
        mode: "local",
        activeModelId: "gemma-4-e2b-it-q4",
        transport: "uds",
        engineReady: true,
        localScopeActive: true,
      });

      const activated = await agentCall(agent, "POST", "/api/alpha/local-llm/activate", { modelId: "gemma-4-e2b-it-q4" });
      expect(activated.status).toBe(200);
      expect(activated.body).toMatchObject({ ok: true, activeModelId: "gemma-4-e2b-it-q4", activeStatus: "ready" });
      expect(observedOps).toContain("load");

      const modeRes = await agentCall(agent, "POST", "/api/alpha/local-llm/mode", { mode: "local", modelId: "gemma-4-e2b-it-q4" });
      expect(modeRes.status).toBe(200);
      expect(modeRes.body).toMatchObject({ ok: true, mode: "local", activeModelId: "gemma-4-e2b-it-q4" });

      const created = await agentCall(agent, "POST", "/api/conversations", { title: "Offline Gemma 4" });
      expect(created.status).toBe(201);
      const conversationId = ((created.body as { conversation?: { id?: string } }).conversation?.id) ?? "";
      expect(conversationId).not.toBe("");

      const streamed = await agentStream(agent, `/api/conversations/${conversationId}/messages/stream`, {
        text: "Say hello offline.",
      });
      expect(streamed.status).toBe(200);
      expect(streamed.sseText).toContain("Hello from on-device Gemma 4 without any cloud sign-in.");

      const observeFirefox = (webUri: string, nodes: readonly Record<string, unknown>[]) =>
        agentCall(agent, "POST", "/api/alpha-control/observe", {
          tier: "TierAccessibility",
          capabilities: ["ui.observe.v1", "ui.act.v1"],
          packageName: "org.mozilla.firefox",
          activityName: "org.mozilla.fenix.HomeActivity",
          webUri,
          protection: "ScreenClear",
          windowCount: 1,
          nodes,
        });
      const clickableLink = (nodeId: string, text: string) => ({
        nodeId,
        role: "Link",
        text,
        clickable: true,
        editable: false,
        scrollable: false,
        sensitive: false,
        bounds: { left: 24, top: 320, right: 420, bottom: 392 },
      });
      const obs = await observeFirefox("https://example.org", [clickableLink("w1_n0", "More information")]);
      expect(obs.status).toBe(200);

      const lease = await agentCall(agent, "POST", "/api/alpha/control/lease", {
        packageName: "org.mozilla.firefox",
        maxOps: 3,
        durationMs: 60_000,
      });
      expect(lease.status).toBe(200);

      const controlTurn = agentStream(agent, `/api/conversations/${conversationId}/messages/stream`, {
        text: "Click More information in Firefox.",
      });

      let executedOpId = 0;
      const pollDeadline = Date.now() + 30_000;
      while (Date.now() < pollDeadline) {
        const next = await agentCall(agent, "GET", "/api/alpha-control/next");
        const op = (next.body as { op?: { opId: number; expectedPackage: string; op: { type: string } } | null }).op;
        if (op !== null && op !== undefined) {
          expect(op.expectedPackage).toBe("org.mozilla.firefox");
          expect(op.op.type).toBe("ui_click");
          executedOpId = op.opId;
          const postObs = await observeFirefox("https://www.iana.org/help/example-domains", []);
          const postSnap = (postObs.body as { snapshotId: number }).snapshotId;
          const receipt = await agentCall(agent, "POST", "/api/alpha-control/receipt", {
            opId: op.opId,
            outcome: "done",
            postSnapshotId: postSnap,
          });
          expect(receipt.status).toBe(200);
          break;
        }
        await Effect.runPromise(Effect.sleep("50 millis"));
      }
      expect(executedOpId).toBeGreaterThan(0);

      const controlResult = await controlTurn;
      expect(controlResult.status).toBe(200);
      expect(controlResult.sseText).toContain("I clicked More information in Firefox completely offline.");

      const deleted = await agentCall(agent, "POST", "/api/alpha/local-llm/delete", { modelId: "gemma-4-e2b-it-q4" });
      expect(deleted.status).toBe(200);
      expect(deleted.body).toMatchObject({ ok: true, deletedModelId: "gemma-4-e2b-it-q4" });
      expect(observedOps).toContain("unload");
    } finally {
      await agent.stop();
      await new Promise<void>((resolve) => mockUdsServer.close(() => resolve()));
    }
  }, 180_000);

  // spec/agent/index.md, "Story: Run Alpha's agent on the phone"
  it("supports loopback OpenAI-compatible local inference URL with Qwen 3.5 SSE streaming", async () => {
    const stateDir = makeScratch("alpha-local-llm-http-e2e-");
    let requestsSeen = 0;

    const loopbackServer = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        requestsSeen += 1;
        let body = "";
        req.setEncoding("utf8").on("data", (d: string) => { body += d; }).on("end", () => {
          const parsed = JSON.parse(body) as { stream?: boolean };
          if (parsed.stream) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "[answer] Loopback " } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Qwen 3.5 local reply." }, finish_reason: "stop" }], usage: { prompt_tokens: 18, completion_tokens: 8, total_tokens: 26 } })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            choices: [{ message: { role: "assistant", content: "[answer] Loopback Qwen 3.5 local reply." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 18, completion_tokens: 8, total_tokens: 26 },
          }));
        });
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => loopbackServer.listen(0, "127.0.0.1", resolve));
    const port = (loopbackServer.address() as AddressInfo).port;
    const launchFile = writeOfflineLaunchDocument(stateDir, {
      ALPHA_AI_MODE: "local",
      ALPHA_LOCAL_MODEL: "qwen3.5-4b-q4",
      ALPHA_LOCAL_LLM_URL: `http://127.0.0.1:${port}`,
    });
    const agent = startOfflineLocalAgent(stateDir, launchFile);

    try {
      await waitForReady(agent);
      const status = await agentCall(agent, "GET", "/api/alpha/local-llm/status");
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ mode: "local", activeModelId: "qwen3.5-4b-q4", transport: "loopback-http", engineReady: true });

      const created = await agentCall(agent, "POST", "/api/conversations", { title: "Loopback Qwen 3.5" });
      const conversationId = ((created.body as { conversation?: { id?: string } }).conversation?.id) ?? "";
      const streamed = await agentStream(agent, `/api/conversations/${conversationId}/messages/stream`, { text: "Ping local loopback." });
      expect(streamed.status).toBe(200);
      expect(streamed.sseText).toContain("Loopback Qwen 3.5 local reply.");
      expect(requestsSeen).toBeGreaterThan(0);
    } finally {
      await agent.stop();
      await new Promise<void>((resolve) => loopbackServer.close(() => resolve()));
    }
  }, 180_000);
});
