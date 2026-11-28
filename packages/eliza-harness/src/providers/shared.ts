import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/** Startup configuration shared by standalone HTTP provider servers. */
export interface ProviderOptions {
  readonly port?: number;
  readonly stateFile?: string;
}

/** Running loopback HTTP+SSE provider server handle. */
export interface RunningProvider {
  readonly origin: string;
  readonly port: number;
  stop(): Promise<void>;
}

/** Armed fault rule returned by `/__control/fault` and matched against non-control requests. */
export interface FaultRule {
  readonly method?: string;
  readonly path: string;
  readonly status: number;
  readonly retryAfter?: number;
  readonly body?: unknown;
  remaining: number;
  readonly stall?: boolean;
}

/** Recorded wire request held in the provider's ring buffer for `/__control/requests`. */
export interface RecordedRequest {
  readonly seq: number;
  readonly at: number;
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** Parsed incoming HTTP request with unified query + body parameter map. */
export interface ParsedRequest {
  readonly method: string;
  readonly url: URL;
  readonly pathname: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: unknown;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Single Server-Sent Event frame dispatched through {@link SseHub}. */
export interface SseEnvelope {
  readonly id?: string;
  readonly event?: string;
  readonly data: unknown;
  readonly channel?: string;
}

interface SseClient {
  readonly res: ServerResponse;
  readonly filter?: (envelope: SseEnvelope) => boolean;
  readonly meta?: Readonly<Record<string, string>>;
}

/** Shared context passed into provider route and control handlers. */
export interface ProviderContext<S> {
  getState(): S;
  setState(next: S): void;
  save(): void;
  readonly sse: SseHub;
  readonly faults: FaultArmory;
  readonly requests: RequestLog;
}

/** Provider server specification consumed by {@link createProviderServer}. */
export interface ProviderServerConfig<S> {
  readonly options?: ProviderOptions;
  readonly createInitial: () => S;
  readonly preflightHeaders?: (pathname: string) => string | undefined;
  readonly serializeState?: (state: S) => unknown;
  readonly defaultFaultBody?: (fault: FaultRule) => unknown;
  readonly onReset?: (params: Readonly<Record<string, unknown>>, ctx: ProviderContext<S>) => void;
  readonly onControl?: (
    req: ParsedRequest,
    res: ServerResponse,
    ctx: ProviderContext<S>,
  ) => Promise<boolean> | boolean;
  readonly onRequest: (
    req: ParsedRequest,
    res: ServerResponse,
    ctx: ProviderContext<S>,
  ) => Promise<void> | void;
}

/** Permissive CORS headers allowing Chromium Playwright and local dev pages to reach loopback providers directly. */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, X-Slack-Workspace, b3, traceparent, tracestate",
  "access-control-expose-headers": "Retry-After, Content-Type",
};

const MAX_REQUEST_LOG = 500;
const MAX_BODY_BYTES = 1024 * 1024;

/** Error raised when an incoming HTTP body exceeds the provider size limit. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds maximum size");
    this.name = "PayloadTooLargeError";
  }
}

/** Safe own-property lookup on plain object dictionaries, preventing prototype chain reads. */
export function ownGet<T>(record: Readonly<Record<string, T>> | undefined, key: string | undefined): T | undefined {
  if (record === undefined || key === undefined) return undefined;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Evict the oldest keys from a mutable record once its size exceeds `max`. */
export function pruneRecordCap(record: Record<string, unknown>, max: number): void {
  const keys = Object.keys(record);
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) {
    delete record[key];
  }
}

/** Safe narrow to plain record. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Safe narrow to string. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Safe narrow to finite number (parsing numeric strings from query/form payloads). */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Safe narrow to boolean (parsing `"true"`/`"false"`/`"1"`/`"0"` from query/form payloads). */
export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/** Safe narrow to string array. */
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/** Safe narrow to finite number array (also accepting a single number). */
export function asNumberArray(value: unknown): number[] | undefined {
  const single = asNumber(value);
  if (single !== undefined) return [single];
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const item of value) {
    const num = asNumber(item);
    if (num !== undefined) out.push(num);
  }
  return out;
}

/** Generate a URL-safe random token with a caller-specified prefix. */
export function randomToken(prefix: string, bytes = 18): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

