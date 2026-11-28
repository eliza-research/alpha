// spec/app/inbox/index.md, "Story: See my mail"
import type { createCloudClient, GoogleStatus, MailCard, MailMessage, MailOperation, MailSearch } from "@elizaos/cloud";
import type { MailBackgroundSelection, MailBackgroundStatus, MailNoticeTap, OpaqueMailAttachment } from "@elizaos/plugin-inbox-client";
import { type Faked, rejection } from "./phone.ts";
import type { Route } from "./routes.ts";

/** A message of the fake mailbox: eliza's card of it, and what reading it whole gives. */
export interface Stored {
  card: MailCard;
  body: string;
  threadBody?: string;
  html: string | null;
  files: MailMessage["attachments"];
  attachmentData?: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
}

type DraftFixture = {
  readonly id: string;
  readonly messageId: string;
  readonly providerDigest: string;
  readonly content: {
    readonly to: readonly string[];
    readonly cc: readonly string[];
    readonly bcc: readonly string[];
    readonly subject: string;
    readonly bodyText: string;
    readonly plainText: boolean;
    readonly threaded: boolean;
    readonly attachmentCount: number;
  };
};

type Proposal = Parameters<ReturnType<typeof createCloudClient>["gmailPrepare"]>[0]["proposal"];
type Delivery = Extract<Proposal, { mode: string }>;

/** What the fake cloud holds of the owner's Gmail, and how it behaves; a journey changes it between steps. */
export interface InboxScene {
  /** The owner's Google connection, by its address, with what Google consented to; none where it is undefined. */
  google: { email: string; connection: string; capabilities: GoogleStatus["grantedCapabilities"] } | undefined;
  readonly mail: Stored[];
  readonly drafts: Map<string, DraftFixture>;
  /** Gmail's history: it moves with every change to the mailbox. */
  history: number;
  /** Every request is lost on the way, as when the phone is offline. */
  offline: boolean;
  /** Google refuses every Gmail request: the owner withdrew access. */
  revoked: boolean;
  /** A reply the journey holds at the Gmail search boundary. */
  pageReply?: Promise<void>;
  /** A reply the journey holds at the Gmail thread boundary. */
  threadReply?: Promise<void>;
  threadPageSize?: number;
  readonly threadReads: { offset: number; history: string | null }[];
  /** Every change asked of Gmail, as `<kind> <message>`, once it was dispatched. */
  readonly changes: string[];
  readonly pageReads: { query: string; cursor: string | null }[];
  readonly bodyReads: string[];
  /** The name of every file a dispatched send carried. */
  readonly attached: string[];
  readonly attachmentReads: string[];
  readonly savedAttachments: Map<string, string>;
  /** How many more times the owner backs out of the save picker, which then writes nothing. */
  pickerCancels?: number;
  loseSendReply?: boolean | "rejected";
  loseDraftReply?: boolean;
  rejectDraftReply?: boolean;
  /** Google's answer about the owner's access never comes, as on a network that hangs. */
  stalled?: boolean;
  /** How Gmail stands on a request the earlier Alpha sent, by its request id; one not here is unknown to the cloud. */
  readonly receipts: Map<string, MailOperation["receipt"]["state"]>;
  readonly receiptReads: string[];
  notices?: InboxNoticeScene;
  consent?: { authUrl: string; reauthRequired?: boolean; readonly requests: string[][]; readonly opened: string[] };
}

export interface InboxNoticeScene {
  selection?: MailBackgroundSelection;
  pending?: MailNoticeTap;
  enter?: (tap: MailNoticeTap) => void;
  readonly spent: string[];
  readonly released: string[];
}

