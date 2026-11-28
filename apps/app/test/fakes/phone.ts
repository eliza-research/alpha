import type { AgentEvents, AgentRequest, AgentStatus, AgentStreamRequest, ElizaAgentPlugin, ElizaCloudPlugin, NativeCloudRequest, ElizaSecureStorePlugin, ElizaSecureStoreResult } from "@elizaos/os-bridges";
import { deviceRoutes } from "@elizaos/cloud";
import type { PlatformScene } from "./platform.ts";
import type { RecoveryScene } from "./settings.ts";
import type { Answering } from "./routes.ts";

/**
 * A plugin as its Java or Kotlin answers the page: each method of eliza's definition `P`. The phone is faked once, at
 * the boundary Capacitor's own runtime calls on a native platform (`plugIn`), with eliza's plugins behind it by their
 * names, arguments, answers, rejections and events (`.eliza/packages/os/android`, typed by
 * `.eliza/packages/os-bridges/src/bridges/definitions`): Alpha's phone layers, eliza's clients and Capacitor run on it unchanged.
 */
export type Native<P> = { [Method in Exclude<keyof P, "addListener">]: P[Method] };

/** Send the page's listeners an event of a plugin, as `notifyListeners` does. */
export type Emit<Events> = <Name extends keyof Events & string>(event: Name, data: Events[Name]) => void;

/** One plugin of the fake phone: its methods, given the way to emit its events and optional unplug teardown hook. */
export type Faked = (emit: (event: string, data: unknown) => void, onUnplug?: (cleanup: () => void) => void) => object;

/** The fake of a plugin whose definition is `P` and whose events are `Events`: it does not compile once eliza changes either. */
export const plugin = <P, Events = Record<never, never>>(make: (emit: Emit<Events>, onUnplug?: (cleanup: () => void) => void) => Native<P>): Faked => (emit, onUnplug) => make(emit, onUnplug);

/** What a plugin rejects a call with: Android's `call.reject(message, code)`. */
export function rejection(message: string, code = message) {
  return Object.assign(new Error(message), { code });
}

/** A plugin call's answer, worked out at once as Capacitor's bridge does: what `work` throws, the call rejects with. */
export const answered = <T>(work: () => T) => new Promise<T>((resolve) => resolve(work()));

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (one) => String.fromCharCode(one)).join(""));

/**
 * `AgentPlugin.java`, the `ElizaAgent` plugin: `request` answers `{ status, data }`, where data is the JSON of the
 * agent's body, null for none, or its text; `requestStream` answers `{ id }`, then emits a head and each chunk as
 * `streamData` and one `streamEnd`; `abort` ends either. It relays a path under `/api/`, a JSON object and the headers
 * its channel admits; `subscribeEvents` answers `{ id }`, then emits each event the agent publishes on the topic as
 * `agentEvent`, until `unsubscribeEvents`.
 */