/** Extract a Bearer token from normalized request headers. */
export function bearerToken(headers: Readonly<Record<string, string>>): string | undefined {
  const auth = headers.authorization;
  if (!auth) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return match?.[1];
}

/** Verify an OAuth2 PKCE S256 verifier against its challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const digest = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return digest === challenge;
}

/** Escape special HTML characters for safe rendering in OAuth consent pages. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Paginate an array using an opaque base64url offset cursor. */
export function paginateSlice<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { readonly items: readonly T[]; readonly nextCursor: string; readonly hasMore: boolean } {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  let offset = 0;
  if (cursor && cursor.length > 0) {
    const decoded = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Number.isInteger(decoded) && decoded >= 0) offset = decoded;
  }
  const page = items.slice(offset, offset + safeLimit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  const nextCursor = hasMore ? Buffer.from(String(nextOffset), "utf8").toString("base64url") : "";
  return { items: page, nextCursor, hasMore };
}

/** Write a JSON response with CORS headers. */
export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

/** Write an HTML response with CORS headers. */
export function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "text/html; charset=utf-8",
    ...extraHeaders,
  });
  res.end(html);
}

/** Write an HTTP 302 redirect response with CORS headers. */
export function sendRedirect(
  res: ServerResponse,
  location: string,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  if (res.writableEnded) return;
  res.writeHead(302, { ...CORS_HEADERS, location, ...extraHeaders });
  res.end();
}

/** Format a single SSE envelope into wire frames. */
export function formatSseFrame(envelope: SseEnvelope): string {
  let frame = "";
  if (envelope.id !== undefined) frame += `id: ${envelope.id}\n`;
  if (envelope.event !== undefined) frame += `event: ${envelope.event}\n`;
  frame += `data: ${JSON.stringify(envelope.data)}\n\n`;
  return frame;
}

/** Fan-out Server-Sent Events hub with optional per-client filters and reconnect replay. */
export class SseHub {
  readonly #clients = new Set<SseClient>();

