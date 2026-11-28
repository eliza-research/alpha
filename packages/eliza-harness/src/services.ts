import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { type AddressInfo, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import { Effect, Schema } from "effect";
import { prepared } from "./checkout.ts";
import { builtPack } from "./pack.ts";

/** What the model answers next: the pieces of a reply, or one piece and then nothing until the caller gives up. */
export type Reply =
  | { readonly kind: "text"; readonly parts: readonly string[] }
  | { readonly kind: "stall"; readonly first: string }
  | { readonly kind: "tool"; readonly name: string; readonly input: unknown };

/** The key a signed-in device holds: what the phone's native code keeps, hands the agent at launch, and adds to each request the page makes of the cloud. */
export interface DeviceKey {
  readonly token: string;
  readonly accountId: string;
  readonly organizationId: string;
  /** The code the cloud mailed this owner, which signed them in. */
  readonly mailed: string;
}

/**
 * A real model the local cloud's provider forwards every call to, in place of the scripted one: an OpenAI-compatible
 * endpoint, the model it is asked for, the output cap the cloud holds for a call that names none, and its key, which
 * stays in this process and goes only to that endpoint.
 */
export interface RealModel {
  readonly baseUrl: string;
  readonly model: string;
  readonly defaultMaxTokens: number;
  readonly key: string;
}

/**
 * Real speech for the local cloud's relay, in place of none: the key of Cartesia, which eliza's hosted cloud speaks
 * through, kept in this process and handed only to the cloud command's environment, never to a file or the page.
 */
export interface RealSpeech {
  readonly key: string;
}

/**
 * The hosted cloud's speech settings (apps/cloud/profile/candidate.example.json) with the voice and model eliza's own
 * Cartesia client speaks in (`CartesiaSpeech.VOICE`), so Talk in the browser is heard and spoken as on the phone.
 */
const speechSettings = {
  provider: "cartesia",
  baseUrl: "https://api.cartesia.ai",
  realtimeUrl: "wss://api.cartesia.ai",
  apiKeyEnv: "CARTESIA_API_KEY",
  tts: { defaultVoiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4", defaultModelId: "sonic-3.5", voiceIds: ["db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"], modelIds: ["sonic-3.5"], microsPerCharacter: 30 },
  stt: { languageCodes: ["en", "en-US"], microsPerSecond: 100 },
} as const;

/**
 * The local eliza cloud: eliza's own cloud command (`elizaos-cloud serve`) over a database of this run, with its
 * staging mailbox, an operator who funds each owner, and, where a real deployment has a model provider and a payment
 * provider, a scripted model or a real one, and a read-only catalog of the two plans.
 */
export interface Cloud {
  /** The https origin the agent calls, and the certificate authority it must trust for it: an agent takes no other kind of origin. */
  readonly api: string;
  readonly caFile: string;
  /** The cloud's own listener, plain HTTP on loopback: what the page's proxy and the journeys call. */
  readonly local: string;
  /** The one model it offers, as its profile and an agent's launch name it: the real model's own id, so the agent asks it as it would on the phone. */
  readonly model: string;
  /** Where the scripted model is told what to say and asked what it heard (`/operator/model`, `/operator/asked`). */
  readonly provider: string;
  /** Each owner the cloud was started with, by email: signed in by the mailed code, with a device key, and funded. */
  readonly owners: ReadonlyMap<string, DeviceKey>;
  stop(): Promise<void>;
}

/** The resident agent, as one Node process: its loopback origin and the bearer token of this launch. */
export interface Agent {
  readonly origin: string;
  readonly token: string;
  stop(): Promise<void>;
}

const node = process.execPath;
const base64url = (bytes: Buffer) => bytes.toString("base64url");
/** The scripted model's id, which no provider serves: the one model the local cloud offers where it is given no real one. */
const scriptedModel = "alpha-chat";
/**
 * The scripted model's reply to `said` as eliza's agent asks a model to answer: tagged `[answer]` as a complete reply,
 * and repeating only the person's own words, since the agent appends its notes, each starting "Note from the agent
 * host", and delivers no reply that repeats one.
 */
const ownerWords = (text: string) => text.split(/(?:^|\n+)Note from the agent host\b/u, 1)[0].trimEnd();
const repeated = (said: string) => `[answer] You said: ${ownerWords(said)}`;
/** Alpha as the cloud's staging registry knows it: the client a device signs in as. */
const client = { clientId: "ai.alphacompute.alphaphone", displayName: "Alpha", androidPackage: "ai.alphacompute.alphaphone", certFingerprints: [Array.from({ length: 32 }, () => "AA").join(":")] };

/** A directory only this user reads, as the agent demands of its state. */
function owned(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

const legacyAccount = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  account: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
})));

