// spec/app/ask/index.md, "Story: Talk to my agent"
import type { TurnReply } from "@elizaos/agent";
import type { DraftAddress } from "../../src/assistant/draft-device.vibe";
import type { Faked } from "./phone.ts";
import type { Route } from "./routes.ts";

export interface AskScene {
  opened: number;
  readonly said: string[];
  down: boolean;
  stalled: boolean;
  readonly turns: Map<string, () => void>;
  /** While set, the agent holds each answer to an abort of a turn until the test lets it go, as an agent slow to stop a turn does. */
  holdAborts?: boolean;
  readonly heldAborts: (() => void)[];
  /** While set, the agent holds each conversation it is asked to make until the test lets it go. */
  holdCreates?: boolean;
  readonly heldCreates: (() => void)[];
  afterStop?: Kept["messages"];
  readonly kept: Map<string, Kept>;
  searchDown: boolean;
  /** The agent fails every read of a conversation's messages with a 503, as while it is starting. */
  pagesDown: boolean;
  /** The agent lists its conversations but answers every read of their messages 404, as a mismatched store or a proxy does. */
  pagesMissing: boolean;
  /** How many of the next reads of the messages around one message the agent fails with a 503, as a read that drops does. */
  aroundDown?: number;
  /** How many reads of a conversation's messages, and of the list of conversations, the agent was asked. */
  pageReads: number;
  listReads: number;
  /** While set, the agent holds each answer to a read of the list until the test lets it go. */
  holdLists: boolean;
  readonly heldLists: (() => void)[];
  /** While set, the agent holds each answer to a read of a conversation's messages, as it stood when asked, until the test lets it go. */
  holdPages?: boolean;
  readonly heldPages: (() => void)[];
  acknowledgment?: string;
  /** Text the agent streams before its acknowledgment, which it starts again after it, as eliza's planner does with a cue it displayed. */
  streamedBeforeAcknowledgment?: string;
  /** The next reply holds after its acknowledgment and tool frames, before any text, until the test runs its entry in `turns`. */
  holdAfterTools?: boolean;
  metadata?: unknown[];
  spokenFiles?: { readonly channel: unknown; readonly images: readonly unknown[] | undefined }[];
  /** The failure fields of the resident's terminal reply. */
  refusal?: Pick<TurnReply, "cloudCode" | "planAction"> & { readonly failureKind: NonNullable<TurnReply["failureKind"]> };
  nextReplyChunks?: readonly string[];
  /** The agent chooses not to reply: its turn ends with no text. */
  silent?: boolean;
  nextReplyProvisional?: boolean;
  /** After the next reply's chunks, the agent writes their whole text once without the provisional mark, as eliza writes the reply it decided before storing it. */
  nextReplySettled?: boolean;
  /** After the next reply's provisional chunks, the agent settles on this text instead and stores it, as eliza settles a reply whose failed step it marked untold. */
  nextReplySettledAs?: string;
  /** The next streamed reply is stored with this text and these untold steps, then drops before its terminal frame; the resend without streaming under the same key answers the stored reply's text alone, with no action results, as eliza's agent replays a reply it already stored (agent-host conversation turns, `HeldAnswered`). */
  nextDropsWith?: { readonly text: string; readonly untold: readonly string[] };
  /** The reply the agent stored for a dropped stream, which it replays to the resend under the dropped message's key. */
  resend?: { readonly text: string; readonly clientMessageId?: string };
  /** The actions the next reply says it ran, made from the turn's metadata and the device capabilities the turn declared, as eliza's agent lists them on its done frame. */
  nextActions?: (metadata: unknown, capabilities: readonly string[]) => readonly unknown[];
  /** When set, emits a `reply_ready` frame before `done` and awaits this promise before emitting `done`. */
  holdDoneAfterReady?: Promise<void>;
  /** The agent sends no status frame, as the resident host does not. */
  noStatus?: boolean;
  /** With `holdDoneAfterReady`, awaits this promise after the reply's text before emitting `reply_ready`. */
  holdReady?: Promise<void>;
  /** The next reply's tools ran while the stream was busy, so only the newest waiting tool frame is written, as eliza's reply stream writes progress. */
  nextNewestProgressOnly?: boolean;
  /** The agent is older than any direct-request mode: a turn that states one is refused whole, as eliza's agent refuses an invalid voice view context. */
  knowsNoActionMode?: boolean;
  /** The fake native store, which survives disposal of the WebView runtime. */
  readonly drafts: Map<string, string>;
  beforeDraftExchange?: () => Promise<void>;
  /** The native store answers every read of a draft slot as unreadable, as its SecureSlots does for a slot it cannot decrypt. */
  draftReadsFail?: boolean;
  /** Every message posted waits: "unheard" before the agent keeps it, as when Alpha stops before its request arrives; "unanswered" once the agent kept it, with no frame back. */
  holdPosts?: "unheard" | "unanswered";
  /** The text of each post held "unheard", which reached the agent's address but was never kept. */
  readonly unheard: string[];
  refusedDraftExchanges: number;
  /** When true, /api/status omits serverInstanceId so the peer does not declare optional turn-context fields. */
  noOptionalFields?: boolean;
  /** When true, /api/status fails with 503 (for testing transient support probe failures). */
  failStatus?: boolean;
  /** Optional hook awaited before answering /api/status (for simulating slow startup support probes). */
  beforeStatus?: () => Promise<void>;
  /** Whether the agent's status says it can answer, and each warm-up it was asked for, with the headers it came with. */
  canRespond: boolean;
  lastCloudFailure?: { readonly kind: string; readonly at: number };
  warmUps: Record<string, string>[];
  warmUpFails: boolean;
  statusReads: number;
}