  connect(
    res: ServerResponse,
    options?: {
      readonly filter?: (envelope: SseEnvelope) => boolean;
      readonly replay?: readonly SseEnvelope[];
      readonly meta?: Readonly<Record<string, string>>;
    },
  ): void {
    res.writeHead(200, {
      ...CORS_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.flushHeaders();
    try {
      res.write(": connected\n\n");
      if (options?.replay) {
        for (const item of options.replay) {
          if (!options.filter || options.filter(item)) {
            res.write(formatSseFrame(item));
          }
        }
      }
    } catch {
      res.destroy();
      return;
    }
    const client: SseClient = { res, filter: options?.filter, meta: options?.meta };
    this.#clients.add(client);
    res.on("close", () => {
      this.#clients.delete(client);
    });
  }

  broadcast(envelope: SseEnvelope): void {
    const wire = formatSseFrame(envelope);
    for (const client of [...this.#clients]) {
      if (client.res.writableEnded || client.res.destroyed) {
        this.#clients.delete(client);
        continue;
      }
      if (!client.filter || client.filter(envelope)) {
        try {
          client.res.write(wire);
        } catch {
          this.#clients.delete(client);
          client.res.destroy();
        }
      }
    }
  }

  closeWhere(predicate: (meta: Readonly<Record<string, string>> | undefined) => boolean): void {
    for (const client of [...this.#clients]) {
      if (!predicate(client.meta)) continue;
      this.#clients.delete(client);
      if (!client.res.writableEnded && !client.res.destroyed) {
        try {
          client.res.end();
        } catch {
          client.res.destroy();
        }
      }
    }
  }

  closeAll(): void {
    for (const client of [...this.#clients]) {
      if (!client.res.writableEnded && !client.res.destroyed) {
        try {
          client.res.end();
        } catch {
          client.res.destroy();
        }
      }
    }
    this.#clients.clear();
  }
}

/** Fixed-capacity ring buffer capturing non-control wire requests. */
export class RequestLog {
  #seq = 0;
  readonly #items: RecordedRequest[] = [];
  readonly #capacity: number;

  constructor(capacity = MAX_REQUEST_LOG) {
    this.#capacity = capacity;
  }

  record(req: ParsedRequest): RecordedRequest {
    const entry: RecordedRequest = {
      seq: ++this.#seq,
      at: Date.now(),
      method: req.method,
      path: req.pathname,
      query: req.query,
      headers: req.headers,
      body: req.body,
    };
    this.#items.push(entry);
    if (this.#items.length > this.#capacity) {
      this.#items.splice(0, this.#items.length - this.#capacity);
    }
    return entry;
  }

  list(pathFilter?: string): readonly RecordedRequest[] {
    if (!pathFilter) return [...this.#items];
    return this.#items.filter((item) => item.path === pathFilter || item.path.startsWith(pathFilter));
  }

  clear(): void {
    this.#items.length = 0;
  }
}

function matchesFaultPath(pattern: string, pathname: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

/** Armed HTTP fault rule registry supporting `429 Retry-After`, `503`, custom errors, and stalls. */
export class FaultArmory {
  readonly #rules: FaultRule[] = [];

  arm(rule: Omit<FaultRule, "remaining"> & { readonly remaining?: number }): FaultRule {
    const remaining = rule.remaining ?? 1;
    const normalized: FaultRule = {
      method: rule.method?.toUpperCase(),
      path: rule.path,
      status: rule.status,
      retryAfter: rule.retryAfter,
      body: rule.body,
      remaining: Math.max(0, remaining),
      stall: rule.stall,
    };
    if (normalized.remaining > 0) this.#rules.push(normalized);
    return normalized;
  }

  consume(method: string, pathname: string): FaultRule | undefined {
    const upper = method.toUpperCase();
    for (let index = 0; index < this.#rules.length; index += 1) {
      const rule = this.#rules[index];
      if (rule.remaining <= 0) {
        this.#rules.splice(index, 1);
        index -= 1;
        continue;
      }
      if ((!rule.method || rule.method === upper) && matchesFaultPath(rule.path, pathname)) {
        rule.remaining -= 1;
        if (rule.remaining <= 0) this.#rules.splice(index, 1);
        return rule;
      }
    }
    return undefined;
  }

  list(): readonly FaultRule[] {
    return this.#rules.map((rule) => ({ ...rule }));
  }

  clear(): void {
    this.#rules.length = 0;
  }
}

function normalizeHeaders(raw: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value)) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

function parseRawBody(rawBody: string, contentType: string): unknown {
  if (rawBody.trim() === "") return undefined;
  const lower = contentType.toLowerCase();
  if (lower.includes("application/x-www-form-urlencoded")) {
    const form: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(rawBody)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      form[key] = value;
    }
    return form;
  }
  if (lower.includes("application/json") || rawBody.trimStart().startsWith("{") || rawBody.trimStart().startsWith("[")) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }
  return rawBody;
}

/** Read and parse an incoming Node HTTP request into query, body, and merged params. */
export async function parseRequest(req: IncomingMessage): Promise<ParsedRequest> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    query[key] = value;
  }
  const headers = normalizeHeaders(req.headers);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const body = parseRawBody(rawBody, headers["content-type"] ?? "");
  const bodyRecord = asRecord(body);
  const params: Record<string, unknown> = { ...query };
  if (bodyRecord !== undefined) {
    for (const [key, value] of Object.entries(bodyRecord)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      params[key] = value;
    }
  }
  return {
    method: (req.method ?? "GET").toUpperCase(),
    url,
    pathname: url.pathname,
    query,
    headers,
    rawBody,
    body,
    params,
  };
}

function loadStateFile<S>(stateFile: string | undefined, createInitial: () => S): S {
  if (!stateFile) return createInitial();
  if (fs.existsSync(stateFile)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (asRecord(parsed) === undefined) throw new Error(`Invalid provider state file: ${stateFile}`);
    return parsed as S;
  }
  const initial = createInitial();
  saveStateFile(stateFile, initial);
  return initial;
}

function saveStateFile<S>(stateFile: string | undefined, state: S): void {
  if (!stateFile) return;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, stateFile);
  } catch (cause) {
    fs.rmSync(temp, { force: true });
    throw cause;
  }
}