/** Private state and custody for one developer account. A previous unscoped store belongs to its recorded owner. */
export function keptAgentState(state: string, account: Pick<DeviceKey, "accountId" | "organizationId">) {
  const scope = createHash("sha256").update(JSON.stringify([account.accountId, account.organizationId])).digest("hex");
  const directory = owned(path.join(state, ".alpha-custody", scope));
  const legacy = path.join(state, "launch.json");
  const previous = fs.existsSync(legacy) ? legacyAccount(fs.readFileSync(legacy, "utf8")).account : undefined;
  const original = previous?.userId === account.accountId && previous.organizationId === account.organizationId;
  const home = owned(path.join(original ? state : directory, "agent"));
  const target = path.join(directory, "storage.key");
  if (!fs.existsSync(target)) {
    if (fs.existsSync(path.join(home, "wallet", "keys.sealed"))) {
      throw new Error("This development wallet needs its original storage key. Restore its private custody directory or choose a fresh development state directory.");
    }
    const staged = path.join(directory, `${base64url(randomBytes(16))}.key`);
    fs.writeFileSync(staged, randomBytes(32), { mode: 0o600, flag: "wx", flush: true });
    try {
      fs.linkSync(staged, target);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
    } finally {
      fs.unlinkSync(staged);
    }
  }
  const held = fs.readFileSync(target);
  if (held.length !== 32) throw new Error("The development storage key is damaged. Restore its original private custody directory.");
  return { home, launch: path.join(directory, "launch.json"), storageKey: base64url(held) };
}

/** A fresh state directory, for one run. */
export const scratch = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alpha-eliza-")));

const children = new Set<ChildProcess>();
process.once("exit", () => { for (const child of children) child.kill("SIGKILL"); });

const MAX_LOG_CHARS = 65_536;
const MAX_ASKED_SYSTEMS = 100;
const MAX_ASKED_PER_SYSTEM = 200;
const STARTUP_DEADLINE_MS = 120_000;

function appendRing(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_LOG_CHARS ? combined.slice(combined.length - MAX_LOG_CHARS) : combined;
}

function waitForClose(child: ChildProcess): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    const onClose = () => resume(Effect.void);
    child.once("close", onClose);
    return Effect.sync(() => { child.off("close", onClose); });
  });
}

function ended(child: ChildProcess): Promise<void> {
  children.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.kill("SIGTERM");
  return Effect.runPromise(
    Effect.race(
      waitForClose(child),
      Effect.sleep(5_000).pipe(
        Effect.andThen(Effect.sync(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        })),
        Effect.andThen(Effect.race(waitForClose(child), Effect.sleep(2_000))),
      ),
    ),
  );
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

const listening = (server: http.Server) => new Promise<number>((done) => server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port)));

interface Answer { readonly status: number; readonly text: string }

/** One exchange over node:http, and not fetch: a journey's page replaces fetch with its own, which keeps to the page's origin. */
function exchange(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; within?: number } = {}): Promise<Answer> {
  return new Promise((done, fail) => {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const request = http.request(url, { method: init.method ?? (body === undefined ? "GET" : "POST"), timeout: init.within, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...init.headers } }, (response) => {
      let text = "";
      response.setEncoding("utf8").on("data", (part: string) => { text += part; }).on("end", () => done({ status: response.statusCode ?? 0, text }));
    });
    if (init.within !== undefined) request.on("timeout", () => request.destroy(new Error("no answer in time")));
    request.on("error", fail).end(body);
  });
}

/** Wait until `url` answers 200: a service that has only just bound its port may take a connection and never answer it. */
async function answering(url: string, gone: () => string | undefined, timeoutMs = STARTUP_DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!(await exchange(url, { within: 2_000 }).then((answer) => answer.status === 200, () => false))) {
    const why = gone();
    if (why !== undefined) throw new Error(why);
    if (Date.now() > deadline) throw new Error(`${url} did not answer 200 within ${timeoutMs}ms`);
    await Effect.runPromise(Effect.sleep(100));
  }
}

export async function said<A>(url: string, init?: Parameters<typeof exchange>[1]): Promise<A> {
  const answer = await exchange(url, init);
  if (answer.status < 200 || answer.status >= 300) throw new Error(`${url} answered ${answer.status} ${answer.text}`);
  return (answer.text === "" ? undefined : JSON.parse(answer.text)) as A;
}

interface Message { readonly role: string; readonly content?: unknown }