/** What the native Gmail worker gives Capacitor after it has checked the tapped notice. */
export const alphaInboxNotices = (scene: InboxNoticeScene): Faked => (emit) => {
  const status = (): MailBackgroundStatus => scene.selection
    ? { status: "watching-new-mail", notificationsAllowed: true, grantId: scene.selection.grantId, lastSyncAt: 1 }
    : { status: "disabled", notificationsAllowed: true };
  scene.enter = (tap) => {
    scene.pending = tap;
    emit("changed", {});
  };
  return {
    configure: (selection: MailBackgroundSelection) => { scene.selection = selection; emit("changed", {}); return Promise.resolve(status()); },
    withdraw: ({ grantId }: { grantId?: string }) => {
      if (grantId === undefined || scene.selection?.grantId === grantId) {
        scene.selection = undefined;
        scene.pending = undefined;
        emit("changed", {});
      }
      return Promise.resolve();
    },
    status: () => Promise.resolve(status()),
    pending: () => Promise.resolve(scene.pending ?? {}),
    consume: ({ token }: { token: string }) => {
      if (scene.pending?.token !== token) return Promise.reject(rejection("Gmail tap changed"));
      scene.spent.push(token);
      scene.pending = undefined;
      return Promise.resolve();
    },
    releaseQuestion: ({ token }: { token: string }) => {
      if (scene.pending?.question && scene.pending.token === token) {
        scene.released.push(token);
        scene.pending = undefined;
      }
      return Promise.resolve();
    },
    notificationSettings: () => Promise.resolve(undefined),
  };
};

/** Android's save picker in the fake phone, with its selected documents kept as exact copies. */
export const alphaInboxAttachments = (scene: InboxScene) => () => ({
  saveReviewed: ({ name, dataBase64 }: OpaqueMailAttachment) => {
    if (scene.pickerCancels) {
      scene.pickerCancels--;
      return Promise.resolve({ status: "cancelled" });
    }
    scene.savedAttachments.set(name, atob(dataBase64));
    return Promise.resolve({ status: "saved" });
  },
  cancelReviewed: () => Promise.resolve(undefined),
});

const everything: GoogleStatus["grantedCapabilities"] = ["google.basic_identity", "google.gmail.triage", "google.gmail.send", "google.gmail.manage"];

/** A message as Gmail lists it: `labels` say where it is; `from` the sender and `at` when it arrived. */
export function letter(id: number, subject: string, labels: string[], body = `About ${subject}`, from = `Sender ${id} <s${id}@mail.test>`, at = Date.UTC(2026, 10, 1, 0, id)): Stored {
  return {
    card: {
      id: `g${id}`, threadId: `t${id}`, subject, from, to: ["you@gmail.example"], cc: [], snippet: body.replace(/\s+/gu, " ").slice(0, 90),
      receivedAt: new Date(at).toISOString(), labels, isUnread: labels.includes("UNREAD"), isImportant: false,
      likelyReplyNeeded: false, triageScore: 0, triageReason: "", metadata: { historyId: String(100 + id) },
    },
    body, html: null, files: [],
  };
}

/** `hour`:`minute` on the day the scene is made, or `days` before it, on the phone's clock: develop's fixture mail arrived today. */
function today(hour: number, minute: number, days = 0): number {
  const at = new Date();
  at.setDate(at.getDate() - days);
  at.setHours(hour, minute, 0, 0);
  return at.getTime();
}

/** A file a message carries, as Gmail reads it. */
const file = (partId: string, name: string, size: number): Stored["files"][number] => ({ partId, name, mimeType: "application/pdf", size, supported: true });
const withFiles = (message: Stored, files: Stored["files"]): Stored => ({ ...message, card: { ...message.card, hasAttachments: true }, files });