export function elizaAgent(agent: Answering, platform: Pick<PlatformScene, "abortFails" | "agentCredentialMissing">, recovery?: RecoveryScene): Faked {
  return plugin<ElizaAgentPlugin, AgentEvents>((emit, onUnplug) => {
    const calls = new Map<string, AbortController>();
    let state: "running" | "stopped" | "failed" = recovery === undefined ? "running" : "failed";
    let epoch = 1;
    const requestBodyLimit = 1_048_576;
    onUnplug?.(() => {
      for (const call of calls.values()) call.abort();
      calls.clear();
    });
    const status = (): AgentStatus => platform.agentCredentialMissing
      ? { available: true, epoch, requestBodyLimit, state: "failed", failure: "credential" }
      : state === "failed"
      ? { available: true, epoch, requestBodyLimit, state, failure: "storage" }
      : { available: true, epoch, requestBodyLimit, state };
    const set = (next: "running" | "stopped", bumpEpoch = false): Promise<AgentStatus> => {
      state = next;
      if (bumpEpoch) epoch += 1;
      const now = status();
      emit("status", now);
      return Promise.resolve(now);
    };
    function asked({ method, path, body, headers }: AgentRequest, id: string) {
      if (status().state !== "running") throw rejection("NotReady");
      if (typeof method !== "string" || typeof path !== "string" || !path.startsWith("/api/")) throw rejection("RouteRefused");
      if (id === "" || calls.has(id)) throw rejection("IdInUse");
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      if (serialized !== undefined && new TextEncoder().encode(serialized).length > requestBodyLimit) throw rejection("BodyTooLarge");
      const gone = new AbortController();
      calls.set(id, gone);
      return new Request(new URL(path, "http://agent.phone"), { method, signal: gone.signal, headers: { ...headers, ...(serialized === undefined ? {} : { "content-type": "application/json" }) }, ...(serialized === undefined ? {} : { body: serialized }) });
    }
    async function listen(id: string, request: Request) {
      let index = 0;
      try {
        if (request.signal.aborted) return;
        const response = await agent(request).catch(() => undefined);
        if (request.signal.aborted) return;
        const reader = response?.body?.pipeThrough(new TextDecoderStream()).getReader();
        request.signal.addEventListener("abort", () => void reader?.cancel(), { once: true });
        if (request.signal.aborted) void reader?.cancel();
        let held = "";
        for (let read = await reader?.read().catch(() => undefined); read && !read.done; read = await reader?.read().catch(() => undefined)) {
          if (request.signal.aborted) break;
          const parts = (held + read.value).split("\n\n");
          held = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            try {
              emit("agentEvent", { id, kind: "event", index: index++, event: JSON.parse(part.slice(6)) as Record<string, unknown> });
            } catch {
              continue;
            }
          }
        }
      } catch {
        return;
      } finally {
        if (calls.delete(id)) emit("agentEvent", { id, kind: "end" });
      }
    }
    async function pump(id: string, request: Request) {
      let index = 0;
      try {
        const response = await agent(request);
        emit("streamData", { id, kind: "head", index: index++, status: response.status, headers: Object.fromEntries(response.headers) });
        const reader = response.body?.getReader();
        request.signal.addEventListener("abort", () => void reader?.cancel(), { once: true });
        if (request.signal.aborted) void reader?.cancel();
        for (let read = await reader?.read(); read && !read.done; read = await reader?.read()) emit("streamData", { id, kind: "chunk", index: index++, dataBase64: base64(read.value) });
        emit("streamEnd", { id, kind: calls.has(id) ? "end" : "aborted" });
      } catch {
        emit("streamEnd", { id, kind: calls.has(id) ? "error" : "aborted" });
      } finally {
        calls.delete(id);
      }
    }
    const aborted = ({ id }: { id: string }) => {
      const call = calls.get(id);
      calls.delete(id);
      call?.abort();
      if (platform.abortFails) return Promise.reject(rejection("AbortFailed"));
      return Promise.resolve({ aborted: call !== undefined });
    };
    return {
      getStatus: () => Promise.resolve(status()),
      start: () => { if (recovery !== undefined) recovery.starts += 1; return set("running", true); },
      stop: () => set("stopped"),
      restart: () => set("running", true),
      async request(options: AgentRequest) {
        const id = options.id ?? crypto.randomUUID();
        try {
          const response = await agent(asked(options, id));
          const text = await response.text();
          let data: unknown = null;
          if (text !== "") try { data = JSON.parse(text) as unknown; } catch { data = text; }
          return { status: response.status, data };
        } catch (cause) {
          throw cause instanceof Error && "code" in cause ? cause : rejection("Broken");
        } finally {
          calls.delete(id);
        }
      },
      requestStream(options: AgentStreamRequest) {
        try {
          void pump(options.id, asked(options, options.id));
          return Promise.resolve({ id: options.id });
        } catch (cause) {
          return Promise.reject(cause instanceof Error ? cause : rejection("Broken"));
        }
      },
      abort: aborted,
      subscribeEvents({ id, topic, clientId }) {
        try {
          void listen(id, asked({ method: "GET", path: `/api/events?topic=${topic}${clientId === undefined ? "" : `&clientId=${clientId}`}` }, id));
          return Promise.resolve({ id });
        } catch (cause) {
          return Promise.reject(cause instanceof Error ? cause : rejection("Broken"));
        }
      },
      unsubscribeEvents: aborted,
      reviewRecovery: () => Promise.resolve(recovery !== undefined && state === "failed"
        ? { kind: "reviewable", reviewToken: "1.check", retainedCount: recovery.retained }
        : { kind: "unavailable" }),
      archiveRecovery: async ({ reviewToken }) => {
        if (recovery === undefined || state !== "failed" || reviewToken !== "1.check") return { kind: "unavailable" };
        recovery.tokens.push(reviewToken);
        await set("stopped");
        return { kind: "archived", archivedCount: recovery.archived };
      },
    };
  });
}