/** A tool of a chat request, as the cloud forwards it to its provider. */
interface Tool { readonly type: string; readonly function: { readonly name: string; readonly strict?: boolean } }

/**
 * `tools` strict only where every one is, and otherwise none of them, as Cerebras takes them: it refuses a list that
 * mixes them (elizaOS/eliza#40482, #40485). The agent already sends Alpha's model a uniform list; this keeps any other
 * caller of the local cloud, such as a journey's own call, from a refusal the phone never meets.
 */
const uniformTools = (tools: readonly Tool[]): Tool[] =>
  tools.every((tool) => tool.function.strict === true) ? [...tools] : tools.map(({ function: { strict: _strict, ...declared }, ...tool }) => ({ ...tool, function: declared }));

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

/** One model call as `ALPHA_MODEL_TIMING_LOG` keeps it: when it started, how long until its headers, its first output and its end, what it asked and called with which arguments, and the start of the text it wrote. */
interface CallTiming {
  readonly kind: "model";
  readonly startedAt: number;
  readonly headersMs: number;
  readonly firstMs: number | undefined;
  readonly ms: number;
  readonly status: number | undefined;
  readonly messages: number;
  readonly tools: number;
  readonly called: string[];
  readonly answered: string[];
  readonly said: string;
  readonly args: string[];
  readonly usage: unknown;
}

type Delta = { content?: unknown; reasoning?: unknown; reasoning_content?: unknown; tool_calls?: { index?: unknown; function?: { name?: unknown; arguments?: unknown } }[] };
type Choice = { delta?: Delta; message?: Delta };

/** What the tools answered since the model last spoke, as this call tells it: why a turn took the steps it did. */
function answeredBefore(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const told: string[] = [];
  for (const message of (messages as { role?: unknown; content?: unknown }[]).toReversed()) {
    if (message.role !== "tool") break;
    told.unshift(typeof message.content === "string" ? message.content.slice(0, 600) : JSON.stringify(message.content).slice(0, 600));
  }
  return told;
}

/** Whether a streamed or whole answer's choice carries output: text, reasoning or a tool call. */
const carries = (part: Delta | undefined) =>
  part !== undefined && ([part.content, part.reasoning, part.reasoning_content].some((one) => typeof one === "string" && one !== "") || (part.tool_calls?.length ?? 0) > 0);

/**
 * A listener for the real model's answer to one call that appends the call's timing to the file `log` names once the
 * answer ends, read from the answer's own JSON, streamed as server-sent events or whole: a developer's measure of
 * where a turn's time goes, kept only on the dev server.
 */
function noted(log: string, input: Record<string, unknown>, startedAt: number, answer: IncomingMessage) {
  const headersMs = Date.now() - startedAt;
  const called = new Set<string>();
  let firstMs: number | undefined;
  let usage: unknown;
  let said = "";
  const args = new Map<number, string>();
  let pending = "";
  const read = (json: string) => {
    let body: { choices?: Choice[]; usage?: unknown };
    try { body = JSON.parse(json) as typeof body; } catch { return; }
    for (const choice of body.choices ?? []) {
      const part = choice.delta ?? choice.message;
      if (firstMs === undefined && carries(part)) firstMs = Date.now() - startedAt;
      if (typeof part?.content === "string" && said.length < 600) said += part.content;
      for (const [at, call] of (part?.tool_calls ?? []).entries()) {
        if (typeof call.function?.name === "string") called.add(call.function.name);
        const index = typeof call.index === "number" ? call.index : at;
        if (typeof call.function?.arguments === "string") args.set(index, `${args.get(index) ?? ""}${call.function.arguments}`.slice(0, 300));
      }
    }
    if (body.usage !== undefined && body.usage !== null) usage = body.usage;
  };
  const lines = (text: string) => {
    pending += text;
    const done = pending.split("\n");
    pending = done.pop() ?? "";
    for (const line of done) if (line.startsWith("data:") && line.slice(5).trim() !== "[DONE]") read(line.slice(5).trim());
  };
  const streamed = String(answer.headers["content-type"] ?? "").includes("text/event-stream");
  answer.on("end", () => {
    if (streamed) lines("\n");
    else read(pending);
    const messages = Array.isArray(input.messages) ? input.messages.length : 0;
    const tools = Array.isArray(input.tools) ? input.tools.length : 0;
    const row: CallTiming = { kind: "model", startedAt, headersMs, firstMs, ms: Date.now() - startedAt, status: answer.statusCode, messages, tools, called: [...called], answered: answeredBefore(input.messages), said: said.slice(0, 600), args: [...args.values()], usage };
    fs.appendFileSync(log, `${JSON.stringify(row)}\n`);
  });
  return (part: Buffer) => {
    if (streamed) lines(part.toString("utf8"));
    else pending += part.toString("utf8");
  };
}