/** Develop's fixture mailbox: seven messages in Inbox, newest unread first, one in Spam and one sent. */
export function inboxScene(): InboxScene {
  return {
    google: { email: "you@gmail.example", connection: "grant-1", capabilities: everything },
    mail: [
      withFiles(letter(1, "Revised term sheet", ["INBOX", "UNREAD"], "Hi,\n\nAttached is the revised term sheet. We moved on the pro-rata and tightened the board language as discussed.\n\nNeed your eyes by Friday so we can get it to counsel. Happy to walk through it on our 4:30.\n\nJordan", "Jordan Park <jordan@northpoint.example>", today(13, 12)), [file("1", "Term sheet v3.pdf", 212_000)]),
      withFiles(letter(2, "Notes for the 3:00 review", ["INBOX", "UNREAD"], "Notes for this afternoon attached. Pages 6 to 9 are the new onboarding flow, that's where I'd love your call.\n\nMaya", "Maya Chen <maya@lumen.example>", today(12, 48)), [file("1", "Design review notes.pdf", 1_100_000)]),
      letter(3, "Dinner Friday?", ["INBOX", "UNREAD"], "We're doing tacos at ours on Friday around 7. Bring nothing but yourself. Sam's coming too.\n\nL", "Lena Ruiz <lena@ruiz.example>", today(9, 30)),
      letter(4, "Standup notes", ["INBOX"], "Quick notes from standup:\n\n- Build 0.9 goes to beta testers Thursday\n- Redaction eval is green on all devices\n- Maya owns the onboarding copy\n\nSam", "Sam Okafor <sam@okafor.example>", today(9, 48)),
      letter(5, "Reservation confirmed · Oct 2", ["INBOX"], "Your reservation for 8 × H200 on October 2, 09:00 to 21:00 PT is confirmed.\n\nReference GR-20417.", "GPU Reserve <no-reply@gpureserve.example>", today(9, 5)),
      letter(6, "Table for 2 at 1:00", ["INBOX"], "See you today at 1:00 PM. Table for 2 under your name, Guerrero St.\n\nReply to this email to change your booking.", "Tartine <hello@tartine.example>", today(8, 12)),
      letter(7, "Your trip to Portland", ["INBOX"], "SFO to PDX, Saturday Oct 4, 8:40 AM. Seat 7A.\n\nCheck-in opens 24 hours before departure.", "Alaska Airlines <trips@alaskaair.example>", today(18, 30, 1)),
      letter(8, "Win a prize", ["SPAM"], "About Win a prize", "Prize Desk <win@prize.example>", today(7, 0, 2)),
      letter(9, "Notes from me", ["SENT"], "About Notes from me", "You <you@gmail.example>", today(17, 0, 2)),
    ],
    history: 500, offline: false, revoked: false, changes: [], pageReads: [], bodyReads: [], threadReads: [], attached: [], attachmentReads: [], savedAttachments: new Map(), drafts: new Map(), receipts: new Map(), receiptReads: [],
  };
}

const labelOf: Record<string, string> = { inbox: "INBOX", sent: "SENT", spam: "SPAM", trash: "TRASH", drafts: "DRAFT", starred: "STARRED" };

/** Whether `stored` is found by Gmail's search `query`, in the few words Alpha asks it in. */
function matches(stored: Stored, query: string): boolean {
  return query.split(/\s+/u).filter(Boolean).every((word) => {
    const negated = word.startsWith("-");
    const term = negated ? word.slice(1) : word;
    const [, place] = /^(?:in|is):(\w+)$/u.exec(term) ?? [];
    const found = place === "all" ? !stored.card.labels.some((label) => label === "SPAM" || label === "TRASH")
      : place !== undefined ? stored.card.labels.includes(labelOf[place] ?? place.toUpperCase())
      : `${stored.card.subject} ${stored.body} ${stored.card.from}`.toLowerCase().includes(term.toLowerCase());
    return negated ? !found : found;
  });
}

const refused = (status: number, error: string) => Response.json({ error }, { status });
const google = "/api/v1/eliza/google";
const operations = `${google}/gmail/inbox-v1/operations`;
const sha = (bytes: Uint8Array<ArrayBuffer>) => crypto.subtle.digest("SHA-256", bytes)
  .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));

function status(scene: InboxScene): GoogleStatus {
  const linked = scene.google;
  return {
    provider: "google", side: "owner", mode: "managed", configured: true, connected: linked !== undefined, reason: linked === undefined ? "disconnected" : "connected",
    identity: linked === undefined ? null : { email: linked.email }, grantedCapabilities: linked?.capabilities ?? [], grantedScopes: [], expiresAt: null,
    hasRefreshToken: linked !== undefined, connectionId: linked?.connection ?? null, linkedAt: null, lastUsedAt: null,
  };
}

function operation(requestId: string, kind: MailOperation["receipt"]["kind"], state: MailOperation["receipt"]["state"]): MailOperation {
  return {
    version: 1, providerExactlyOnce: false,
    receipt: { requestId, kind, reviewDigest: "a".repeat(64), state, providerResult: state === "succeeded" ? {} : null, rejectionCode: null, createdAt: "2026-11-01T00:00:00Z", dispatchedAt: null, finishedAt: null },
  };
}