/** The phone's mail lease as eliza's sign-in keeps it: whether it holds one, how the owner answers the browser sign-in for one, how many of those sign-ins the phone started, and how many mail or calendar requests it held back for want of the lease. */
export interface MailLeaseScene { held: boolean; answer: "SignsIn" | "Cancels"; asked: number; heldBack: number }

/** Whether eliza's cloud client lists `method` and the path of `target` as a mail or calendar route (`Mail`), which the phone sends only with its device lease. */
function mailRoute(method: string, target: string): boolean {
  const pieces = new URL(target, "http://cloud.phone").pathname.slice(1).split("/");
  return deviceRoutes.some((route) => route.auth === "Mail" && route.method.toUpperCase() === method && route.path.length === pieces.length
    && route.path.every((piece, at) => piece.tag === "Param" || piece.text === pieces[at]));
}

/**
 * `ElizaCloudPlugin.java`, the `ElizaCloud` plugin: `request` sends one listed route under the credential it alone
 * holds, the device lease on a mail or calendar route, the signed session to connect Google, and the device key on other routes. It answers the status, the
 * headers a page may read and the body in base64; what it will not send it rejects with one of eliza's `CloudFailure`
 * codes, `mail-lease-upgrade-required` for a mail or calendar route on a phone signed in without a lease.
 */