/** Send the cloud's call on to `real`, which the cloud already asks for by its own id, under its key, and its answer back as it comes, a stream included. */
function forwarded(real: RealModel, input: Record<string, unknown>, outgoing: ServerResponse) {
  const startedAt = Date.now();
  const tools = input.tools as readonly Tool[] | undefined;
  const url = new URL(`${real.baseUrl}/chat/completions`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    outgoing.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "invalid_request_error", message: "Refusing non-loopback HTTP upstream for bearer key" } }));
    return;
  }
  const upstream = (url.protocol === "https:" ? https : http).request(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${real.key}` } }, (answer) => {
    const wait = answer.headers["retry-after"];
    outgoing.writeHead(answer.statusCode ?? 502, { "content-type": answer.headers["content-type"] ?? "application/json", "cache-control": "no-store", ...(wait === undefined ? {} : { "retry-after": wait }) }).flushHeaders();
    const timing = process.env.ALPHA_MODEL_TIMING_LOG;
    if (timing) answer.on("data", noted(timing, input, startedAt, answer));
    pipeline(answer, outgoing, () => undefined);
  });
  upstream.on("error", (cause) => {
    if (outgoing.destroyed) return;
    if (outgoing.headersSent) return void outgoing.destroy();
    outgoing.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "upstream_unreachable", message: cause.message } }));
  });
  outgoing.on("close", () => upstream.destroy());
  upstream.end(JSON.stringify({ ...input, ...(tools === undefined ? {} : { tools: uniformTools(tools) }) }));
}

/** The two plans the cloud sells, as its payment provider's catalog lists them: the cloud checks them before it serves billing. */
const plans = { plus_monthly: { priceId: "price_plus", productId: "prod_plus", unitAmount: 3_000 }, pro_monthly: { priceId: "price_pro", productId: "prod_pro", unitAmount: 10_000 } };
const paymentKey = "sk_test_local";

/** The payment provider's catalog, read-only: a price or a product of `plans`, as Stripe's API answers one. */
function catalogued(route: string, authorization: string | undefined): [number, unknown] {
  if (authorization !== `Bearer ${paymentKey}`) return [401, { error: { type: "invalid_request_error" } }];
  for (const { priceId, productId, unitAmount } of Object.values(plans)) {
    if (route === `/v1/prices/${priceId}`) {
      return [200, {
        id: priceId, object: "price", active: true, currency: "usd", unit_amount: unitAmount, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
        livemode: false, product: productId, recurring: { interval: "month", interval_count: 1, trial_period_days: null, usage_type: "licensed" },
      }];
    }
    if (route === `/v1/products/${productId}`) return [200, { id: productId, object: "product", active: true, livemode: false }];
  }
  return [404, { error: { type: "invalid_request_error", message: "no such object" } }];
}

/**
 * The model provider a deployment's cloud pays: an OpenAI-compatible `chat/completions`, which says what a journey
 * scripted, or repeats the owner's last message, and reports the tokens it is paid for; or, given a `real` model, asks
 * that model instead. An agent is told apart by its character's system prompt, which begins the system message eliza
 * sends, so journeys share one cloud.
 */
async function startProvider(key: string, real: RealModel | undefined) {
  const replies = new Map<string, { readonly prompt?: string; readonly reply: Reply }[]>();
  const asked = new Map<string, Message[][]>();
  const listed = <A>(lists: Map<string, A[]>, system: string): A[] => {
    const existing = lists.get(system);
    if (existing !== undefined) return existing;
    const created: A[] = [];
    lists.set(system, created);
    return created;
  };
  const scripted = (system: string) => [...replies.keys()].filter((character) => system.startsWith(character)).sort((a, b) => b.length - a.length)[0] ?? system;
  const heard = (character: string) => [...asked].filter(([system]) => system.startsWith(character)).flatMap(([, calls]) => calls);
  const frame = (data: unknown) => `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
  const usage = (messages: readonly Message[], text: string) => {
    const promptTokens = JSON.stringify(messages).length;
    return { prompt_tokens: promptTokens, completion_tokens: text.length, total_tokens: promptTokens + text.length };
  };
  const json = (outgoing: ServerResponse, status: number, data: unknown) => void outgoing.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  async function read(incoming: IncomingMessage) {
    let text = "";
    for await (const part of incoming.setEncoding("utf8")) text += part as string;
    return text === "" ? {} : JSON.parse(text) as Record<string, unknown>;
  }
  function completed(input: Record<string, unknown>, outgoing: ServerResponse) {
    const messages = (input.messages ?? []) as Message[];
    const character = messages.find((message) => message.role === "system")?.content;
    const system = typeof character === "string" ? character : "";
    if (real !== undefined) return forwarded(real, input, outgoing);
    if (!asked.has(system) && asked.size >= MAX_ASKED_SYSTEMS) {
      const oldest = asked.keys().next().value;
      if (oldest !== undefined) asked.delete(oldest);
    }
    const recorded = listed(asked, system);
    recorded.push(messages);
    if (recorded.length > MAX_ASKED_PER_SYSTEM) recorded.splice(0, recorded.length - MAX_ASKED_PER_SYSTEM);
    const content = messages.findLast((message) => message.role === "user")?.content;
    const last = Array.isArray(content)
      ? content.flatMap((part: unknown) => typeof part === "object" && part !== null && "type" in part && part.type === "text"
        && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n")
      : content;
    const pending = replies.get(scripted(system)) ?? [];
    const prompt = typeof last === "string" ? ownerWords(last) : undefined;
    const choice = pending.findIndex((entry) => entry.prompt === undefined || entry.prompt === prompt);
    const queued = choice < 0 ? undefined : (pending[choice]?.reply.kind === "stall" && input.stream !== true ? undefined : pending.splice(choice, 1)[0]?.reply);
    const reply = queued ?? { kind: "text", parts: [typeof last === "string" ? repeated(last) : `You said: ${JSON.stringify(last)}`] };
    const parts = reply.kind === "text" ? reply.parts : reply.kind === "stall" ? [reply.first] : [];
    const text = parts.join("");
    const tool = reply.kind === "tool"
      ? { id: "call-local", type: "function", function: { name: reply.name, arguments: JSON.stringify(reply.input) } }
      : undefined;
    const reason = tool === undefined ? "stop" : "tool_calls";
    const named = { id: "chatcmpl-local", created: 1_790_000_000, model: input.model };
    if (input.stream !== true) {
      return json(outgoing, 200, { ...named, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: tool === undefined ? text : null, ...(tool === undefined ? {} : { tool_calls: [tool] }) }, finish_reason: reason }], usage: usage(messages, text) });
    }
    const piece = (delta: object, finish: string | null) => frame({ ...named, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] });
    outgoing.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }).flushHeaders();
    outgoing.write(piece({ role: "assistant", content: "" }, null));
    for (const part of parts) outgoing.write(piece({ content: part }, null));
    if (reply.kind === "stall") return;
    if (tool !== undefined) outgoing.write(piece({ tool_calls: [{ index: 0, ...tool }] }, null));
    outgoing.write(piece({}, reason));
    outgoing.write(frame({ ...named, object: "chat.completion.chunk", choices: [], usage: usage(messages, text) }));
    outgoing.end(frame("[DONE]"));
  }
  const server = http.createServer((incoming, outgoing) => void (async () => {
    const url = new URL(incoming.url ?? "/", "http://provider");
    if (url.pathname === "/operator/model") {
      const body = await read(incoming);
      const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
      return json(outgoing, 200, { scripted: listed(replies, String(body.system)).push({ prompt, reply: body.reply as Reply }) });
    }
    if (url.pathname === "/operator/asked") {
      if (real !== undefined) return json(outgoing, 403, { error: "disabled_in_real_model_mode" });
      return json(outgoing, 200, heard(url.searchParams.get("system") ?? ""));
    }
    if (url.pathname.startsWith("/stripe/")) return json(outgoing, ...catalogued(url.pathname.slice("/stripe".length), incoming.headers.authorization));
    if (incoming.method !== "POST" || url.pathname !== "/v1/chat/completions") return json(outgoing, 404, { error: { type: "invalid_request_error", message: "no such route" } });
    if (incoming.headers.authorization !== `Bearer ${key}`) return json(outgoing, 401, { error: { type: "authentication_error", message: "bad key" } });
    completed(await read(incoming), outgoing);
  })().catch((cause: unknown) => json(outgoing, 500, { error: String(cause) })));
  const origin = `http://127.0.0.1:${await listening(server)}`;
  return { origin, stop: () => new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }) };
}