export interface Kept {
  readonly roomId: string;
  readonly title: string;
  readonly messages: { id: string; role: "user" | "assistant"; text: string; failureKind?: string; abortCause?: string; cloudCode?: string; untold?: string[]; clientMessageId?: string }[];
}

export function askScene(): AskScene {
  return { opened: 0, said: [], down: false, stalled: false, turns: new Map(), heldAborts: [], heldCreates: [], kept: new Map(), searchDown: false, pagesDown: false, pagesMissing: false, pageReads: 0, listReads: 0, holdLists: false, heldLists: [], heldPages: [], drafts: new Map(), refusedDraftExchanges: 0, unheard: [], canRespond: true, warmUps: [], warmUpFails: false, statusReads: 0 };
}

/** A storage address within the fake phone's already verified local account. */
export function draftKey(owner: string, agent: string, conversation?: string, room?: string) {
  return JSON.stringify([owner, agent, conversation ?? null, room ?? null]);
}

/** The most UTF-8 bytes AlphaAssistantDraft takes for a slot row it compares or writes, as its `RAW_LIMIT`. */
const rawLimit = 256 * 1024;

/** The rows AlphaAssistantDraft writes, as `AlphaDraftRow.admits` checks a `next` before the plugin exchanges it: a whole revision of at least 1, a text, a sending flag, and only beside a sending mark a string `lastSentId` and `lastSentWire`. */
function admitsRow(next: string) {
  let row: unknown;
  try { row = JSON.parse(next); } catch { return false; }
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  const { revision, text, sending, ...mark } = row as Record<string, unknown>;
  return Number.isSafeInteger(revision) && (revision as number) >= 1 && typeof text === "string" && typeof sending === "boolean"
    && Object.entries(mark).every(([key, value]) => sending && (key === "lastSentId" || key === "lastSentWire") && typeof value === "string");
}

