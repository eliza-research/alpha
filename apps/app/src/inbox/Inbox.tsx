// spec/app/inbox/index.md, "Story: See my mail"; spec/app/inbox/index.md, "Only a card with a positive attachment hint shows a paperclip"; spec/app/inbox/message.md, "Story: Read a message"; spec/app/inbox/marking.md, "Story: Mark mail read or unread"; spec/app/inbox/sending.md, "Story: Archive or trash mail, with Undo"
import {
  Alert, Button, Dialog, DialogContent, DialogDescription, DialogTitle, InboxAccountList, type InboxAttachmentPreview, InboxAttachmentReview, InboxChangeReview, InboxChangeToast, InboxDiscardDialog, type InboxFolder,
  InboxLinkReview, type InboxListRow, InboxListScreen, type InboxListStateKind, InboxMessageScreen, type InboxMessageFaultKind, InboxNotice,
  type InboxNoticeKind, InboxSendOutcome, Input, Spinner, ToastRegion,
} from "@repo/ui";
import type { MailCard } from "@elizaos/cloud";
import { Effect, type ManagedRuntime } from "effect";
import { type ReactNode, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Folder, type Mailbox, accessOf, readable, searchOpen, searchableIn, showsAttachment } from "../../gen/app__inbox.ts";
import type { Machine as List } from "../../gen/app__inbox.effect.vibe";
import { useMachine as useList } from "../../gen/app__inbox.react.ts";
import type { Machine as Marks } from "../../gen/app__inbox__marking.effect.vibe";
import { useMachine as useMarks } from "../../gen/app__inbox__marking.react.ts";
import type { Fault } from "../../gen/app__inbox__message.ts";
import type { Machine as Shown } from "../../gen/app__inbox__message.effect.vibe";
import { imagesLoad } from "../../gen/app__inbox__message.ts";
import { useMachine as useMessage } from "../../gen/app__inbox__message.react.ts";
import type { Machine as Changes } from "../../gen/app__inbox__sending.effect.vibe";
import { type Kind, type Operations, aside, checksSelection } from "../../gen/app__inbox__sending.ts";
import { useMachine as useChanges } from "../../gen/app__inbox__sending.react.ts";
import type { Machine as Writing } from "../../gen/app__inbox__drafts.effect.vibe";
import { useMachine as useDrafts } from "../../gen/app__inbox__drafts.react.ts";
import { deletableShelfDraft, type ShelfPick } from "../../gen/app__inbox__drafts.ts";
import { held } from "../../gen/app__inbox__shelf.ts";
import type { Machine as Shell } from "../../gen/app__shell.effect.vibe";
import { drawsAppBack } from "../../gen/app__shell.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import type { Machine as Canvas } from "../../gen/app__shell__keyboard.effect.vibe";
import { useMachine as useCanvas } from "../../gen/app__shell__keyboard.react.ts";
import type { Machine as Preferences } from "../../gen/app__settings__preferences.effect.vibe";
import { useMachine as usePreferences } from "../../gen/app__settings__preferences.react.ts";
import { loadsImages } from "../../gen/app__settings__preferences.ts";
import type { Alpha } from "../runtime/ui.tsx";
import { openInboxAccount } from "../account/profile.vibe";
import { useTimed } from "../runtime/ui.tsx";
import type { Cloud } from "../platform/index.vibe";
import { untimed } from "../runtime/index.vibe";
import { Time } from "../runtime/index.vibe";
import { Compose, FileOffer, Suggested } from "./Compose.tsx";
import type { Offers } from "./suggestion.vibe";
import type { Machine as Offering } from "../../gen/app__inbox__suggestion.effect.vibe";
import type { ContactAddresses, Incoming } from "./adding.vibe";
import type { Machine as Adding } from "../../gen/app__inbox__adding.effect.vibe";
import { type Beginning, Letters, begin, openGmailDraft } from "./composer.vibe";
import { type Letter, Mail, revisionOf } from "./gmail.vibe";
import { gmailAuthorizationWindow } from "./authorization.vibe";
import { MailSignIn } from "./mailbox.vibe";
import { connectMailFrame, frameDocument, prepareMessage } from "./mail-html.ts";
import { AttachmentPreviews, canPreviewAttachment, canSaveAttachment } from "./attachment.vibe";
import { InboxAttachmentFiles } from "../platform/index.vibe";
import type { Telephony } from "../platform/index.vibe";
import { ThreadPages } from "./thread.vibe";

export interface InboxProps {
  /** Provides the list, the message open and its marks, the changes, the shell, Mail, which holds what Gmail said, and the phone's sign-in for mail. */
  runtime: ManagedRuntime.ManagedRuntime<List | Shown | Marks | Changes | Writing | Adding | Incoming | ContactAddresses | Offering | Offers | Letters | Shell | Canvas | Mail | Time | Preferences | Cloud | AttachmentPreviews | InboxAttachmentFiles | MailSignIn | Telephony | ThreadPages, unknown>;
}

type Runtime = InboxProps["runtime"];

const folderNames = {
  Incoming: "incoming", Starred: "starred", Sent: "sent", DraftsFolder: "drafts", AllMail: "allMail", Archived: "archived", Spam: "spam", Trashed: "trashed",
} as const satisfies Record<Folder, InboxFolder>;
const folderOf = Object.fromEntries(Object.entries(folderNames).map(([folder, name]) => [name, folder])) as Record<InboxFolder, Folder>;

const faultNames = { Unreachable: "unreachable", Stale: "changed", Moved: "conversationChanged", TooLarge: "tooLarge" } as const satisfies Partial<Record<Fault, InboxMessageFaultKind>>;

const markNotices = { Busy: "markBusy", NotMarked: "markFailed", Unconfirmed: "markUnconfirmed" } as const satisfies Record<string, InboxNoticeKind>;

const operationNames = {
  Archive: "archive", Trash: "trash", Unarchive: "unarchive", Untrash: "untrash",
  Star: "star", Unstar: "unstar", MarkRead: "markRead", MarkUnread: "markUnread",
} as const satisfies Partial<Record<Kind, string>>;
type Change = keyof typeof operationNames;
const isChange = (kind: Kind): kind is Change => kind in operationNames;

const mailTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const mailDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** When a message arrived, as the list words it: a time on Alpha's day, else a date. */
function arrived(receivedAt: string, today: string): string {
  const at = new Date(receivedAt);
  if (Number.isNaN(at.getTime())) return "";
  return (at.toDateString() === today ? mailTime : mailDate).format(at);
}

/** When a message arrived in full, as its details word it: weekday, date, time with seconds, and time zone. */
function arrivedFully(receivedAt: string): string {
  const at = new Date(receivedAt);
  if (Number.isNaN(at.getTime())) return "Date unavailable";
  return at.toLocaleString([], { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).replace(/[\u202f\u00a0]/gu, " ");
}

/** The name a sender wrote, else the address. */
const senderName = (from: string) => from.replace(/<[^>]*>/u, "").replace(/"/gu, "").trim() || from;
const senderAddress = (from: string) => /<([^>]+)>/u.exec(from)?.[1] ?? from;

/** Why the list has nothing to show, as the list's state says it, else that the accounts are being checked or could not be; none where it has rows to show or is reading. */
function emptyOf(s: Mailbox): InboxListStateKind | undefined {
  if (!s.signedIn || s.failure === "LeaseNeeded") return "signedOut";
  if (s.accounts.status === "Loaded" && s.selected.account === 0 && s.connected.length === 0) return "notConnected";
  if (s.accounts.status === "Loaded" && s.selected.account !== 0 && !readable(s)) return "needsAccess";
  if (readable(s) && !searchableIn(s.selected.folder, s)) return "unavailable";
  if (s.list.status === "Failed") return s.failure === "Offline" ? "offline" : "failed";
  if (s.list.status === "Loaded" && s.pages > 0 && s.total === 0) return s.selected.query === "" ? "empty" : "noResults";
  if (s.accounts.status === "Idle" || s.accounts.status === "Loading") return "checking";
  if (s.accounts.status === "Failed") return "failed";
  return undefined;
}

/** What the list tells the owner above its messages, most pressing first. */
function noticeOf(s: Mailbox): InboxNoticeKind | undefined {
  if (s.failure === "Revoked" || s.failure === "LeaseNeeded") return "reconnect";
  if (s.list.status === "Failed" && s.pages > 0) return s.failure === "Offline" ? "offline" : "unreachable";
  if (s.saved) return "savedList";
  if (s.doubtful) return "listOutOfDate";
  if (s.moved) return "newerMailMissing";
  return undefined;
}

/** Archive, Trash or a restore of `messages` on the list's account, as the list's revision has them. */
function changeOf(list: Mailbox, kind: Change, messages: number[], history: number) {
  const account = list.selected.account;
  return {
    type: "prepareChange", kind, access: accessOf(list, account), account, messages, revision: list.revision, history, fresh: list.pages > 0 && !list.saved,
  } as const;
}

/** The review of a change to messages, and the toast of how it stands: Undo while held, then how it ended. */
function ChangeReview({ runtime, list, cards, selecting = false }: { runtime: Runtime; list: Mailbox; cards: (message: number) => MailCard | undefined; selecting?: boolean }) {
  const { state, can, send } = useTimed(runtime, useChanges);
  const listed = useList(runtime);
  if (!state || !isChange(state.kind)) return null;
  const operation = operationNames[state.kind];
  const confirm = { type: "confirm", revision: list.revision, access: accessOf(list, state.account), now: untimed } as const;
  const undo = { type: "undo", now: untimed } as const;
  const cancel = { type: "cancel" } as const;
  const dismiss = { type: "dismissOutcome" } as const;
  const restoring = () => {
    if (state.attempt.outcome !== "Confirmed" || (state.kind !== "Archive" && state.kind !== "Trash")) return undefined;
    const event = changeOf(list, state.kind === "Archive" ? "Unarchive" : "Untrash", state.messages, revisionOf(cards(state.messages[0] ?? 0)));
    return can(event, "Owner") ? () => void send(event, "Owner") : undefined;
  };
  return (
    <>
      <InboxChangeReview
        open={state.review.showing}
        operation={operation}
        messages={state.messages.map((message) => {
          const card = cards(message);
          return { id: String(message), sender: senderName(card?.from ?? ""), subject: card?.subject ?? "" };
        })}
        changed={state.changed}
        onConfirm={can(confirm, "Owner") ? () => void send(confirm, "Owner").then(() => {
          if (!checksSelection(state.kind) && listed.can({ type: "held" })) void listed.send({ type: "held" });
        }) : undefined}
        onCancel={() => {
          if (can(cancel, "Owner")) void send(cancel, "Owner");
          if (!selecting) {
            for (const message of state.messages) {
              if (listed.can({ type: "unchoose", message })) void listed.send({ type: "unchoose", message });
            }
          }
        }}
      />
      <ToastRegion>{toastOf(state, operation, can(undo, "Owner") ? () => void send(undo, "Owner") : restoring(), can(dismiss, "Owner") ? () => void send(dismiss, "Owner") : undefined)}</ToastRegion>
    </>
  );
}

function toastOf(state: Operations, operation: (typeof operationNames)[Change], onUndo: (() => void) | undefined, onDismiss: (() => void) | undefined): ReactNode {
  const count = state.messages.length;
  if (onUndo) return <InboxChangeToast operation={operation} count={count} phase={state.attempt.outcome === "Confirmed" ? "done" : "holding"} onUndo={onUndo} />;
  if (!state.noticed) {
    return (
      <div className="pointer-events-auto flex items-center gap-2">
        <InboxChangeToast operation={operation} count={count} phase="unknown" />
        {onDismiss ? <Button size="sm" variant="secondary" onClick={onDismiss}>Dismiss</Button> : null}
      </div>
    );
  }
  if (state.attempt.outcome === "Refused") return <InboxChangeToast operation={operation} count={count} phase={state.kind === "Unarchive" || state.kind === "Untrash" ? "outOfDate" : "refused"} />;
  return null;
}

// spec/app/inbox/sending.md, "What the earlier Alpha sent, or never heard the answer to, is taken in as the operation in flight, is never sent again, and ends as Gmail's record of it says"
/** How a send the earlier Alpha made, taken in here, stands: while Gmail's record is read, then as it said, with Dismiss for an unknown one. */
function EarlierSend({ runtime }: { runtime: Runtime }) {
  const { state, can, send } = useTimed(runtime, useChanges);
  if (!state || state.kind !== "Send" || state.draft >= 0 || state.of !== state.session) return null;
  const outcome = state.attempt.outcome;
  const told = outcome === "Sent" ? "sending" : outcome === "Confirmed" ? "sent" : outcome === "Refused" ? "refused" : outcome === "Unknown" && !state.noticed ? "unknown" : undefined;
  if (told === undefined) return null;
  const dismiss = { type: "dismissOutcome" } as const;
  return <InboxSendOutcome earlier outcome={told} onDismiss={can(dismiss, "Owner") ? () => void send(dismiss, "Owner") : undefined} />;
}

type LinkReview = (at: number, facts: { readonly secure: boolean; readonly mismatch: boolean }) => void;

/** The body of a message with nothing able to run, its remote images only once they may load, and its links each reviewed. */
function Body({ text, contents, images, onReview }: { text: string; contents: ReturnType<typeof prepareMessage>; images: boolean; onReview: LinkReview }) {
  const { formatted, links } = contents;
  const document = useMemo(() => formatted ? frameDocument(formatted, images) : undefined, [formatted, images]);
  const frameRef = useCallback((node: HTMLIFrameElement | null) => node ? connectMailFrame(node, (at) => {
    const link = links[at - 1];
    if (link) onReview(at, { secure: link.secure, mismatch: link.mismatch });
  }) : undefined, [links, onReview]);
  const additional = links.flatMap((link, at) => formatted?.inline.has(link.url) ? [] : [{ ...link, at: at + 1 }]);
  const list = (
    <ul aria-label="Links" className={formatted ? "flex flex-col items-start gap-1" : "mt-5 flex flex-col items-start gap-1"}>
      {additional.map((link) => (
        <li key={link.url} className="min-w-0 max-w-full text-sm wrap-anywhere">
          {link.secure ? (
            <Button variant="ghost" size="sm" aria-label={link.mismatch ? link.label : link.url}
              className="h-auto min-h-11 min-w-0 justify-start rounded-sm px-0 text-left font-normal whitespace-normal text-primary hover:bg-transparent active:bg-transparent"
              onClick={() => onReview(link.at, { secure: link.secure, mismatch: link.mismatch })}>
              {link.mismatch ? link.label : URL.parse(link.url)?.hostname ?? link.label}
            </Button>
          ) : link.label}
        </li>
      ))}
    </ul>
  );
  return <>
    {document
      ? <iframe ref={frameRef} title="Formatted email" sandbox="allow-same-origin" referrerPolicy="no-referrer" className="block h-96 w-full border-0" srcDoc={document} />
      : <p className="whitespace-pre-wrap wrap-anywhere">{text || "(Empty message)"}</p>}
    {additional.length > 0
      ? formatted ? <details className="mt-4"><summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground">Other links ({additional.length})</summary>{list}</details> : list
      : null}
  </>;
}

// spec/app/inbox/message.md, "Remote images load only after Show images, or when the owner turned on loading them in Settings"
/** Whether the owner turned on loading images in Inbox, as Settings last read it. */
function useRemote(runtime: Runtime): boolean {
  const preferences = usePreferences(runtime).state;
  return preferences !== undefined && loadsImages(preferences);
}

/** The message open: its body, links and attachments each reviewed before use, its marks, Archive and Trash, Retry and Ask Alpha. */
function Opened({ runtime, list, onRefresh, onBegin }: { runtime: Runtime; list: Mailbox; onRefresh: (() => void) | undefined; onBegin: (beginning: Beginning) => (() => void) | undefined }) {
  const { state, can, send } = useMessage(runtime);
  const marking = useMarks(runtime);
  const changes = useTimed(runtime, useChanges);
  const remote = useRemote(runtime);
  const today = new Date(runtime.runSync(Effect.flatMap(Time, (time) => time.latest()))).toDateString();
  const mail = runtime.runSync(Mail);
  const subscribeSaved = useCallback((listener: () => void) => mail.subscribeSavedBodies(listener), [mail]);
  const savedVersion = useCallback(() => mail.savedBodiesVersion(), [mail]);
  useSyncExternalStore(subscribeSaved, savedVersion, savedVersion);
  const read = state?.body.status === "Loaded" ? mail.body(state.body.ticket) : undefined;
  const reviewLink = useCallback<LinkReview>((at, { secure, mismatch }) => {
    const event = { type: "reviewLink", link: at, secure, mismatch } as const;
    if (can(event)) void send(event);
  }, [can, send]);
  if (!state || state.message === 0) return null;
  const access = accessOf(list, state.account);
  const card = mail.card(state.message) ?? read?.message;
  const loaded = state.body.status === "Loaded" && read !== undefined;
  const unread = card?.isUnread ?? false;
  const mark = { type: "mark", access, account: state.account, message: state.message, unread: !unread } as const;
  const retry = { type: "retry", access, remote } as const;
  const reopen = { type: "reopen", access, remote } as const;
  const earlier = { type: "earlier", access, remote } as const;
  const newer = { type: "newer", access, remote } as const;
  const history = revisionOf(card);
  const changing = (kind: Change) => {
    if (!loaded || list.selected.account !== state.account) return undefined;
    const event = changeOf(list, kind, [state.message], history);
    return changes.can(event, "Owner") ? () => void changes.send(event, "Owner") : undefined;
  };
  const fault = state.body.status === "Failed" && state.fault in faultNames ? faultNames[state.fault as keyof typeof faultNames] : undefined;
  const gmailId = fault === "tooLarge" && access.grant.read ? mail.gmailId(state.message, state.account) : undefined;
  const faultAction = gmailId ? () => {
    const account = mail.email(state.account);
    window.open(`https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(gmailId)}`, "_blank", "noopener,noreferrer");
  } : fault === "conversationChanged" ? (can(reopen) ? () => void send(reopen) : undefined) : can(retry) ? () => void send(retry) : undefined;
  const told = marking.state?.told;
  const notice = told !== undefined && told in markNotices ? markNotices[told as keyof typeof markNotices] : undefined;
  const files = loaded ? read.attachments : [];
  const destination = runtime.runSync(InboxAttachmentFiles).destination;
  const unsure = (attachment: number) => state.unsure.some((held) => held.account === state.account && held.message === state.message && held.attachment === attachment);
  const reviewing = (attachment: number, handling: "Opening" | "Saving") => {
    const event = { type: "reviewAttachment", attachment, handling } as const;
    return can(event) ? () => void send(event) : undefined;
  };
  // spec/app/inbox/message.md, "An attachment Alpha can neither show nor save still answers a tap: it is to be opened in Gmail"
  const unsupported = (attachment: number) => {
    const event = { type: "unsupportedAttachment", attachment } as const;
    return can(event) ? () => void send(event) : undefined;
  };
  const file = files.at(state.attachment - 1);
  const outcome = state.file.outcome;
  const outcomeOf = (attempt: typeof state.file) => attempt.outcome === "Planned" ? undefined
    : attempt.outcome === "Recorded" || attempt.outcome === "Sent" ? "working" : attempt.outcome === "Confirmed" ? "done"
      : attempt.outcome === "Refused" ? (attempt.id === state.cancelled ? "cancelled" : "refused") : "unknown";
  const saveReviewed = { type: "saveReviewed", access } as const;
  const attachment = file && state.handling === "Opening" && outcome === "Confirmed"
    ? runtime.runSync(AttachmentPreviews).read(state.file.id)
    : undefined;
  const turn = (page: number) => {
    const event = { type: "pdfPage", access, page } as const;
    return can(event) ? () => void send(event) : undefined;
  };
  const pdf = state.pdf;
  const preview: InboxAttachmentPreview | undefined = attachment?.kind !== "pdf" ? attachment : {
    kind: "pdf", digest: attachment.digest, page: pdf.page, pages: pdf.pages,
    drawing: pdf.drawing.status === "Loading" ? { kind: "loading" }
      : pdf.drawing.status === "Loaded" && attachment.page === pdf.page ? { kind: "rendered", url: attachment.url }
        : { kind: "failed", onRetry: turn(pdf.page) },
    onPrevious: turn(pdf.page - 1), onNext: turn(pdf.page + 1),
  };
  const contents = loaded ? prepareMessage(read) : undefined;
  const link = state.link > 0 ? contents?.links.at(state.link - 1) : undefined;
  const original = read?.message;
  // spec/app/inbox/message.md, "A thread control selects an exact position from the message and thread currently shown"
  const conversation = loaded && state.thread > 1 && original
    ? runtime.runSync(ThreadPages).get({ account: state.account, generation: mail.generation(state.account), threadId: original.threadId })
    : undefined;
  const threadPage = conversation?.pages[0];
  const selectPosition = (position: number | null | undefined, paging: boolean) => {
    if (position === null || position === undefined) return undefined;
    const event = { type: "selectThreadPosition", ticket: state.body.ticket, access, thread: state.thread, position, paging, remote } as const;
    return can(event) ? () => void send(event) : undefined;
  };
  const threadRows = threadPage?.messages.flatMap(({ message }, at) => {
    if (message.id === original?.id) return [];
    const position = threadPage.offset + at;
    return [{ position, sender: senderName(message.from), date: arrived(message.receivedAt, today), snippet: message.snippet, onOpen: selectPosition(position, false) }];
  });
  const from = senderAddress(card?.from ?? "");
  const replyTo = original && "replyTo" in original && typeof original.replyTo === "string" ? original.replyTo : undefined;
  const answered = original === undefined || read === undefined ? undefined : {
    id: original.id, from: original.from, replyTo, others: [...original.to, ...original.cc], subject: original.subject,
    body: read.bodyText, historyId: original.metadata.historyId, files,
  };
  return (
    <>
      <InboxMessageScreen
        subject={card?.subject || "(no subject)"}
        sender={senderName(card?.from ?? "")}
        address={from}
        to={card?.to.join(", ") ?? ""}
        cc={card?.cc.join(", ") || undefined}
        replyTo={replyTo && replyTo.toLowerCase() !== from.toLowerCase() ? replyTo : undefined}
        date={card ? arrived(card.receivedAt, today) : ""}
        fullDate={card ? arrivedFully(card.receivedAt) : undefined}
        place={Math.max(1, state.position + 1)}
        count={Math.max(state.thread, 1)}
        threadRows={threadRows}
        onOlder={threadPage ? selectPosition(conversation?.earlier.get(threadPage.offset), true) : can(earlier) ? () => void send(earlier) : undefined}
        onNewer={threadPage ? selectPosition(threadPage.nextOffset, true) : can(newer) ? () => void send(newer) : undefined}
        onClose={() => { if (can({ type: "close" })) void send({ type: "close" }); }}
        reading={state.body.status === "Loading"}
        fault={fault}
        onFaultAction={faultAction}
        fromPhone={state.fromPhone}
        imagesHidden={!imagesLoad(state) && (contents?.formatted?.remoteImages ?? 0) > 0}
        onShowImages={can({ type: "showImages" }) ? () => void send({ type: "showImages" }) : undefined}
        notice={notice ?? (state.unsupported > 0 ? "openInGmail" : undefined)}
        onNoticeAction={told === "Unconfirmed" && onRefresh ? onRefresh : undefined}
        attachments={files.map((one, at) => ({
          id: `${one.partId}:${at}`, name: one.name, size: sizeOf(one.size),
          onOpen: state.revision > 0 && canPreviewAttachment(one) ? reviewing(at + 1, "Opening") : undefined,
          onSave: state.revision > 0 && destination !== "unavailable" && !canPreviewAttachment(one) && canSaveAttachment(one) ? reviewing(at + 1, "Saving") : undefined,
          onUnsupported: !canPreviewAttachment(one) && (destination === "unavailable" || !canSaveAttachment(one)) ? unsupported(at + 1) : undefined,
          saveUnconfirmed: unsure(at + 1),
          browserDownload: destination === "download",
          picker: destination === "picker",
        }))}
        unread={unread}
        onToggleRead={loaded && marking.can(mark, "Owner") ? () => void marking.send(mark, "Owner") : undefined}
        onArchive={changing("Archive")}
        onTrash={changing("Trash")}
        onAskAlpha={can({ type: "askAlpha" }) ? () => void send({ type: "askAlpha" }) : undefined}
        onReply={loaded ? onBegin({ kind: "Reply", account: state.account, message: answered }) : undefined}
        onReplyAll={loaded && new Set([...(card?.to ?? []), ...(card?.cc ?? [])].map((one) => one.toLowerCase())).size > 1 ? onBegin({ kind: "ReplyAll", account: state.account, message: answered }) : undefined}
        onForward={loaded ? onBegin({ kind: "Forward", account: state.account, message: answered }) : undefined}
      >
        {state.fromPhone ? <p className="whitespace-pre-wrap wrap-anywhere">{mail.savedBody(list, state.message) ?? "Message not saved on this device."}</p> : null}
        {loaded && contents ? (
          <Body text={read.bodyText} contents={contents} images={imagesLoad(state)} onReview={reviewLink} />
        ) : null}
      </InboxMessageScreen>
      <InboxLinkReview open={link !== undefined} destination={link?.url ?? ""} claimed={state.warning ? link?.label : undefined}
        onOpen={() => { if (can({ type: "openLink" })) void send({ type: "openLink" }); }}
        onClose={() => { if (can({ type: "closeLink" })) void send({ type: "closeLink" }); }} />
      <InboxAttachmentReview
        open={file !== undefined && state.attachment > 0}
        name={file?.name ?? ""}
        size={sizeOf(file?.size ?? 0)}
        handling={state.handling === "Saving" ? "save" : "open"}
        outcome={outcomeOf(state.file) ?? "review"}
        preview={preview}
        browserDownload={destination === "download"}
        picker={destination === "picker"}
        onConfirm={can({ type: "confirmAttachment", access }) ? () => void send({ type: "confirmAttachment", access }) : undefined}
        onSave={file && destination !== "unavailable" && canSaveAttachment(file) && can(saveReviewed) ? () => void send(saveReviewed) : undefined}
        saveOutcome={state.handling === "Opening" ? outcomeOf(state.keep) : undefined}
        onClose={() => { if (can({ type: "closeAttachment" })) void send({ type: "closeAttachment" }); }}
      />
    </>
  );
}

const sizeOf = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : bytes >= 1_000 ? `${Math.round(bytes / 1_000)} KB` : `${bytes} B`);

function useInboxPaneFocus({ readerOpen, split, covered }: { readerOpen: boolean; split: boolean; covered: boolean }) {
  const lastPaneRef = useRef<"list" | "reader">(undefined);
  const openingRowRef = useRef<number>(undefined);
  const wasReadingRef = useRef(false);
  const listPaneRef = useCallback((pane: HTMLDivElement | null) => {
    if (!pane || readerOpen || covered || !wasReadingRef.current) return;
    wasReadingRef.current = false;
    const focused = document.activeElement;
    if (focused !== document.body && !focused?.closest('[data-alpha-subview="inbox-detail"]')) return;
    const row = openingRowRef.current === undefined ? null : pane.querySelector<HTMLButtonElement>(`[data-inbox-row="${openingRowRef.current}"] button`);
    (row ?? pane).focus({ preventScroll: true });
  }, [covered, readerOpen]);
  const readerPaneRef = useCallback((pane: HTMLDivElement | null) => {
    if (!pane) return;
    wasReadingRef.current = true;
    const focused = document.activeElement;
    if (!split && lastPaneRef.current === "list" && (focused === document.body || focused?.closest('[data-alpha-subview="inbox-list"]'))) {
      pane.focus({ preventScroll: true });
    }
  }, [split]);
  return { lastPaneRef, openingRowRef, listPaneRef, readerPaneRef };
}

/** Owner confirmation dialog shown when the phone needs a fresh session before opening Google OAuth consent. */
function MailReauthDialog({ runtime }: { runtime: Runtime }) {
  const signIn = runtime.runSync(MailSignIn);
  const subscribe = useCallback((listener: () => void) => signIn.subscribeReauth(listener), [signIn]);
  const snapshot = useCallback(() => signIn.reauthSnapshot(), [signIn]);
  const reauth = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [code, setCode] = useState("");
  const [shownKind, setShownKind] = useState(reauth.kind);
  if (reauth.kind !== shownKind) {
    setShownKind(reauth.kind);
    setCode("");
  }
  if (reauth.kind === "Idle") return null;
  const busy = reauth.kind === "Starting" || reauth.busy === true;
  const cancel = () => {
    setCode("");
    void runtime.runPromise(signIn.cancelReauth());
  };
  const submit = (factor?: "sms" | "totp") => {
    const entered = code;
    setCode("");
    void runtime.runPromise(signIn.verifyReauth(entered, factor));
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent closeLabel="Cancel">
        <DialogTitle>Confirm it’s you</DialogTitle>
        <DialogDescription>
          {reauth.kind === "UseFactor"
            ? "Finish confirming your Alpha Cloud account to connect Gmail."
            : `We sent a confirmation code to ${reauth.email} so Alpha can open Gmail authorization.`}
        </DialogDescription>
        {reauth.kind === "Starting" ? (
          <div className="py-2"><Spinner label="Sending confirmation code" /></div>
        ) : (
          <form className="grid gap-3" onSubmit={(event) => {
            event.preventDefault();
            if (busy || !code.trim()) return;
            if (reauth.kind === "EnterCode") submit();
            else if (reauth.factors.length === 1 && (reauth.factors[0] !== "sms" || reauth.smsSent)) submit(reauth.factors[0]);
          }}>
            <Input aria-label="Confirmation code" autoComplete="one-time-code" inputMode="numeric" placeholder="6-digit code"
              value={code} onChange={(event) => setCode(event.currentTarget.value)} />
            {reauth.error ? <p role="status" className="text-sm text-destructive">{reauth.error}</p> : null}
            <div className="flex flex-wrap gap-2">
              {reauth.kind === "EnterCode" ? (
                <Button type="submit" disabled={busy || !code.trim()}>Verify code</Button>
              ) : reauth.factors.map((factor) => factor === "sms" && !reauth.smsSent ? (
                <Button key={factor} type="button" disabled={busy} onClick={() => void runtime.runPromise(signIn.sendReauthSms())}>Text me a code</Button>
              ) : (
                <Button key={factor} type="button" disabled={busy || !code.trim()} onClick={() => submit(factor)}>
                  Verify {factor === "totp" ? "authenticator" : "text message"} code
                </Button>
              ))}
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setCode(""); void runtime.runPromise(signIn.resendReauth()); }}>Send another email</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>Not now</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inbox: the list of the account, folder and search chosen, saved on the phone while Gmail cannot be reached, and the
 * message opened from it, with the review and Undo of a change. Each control is offered exactly when its machine takes
 * its event.
 * @model spec/app/inbox/index.md
 */
export function Inbox({ runtime, alpha }: InboxProps & { alpha: Alpha }) {
  const { state, cause, can, send } = useList(runtime);
  const message = useMessage(runtime);
  const changes = useTimed(runtime, useChanges);
  const drafts = useDrafts(runtime);
  const shell = useShell(runtime);
  const canvas = useCanvas(runtime).state;
  // spec/app/shell/index.md, "On the launcher the first page of Settings and of Workflows draws no Back, and Android's Back still leaves it": as v119 45f6bed30 prototype/model.js:6415 drew Inbox's Back only off the launcher.
  const firstPageBack = shell.state && drawsAppBack(shell.state, canvas?.launcher ?? false, "FirstPage") ? () => void alpha.back() : undefined;
  const remote = useRemote(runtime);
  const [typed, setTyped] = useState<{ text: string; over: string; folder: string } | undefined>();
  const [selection, setSelection] = useState<string>();
  const [unopenedDraft, setUnopenedDraft] = useState<number>();
  const composingNow = drafts.state?.open === true;
  const openMessage = message.state?.account === state?.selected.account ? message.state?.message ?? 0 : 0;
  const readerOpen = !composingNow && openMessage !== 0;
  const split = readerOpen && canvas?.split === true;
  const covered = composingNow || (readerOpen && !split);
  const { lastPaneRef, openingRowRef, listPaneRef, readerPaneRef } = useInboxPaneFocus({ readerOpen, split, covered });
  if (cause) return <Alert variant="destructive" className="m-4">Alpha could not open Inbox</Alert>;
  if (!state || !message.state || !drafts.state) return null;
  const mail = runtime.runSync(Mail);
  const retryAccess = can({ type: "checkAccess" })
    ? () => void runtime.runPromise(Effect.flatMap(MailSignIn, (access) => access.retry()))
    : undefined;
  if (state.signedIn && !mail.ownerConfirmed()) {
    const waiting = state.accounts.status !== "Failed";
    return <InboxListScreen folder="incoming" rows={[]} search="" onSearchChange={() => undefined} loading={waiting}
      state={waiting ? undefined : "failed"} onStateAction={retryAccess}
      onBack={firstPageBack} />;
  }
  // spec/app/inbox/drafts.md, "A new message, a reply, a reply to all or a forward begins as [one draft](./letter.md) says; a reply to a message with no usable address is refused and the owner told"
  const onBegin = (beginning: Beginning) => {
    const event = { type: "compose", kind: beginning.kind, account: beginning.account, others: 0, files: 0, mib: 0 } as const;
    return beginning.account !== 0 && drafts.can({ ...event, replyTo: false, addressable: true, forwardable: false, policy: { files: 0, mib: 0 } }, "Owner")
      ? () => void runtime.runPromise(begin(beginning))
      : undefined;
  };
  const cards = (number: number) => mail.card(number);
  const refresh = can({ type: "refresh" }) ? () => void send({ type: "refresh" }) : undefined;
  const retryList = refresh ?? retryAccess;
  const route = shell.state?.route;
  const signIn = route === undefined ? undefined : () => {
    void runtime.runPromise(Effect.flatMap(MailSignIn, (access) => access.signIn(() => alpha.runtime.runFork(openInboxAccount(route)))));
  };
  const connectGmail = route === undefined ? undefined : () => {
    const popup = gmailAuthorizationWindow();
    void runtime.runPromise(Effect.flatMap(MailSignIn, (access) => access.consent({ kind: "Connect", route }, popup)));
  };
  const reconnect = state.failure === "Revoked" ? connectGmail : signIn;
  const hidden = new Set(changes.state ? aside(changes.state) : []);
  const letters = mail.shown(state).filter(({ message: number }) => !hidden.has(number));
  const { account, folder, query } = state.selected;
  const draftsFolder = folder === "DraftsFolder";
  const shelf = drafts.state.shelfSelection;
  const selectingDrafts = draftsFolder && shelf.account === account && readable(state);
  const startDrafts = { type: "startShelfSelection", account } as const;
  const finishDrafts = { type: "endShelfSelection" } as const;
  const reviewDrafts = { type: "reviewShelfDiscard" } as const;
  const deleteDrafts = { type: "discardShelfSelection" } as const;
  const folderKey = `${account}/${folder}`;
  const typedHere = typed && typed.over === query && typed.folder === folderKey ? typed.text : undefined;
  const searching = searchOpen(state); // spec/app/inbox/index.md, "Back from a search shows its folder without the search, before Back leaves Inbox"
  const selecting = !draftsFolder && selection === folderKey && !searching && readable(state) && !state.saved && state.pages > 0;
  const chosenMessages = new Set(state.chosen);
  const access = accessOf(state, account);
  const today = new Date(runtime.runSync(Effect.flatMap(Time, (time) => time.latest()))).toDateString();
  const checkingOrOffline = state.accounts.status === "Loading" || state.accounts.status === "Failed";
  const row = ({ message: number, card, draftId }: Letter): InboxListRow => {
    const open = { type: "open", access, account, message: number, remote } as const;
    const saved = { type: "openSaved", account, message: number, checkingOrOffline, kept: state.saved } as const;
    const opening = draftsFolder ? undefined : message.can(saved) ? saved : message.can(open) ? open : undefined;
    const editing = draftsFolder && !selectingDrafts && draftId !== undefined && !state.saved && readable(state) ? () => {
      setUnopenedDraft(undefined);
      void runtime.runPromise(openGmailDraft(account, draftId)).then((opened) => {
        if (!opened) setUnopenedDraft(account);
      });
    } : undefined;
    const chosen = chosenMessages.has(number);
    const toggle = chosen ? ({ type: "unchoose", message: number } as const) : ({ type: "choose", message: number } as const);
    const swipe = { type: "swipe", message: number } as const;
    const canArchive = !selecting && !draftsFolder && folder !== "Archived" && folder !== "Trashed" && can(swipe) && changes.can(changeOf(state, "Archive", [number], revisionOf(card)), "Owner");
    return {
      id: String(number),
      sender: draftsFolder ? (card.to.length ? `Draft to ${card.to.join(", ")}` : "Draft (no recipients)")
        : folder === "Sent" ? `To: ${card.to.length ? card.to.join(", ") : "(no recipients)"}` : senderName(card.from),
      initial: draftsFolder ? "D" : folder === "Sent" ? (card.to[0] ?? "?").slice(0, 1).toUpperCase() : undefined,
      subject: card.subject || "(no subject)", snippet: card.snippet,
      time: arrived(card.receivedAt, today), unread: card.isUnread, attachment: showsAttachment(card.hasAttachments === true), chosen, selecting, current: openMessage === number,
      onOpen: editing ?? (opening ? () => {
        openingRowRef.current = number;
        void message.send(opening);
      } : undefined),
      onChosenChange: selecting && can(toggle) ? () => void send(toggle) : undefined,
      onSwipe: canArchive ? () => void send(swipe).then((applied) => {
        if (applied._tag !== "Success") return;
        const archive = changeOf(applied.value.state, "Archive", [number], revisionOf(card));
        if (changes.can(archive, "Owner")) void changes.send(archive, "Owner");
      }) : undefined,
    };
  };
  const chosenChange = (kind: Change) => {
    const event = changeOf(state, kind, [...state.chosen], revisionOf(cards(state.chosen[0] ?? 0)));
    return changes.can(event, "Owner") ? () => void changes.send(event, "Owner") : undefined;
  };
  const kind = letters.length === 0 ? emptyOf(state) : undefined;
  const notice = kind === "signedOut" ? undefined : noticeOf(state);
  // spec/app/inbox/index.md, "Select all chooses every message the list shows, in one change"
  const chooseAll = { type: "chooseAll", shown: letters.map((letter) => letter.message) } as const;
  const canSearch = !draftsFolder && readable(state) && searchableIn(folder, state);
  const canOpenSearch = canSearch || (kind === "signedOut" && signIn !== undefined);
  const clearSearch = { type: "clearSearch" } as const;
  const clearSelection = () => {
    for (const message of chosenMessages) void send({ type: "unchoose", message });
  };
  const finishSelection = () => {
    setSelection(undefined);
    clearSelection();
  };
  const accounts = state.connected.map((linked) => ({ id: String(linked.account), email: mail.email(linked.account), grant: linked.grant }));
  const chooseAccount = (id: string) => {
    const event = { type: "chooseAccount", account: Number(id) } as const;
    if (can(event)) {
      setSelection(undefined);
      setTyped(undefined);
      void send(event);
    }
  };
  // spec/app/inbox/shelf.md, "Story: Keep drafts set aside"
  const composing = drafts.state;
  const localIds = composing.shelf.shelved.filter((id) => held(composing.shelf, id).account === account);
  const shelfPicks: ShelfPick[] = localIds.filter((id) => deletableShelfDraft(composing, account, id))
    .map((id) => ({ draft: id, revision: held(composing.shelf, id).revision }));
  const chooseLocal = { type: "pickAllShelfDrafts", picks: shelfPicks } as const;
  const clearLocal = { type: "pickAllShelfDrafts" as const, picks: [] };
  const allLocalChosen = shelfPicks.every(({ draft, revision }) => shelf.picks.some((pick) => pick.draft === draft && pick.revision === revision));
  const localLetters = runtime.runSync(Letters);
  const shelved: InboxListRow[] = localIds.map((id) => {
    const words = localLetters.words(id);
    const resume = { type: "resume", draft: id } as const;
    const pick = { type: "pickShelfDraft", draft: id } as const;
    return {
      id: `shelf:${id}`, sender: "Draft", initial: "D", subject: words.subject || "(No subject)", snippet: words.text.slice(0, 160), time: "Draft",
      selecting: selectingDrafts,
      chosen: shelf.picks.some(({ draft }) => draft === id),
      onChosenChange: selectingDrafts && drafts.can(pick, "Owner") ? () => void drafts.send(pick, "Owner") : undefined,
      onOpen: !selectingDrafts && drafts.can(resume, "Owner") ? () => void drafts.send(resume, "Owner") : undefined,
    };
  });
  const mustChoose = state.accounts.status === "Loaded" && account === 0 && state.connected.length > 0;
  return (
    <>
      <div className="flex h-full min-h-0 min-w-0">
        <div ref={listPaneRef} data-alpha-subview="inbox-list" tabIndex={-1} inert={covered}
          onFocusCapture={() => { lastPaneRef.current = "list"; }}
          className={covered ? "hidden" : split ? "h-full w-[clamp(300px,36%,400px)] shrink-0 border-r border-border" : "min-h-0 min-w-0 flex-1"}>
        <InboxListScreen
          onBack={firstPageBack} launcher={canvas?.launcher ?? false}
          account={account === 0 ? undefined : mail.email(account)}
          folder={folderNames[folder]}
          unavailable={!state.searchable}
          onChooseFolder={readable(state) ? (name) => {
            const event = { type: "chooseFolder", folder: folderOf[name] } as const;
            if (can(event)) {
              setSelection(undefined);
              setTyped(undefined);
              void send(event);
            }
          } : undefined}
          searching={searching} search={typedHere ?? query}
          onOpenSearch={canOpenSearch && can({ type: "openSearch" }) ? () => {
            finishSelection();
            setTyped({ text: query, over: query, folder: folderKey });
            void send({ type: "openSearch" });
          } : undefined}
          onCloseSearch={() => { setTyped(undefined); if (can({ type: "closeSearch" })) void send({ type: "closeSearch" }); }}
          onSearchChange={(text) => {
            if (text === "" && can(clearSearch)) {
              setTyped({ text, over: "", folder: folderKey });
              void send(clearSearch);
            } else setTyped({ text, over: query, folder: folderKey });
          }}
          onSearch={canSearch ? (text) => {
            const event = { type: "search", query: text } as const;
            if (can(event)) {
              setTyped(undefined);
              void send(event);
            }
          } : kind === "signedOut" && signIn ? (text) => {
            if (text !== "") signIn();
          } : undefined}
          notice={notice}
          onNoticeAction={notice === "reconnect" ? reconnect : retryList}
          state={mustChoose ? undefined : kind}
          onStateAction={kind === "offline" || kind === "failed" ? retryList : kind === "signedOut" ? signIn : connectGmail}
          chosen={draftsFolder ? shelf.picks.length : state.chosen.length}
          onStartSelection={draftsFolder
            ? !state.saved && readable(state) && drafts.can(startDrafts, "Owner") ? () => void drafts.send(startDrafts, "Owner") : undefined
            : !selecting && can(chooseAll) ? () => setSelection(folderKey) : undefined}
          onFinishSelection={selectingDrafts ? () => void drafts.send(finishDrafts, "Owner") : selecting || chosenMessages.size > 0 ? finishSelection : undefined}
          onClearSelection={selectingDrafts
            ? shelf.picks.length > 0 && drafts.can(clearLocal, "Owner") ? () => void drafts.send(clearLocal, "Owner") : undefined
            : selecting && chosenMessages.size > 0 ? clearSelection : undefined}
          onChooseAll={draftsFolder
            ? selectingDrafts && !allLocalChosen && drafts.can(chooseLocal, "Owner") ? () => void drafts.send(chooseLocal, "Owner") : undefined
            : can(chooseAll) ? () => void send(chooseAll) : undefined}
          onDeleteDrafts={selectingDrafts && drafts.can(reviewDrafts, "Owner") ? () => void drafts.send(reviewDrafts, "Owner") : undefined}
          onArchive={state.selected.folder === "Archived" ? undefined : chosenChange("Archive")}
          onTrash={state.selected.folder === "Trashed" ? undefined : chosenChange("Trash")}
          onRestore={state.selected.folder === "Archived" ? chosenChange("Unarchive") : state.selected.folder === "Trashed" ? chosenChange("Untrash") : undefined}
          labelChanges={accessOf(state, account).grant.modify}
          onStar={chosenChange(state.selected.folder === "Starred" ? "Unstar" : "Star")}
          onMarkRead={chosenChange("MarkRead")}
          onMarkUnread={chosenChange("MarkUnread")}
          onRefresh={refresh}
          onCompose={selectingDrafts ? undefined : onBegin({ kind: "Fresh", account })}
          accounts={accounts}
          onChooseAccount={chooseAccount}
          aside={!draftsFolder && !can({ type: "chooseFolder", folder: "DraftsFolder" })
            ? shelved.flatMap(({ id, onOpen }) => onOpen ? [{ id, onOpen }] : []) : undefined}
          rows={draftsFolder ? [...shelved, ...letters.map(row)] : letters.map(row)}
          loading={state.list.status === "Loading" && !state.further}
          onLoadMore={can({ type: "loadMore" }) ? () => void send({ type: "loadMore" }) : undefined}
          loadingMore={state.list.status === "Loading" && state.further}
        />
        </div>
        {readerOpen ? <div ref={readerPaneRef} data-alpha-subview="inbox-detail" tabIndex={-1}
          onFocusCapture={() => { lastPaneRef.current = "reader"; }} className="min-h-0 min-w-0 flex-1">
          <Opened runtime={runtime} list={state} onRefresh={refresh} onBegin={onBegin} />
        </div> : null}
        {composingNow ? <div data-alpha-subview="inbox-composing" className="min-h-0 min-w-0 flex-1"><Compose runtime={runtime} list={state} /></div> : null}
      </div>
      <InboxDiscardDialog open={selectingDrafts && shelf.reviewing}
        drafts={shelf.picks.map(({ draft }) => ({ id: draft, subject: localLetters.words(draft).subject || "(No subject)" }))}
        gmailCopy={shelf.picks.some(({ draft }) => held(composing.shelf, draft).gmail !== 0)}
        onDiscard={drafts.can(deleteDrafts, "Owner") ? () => void drafts.send(deleteDrafts, "Owner") : undefined}
        onKeep={() => void drafts.send({ type: "closeShelfReview" }, "Owner")} />
      {draftsFolder && unopenedDraft === account && drafts.state.notice === "NotEditable" ? (
        <InboxNotice kind="notEditable" onAction={() => {
          const email = mail.email(account);
          window.open(`https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts`, "_blank", "noopener,noreferrer");
        }} />
      ) : null}
      {mustChoose ? <InboxAccountList accounts={accounts} onChoose={chooseAccount} /> : null}
      <FileOffer runtime={runtime} />
      <Suggested runtime={runtime} />
      <EarlierSend runtime={runtime} />
      <ChangeReview runtime={runtime} list={state} cards={cards} selecting={selecting} />
      <MailReauthDialog runtime={runtime} />
    </>
  );
}