/** An https listener in front of `upstream`, under a certificate made for this run: the agent calls its cloud only over https. */
async function startFront(state: string, upstream: URL) {
  const [config, keyFile, caFile] = ["leaf.cnf", "leaf.key", "leaf.pem"].map((name) => path.join(state, name)) as [string, string, string];
  fs.writeFileSync(config, [
    "[req]", "prompt = no", "distinguished_name = subject", "x509_extensions = ext", "[subject]", "CN = localhost",
    "[ext]", "basicConstraints = critical, CA:TRUE", "keyUsage = critical, digitalSignature, keyCertSign",
    "extendedKeyUsage = serverAuth", "subjectAltName = DNS:localhost, IP:127.0.0.1", "",
  ].join("\n"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "30", "-config", config, "-keyout", keyFile, "-out", caFile], { stdio: "ignore" });
  const front = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(caFile) }, (incoming, outgoing) => {
    const forwarded = http.request(upstream, { method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: upstream.host } }, (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    });
    forwarded.on("error", () => (outgoing.headersSent ? outgoing.destroy() : outgoing.writeHead(502).end()));
    outgoing.on("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  const api = `https://localhost:${await listening(front)}`;
  return { api, caFile, stop: () => new Promise<void>((done) => { front.close(() => done()); front.closeAllConnections(); }) };
}