function armFaultsFromParams(params: Readonly<Record<string, unknown>>, faults: FaultArmory): void {
  if (asBoolean(params.clear) === true) {
    faults.clear();
    return;
  }
  const rulesRaw = Array.isArray(params.rules) ? params.rules : [params];
  for (const item of rulesRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const faultPath = asString(rec.path) ?? "*";
    const status = asNumber(rec.status) ?? 503;
    faults.arm({
      method: asString(rec.method),
      path: faultPath,
      status,
      retryAfter: asNumber(rec.retryAfter ?? rec.retry_after),
      body: rec.body,
      remaining: asNumber(rec.remaining ?? rec.count) ?? 1,
      stall: asBoolean(rec.stall),
    });
  }
}

async function handleSharedControl<S>(
  parsed: ParsedRequest,
  res: ServerResponse,
  config: ProviderServerConfig<S>,
  ctx: ProviderContext<S>,
): Promise<boolean> {
  if (parsed.pathname === "/__control/reset" && parsed.method === "POST") {
    ctx.setState(config.createInitial());
    ctx.faults.clear();
    ctx.requests.clear();
    config.onReset?.(parsed.params, ctx);
    ctx.save();
    sendJson(res, 200, { ok: true, reset: true });
    return true;
  }
  if (parsed.pathname === "/__control/requests" && parsed.method === "GET") {
    sendJson(res, 200, { ok: true, requests: ctx.requests.list(parsed.query.path) });
    return true;
  }
  if (parsed.pathname === "/__control/state" && parsed.method === "GET") {
    const snapshot = config.serializeState ? config.serializeState(ctx.getState()) : ctx.getState();
    sendJson(res, 200, { ok: true, state: snapshot });
    return true;
  }
  if (parsed.pathname === "/__control/fault" && parsed.method === "POST") {
    armFaultsFromParams(parsed.params, ctx.faults);
    sendJson(res, 200, { ok: true, armed: ctx.faults.list() });
    return true;
  }
  if (config.onControl) {
    return await config.onControl(parsed, res, ctx);
  }
  return false;
}

/** Create and start a loopback HTTP+SSE provider server with shared CORS, fault injection, request log, and `/__control/*` plane. */
export async function createProviderServer<S>(config: ProviderServerConfig<S>): Promise<RunningProvider> {
  const stateFile = config.options?.stateFile;
  let state = loadStateFile(stateFile, config.createInitial);
  const sse = new SseHub();
  const faults = new FaultArmory();
  const requests = new RequestLog();

  const ctx: ProviderContext<S> = {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    save: () => saveStateFile(stateFile, state),
    sse,
    faults,
    requests,
  };

  const server = http.createServer((incoming, outgoing) => {
    void (async () => {
      if ((incoming.method ?? "GET").toUpperCase() === "OPTIONS") {
        const path = new URL(incoming.url ?? "/", "http://localhost").pathname;
        const requested = config.preflightHeaders?.(path) ?? incoming.headers["access-control-request-headers"];
        const headers = typeof requested === "string" && requested.trim() !== ""
          ? { ...CORS_HEADERS, "access-control-allow-headers": requested }
          : CORS_HEADERS;
        outgoing.writeHead(204, headers);
        outgoing.end();
        return;
      }
      const parsed = await parseRequest(incoming);
      if (parsed.pathname.startsWith("/__control/")) {
        const handled = await handleSharedControl(parsed, outgoing, config, ctx);
        if (!handled) sendJson(outgoing, 404, { ok: false, error: "unknown_control_route" });
        return;
      }
      requests.record(parsed);
      const fault = faults.consume(parsed.method, parsed.pathname);
      if (fault) {
        if (fault.stall) return;
        const extra = fault.retryAfter !== undefined ? { "retry-after": String(fault.retryAfter) } : undefined;
        const body = fault.body ?? config.defaultFaultBody?.(fault) ?? { ok: false, error: `http_${fault.status}` };
        sendJson(outgoing, fault.status, body, extra);
        return;
      }
      await config.onRequest(parsed, outgoing, ctx);
    })().catch((cause: unknown) => {
      if (cause instanceof PayloadTooLargeError) {
        sendJson(outgoing, 413, { ok: false, error: "payload_too_large" });
        return;
      }
      sendJson(outgoing, 500, { ok: false, error: "internal_error", detail: String(cause) });
    });
  });

  const requestedPort = config.options?.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    port,
    stop: async () => {
      sse.closeAll();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