export function elizaCloud(cloud: Answering, signedIn: () => boolean, lease: MailLeaseScene, credential: () => string, opened?: (url: string) => void, billing?: () => boolean, googleSession?: () => boolean): Faked {
  return plugin<ElizaCloudPlugin>(() => ({
    async request({ method, target, headers, body, expectedCredentialId, expectedSessionCredentialId }: NativeCloudRequest) {
      if (!target.startsWith("/api/")) throw rejection("not-listed");
      if (!signedIn()) throw rejection("sign-in-required");
      const mail = mailRoute(method, target);
      if (expectedCredentialId !== undefined && (expectedCredentialId !== credential() || mail)) throw rejection("sign-in-required");
      if (expectedSessionCredentialId !== undefined && (expectedSessionCredentialId !== credential() || !billing?.())) {
        return { status: 428, body: "" };
      }
      if (mail && !lease.held) {
        lease.heldBack += 1;
        throw rejection("mail-lease-upgrade-required");
      }
      const connectingGoogle = method === "POST" && target === "/api/v1/eliza/google/connect/initiate";
      if (connectingGoogle && googleSession !== undefined && !googleSession()) throw rejection("reauth-required");
      const bearer = connectingGoogle ? "signed-session" : mail ? "mail-lease" : expectedSessionCredentialId === undefined ? "device-key" : "billing-session";
      const response = await cloud(new Request(new URL(target, "http://cloud.phone"), { method, headers: { ...headers, authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body })).catch(() => { throw rejection("network"); });
      const found = { etag: response.headers.get("etag"), contentType: response.headers.get("content-type"), retryAfter: response.headers.get("retry-after") };
      return { status: response.status, body: base64(new Uint8Array(await response.arrayBuffer())), ...Object.fromEntries(Object.entries(found).filter(([, value]) => value !== null)) };
    },
    readGrant: () => Promise.reject(rejection("grant-unknown")),
    cancel: () => Promise.resolve({ cancelled: false }),
    openExternal: ({ url }) => { opened?.(url); return Promise.resolve({ opened: true }); },
  }));
}

/**
 * `SecureStorePlugin.kt`, the `ElizaSecureStore` plugin: every call resolves, and says in `ok`, `error` and `outcome`
 * how it went. The fake grants the slots the host's policy opens to the page.
 */
export function elizaSecureStore(secrets: Map<string, string>, permits: (key: string) => boolean): Faked {
  const denied: ElizaSecureStoreResult = { ok: false, error: "denied", outcome: "Refused" };
  return plugin<ElizaSecureStorePlugin>(() => ({
    get: ({ key }) => Promise.resolve(!permits(key) ? { ok: false, error: "denied" } : secrets.has(key) ? { ok: true, value: secrets.get(key)! } : { ok: false, error: "not_found" }),
    set({ key, value }) {
      if (!permits(key)) return Promise.resolve(denied);
      secrets.set(key, value);
      return Promise.resolve({ ok: true, outcome: "Written" });
    },
    remove({ key }) {
      if (!permits(key)) return Promise.resolve(denied);
      secrets.delete(key);
      return Promise.resolve({ ok: true, outcome: "Removed" });
    },
    compareAndExchange({ key, expected, value }) {
      if (!permits(key)) return Promise.resolve(denied);
      if ((secrets.get(key) ?? null) !== expected) return Promise.resolve({ ok: false, error: "conflict", outcome: "Conflict" });
      if (value === null) secrets.delete(key);
      else secrets.set(key, value);
      return Promise.resolve({ ok: true, outcome: value === null ? "Removed" : "Written" });
    },
    status: () => Promise.resolve({ ok: true, available: true, backend: "android_keystore", accessibility: "credential_encrypted_device_only", synchronized: false, accessGroup: "app_only" }),
  }));
}

type NativeMethods = Record<string, (options: unknown) => unknown>;

function legacySmsSlot(input: unknown, fields: number): string {
  if (typeof input === "object" && input !== null && Object.keys(input).length === fields && "threadId" in input) {
    const { threadId } = input;
    if (threadId === null) return "sms-draft:v1:new";
    if (typeof threadId === "string" && /^thread:[1-9][0-9]{0,18}$/.test(threadId)) return `sms-draft:v1:${threadId}`;
  }
  throw rejection("Invalid saved Messages draft", "invalid");
}

function legacySmsDrafts(earlier: NativeMethods | undefined) {
  const target = new EventTarget();
  const reply = (payload: object) => target.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  async function receive(data: string) {
    let message: unknown;
    try { message = JSON.parse(data); } catch { return; }
    if (typeof message !== "object" || message === null || !("requestId" in message) || typeof message.requestId !== "string") return;
    const { requestId, ...input } = message as { requestId: string; kind?: unknown; threadId?: unknown; expected?: unknown };
    const { kind, ...fields } = input;
    try {
      if (kind === "read") {
        const slot = legacySmsSlot(fields, 1);
        const result = await Promise.resolve(earlier?.secureRead?.({ slot }) ?? { value: null });
        reply({ requestId, result });
        return;
      }
      const slot = legacySmsSlot(fields, 2);
      const expected = fields.expected;
      if (kind !== "retire" || typeof expected !== "string" || expected.length === 0 || expected.length > 8 * 1024 * 1024) {
        throw rejection("Invalid saved Messages draft", "invalid");
      }
      const retired = await earlier?.secureCompareExchange?.({ slot, expectedValue: expected, value: null });
      const status = typeof retired === "object" && retired !== null && "status" in retired && retired.status === "saved" ? "removed" : "conflict";
      reply({ requestId, result: { status } });
    } catch (reason) {
      const invalid = typeof reason === "object" && reason !== null && "code" in reason && reason.code === "invalid";
      reply({ requestId, error: { code: invalid ? "invalid" : "unavailable", message: "Saved Messages draft refused" } });
    }
  }
  return Object.assign(target, { postMessage: (data: string) => { void receive(data); } });
}

type Hear = (data: unknown) => void;
interface Capacitor {
  PluginHeaders?: { name: string; methods: { name: string; rtype?: string }[] }[];
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
  nativeCallback?: (plugin: string, method: string, options: { eventName?: string; callbackId?: string }, heard?: Hear) => string;
}

let currentHearing = new Map<string, Map<string, Hear>>();

/** Number of active Capacitor listeners currently registered for `plugin` and `event`. */
export function listenerCount(name: string, event: string): number {
  return currentHearing.get(`${name} ${event}`)?.size ?? 0;
}

/**
 * Make the page a phone's: Android's bridge object, which is how Capacitor tells the platform, and on `Capacitor` the
 * header of each plugin of `plugins` and the two calls its runtime makes of the native side. The returned function
 * takes them off again.
 * @throws {never}
 */
export function plugIn(plugins: Readonly<Record<string, Faked>>): () => void {
  const page = globalThis as { Capacitor?: Capacitor; androidBridge?: object };
  const capacitor = (page.Capacitor ??= {});
  const previousHeaders = capacitor.PluginHeaders;
  const previousPromise = capacitor.nativePromise;
  const previousCallback = capacitor.nativeCallback;
  const hearing = new Map<string, Map<string, Hear>>();
  const cleanups: (() => void)[] = [];
  currentHearing = hearing;
  const heard = (name: string, event: string) => hearing.get(`${name} ${event}`) ?? hearing.set(`${name} ${event}`, new Map()).get(`${name} ${event}`)!;
  const made = Object.fromEntries(Object.entries(plugins).map(([name, make]) => [
    name,
    make(
      (event, data) => { for (const hear of [...heard(name, event).values()]) hear(data); },
      (cleanup) => { cleanups.push(cleanup); },
    ) as NativeMethods,
  ]));
  const web = typeof window === "undefined" ? undefined : window as Window & { alphaLegacySmsDrafts?: ReturnType<typeof legacySmsDrafts> };
  const legacy = made.ElizaTelephony === undefined ? undefined : legacySmsDrafts(made.AlphaConnection);
  if (web && legacy) web.alphaLegacySmsDrafts = legacy;
  let listeners = 0;
  page.androidBridge = {};
  capacitor.PluginHeaders = Object.entries(made).map(([name, methods]) => ({ name, methods: [...Object.keys(methods).map((method) => ({ name: method, rtype: "promise" })), { name: "addListener" }, { name: "removeListener" }] }));
  capacitor.nativePromise = (name, method, options) => Promise.resolve().then(() => {
    const call = made[name]?.[method];
    if (call === undefined) throw rejection(`${name}.${method} is not implemented`, "UNIMPLEMENTED");
    return call(options ?? {});
  });
  capacitor.nativeCallback = (name, method, options, hear) => {
    const id = options.callbackId ?? String(++listeners);
    if (method === "addListener" && hear) heard(name, options.eventName ?? "").set(id, hear);
    if (method === "removeListener") heard(name, options.eventName ?? "").delete(id);
    return id;
  };
  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    hearing.clear();
    if (web && web.alphaLegacySmsDrafts === legacy) delete web.alphaLegacySmsDrafts;
    delete page.androidBridge;
    if (previousHeaders === undefined) delete capacitor.PluginHeaders;
    else capacitor.PluginHeaders = previousHeaders;
    if (previousPromise === undefined) delete capacitor.nativePromise;
    else capacitor.nativePromise = previousPromise;
    if (previousCallback === undefined) capacitor.nativeCallback = () => "";
    else capacitor.nativeCallback = previousCallback;
  };
}

/** Press a hardware button, as Alpha's Android host does: Back reaches the page only while the page says it can go back, and is Home otherwise. */
export function pressButton(button: "back" | "home") {
  const back = button === "back" && document.documentElement.dataset.alphaCanGoBack === "true";
  window.dispatchEvent(new Event(back ? "alpha-back" : "launcher-home"));
}