/** AlphaAssistantDraft derives the slot after admitting the supplied owner, agent and epoch as assertions. */
export function alphaAssistantDraft(scene: AskScene, authority: () => Pick<DraftAddress, "owner" | "agent" | "epoch">): Faked {
  function admitted(assertion: DraftAddress) {
    const current = authority();
    if (assertion.owner !== current.owner || assertion.agent !== current.agent || assertion.epoch !== current.epoch ||
      (assertion.conversation === undefined) !== (assertion.room === undefined)) return undefined;
    return draftKey(current.owner, current.agent, assertion.conversation, assertion.room);
  }
  return () => ({
    read(address: DraftAddress) {
      const key = admitted(address);
      if (key === undefined) return Promise.resolve({ status: "denied" });
      if (scene.draftReadsFail) return Promise.resolve({ status: "failure" });
      const raw = scene.drafts.get(key);
      return Promise.resolve(raw === undefined ? { status: "read" } : { status: "read", raw });
    },
    async exchange(address: DraftAddress & { expected?: string; next?: string }) {
      const key = admitted(address);
      if (key !== undefined) await scene.beforeDraftExchange?.();
      if (key === undefined || admitted(address) !== key) {
        scene.refusedDraftExchanges += 1;
        return { status: "denied" };
      }
      if ([address.expected, address.next].some((raw) => raw !== undefined && encoder.encode(raw).length > rawLimit)) return { status: "denied" };
      if (address.next !== undefined && !admitsRow(address.next)) return { status: "denied" };
      if (scene.drafts.get(key) !== address.expected) return { status: "conflict" };
      if (address.next === undefined) scene.drafts.delete(key);
      else scene.drafts.set(key, address.next);
      return { status: "landed" };
    },
  });
}

const encoder = new TextEncoder();
const frame = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
/** What ends a turn, as eliza's agent names its messages (`.eliza/packages/agent/src/client/reply-frame.schema.vibe`, `DoneFrame`). */
const named = (turn: number) => ({ messageId: `m${turn}a`, userMessageId: `m${turn}u`, agentName: "Alpha", actionResults: [] });
/** A failed step's action result that eliza marked untold, as its agent lists it on the reply (eliza agent-host conversation planning). */
export const untoldStep = (action: string) => ({ action, data: { actionName: action, untold: true } });
/** The actions of the steps a reply marks untold, which eliza stores on its history row as `untold`. */
const untoldOf = (actions: readonly unknown[]) => actions.flatMap((one) => {
  const { action, data } = one as { action?: unknown; data?: unknown };
  return typeof action === "string" && typeof data === "object" && data !== null && (data as { untold?: unknown }).untold === true ? [action] : [];
});