/** What a dispatched label change does to the mailbox. */
function relabel(stored: Stored, kind: string) {
  const without = (label: string) => stored.card.labels.filter((one) => one !== label);
  const labels = kind === "mark-read" ? without("UNREAD") : kind === "mark-unread" ? [...without("UNREAD"), "UNREAD"]
    : kind === "star" ? [...without("STARRED"), "STARRED"] : kind === "unstar" ? without("STARRED")
    : kind === "archive" ? without("INBOX") : kind === "trash" ? [...without("INBOX"), "TRASH"]
    : kind === "unarchive" ? [...without("INBOX"), "INBOX"] : kind === "untrash" ? [...without("TRASH").filter((one) => one !== "INBOX"), "INBOX"] : stored.card.labels;
  stored.card = { ...stored.card, labels, isUnread: labels.includes("UNREAD") };
}

export function inboxRoutes(scene: InboxScene): Route[] {
  const asked = new Map<string, Proposal>();
  const receipts = new Map<string, MailOperation>();
  const forwarded = (source: Delivery["forwardAttachments"]) => {
    if (source === undefined) return [];
    const original = scene.mail.find(({ card }) => card.id === source.messageId && card.metadata.historyId === source.historyId);
    return source.partIds.flatMap((id) => {
      const file = original?.files.find((part) => part.partId === id);
      const bytes = original?.attachmentData?.[id];
      return file && bytes ? [{ file, bytes }] : [];
    });
  };
  const lost = () => Promise.reject(new TypeError("offline"));
  let revokedSeen = false;
  return [
    (request, url) => {
      const consent = scene.consent;
      if (request.method !== "POST" || url.pathname !== `${google}/connect/initiate` || consent === undefined) return;
      if (request.headers.get("authorization") !== "Bearer signed-session") return refused(403, "session_required");
      return request.json().then(({ capabilities }: { capabilities: string[] }) => {
        consent.requests.push(capabilities);
        return Response.json({ authUrl: consent.authUrl });
      });
    },
    (request, url) => {
      if (!url.pathname.startsWith(`${google}/`)) return;
      if (scene.offline) return lost();
      if (!scene.revoked) revokedSeen = false;
      if (scene.revoked && (![`${google}/status`, `${google}/accounts`].includes(url.pathname) || revokedSeen)) {
        revokedSeen = true;
        return refused(403, "google_reauth_required");
      }
      return undefined;
    },
    (request, url) => (scene.stalled && [`${google}/status`, `${google}/accounts`].includes(url.pathname) ? new Promise<Response>(() => undefined) : undefined),
    (request, url) => (request.method === "GET" && url.pathname === `${google}/status` ? Response.json(status(scene)) : undefined),
    (request, url) => (request.method === "GET" && url.pathname === `${google}/accounts` ? Response.json(scene.google === undefined ? [] : [status(scene)]) : undefined),
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${google}/gmail/search`) return;
      const size = Number(url.searchParams.get("maxResults") ?? "25");
      const cursor = url.searchParams.get("pageToken");
      const query = url.searchParams.get("query") ?? "";
      scene.pageReads.push({ query, cursor });
      const from = Number((cursor ?? "p0").slice(1));
      const found = scene.mail.filter((stored) => matches(stored, query));
      const page: MailSearch = {
        messages: found.slice(from, from + size).map((stored) => ({ ...stored.card, hasAttachments: stored.files.length > 0 })), nextPageToken: from + size < found.length ? `p${from + size}` : null,
        syncedAt: "2026-11-01T00:00:00Z", mailboxHistoryId: String(scene.history), supportsSpamTrash: true,
      };
      const answer = Response.json(page);
      return scene.pageReply?.then(() => answer) ?? answer;
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${google}/gmail/read`) return;
      const stored = scene.mail.find((one) => one.card.id === url.searchParams.get("messageId"));
      if (!stored) return refused(404, "not_found");
      scene.bodyReads.push(stored.card.id);
      const read: MailMessage = { message: stored.card, bodyText: stored.body, bodyHtml: stored.html, bodyHtmlStatus: stored.html === null ? "none" : "available", attachments: stored.files };
      return Response.json(read);
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${google}/gmail/inbox-v1/thread`) return;
      const threadId = url.searchParams.get("threadId");
      const historyId = String(scene.history);
      const expected = url.searchParams.get("historyId");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      scene.threadReads.push({ offset, history: expected });
      const thread = scene.mail.filter(({ card }) => card.threadId === threadId)
        .toSorted((left, right) => left.card.receivedAt.localeCompare(right.card.receivedAt));
      if (!thread.length) return refused(404, "not_found");
      if (expected !== null && expected !== historyId) return refused(409, "stale_revision");
      const messages = thread.slice(offset, offset + (scene.threadPageSize ?? 25)).map((stored) => ({
        message: stored.card, bodyText: stored.threadBody ?? stored.body, bodyHtml: stored.html,
        bodyHtmlStatus: stored.html === null ? "none" : "available", attachments: stored.files,
        historyId: stored.card.metadata.historyId,
      }));
      const next = offset + messages.length;
      const answer = Response.json({ version: 1, threadId, historyId, total: thread.length, offset, nextOffset: next < thread.length ? next : null, messages });
      return scene.threadReply?.then(() => answer) ?? answer;
    },
    (request, url) => {
      if (request.method !== "GET") return;
      if (url.pathname === `${google}/gmail/inbox-v1/drafts`) {
        const drafts = [...scene.drafts.values()].map(({ id, messageId, content }) => ({
          draftId: id, messageId, subject: content.subject, to: content.to, snippet: content.bodyText, updatedAt: null,
        }));
        return Response.json({ version: 1, drafts, nextPageToken: null });
      }
      if (url.pathname !== `${google}/gmail/inbox-v1/draft`) return;
      const draft = scene.drafts.get(url.searchParams.get("draftId") ?? "");
      return draft ? Response.json({ ...draft, version: 1 }) : refused(404, "not_found");
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${google}/gmail/inbox-v1/attachment`) return;
      const { grantId, messageId, partId, historyId } = Object.fromEntries(url.searchParams);
      if (grantId !== scene.google?.connection) return refused(403, "google_reauth_required");
      const stored = scene.mail.find(({ card }) => card.id === messageId);
      const file = stored?.files.find((part) => part.partId === partId);
      const bytes = partId === undefined ? undefined : stored?.attachmentData?.[partId];
      if (!file || bytes === undefined) return refused(404, "not_found");
      if (historyId === undefined || stored?.card.metadata.historyId !== historyId) return refused(409, "stale_revision");
      scene.attachmentReads.push(`${messageId}/${partId}`);
      const dataBase64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
      return sha(bytes).then((sha256) => Response.json({ version: 1, messageId, historyId, ...file, dataBase64, sha256 }));
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== operations) return;
      return request.json().then(async ({ requestId, proposal }: { requestId: string; proposal: Proposal }) => {
        const prepared = operation(requestId, proposal.kind, "prepared");
        if ("mode" in proposal && proposal.forwardAttachments) {
          const parts = forwarded(proposal.forwardAttachments);
          if (parts.length !== proposal.forwardAttachments.partIds.length) return refused(409, "stale_revision");
          const forwardedAttachments = await Promise.all(parts.map(async ({ file, bytes }) => ({
            partId: file.partId, name: file.name, mimeType: file.mimeType, size: bytes.byteLength, sha256: await sha(bytes),
          })));
          asked.set(requestId, proposal);
          return Response.json({ ...prepared, review: { from: scene.google?.email ?? "", to: proposal.to ?? [], cc: proposal.cc ?? [], bcc: proposal.bcc ?? [], subject: proposal.subject, bodyText: proposal.bodyText, attachments: [], forwardedAttachments } });
        }
        asked.set(requestId, proposal);
        return Response.json(prepared);
      });
    },
    (request, url) => {
      const requestId = new RegExp(`^${operations}/([^/]+)/dispatch$`, "u").exec(url.pathname)?.[1];
      if (request.method !== "POST" || requestId === undefined || asked.get(requestId)?.kind !== "send") return;
      return request.json().then(({ proposal }: { proposal: Delivery }) => {
        const parts = forwarded(proposal.forwardAttachments);
        if (proposal.forwardAttachments && parts.length !== proposal.forwardAttachments.partIds.length) return refused(409, "stale_revision");
        if (scene.loseSendReply === "rejected") {
          receipts.set(requestId, operation(requestId, "send", "rejected"));
          scene.loseSendReply = false;
          return Response.json(operation(requestId, "send", "outcome-unknown"));
        }
        const to = proposal.to ?? [];
        scene.changes.push(`send ${to.join(",")} ${proposal.subject}`);
        scene.attached.push(...(proposal.attachments ?? []).map((file) => file.name), ...parts.map(({ file }) => file.name));
        const sent = letter(scene.mail.length + 100, proposal.subject, ["SENT"], proposal.bodyText);
        scene.mail.push({ ...sent, card: { ...sent.card, to } });
        const confirmed = operation(requestId, "send", "succeeded");
        receipts.set(requestId, confirmed);
        if (!scene.loseSendReply) return Response.json(confirmed);
        scene.loseSendReply = false;
        return Response.json(operation(requestId, "send", "outcome-unknown"));
      });
    },
    (request, url) => {
      const requestId = new RegExp(`^${operations}/([^/]+)$`, "u").exec(url.pathname)?.[1];
      if (request.method !== "GET" || requestId === undefined) return;
      scene.receiptReads.push(requestId);
      const preset = scene.receipts.get(requestId);
      const found = url.searchParams.get("grantId") === scene.google?.connection
        ? receipts.get(requestId) ?? (preset === undefined ? undefined : operation(requestId, "send", preset))
        : undefined;
      return found ? Response.json(found) : refused(404, "not_found");
    },
    (request, url) => {
      const requestId = new RegExp(`^${operations}/([^/]+)/dispatch$`, "u").exec(url.pathname)?.[1];
      const kind = requestId === undefined ? undefined : asked.get(requestId)?.kind;
      if (request.method !== "POST" || requestId === undefined || (kind !== "draft-create" && kind !== "draft-replace" && kind !== "draft-delete")) return;
      return request.json().then(({ proposal }: { proposal: { to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; bodyText?: string; mode?: string; draftId?: string; attachments?: unknown[] } }) => {
        if (scene.rejectDraftReply) {
          scene.rejectDraftReply = false;
          receipts.set(requestId, operation(requestId, kind, "rejected"));
          return Response.json(operation(requestId, kind, "outcome-unknown"));
        }
        scene.changes.push(`${kind} ${proposal.subject ?? proposal.draftId ?? ""}`);
        const draftId = proposal.draftId ?? `d${scene.changes.length}`;
        const answer = (providerResult: Record<string, unknown>) => {
          const done = operation(requestId, kind, "succeeded");
          const confirmed = { ...done, receipt: { ...done.receipt, providerResult } };
          receipts.set(requestId, confirmed);
          if (!scene.loseDraftReply) return Response.json(confirmed);
          scene.loseDraftReply = false;
          return Response.json(operation(requestId, kind, "outcome-unknown"));
        };
        if (kind === "draft-delete") {
          scene.drafts.delete(draftId);
          return answer({ draftId, deleted: true });
        }
        const messageId = `m${draftId}`;
        const providerDigest = (kind === "draft-create" ? "b" : "c").repeat(64);
        scene.drafts.set(draftId, {
          id: draftId, messageId, providerDigest,
          content: { to: proposal.to ?? [], cc: proposal.cc ?? [], bcc: proposal.bcc ?? [], subject: proposal.subject ?? "", bodyText: proposal.bodyText ?? "", plainText: true, threaded: proposal.mode !== "compose", attachmentCount: proposal.attachments?.length ?? 0 },
        });
        return answer({ draftId, messageId, providerDigest });
      });
    },
    (request, url) => {
      const requestId = new RegExp(`^${operations}/([^/]+)/dispatch$`, "u").exec(url.pathname)?.[1];
      if (request.method !== "POST" || requestId === undefined) return;
      const proposal = asked.get(requestId);
      if (!proposal || !("messageId" in proposal)) return refused(404, "not_found");
      const stored = scene.mail.find((one) => one.card.id === proposal.messageId);
      if (!stored) return refused(404, "not_found");
      relabel(stored, proposal.kind);
      scene.history += 1;
      scene.changes.push(`${proposal.kind} ${proposal.messageId}`);
      return Response.json(operation(requestId, proposal.kind, "succeeded"));
    },
  ];
}
