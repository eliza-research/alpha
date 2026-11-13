// Execute product coordination with controlled storage, Gmail and native attachment ports.
import { build } from "esbuild";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
let compiled, expectedInputs;
async function bundle() {
  if (compiled) return compiled;
  const ports = {
    "@capacitor/core": "export const Capacitor={getPlatform:()=> 'android',isNativePlatform:()=>true};",
    "connection-ui": "export const connectionController=globalThis.ports.controller; export const agentPendingText=()=>'';",
    "native-connection": "export const secureConnectionStore=globalThis.ports.store;",
    "platform-plugins": "export const registerPlugin=()=>globalThis.ports.attachment;",
    "daily": "export const DailyApps=globalThis.ports.daily;",
    "dev-profile": "export const browserDevProfile=false;",
    "json-domain-document": "export class BrowserJsonDomainDocument { constructor(){throw Error('Unexpected browser storage in native fixture');} }",
    "domain-recovery": "export function openDomainRecovery(){throw Error('Recovery UI is outside this fixture');}",
    "device-preferences": "export const cachedDevicePreferences=()=>({autoLoadMailImages:false});export const initializeDevicePreferences=()=>{};",
    "gmail-background": "export const configureGmailBackground=async()=>{};export const withdrawGmailBackground=async()=>{};export const retireGmailBackground=async()=>{};export const pendingGmailNotice=async()=>null;export const consumeGmailNotice=async()=>{};export const releaseGmailQuestion=async()=>{};export const onGmailNotice=async()=>({remove:async()=>{}});",
    "google-connect-flow": "export const googleConnect={subscribe:()=>()=>{},getSnapshot:()=> 'idle',start:()=>{throw Error('OAuth is outside this fixture');}};export const googleConnectNote=()=>'';",
    "mail-html": "export const prepareMailHtml=()=>{throw Error('HTML body rendering is outside this fixture');};",
    "own-notice-question": "export const reviewOwnNoticeQuestion=()=>{throw Error('Notice question is outside this fixture');};",
    "google-connection-ui": "export const googleConnectionController={getSnapshot:()=>({}),subscribe:()=>()=>{},open:()=>{throw Error(\"Google connection UI is outside this fixture\");}};",
    "alpha-client": "export const alphaClient={getState:()=>({context:{sensitive:false}})};",
    "review": "export class BrowserReviews{confirm(){throw Error('Link review is outside this fixture');}cancel(){}cancelAll(){}}"
  };
  const result = await build({
    stdin: { contents: `export {installInboxCloudAdapter,inboxAttention} from './apps/app/src/prototype/inbox-cloud-adapter.ts';
      export {inboxProviderControls} from './apps/app/src/prototype/inbox-provider-controls.ts';
      export {inboxDrafts} from './apps/app/src/prototype/inbox-drafts.ts';
      export {InboxOperation} from './apps/app/src/runtime/inbox-operation.ts';
      export {reviewMailAttachment as reviewAttachment} from './apps/app/src/runtime/inbox-attachment.ts';
      export {serviceReadCache} from './apps/app/src/runtime/service-read-cache-store.ts';
      export {readInboxUnsaved} from './apps/app/src/runtime/inbox-unsaved-record.ts';`, resolveDir: root, sourcefile: "inbox-coordinator-entry.ts" },
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: "iife",
    globalName: "inboxModules",
    platform: "browser",
    target: "es2022",
    metafile: true,
    define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-inbox-ports", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const name = args.path === "@capacitor/core" ? args.path : args.path.split("/").at(-1).replace(/\.(?:ts|tsx)$/, "");
        if (Object.hasOwn(ports, name)) return { path: name, namespace: "inbox-port" };
      });
      builder.onLoad({ filter: /.*/, namespace: "inbox-port" }, ({ path }) => ({ contents: ports[path], loader: "js" }));
    } }]
  });
  compiled = { code: result.outputFiles[0].text, sources: Object.keys(result.metafile.inputs).filter((path) => !path.startsWith("inbox-port:") && path !== "inbox-coordinator-entry.ts" && !path.startsWith("node_modules/") && !path.startsWith("<")) };
  if (expectedInputs && JSON.stringify([...compiled.sources].sort()) !== expectedInputs) throw Error("Inbox module graph changed during compilation");
  return compiled;
}
export async function inboxDriverSources() {
  return [...(await bundle()).sources, 'upstream.lock.json', 'scripts/prepare-client-features.ts',
    '.eliza/client-features/.source.json'];
}
export async function inboxDriverArtifact() {
  return (await bundle()).code;
}
export function rebuildInboxDriver(expected) {
  compiled = undefined;
  expectedInputs = JSON.stringify(expected.filter(path=>path!==".eliza/client-features/.source.json"&&path!=="upstream.lock.json"&&path!=="scripts/prepare-client-features.ts").sort());
}
export async function createInboxFixture() {
  const artifact = await bundle();
  const slots = new Map(), events = [], toasts = [], listeners = new Set(), pending = new Set();
  let counter = 0, clock = 1000, storeGate, storeResultGate, capabilityGate, prepareGate, dispatchGate, receiptGate, attachmentGate;
  let accountIndex = 1, sessionIndex = 1, connected = true, fixture;
  const capabilities = new Map([1, 2].map((owner) => [owner, {
    version: 1,
    from: `owner-${owner}@example.test`,
    threads: true,
    send: true,
    providerDrafts: true,
    mailboxMutations: true,
    attachments: true,
    providerExactlyOnce: false,
    atomicDraftReplacement: false,
    readState: true,
    draftsList: true,
    forwardAttachments: true,
    attachmentPolicy: { maximumOutgoing: 2, maximumBytes: 5242880, maximumTotalBytes: 5242880 }
  }]));
  const receipts = new Map();
  const state = { prepares: 0, dispatches: 0, receiptReads: 0, outcome: "succeeded", failReceipt: false, failStore: false, attachments: [], released: [], messages: [] };
  function track(task) {
    const result = Promise.resolve().then(task);
    pending.add(result);
    counter++;
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  }
  const keyFor = (grant, request) => `${grant}/${request}`;
  const store = {
    read: (key) => track(async () => {
      events.push(["read", key]);
      if (storeGate) await storeGate({ kind: "read", key });
      return structuredClone(slots.get(key) ?? null);
    }),
    compareExchange: (key, expected, value) => track(async () => {
      events.push(["cas-start", key, value?.phase ?? null]);
      if (storeGate) await storeGate({ kind: "cas", key, expected, value });
      if (state.failStore) throw Error("Fixture storage unavailable");
      if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(expected)) return { status: "conflict" };
      if (value === null) slots.delete(key);
      else slots.set(key, structuredClone(value));
      events.push(["cas-done", key, value?.phase ?? null]);
      if (storeResultGate) await storeResultGate({kind: "cas", key, expected, value});
      return { status: "saved" };
    }),
    readRaw: async (key) => {
      const value = await store.read(key);
      return value === null ? null : JSON.stringify(value);
    },
    compareExchangeRaw: async (key, expected, value) => store.compareExchange(key, expected === null ? null : JSON.parse(expected), JSON.parse(value))
  };
  const client = {
    gmailAccounts: () => track(async () => [1, 2].filter((owner) => capabilities.has(owner)).map((owner) => ({
      connectionId: `grant-${owner}`,
      label: `Owner ${owner}`,
      connected,
      grantedCapabilities: capabilities.get(owner).read === false ? [] : ["google.gmail.triage", ...capabilities.get(owner).send ? ["google.gmail.send"] : [], ...capabilities.get(owner).providerDrafts ? ["google.gmail.drafts"] : [], ...capabilities.get(owner).mailboxMutations ? ["google.gmail.mailbox"] : []]
    }))),
    gmailInboxCapabilities: (grant, signal) => track(async () => {
      events.push(["capabilities", grant]);
      if (capabilityGate) return capabilityGate(grant, signal);
      const result = capabilities.get(Number(grant.split("-")[1]));
      if (!result) throw Error("Fixture capability read unavailable");
      return structuredClone(result);
    }),
    gmailSearch: (grant, query) => track(async () => {
      events.push(["search", grant, query]);
      return { messages: structuredClone(state.messages), syncedAt: "fixture", nextPageToken: null, mailboxHistoryId: "1" };
    }),
    gmailPrepareOperation: (grant, request, proposal, signal) => track(async () => {
      state.prepares++;
      events.push(["prepare", grant, request]);
      if (prepareGate) await prepareGate(grant, request, proposal, signal);
      const attachments = await Promise.all((proposal.attachments ?? []).map((file) => fixture.modules.reviewAttachment(file)));
      const review = { ...structuredClone(proposal), from: capabilities.get(Number(grant.split("-")[1]))?.from ?? "owner@example.test", attachments: attachments.map(({ text, ...metadata }) => metadata) };
      if (proposal.forwardAttachments) {
        review.forwardSource = { messageId: proposal.forwardAttachments.messageId, historyId: proposal.forwardAttachments.historyId };
        review.forwardedAttachments = proposal.forwardAttachments.partIds.map((partId) => ({ partId, name: "forward.txt", mimeType: "text/plain", size: 1, sha256: "a".repeat(64) }));
      }
      const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(review)))).toString("hex");
      const receipt = { requestId: request, kind: proposal.kind, state: "prepared", reviewDigest: digest, providerResult: null, rejectionCode: null };
      receipts.set(keyFor(grant, request), receipt);
      return { review, receipt };
    }),
    gmailDispatchOperation: (grant, request, reviewDigest, proposal, signal) => track(async () => {
      state.dispatches++;
      events.push(["dispatch", grant, request]);
      if (dispatchGate) await dispatchGate(grant, request, proposal, signal);
      const outcome = state.outcome === "lost" ? "succeeded" : state.outcome;
      const receipt = { requestId: request, kind: proposal.kind, state: outcome, reviewDigest, providerResult: outcome === "succeeded" ? { messageId: "sent-message", historyId: "2" } : null, rejectionCode: outcome === "rejected" ? "policy" : null };
      receipts.set(keyFor(grant, request), receipt);
      if (state.outcome === "lost") throw new TypeError("Failed to fetch");
      return receipt;
    }),
    gmailOperation: (grant, request, signal) => track(async () => {
      state.receiptReads++;
      events.push(["receipt", grant, request]);
      if (receiptGate) return receiptGate(grant, request, signal);
      if (state.failReceipt) throw new TypeError("Failed to fetch");
      return structuredClone(receipts.get(keyFor(grant, request)) ?? null);
    })
  };
  const controller = {
    getCloudClient: () => connected ? { client, sessionId: `session-${sessionIndex}`, credentialId: `credential-${sessionIndex}` } : null,
    getSnapshot: () => ({ session: null, cloudAccount: connected ? { environment: "production", userId: `user-${accountIndex}`, organizationId: "organization", sessionId: `session-${sessionIndex}` } : null }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rejectCloudSession: () => false,
    getWorkflowDeviceTarget: () => null,
    openCloudAccount: () => {
    },
    open: () => {
    }
  };
  const documentEvents = new EventTarget(), windowEvents = new EventTarget(), local = new Map();
  const document = { hidden: false, documentElement: { dataset: { connectionMode: "live" } }, addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) };
  const window = { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents), dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents), confirm: () => true };
  const sandbox = vm.createContext({
    ports: {
      store,
      controller,
      attachment: { cancel: async () => {
      }, readSelected: async () => {
        if (attachmentGate) await attachmentGate();
        return state.attachments.shift();
      } },
      daily: { perform: async () => ({ status: "selected", selectionId: "selection", name: "file" }), forgetSelected: async ({ selectionId }) => state.released.push(selectionId), addListener: async () => ({ remove: async () => {
      } }) }
    },
    crypto: { randomUUID: () => crypto.randomUUID(), subtle: { digest: (...args) => track(() => crypto.subtle.digest(...args)) } },
    window,
    document,
    localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    AbortController,
    DOMException,
    Event,
    CustomEvent,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance: { now: () => clock },
    console
  });
  vm.runInContext(artifact.code, sandbox);
  const modules = sandbox.inboxModules;
  if (!modules.reviewAttachment) throw Error("Missing actual attachment reviewer");
  async function settle() {
    let stable = 0, last = -1;
    const deadline = Date.now() + 1e4;
    while (stable < 3) {
      if (Date.now() > deadline) throw Error("Inbox fixture did not settle");
      await new Promise((ok) => setTimeout(ok, 0));
      if (pending.size === 0 && counter === last) stable++;
      else stable = 0;
      last = counter;
    }
  }
  fixture = {
    modules,
    observeTask: track,
    sources: artifact.sources,
    slots,
    receipts,
    state,
    events,
    toasts,
    client,
    controller,
    sandbox,
    async settle() {
      await settle();
    },
    advance() {
      clock += 1000;
    },
    capability(owner, patch) {
      if (patch === null) capabilities.delete(owner);
      else capabilities.set(owner, { ...capabilities.get(owner), ...patch });
    },
    gates(value) {
      ({ store: storeGate, storeResult: storeResultGate, capability: capabilityGate, prepare: prepareGate, dispatch: dispatchGate, receipt: receiptGate, attachment: attachmentGate } = value);
    },
    switchOwner(owner) {
      accountIndex = owner;
      sessionIndex++;
      for (const listener of listeners) listener();
    },
    disconnect() {
      connected = false;
      sessionIndex++;
      for (const listener of listeners) listener();
    },
    mount() {
      class Shell {
        constructor() {
          this.st = { q: null, compose: null };
        }
        renderVals() {
          return {};
        }
        componentDidMount() {
        }
        componentWillUnmount() {
        }
        vset(_view, patch) {
          Object.assign(this.st, patch);
        }
        S() {
          return this.st;
        }
        openView(_view, patch) {
          Object.assign(this.st, patch);
        }
      }
      const views = { inbox: { state: {} } };
      modules.installInboxCloudAdapter(Shell, views);
      const shell = new Shell();
      shell.componentDidMount();
      const api = { sw: () => ({ down() {
      }, up() {
      } }), swallowed: () => false, get: () => shell.st, isActive: () => true, set: (patch) => shell.vset("inbox", patch), toast: (message) => toasts.push(message) };
      const render = () => views.inbox.render(shell.st, api);
      return { shell, views, api, render, dispose: () => shell.componentWillUnmount() };
    },
    createPair() {
      const provider = modules.inboxProviderControls(() => {
      }, (text) => toasts.push(text));
      const drafts = modules.inboxDrafts(() => {
      }, (text) => toasts.push(text), provider);
      provider.setComposer(() => drafts.email());
      provider.setEditor((proposal, reference, review) => drafts.editProvider(proposal, reference, review));
      provider.setObservers({ sent: (source, proposal, grant) => void drafts.settleSent(source.draftId, proposal, grant, source.savedRevision), sentNote: (source) => drafts.sentNote(source.draftId) });
      return { provider, drafts, async bind(grant = "grant-1") {
        await Promise.all([provider.bind(grant), drafts.bind(grant, grant)]);
        await settle();
      }, dispose() {
        provider.reset();
        drafts.reset();
      } };
    }
  };
  return fixture;
}