function reply(scene: AskScene, room: string, text: string, keep: (said: string, untold: readonly string[]) => void, metadata: unknown, capabilities: readonly string[]): Response {
  const custom = scene.nextReplyChunks;
  const settledAs = scene.nextReplySettledAs;
  const provisional = scene.nextReplyProvisional;
  const settles = scene.nextReplySettled === true;
  const actions = scene.nextActions?.(metadata, capabilities) ?? [];
  const holdDone = scene.holdDoneAfterReady;
  const holdReady = scene.holdReady;
  let cancelled = false;
  const newestOnly = scene.nextNewestProgressOnly === true;
  scene.nextNewestProgressOnly = undefined;
  scene.nextReplyChunks = undefined;
  scene.nextReplyProvisional = undefined;
  scene.nextReplySettled = undefined;
  scene.nextReplySettledAs = undefined;
  scene.nextActions = undefined;
  scene.holdDoneAfterReady = undefined;
  scene.holdReady = undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!scene.noStatus) controller.enqueue(frame({ type: "status", activity: "thinking" }));
      if (scene.refusal !== undefined) {
        controller.enqueue(frame({ type: "done", fullText: "", ...named(scene.said.length), ...scene.refusal }));
        controller.close();
        return;
      }
      const streamedCue = scene.acknowledgment === undefined ? undefined : scene.streamedBeforeAcknowledgment;
      if (streamedCue !== undefined) controller.enqueue(frame({ type: "token", text: streamedCue }));
      if (scene.acknowledgment !== undefined) controller.enqueue(frame({ type: "acknowledgment", text: scene.acknowledgment }));
      if (streamedCue !== undefined) controller.enqueue(frame({ type: "token", fullText: "" }));
      if (scene.acknowledgment !== undefined) controller.enqueue(frame({ type: "tool", name: "CALENDAR", label: "Using Calendar" }));
      if (scene.silent) {
        controller.enqueue(frame({ type: "done", fullText: "", ...named(scene.said.length) }));
        controller.close();
        return;
      }
      if (scene.stalled) {
        for (const piece of custom ?? ["Thinking"]) controller.enqueue(frame({ type: "token", text: piece, ...(provisional ? { provisional } : {}) }));
        if (settles) controller.enqueue(frame({ type: "token", fullText: (custom ?? ["Thinking"]).join("") }));
        scene.turns.set(room, () => controller.close());
        return;
      }
      const answer = () => {
        const ran = actions as readonly { readonly action?: unknown }[];
        for (const { action } of newestOnly ? ran.slice(-1) : ran) {
          if (typeof action === "string") controller.enqueue(frame({ type: "tool", name: action, label: "Working" }));
        }
        if (custom !== undefined && custom.length > 0) {
          for (const piece of custom) controller.enqueue(frame({ type: "token", text: piece, ...(provisional ? { provisional } : {}) }));
          const full = settledAs ?? custom.join("");
          if (settles || settledAs !== undefined) controller.enqueue(frame({ type: "token", fullText: full }));
          keep(full, untoldOf(actions));
          if (holdDone !== undefined) {
            const announce = () => {
              if (cancelled) return;
              controller.enqueue(frame({ type: "reply_ready", fullText: full, actionResults: actions }));
              void holdDone.then(() => {
                if (cancelled) return;
                controller.enqueue(frame({ type: "done", fullText: full, ...named(scene.said.length), actionResults: actions }));
                controller.close();
              });
            };
            if (holdReady === undefined) announce();
            else void holdReady.then(announce);
            return;
          }
          controller.enqueue(frame({ type: "done", fullText: full, ...named(scene.said.length), actionResults: actions }));
          controller.close();
          return;
        }
        controller.enqueue(frame({ type: "token", text: "You said: " }));
        controller.enqueue(frame({ type: "token", text }));
        keep(`You said: ${text}`, []);
        controller.enqueue(frame({ type: "done", fullText: `You said: ${text}`, ...named(scene.said.length) }));
        controller.close();
      };
      if (scene.holdAfterTools) {
        scene.holdAfterTools = false;
        controller.enqueue(frame({ type: "status", activity: "Working" }));
        scene.turns.set(room, () => {
          scene.turns.delete(room);
          answer();
        });
        return;
      }
      answer();
    },
    cancel: () => {
      cancelled = true;
      scene.turns.delete(room);
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

export function askRoutes(scene: AskScene): Route[] {
  return [
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/conversations") return;
      if (scene.down) return Response.json({ error: "starting" }, { status: 503 });
      const made = () => {
        const id = ++scene.opened;
        scene.kept.set(`c${id}`, { roomId: `r${id}`, title: "Ask Alpha", messages: [] });
        return Response.json({ conversation: { id: `c${id}`, roomId: `r${id}`, title: "Ask Alpha", createdAt: 0, updatedAt: 0 } }, { status: 201 });
      };
      return scene.holdCreates ? new Promise<void>((resolve) => { scene.heldCreates.push(resolve); }).then(made) : made();
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== "/api/conversations") return;
      scene.listReads += 1;
      const listing = Response.json({ conversations: [...scene.kept].map(([id, one]) => ({ id, roomId: one.roomId, title: one.title, createdAt: 0, updatedAt: 0 })) });
      return scene.holdLists ? new Promise<Response>((resolve) => void scene.heldLists.push(() => resolve(listing))) : listing;
    },
    (request, url) => {
      const id = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname)?.[1];
      if (request.method !== "GET" || id === undefined || id === "messages") return;
      scene.pageReads += 1;
      const answer = (): Response => {
        if (scene.pagesDown) return Response.json({ error: "starting" }, { status: 503 });
        if (scene.pagesMissing) return Response.json({ error: "unknown_conversation" }, { status: 404 });
        const one = scene.kept.get(id);
        if (one === undefined) return Response.json({ error: "unknown_conversation" }, { status: 404 });
        const messages = one.messages.map((message, at) => ({ ...message, timestamp: at + 1 }));
        const around = url.searchParams.get("around");
        if (around !== null && (scene.aroundDown ?? 0) > 0) {
          scene.aroundDown = (scene.aroundDown ?? 0) - 1;
          return Response.json({ error: "starting" }, { status: 503 });
        }
        if (around !== null) {
          const pivot = messages.findIndex((message) => message.id === around);
          return pivot < 0 ? Response.json({ error: "unknown_message" }, { status: 404 })
            : Response.json({ messages: messages.slice(Math.max(0, pivot - 100), pivot + 101) });
        }
        const before = url.searchParams.get("before");
        if (before === null) return Response.json({ messages: messages.slice(-200), hasMore: messages.length > 200 });
        const beforeId = url.searchParams.get("beforeId");
        const older = messages.filter(({ timestamp, id }) => timestamp < Number(before) || (timestamp === Number(before) && beforeId !== null && id < beforeId));
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
        return Response.json({ messages: older.slice(-limit), hasMore: older.length > limit });
      };
      const page = answer();
      return scene.holdPages ? new Promise<Response>((resolve) => void scene.heldPages.push(() => resolve(page))) : page;
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== "/api/conversations/messages/search") return;
      if (scene.searchDown) return Response.json({ error: "down" }, { status: 500 });
      const words = (url.searchParams.get("q") ?? "").toLowerCase();
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const hits = [...scene.kept].flatMap(([id, one]) => one.messages.filter((message) => message.text.toLowerCase().includes(words))
        .map((message) => ({ messageId: message.id, conversationId: id, roomId: one.roomId, role: message.role, text: message.text, createdAt: 0 })));
      const results = hits.slice(offset, offset + limit);
      return Response.json({ results, count: results.length });
    },
    (request, url) => {
      const id = /^\/api\/conversations\/([^/]+)\/fork$/.exec(url.pathname)?.[1];
      if (request.method !== "POST" || id === undefined) return;
      return request.json().then(({ messageId }: { messageId: string }) => {
        const source = scene.kept.get(id);
        const at = source?.messages.findIndex((message) => message.id === messageId) ?? -1;
        if (source === undefined || at < 0) return Response.json({ error: "unknown_message" }, { status: 404 });
        const fork = ++scene.opened;
        scene.kept.set(`c${fork}`, { roomId: `r${fork}`, title: `${source.title} (fork)`, messages: source.messages.slice(0, at + 1).map((message) => ({ ...message, id: `${message.id}f${fork}` })) });
        return Response.json({ conversation: { id: `c${fork}`, roomId: `r${fork}`, title: `${source.title} (fork)`, createdAt: 0, updatedAt: 0 } }, { status: 201 });
      });
    },
    (request, url) => {
      const found = /^\/api\/conversations\/([^/]+)\/messages(\/stream)?$/.exec(url.pathname);
      if (request.method !== "POST" || !found) return;
      if (scene.holdPosts === "unheard") return request.json().then((body: { text: string }) => { scene.unheard.push(body.text); return new Promise<Response>(() => undefined); });
      const conversationId = decodeURIComponent(found[1] ?? "");
      const kept = scene.kept.get(conversationId);
      if (kept === undefined) return Response.json({ error: "unknown_conversation" }, { status: 404 });
      const keep = (role: "user" | "assistant", text: string, untold: readonly string[] = []) =>
        void kept.messages.push({ id: `m${scene.said.length}${role === "user" ? "u" : "a"}`, role, text, ...(untold.length === 0 ? {} : { untold: [...untold] }) });
      return request.json().then((body: { text: string; metadata?: unknown; channelType?: unknown; images?: readonly unknown[]; clientMessageId?: string }) => {
        scene.metadata?.push(body.metadata);
        scene.spokenFiles?.push({ channel: body.channelType, images: body.images });
        if (body.text !== body.text.trim()) return Response.json({ error: "invalid_message" }, { status: 400 });
        if (scene.knowsNoActionMode === true && JSON.stringify(body.metadata ?? {}).includes('"agentActionMode"')) return Response.json({ error: "VOICE_UI_CONTEXT_INVALID" }, { status: 400 });
        const resent = found[2] === undefined && body.clientMessageId !== undefined && scene.resend?.clientMessageId === body.clientMessageId
          ? scene.resend : undefined;
        if (resent !== undefined) {
          scene.resend = undefined;
          return Response.json({ ...named(scene.said.length), fullText: resent.text, text: resent.text });
        }
        scene.said.push(body.text);
        keep("user", body.text);
        Object.assign(kept.messages.at(-1) ?? {}, { clientMessageId: body.clientMessageId });
        if (scene.holdPosts === "unanswered") return new Promise<Response>(() => undefined);
        if (found[2] !== undefined && scene.nextDropsWith !== undefined) {
          const dropped = scene.nextDropsWith;
          scene.nextDropsWith = undefined;
          keep("assistant", dropped.text, dropped.untold);
          scene.resend = { text: dropped.text, clientMessageId: body.clientMessageId };
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(frame({ type: "status", activity: "thinking" }));
            controller.close();
          } }), { headers: { "content-type": "text/event-stream" } });
        }
        if (found[2] === undefined) {
          const text = `You said: ${body.text}`;
          keep("assistant", text);
          return Response.json({ text, ...named(scene.said.length) });
        }
        if (scene.refusal !== undefined) kept.messages.push({ id: `m${scene.said.length}a`, role: "assistant", text: "", failureKind: scene.refusal.failureKind, ...(scene.refusal.cloudCode === undefined ? {} : { cloudCode: scene.refusal.cloudCode }) });
        const capabilities = request.headers.get("x-eliza-device-capabilities")?.split(",").filter((name) => name !== "") ?? [];
        return reply(scene, kept.roomId, body.text, (said, untold) => keep("assistant", said, untold), body.metadata, capabilities);
      });
    },
    (request, url) => {
      const room = /^\/api\/turns\/([^/]+)\/abort$/.exec(url.pathname)?.[1];
      if (request.method !== "POST" || room === undefined) return;
      const held = scene.holdAborts ? new Promise<void>((resolve) => { scene.heldAborts.push(resolve); }) : Promise.resolve();
      return Promise.all([request.json(), held]).then(([{ reason }]: [{ reason: string }, void]) => {
        const stop = scene.turns.get(room);
        scene.turns.delete(room);
        stop?.();
        const after = scene.afterStop;
        scene.afterStop = undefined;
        if (after !== undefined) [...scene.kept.values()].find((one) => one.roomId === room)?.messages.push(...after);
        return Response.json({ aborted: stop !== undefined, roomId: room, reason, outcome: stop === undefined ? "nothingRunning" : "stopped" });
      });
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== "/api/status") return;
      scene.statusReads += 1;
      const answer = () => scene.failStatus
        ? Response.json({ error: "status_unavailable" }, { status: 503 })
        : Response.json({
          ...(scene.noOptionalFields ? {} : { serverInstanceId: "alpha-fake" }),
          canRespond: scene.canRespond,
          ...(scene.lastCloudFailure === undefined ? {} : { lastCloudFailure: scene.lastCloudFailure }),
        });
      return scene.beforeStatus ? scene.beforeStatus().then(answer) : answer();
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/turns/warm") return;
      scene.warmUps.push(Object.fromEntries([...request.headers].filter(([name]) => name.startsWith("x-eliza-"))));
      return scene.warmUpFails ? Response.json({ error: "warm_up_failed" }, { status: 500 }) : Response.json({ started: true }, { status: 202 });
    },
    (request, url) => (request.method === "GET" && url.pathname === "/api/agents" ? Response.json({ agents: [{ id: "agent-owner", name: "Alpha", status: "running" }] }) : undefined),
  ];
}