/** eliza's cloud command with `args`, from the pinned checkout's build: what it printed, and when it ended. */
function cloudCommand(secrets: string, args: readonly string[], keys: Readonly<Record<string, string>> = {}) {
  const child = spawn(node, ["--no-warnings", `--env-file=${secrets}`, "dist/src/main.js", ...args], { cwd: prepared().cloud, env: { PATH: process.env.PATH, TZ: "UTC", ...keys }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding("utf8").on("data", (text: string) => { output = appendRing(output, text); });
  const exited = new Promise<number | null>((done) => child.once("close", (code) => { children.delete(child); done(code); }));
  return { child, exited, output: () => output };
}

/** Wait for a spawned child service to answer 200 at `url`, or fail promptly if it exits or is killed by a signal. */
export async function awaitChildService(
  child: ChildProcess,
  url: string,
  label: string,
  output: () => string,
): Promise<void> {
  let stopped: string | undefined;
  child.once("close", (code, signal) => {
    children.delete(child);
    stopped = `${label} stopped with ${signal ?? code}: ${output()}`;
  });
  await answering(
    url,
    () => stopped ?? (child.exitCode !== null || child.signalCode !== null ? `${label} stopped with ${child.signalCode ?? child.exitCode}: ${output()}` : undefined),
  );
}

async function served(secrets: string, args: readonly string[], origin: string, keys: Readonly<Record<string, string>> = {}) {
  const running = cloudCommand(secrets, ["serve", ...args], keys);
  try {
    await awaitChildService(running.child, `${origin}/api/public/service`, "the cloud", running.output);
    return running.child;
  } catch (cause) {
    await ended(running.child);
    throw cause;
  }
}

const challenged = () => {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier, "ascii").digest()) };
};

/**
 * Sign `email` in by the code the cloud mails, and pair a device, as the phone's native code does: the code from the
 * staging mailbox, then a device grant redeemed and acknowledged. The whole of sign-in, with no one to type the code.
 */
async function signIn(local: string, email: string, signInReturn: string): Promise<DeviceKey> {
  const call = <A>(route: string, body?: unknown, credential?: string) => said<A>(`${local}${route}`, { body, headers: credential === undefined ? {} : { authorization: `Bearer ${credential}` } });
  const first = challenged();
  await call("/api/v1/auth/email/code/send", { email, clientId: client.clientId, codeChallenge: first.challenge, codeChallengeMethod: "S256" });
  const mailed = /\b(\d{6})\b/.exec((await call<{ text: string }>(`/api/test/inbox/${encodeURIComponent(email)}`)).text)?.[1] ?? "";
  const signed = await call<{ accessToken: string; organizationId: string; user: { id: string } }>("/api/v1/auth/email/code/verify", { email, code: mailed, clientId: client.clientId, codeVerifier: first.verifier });
  const binding = { clientId: client.clientId, environment: "staging", redirectUri: signInReturn };
  const second = challenged();
  const state = base64url(randomBytes(32));
  const connected = await call<{ code: string }>("/api/v1/app-auth/connect", { ...binding, flow: "mobile_pkce", state, codeChallenge: second.challenge, codeChallengeMethod: "S256" }, signed.accessToken);
  const redeemed = { ...binding, code: connected.code, state, codeVerifier: second.verifier };
  const minted = await call<{ credentialId: string; secret: string }>("/api/v1/app-auth/mobile/token", { ...redeemed, grantType: "authorization_code" });
  await call("/api/v1/app-auth/mobile/ack", { ...redeemed, credentialId: minted.credentialId, secret: minted.secret });
  return { token: minted.secret, accountId: signed.user.id, organizationId: signed.organizationId, mailed };
}

/**
 * Start eliza's cloud over `state` with each of `emails` signed in, paired and given `credits`. The operator's
 * command needs the database to itself, so every owner of a run is made before the cloud serves that run: the cloud
 * serves once to sign them in, stops, is funded, and serves again at the same address.
 */
export async function startCloud(state: string, emails: readonly string[], credits: number, real?: RealModel, speech?: RealSpeech): Promise<Cloud> {
  const home = owned(path.join(state, "cloud"));
  const fixture = (name: string) => fs.readFileSync(path.join(prepared().cloud, "test/fixtures", name), "utf8");
  const file = (name: string, text: string) => { fs.writeFileSync(path.join(home, name), text, { mode: 0o600 }); return path.join(home, name); };
  const model = real?.model ?? scriptedModel;
  const providerKey = base64url(randomBytes(24));
  const provider = await startProvider(providerKey, real);
  const profile = JSON.parse(fixture("profile.json")) as { environments: { staging: { web: string } & Record<string, unknown> } };
  const { web } = profile.environments.staging;
  profile.environments.staging = {
    ...profile.environments.staging,
    capabilities: speech === undefined ? ["inference", "billing"] : ["inference", "billing", "speech"],
    ...(speech === undefined ? {} : { speech: speechSettings }),
    billing: {
      apiUrl: `${provider.origin}/stripe`, secretKeyEnv: "STRIPE_SECRET_KEY", webhookSecretEnv: "STRIPE_WEBHOOK_SECRET", publishableKey: "pk_test_local",
      plans: Object.fromEntries(Object.entries(plans).map(([plan, { priceId, productId }]) => [plan, { priceId, productId }])),
    },
    inference: { providers: [{ id: "scripted", baseUrl: `${provider.origin}/v1`, apiKeyEnv: "CLOUD_UPSTREAM_KEY" }], models: [{ id: model, provider: "scripted", upstreamModel: model, vision: real === undefined, defaultMaxTokens: real?.defaultMaxTokens ?? 1024 }] },
  };
  const signInReturn = `${web}/alphaphone/auth/callback`;
  const seed = { clients: [{ ...client, signInReturn, billingReturn: `${web}/alphaphone/billing/return` }], prices: [{ modelId: model, inputPer1K: 150, outputPer1K: 600 }] };
  const secrets = file("secrets.env", `${fixture("secrets.env")}\nCLOUD_UPSTREAM_KEY=${providerKey}\nSTRIPE_SECRET_KEY=${paymentKey}\nSTRIPE_WEBHOOK_SECRET=whsec_local\n`);
  const deployment = ["--profile", file("profile.json", JSON.stringify(profile)), "--environment", "staging", "--store", `pglite:${path.join(home, "cloud.pglite")}`];
  const port = await freePort();
  const local = `http://127.0.0.1:${port}`;
  const at = [...deployment, "--port", String(port), "--host", "127.0.0.1"];
  const owners = new Map<string, DeviceKey>();
  let running: ChildProcess | undefined;
  const keys: Readonly<Record<string, string>> = speech === undefined ? {} : { [speechSettings.apiKeyEnv]: speech.key };
  try {
    const first = await served(secrets, [...at, "--seed", file("seed.json", JSON.stringify(seed))], local, keys);
    try {
      for (const email of emails) owners.set(email, await signIn(local, email, signInReturn));
    } finally {
      await ended(first);
    }
    for (const [email, key] of owners) {
      const funded = cloudCommand(secrets, ["credits", "add", "--organization", key.organizationId, "--amount", String(credits), "--request", `grant-${email}`, ...deployment], keys);
      if (await funded.exited !== 0) throw new Error(`the operator could not fund ${email}: ${funded.output()}`);
    }
    running = await served(secrets, at, local, keys);
    const active = running;
    const front = await startFront(home, new URL(local));
    return { api: front.api, caFile: front.caFile, local, model, provider: provider.origin, owners, stop: async () => { await front.stop(); await ended(active); await provider.stop(); } };
  } catch (cause) {
    if (running !== undefined) await ended(running);
    await provider.stop();
    throw cause;
  }
}

/** The character of the agent of `email`: its system prompt names its owner, which is also how the local cloud's model tells one journey's agent from another's. */
export const characterOf = (email: string) => ({ name: "Alpha", system: `You are Alpha, the phone agent of ${email}.` });

/**
 * Start the agent pack the phone ships (`pnpm --filter @repo/agent build`) as the owner's, over `state`, with `key` as
 * its cloud credential: its bundle, the plugins and modules its policy loads, the actions it allows, the workflow
 * worker it pins, the phone's host context revision, so an enrolled device is offered and shown its proposals as on
 * the phone, and the views the phone declares, so the agent can show its apps; `persist` keeps its conversations in `state`.
 */
export async function startAgent(state: string, cloud: Cloud, key: DeviceKey, character: { name: string; system: string },
  persist: boolean, browserNotesSpeech?: string, timeZone?: string,
): Promise<Agent> {
  const pack = await builtPack();
  const { home, launch, storageKey } = persist ? keptAgentState(state, key) : {
    home: owned(path.join(state, "agent")), launch: path.join(state, "launch.json"), storageKey: base64url(randomBytes(32)),
  };
  fs.writeFileSync(launch, JSON.stringify({
    schema: 1,
    character,
    policy: pack.policy,
    workflowWorker: pack.workflowWorker,
    model: { backend: "cloud", cloudBaseUrl: cloud.api, smallModel: cloud.model, largeModel: cloud.model, imageModel: cloud.model },
    account: { userId: key.accountId, organizationId: key.organizationId },
    embeddings: "none", persistMemory: persist, callerRole: "owner",
    ...(browserNotesSpeech === undefined ? {} : { environment: { ALPHA_BROWSER_NOTES_SPEECH_SOCKET: browserNotesSpeech } }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(pack.hostContextRevision === undefined ? {} : { hostContextRevision: pack.hostContextRevision }),
    ...(pack.views === undefined ? {} : { views: pack.views }),
  }), { mode: 0o600 });
  const token = base64url(randomBytes(32));
  const port = await freePort();
  const child = spawn(node, [pack.bundle, "serve", "--launch", launch, "--state", home, "--http", `127.0.0.1:${port}`], {
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, TZ: timeZone ?? "UTC", NODE_EXTRA_CA_CERTS: cloud.caFile },
    stdio: ["pipe", "ignore", "pipe"],
  });
  children.add(child);
  let errors = "";
  child.stderr.setEncoding("utf8").on("data", (text: string) => { errors = appendRing(errors, text); });
  child.stdin.end(`${JSON.stringify({ version: 1, token, epoch: Date.now(), credential: { version: 1, value: key.token }, storageKey })}\n`);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await awaitChildService(child, `${origin}/api/health`, "the agent", () => errors);
  } catch (cause) {
    await ended(child);
    throw cause;
  }
  return { origin, token, stop: () => ended(child) };
}

/** The owner the dev server signs in, and what the operator grants: enough for a day of talking to the local cloud's model. */
const owner = { email: "owner@alpha.test", credits: 50_000_000 };

/**
 * The cloud and the agent a dev server runs against: one signed-in, funded owner, whose model is the scripted one or
 * `real`, and whose agent is the pack's with the phone's own character, so a real model is given the phone's system
 * prompt. Their state is a directory of this run, gone with it, so nothing piles up between runs; `keep` names a
 * directory to keep both in instead, so a restart over it signs the same owner in again and reopens the agent's store.
 * The agent runs in the owner's time zone, the dev server's own, as the phone's does (its launch and its process
 * clock), so "6 PM" is the owner's 6 PM; the journeys' agents keep UTC.
 */
export async function startEliza(keep?: string, real?: RealModel, speech?: RealSpeech) {
  const { character } = await builtPack();
  const state = keep === undefined ? scratch() : owned(path.join(keep, "harness"));
  let cloud: Cloud | undefined;
  try {
    cloud = await startCloud(state, [owner.email], owner.credits, real, speech);
    const key = cloud.owners.get(owner.email);
    if (key === undefined) throw new Error(`missing device key for ${owner.email}`);
    const socket = process.env.ALPHA_LOCAL_SPEECH_SOCKET;
    const browserNotesSpeech = socket === undefined || !path.isAbsolute(socket) ? undefined : socket;
    const agent = await startAgent(keep ?? state, cloud, key, character, keep !== undefined, browserNotesSpeech, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const activeCloud = cloud;
    return { cloud: activeCloud, agent, key, stop: async () => { await agent.stop(); await activeCloud.stop(); if (keep === undefined) fs.rmSync(state, { recursive: true, force: true }); } };
  } catch (cause) {
    await cloud?.stop();
    if (keep === undefined) fs.rmSync(state, { recursive: true, force: true });
    throw cause;
  }
}
