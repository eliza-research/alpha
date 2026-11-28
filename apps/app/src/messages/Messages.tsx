// spec/app/messages/index.md, "Story: See my conversations"; spec/app/messages/index.md, "Story: Read a conversation"; spec/app/messages/index.md, "Story: Act on a message"; spec/app/messages/index.md, "Story: Start a new message"; spec/app/messages/composer.md, "Story: Keep my draft"; spec/app/messages/composer.md, "Story: Send a message"
import { MMS_ATTACHMENT_TYPES, MMS_MAX_BODY } from "@elizaos/os-bridges";
import type { MessageRow, ThreadRow } from "@elizaos/os-bridges";
import { Alert, AppHeader, Avatar, Banner, Button, Chip, cn, focusRing, Mark, Input, MessageAttachmentsMenu, MessagePictureChip, SearchField, Textarea, watchMessageMenu } from "@repo/ui";
import { Effect, type Layer, type ManagedRuntime } from "effect";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronUp, CircleAlert, Image as PictureIcon, Mic, Pencil, Phone as Call, Plus, RefreshCw, Search, Square, X } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { clear, liveCall } from "../../gen/app__phone.ts";
import { useMachine as usePhone } from "../../gen/app__phone.react.ts";
import { content, noMatches, noThreads, smsNeeded, threadsFailed } from "../../gen/app__messages.ts";
import { useMachine as useMessages } from "../../gen/app__messages.react.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { useMachine as useCanvas } from "../../gen/app__shell__keyboard.react.ts";
import { delivered, sentAll, uncertain } from "../../gen/app__messages__sending.ts";
import { useMachine as useComposer } from "../../gen/app__messages__composer.react.ts";
import { Time } from "../runtime/index.vibe";
import { callerInitials, displayNumber, shortWhen } from "../comms/index.vibe";
import { Drafts, type NewMessageHandoff, attachAll, discardMessageDraft, editNewMessage, messageRecipients, newDraftHeld, openMessageDraft, prepare, removeMessagePicture, retryMessageHandoff, sameSubscription, startNewMessage, supported, takeSavedMessageDraft, writeMessageDraft } from "./composer.vibe";
import { Conversations, type CopyReport, Inbox, titleOf } from "./messages.vibe";
import { CommsBar, useCommsDock } from "../comms/ui.tsx";
import { commsHeld } from "../comms/index.vibe";
import type { Resident } from "../runtime/ui.tsx";
import { untimed } from "../runtime/index.vibe";
import { useMachine as useVoice } from "../../gen/app__voice.react.ts";
import { dictateMessage, type voiceArea } from "./dictation.vibe";
import { DeleteMessageDialog } from "./DeleteMessageDialog.tsx";
import { MessageActionMenu, type MessageActions } from "./MessageActionMenu.tsx";
import { NewMessageDock } from "./NewMessageDock.tsx";

export interface MessagesProps {
  /** Provides Messages' and the composer's machines, both resident, Phone's, for whether a call may be an emergency call, and what they count. */
  runtime: ManagedRuntime.ManagedRuntime<Resident | Layer.Success<typeof voiceArea>, unknown>;
  onBack?: (() => void) | undefined;
  onOpenLink?: ((href: string) => void) | undefined;
}


type MessagesUI = ReturnType<typeof useMessages>;
type HandoffProps = { handoff?: NewMessageHandoff | undefined; discardHandoff: () => void };

const header = "flex min-h-12 shrink-0 items-center gap-1 px-2";
/**
 * The top of the Messages list as the Pixel drew it on Sunday's v119 (Alpha 45f6bed30): 8px under the status bar
 * (`prototype/phone.css:45`; the 8px is the list's own `pt-2`), then the serif "Messages" title with Search and the pencil New message at its end
 * (`prototype/template.html:566-571`, `phone.css:304,311-317`). The title row is at least 56px (`.alpha-stage-header`, `phone.css:304`), so
 * above 150% text it grows with its wrapped title; only Search keeps the same top at a fixed 56px (`template.html:581`).
 */
const messagesTop = "mt-[max(var(--alpha-native-inset-top,0px),env(safe-area-inset-top))] in-[main:has([data-alpha-call-strip=over])]:mt-0";
const messagesHeader = cn(messagesTop, "shrink-0 in-data-[alpha-launcher]:min-h-14 in-data-[alpha-launcher]:gap-1 in-data-[alpha-launcher]:[&>button[aria-label]:not([aria-label^=Back])]:size-11 in-data-[alpha-launcher]:[&>button[aria-label]:not([aria-label^=Back])]:min-w-11");
const accessPill = "min-h-13 rounded-group bg-foreground px-7 text-lg font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const draftAction = "min-h-11 rounded-tile text-base focus-visible:outline-2 focus-visible:outline-ring";
const notice = "mx-2 basis-full text-caption leading-detail text-muted-foreground";
const textLink = "min-h-11 underline focus-visible:outline-2 focus-visible:outline-ring";
const accessoryChip = "inline-flex min-h-11 items-center rounded-tile text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const contactRow = cn(focusRing, "flex min-h-15 w-full items-center gap-3 px-5 py-1.5 text-left hover:bg-accent focus-visible:-outline-offset-focus");
const messageURL = /\bhttps?:\/\/[^\s<>"']+/giu;
const noMessages: ReadonlyArray<MessageRow> = [];

function firstName(title: string) {
  return /^[+(\d]/.test(title) || title.includes(",") ? title : (title.split(/\s+/, 1)[0] ?? title);
}

function avatarName(title: string) {
  return callerInitials(title) === "#" ? "#" : title;
}

/** A message's time as develop's bubbles say it: the time today, and the date before it on another day. */
function stamp(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
  return `${day} · ${time}`;
}

function clearChoice(runtime: MessagesProps["runtime"]) {
  runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ chosen: "", copyRequest: undefined })));
}

/**
 * Messages: the conversation list, one conversation with its composer, and the picker that starts a new message.
 * Only the owner's Send sends. Alpha's draft is marked as Alpha's and never sends itself.
 * @model spec/app/messages/index.md
 */
export function Messages({ runtime, onBack, onOpenLink }: MessagesProps) {
  const messages = useMessages(runtime);
  const route = useShell(runtime).state?.route;
  const dock = useCommsDock(runtime);
  const [view, setView] = useState<HTMLElement | null>(null);
  const { handoffs, touch } = runtime.runSync(Effect.map(Drafts, (drafts) => ({ handoffs: drafts.messageHandoff, touch: drafts.messageTouches.touch })));
  const pending = useSyncExternalStore(handoffs.subscribe, handoffs.get, handoffs.get);
  const handoff = pending !== undefined && pending.route === route ? pending : undefined;
  const discardHandoff = () => { if (handoff !== undefined) handoffs.replace(handoff, undefined); };
  if (messages.cause) return <Alert variant="destructive" className="m-4">Alpha could not open Messages</Alert>;
  const { state } = messages;
  if (!state) return null;
  return (
    <section ref={setView} data-alpha-messages data-sheet={dock.open ? "open" : "closed"} aria-label="Messages"
      onPointerDownCapture={touch} onKeyDownCapture={touch} onFocusCapture={touch}
      onClickCapture={touch} onInputCapture={touch} onWheelCapture={touch}
      className="group/messages relative flex h-full min-h-0 flex-col overflow-hidden data-[sheet=closed]:pt-2">
      {state.pane === "Threads" && <Threads runtime={runtime} messages={messages} onBack={onBack} handoff={handoff} discardHandoff={discardHandoff} />}
      {state.pane === "Conversation" && <Conversation key={state.thread} runtime={runtime} messages={messages} onOpenLink={onOpenLink} view={view} />}
      {state.pane === "Picker" && <Picker key="handoff" runtime={runtime} messages={messages} discardHandoff={discardHandoff} />}
      {state.pane === "New" && <Picker key={state.newDraft.visit} runtime={runtime} messages={messages} handoff={handoff} discardHandoff={discardHandoff} />}
    </section>
  );
}

function Threads({ runtime, messages: { state, can, send }, onBack, handoff, discardHandoff }: MessagesProps & HandoffProps & { messages: MessagesUI }) {
  const launcher = useCanvas(runtime).state?.launcher ?? false;
  const [draftOpening, setDraftOpening] = useState<"Opening" | "Failed">();
  const openingRef = useRef(false);
  if (!state) return null;
  const { searching } = state;
  const { threads, sought, names } = runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.get()));
  const query = state.sought ? sought : "";
  const now = runtime.runSync(Effect.flatMap(Time, (time) => time.latest()));
  const search = (typed: string) => {
    const event = { type: "search", typed: typed.trim() !== "" } as const;
    if (!can(event)) return;
    runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ sought: typed })));
    void send(event);
  };
  const open = (row: ThreadRow) => {
    clearChoice(runtime);
    const thread = runtime.runSync(Effect.flatMap(Conversations, (numbering) => numbering.of({ id: row.id, addresses: "incomplete" in row ? [] : row.addresses })));
    if (can({ type: "openThread", thread })) {
      discardHandoff();
      void send({ type: "openThread", thread });
    }
  };
  const openSearch = { type: "openSearch" } as const;
  const closeSearch = () => {
    runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ sought: "" })));
    void send({ type: "closeSearch" });
  };
  const allow = { type: "allow", need: "SmsAccess" } as const;
  const settings = { type: "goToSettings", need: "SmsAccess" } as const;
  const all = { type: "pickChip", chip: "AllThreads" } as const;
  const newMessage = { type: "newMessage" } as const;
  const handoffOpening = handoff?.phase === "Opening";
  const handoffFailed = handoff?.phase === "OpenFailed";
  const openNew = async () => {
    if (openingRef.current || handoffOpening || !can(newMessage)) return;
    if (handoff?.phase === "OpenFailed") {
      await runtime.runPromise(retryMessageHandoff(handoff)).catch(() => false);
      return;
    }
    openingRef.current = true;
    setDraftOpening("Opening");
    const opened = await runtime.runPromise(startNewMessage()).catch(() => false);
    openingRef.current = false;
    setDraftOpening(opened ? undefined : "Failed");
  };
  return (
    <>
      {searching ? (
        <header className={cn("flex h-13 shrink-0 items-center gap-0.5 px-2 in-data-[alpha-launcher]:h-14", messagesTop)} data-alpha-messages-search-header>
          {!launcher && <Button variant="ghost" size="icon" className="size-13 rounded-lg" aria-label="Back to messages" onClick={closeSearch}><ChevronLeft /></Button>}
          <div role="search" aria-label="Search messages" className="min-w-0 flex-1">
            <SearchField autoFocus keepClear aria-label="Search conversations" placeholder="Search conversations" value={query} onValueChange={search} clearLabel="Clear search" className="[&_button]:size-13 [&_button]:min-w-13 [&_button]:rounded-tile [&_input:focus-visible]:outline-none" />
          </div>
        </header>
      ) : (
        <AppHeader title="Messages" className={messagesHeader} data-alpha-messages-header="" data-alpha-stage-header=""
          leading={onBack && <Button variant="ghost" size="icon" className="rounded-lg" aria-label="Back to apps" onClick={onBack}><ChevronLeft /></Button>}>
          {can(openSearch) && <Button variant="ghost" size="icon" className="rounded-tile" aria-label="Search messages" data-alpha-messages-search onClick={() => { runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ sought: "" }))); void send(openSearch); }}><Search className="size-5" /></Button>}
          {can(newMessage) && <Button variant="ghost" size="icon" className="rounded-tile" aria-label="New message" data-alpha-messages-new disabled={draftOpening === "Opening" || handoffOpening} onClick={() => void openNew()}><Pencil className="size-5" /></Button>}
        </AppHeader>
      )}
      {(draftOpening === "Opening" || handoffOpening) && <p role="status" className={`${notice} px-3`}>Opening message draft…</p>}
      {(draftOpening === "Failed" || handoffFailed) && can(newMessage) && <Banner variant="warn" action={<Button size="sm" onClick={() => void openNew()}>Retry</Button>}>Message draft couldn’t be opened</Banner>}
      {smsNeeded(state) && (can(allow) || can(settings)) && (
        <div className="grid flex-1 place-items-center px-4">
          {can(allow) ? <button type="button" data-alpha-messages-allow className={accessPill} onClick={() => void send(allow)}>Allow SMS read access</button> : <button type="button" className={accessPill} onClick={() => void send(settings)}>Open Settings for SMS access</button>}
        </div>
      )}
      {!smsNeeded(state) && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 empty:hidden" role="group" aria-label="Filter conversations">
            {state.chip === "UnreadThreads" && <Chip onClear={can(all) ? () => void send(all) : undefined} clearLabel="Show all conversations" className="min-h-11 [&>button_svg]:size-3.5">Unread</Chip>}
            {!searching && state.sought && <Chip onClear={() => search("")} clearLabel="Clear the search" className="min-h-11 [&>button_svg]:size-3.5">{query}</Chip>}
          </div>
          <div data-alpha-messages-threads className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain py-1">
            {state.list.status === "Loading" && state.threads === 0 && <span role="status" className="sr-only">Reading conversations</span>}
            {threadsFailed(state) && <p role="status" className="mx-4 my-2">Conversations could not be read {can({ type: "retryThreads" }) && <button type="button" className={textLink} onClick={() => void send({ type: "retryThreads" })}>Retry</button>}</p>}
            {noThreads(state) && <p role="status" className="px-5 py-3 text-muted-foreground">No conversations</p>}
            {noMatches(state) && <p role="status" className="px-5 py-3 text-muted-foreground">No matches</p>}
            {state.threads > 0 && (
              <ul aria-label="Conversations">
                {threads.map((row) => {
                  const complete = "incomplete" in row ? undefined : row;
                  const title = complete ? titleOf(complete.addresses, names) || "Conversation" : "Conversation content unavailable";
                  return (
                    <li key={row.id}>
                      <button type="button" disabled={!can({ type: "openThread", thread: 1 })} aria-label={title} aria-description={complete?.unread ? "Unread" : undefined} onClick={() => open(row)} className={`${contactRow} min-h-17 items-start py-2.5`}>
                        <Avatar name={avatarName(title)} aria-hidden className="size-12 text-md font-bold" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
                          <span className="flex items-center gap-1.5">
                            {complete?.unread && <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />}
                            <span className={`min-w-0 flex-1 truncate text-md ${complete?.unread ? "font-bold" : "font-semibold"}`}>{title}</span>
                            <span className="shrink-0 text-sm text-muted-foreground">{shortWhen(row.date, now)}</span>
                          </span>
                          <span className={`block truncate text-base ${complete?.unread ? "text-foreground" : "text-muted-foreground"}`}>{complete?.snippet ?? "Use the system messaging app to view this conversation."}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {can({ type: "olderThreads" }) && <div className="grid place-items-center py-2"><Button size="icon" variant="secondary" aria-label="Older conversations" onClick={() => void send({ type: "olderThreads" })}><ChevronDown className="size-5" /></Button></div>}
          </div>
        </>
      )}
      <CommsBar runtime={runtime} closed={smsNeeded(state) ? undefined : (ask, talk) => (
        <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); ask(query.trim()); }}>
          <Input data-alpha-composer aria-label="Search or ask" placeholder="Search or ask" value={query} onChange={(event) => search(event.target.value)} className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent py-2.75 pr-0.5 pl-2 shadow-none focus-visible:outline-none" />
          {query.trim() !== "" ? <Button size="icon" variant="ghost" type="submit" aria-label="Ask Alpha"><ArrowUp /></Button>
            : talk && <Button size="icon" variant="ghost" type="button" aria-label="Talk" onClick={talk}><Mic /></Button>}
        </form>
      )} />
    </>
  );
}

/** Inline URL text, escaped by React. Whitespace and punctuation outside each URL are preserved. */
function MessageText({ text, onOpenLink }: { text: string; onOpenLink?: MessagesProps["onOpenLink"] }) {
  const parts = [];
  let consumed = 0;
  for (const matched of text.matchAll(messageURL)) {
    const found = matched[0];
    const offset = matched.index;
    if (offset === undefined) continue;
    const raw = found.replace(/[.,!?;:]+$/u, "").replace(/\)+$/u, (ending) => {
      const excess = (found.match(/\)/gu)?.length ?? 0) - (found.match(/\(/gu)?.length ?? 0);
      return ending.slice(0, Math.max(0, ending.length - Math.max(0, excess)));
    });
    const parsed = URL.parse(raw);
    if (!parsed?.hostname || parsed.username || parsed.password) continue;
    parts.push(text.slice(consumed, offset), (
      <a className="underline underline-offset-2" href={parsed.href} target="_blank" rel="noopener noreferrer" key={offset} onClick={onOpenLink ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenLink(parsed.href);
      } : undefined}>{raw}</a>
    ));
    consumed = offset + raw.length;
  }
  return <>{parts}{text.slice(consumed)}</>;
}

/** Develop's picture mark beside a picture message's label: a frame with a hill line, stroked. */
function PictureGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" />
    </svg>
  );
}

// spec/app/messages/index.md, "Story: Act on a message"
const Bubble = memo(function Bubble({ row, now, choose, actions, hold, onOpenLink }: { row: MessageRow; now: number; choose: (id: string, toggle?: boolean) => void; actions?: MessageActions | undefined; hold: (held: () => void) => () => void; onOpenLink?: MessagesProps["onOpenLink"] }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; cancel: () => void } | undefined>(undefined);
  const skipTapRef = useRef(false);
  const [keyboardMenu, setKeyboardMenu] = useState(false);
  const release = useCallback(() => {
    pointerRef.current?.cancel();
    pointerRef.current = undefined;
  }, []);
  const trigger = useCallback((node: HTMLDivElement | null) => {
    triggerRef.current = node;
    if (!node) return;
    return () => { release(); triggerRef.current = null; };
  }, [release]);
  const watchMenu = useCallback((node: HTMLDivElement | null) => {
    if (node && !actions?.covered) return watchMessageMenu(node, () => choose(""), { within: triggerRef.current, dismissOnSelection: false });
  }, [actions?.covered, choose]);
  const complete = "incomplete" in row ? undefined : row;
  const outgoing = complete?.direction === "outgoing";
  const failed = complete?.status === "failed";
  const status = !complete || !outgoing ? "" : failed ? "Not sent" : complete.status === "pending" ? "Sending…" : complete.kind === "sms" && complete.deliveryReport === "complete" ? "Delivered" : complete.status === "sent" ? "Sent" : "";
  const selectable = (event: MouseEvent) => !(event.target instanceof Element && event.target.closest("a")) && document.getSelection()?.isCollapsed !== false;
  const showActions = (toggle = false, keyboard = false) => {
    setKeyboardMenu(keyboard);
    choose(row.id, toggle);
  };
  const begin = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    release();
    skipTapRef.current = false;
    if (!selectable(event)) return;
    const { pointerId: id, clientX: x, clientY: y } = event;
    const cancel = hold(() => {
      if (pointerRef.current?.id !== id || document.getSelection()?.isCollapsed === false) return;
      skipTapRef.current = true;
      showActions();
    });
    pointerRef.current = { id, x, y, cancel };
  };
  const cancel = (event: PointerEvent) => {
    if (pointerRef.current?.id !== event.pointerId) return;
    skipTapRef.current = true;
    release();
  };
  const moved = (event: PointerEvent) => {
    const started = pointerRef.current;
    if (started && Math.hypot(event.clientX - started.x, event.clientY - started.y) > 12) cancel(event);
  };
  const label = complete ? complete.body || "Picture message" : "Use the system messaging app to view this message.";
  return (
    <div className={`flex max-w-[min(17.5rem,100%)] flex-col ${outgoing ? "items-end self-end" : "items-start self-start"}`}>
      <div ref={trigger} data-alpha-message-id={row.id} data-alpha-sms-outgoing={outgoing} role="button" tabIndex={0} aria-label={`Message actions: ${label}`} aria-haspopup="menu" aria-expanded={Boolean(actions)}
        className={cn(focusRing, "flex max-w-full flex-col gap-0.5 rounded-tile", outgoing ? "items-end" : "items-start")}
        onClick={(event) => {
          const suppressed = event.detail !== 0 && skipTapRef.current;
          skipTapRef.current = false;
          if (!suppressed && selectable(event)) showActions(true, event.detail === 0);
        }}
        onContextMenu={(event) => {
          if (!selectable(event)) return;
          event.preventDefault();
          release();
          skipTapRef.current = true;
          showActions();
        }}
        onPointerDown={begin}
        onPointerMove={moved}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onPointerUp={(event) => { if (pointerRef.current?.id === event.pointerId) release(); }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showActions(true, true);
          }
        }}>
        {!complete ? <p data-alpha-message-body className="rounded-tile bg-secondary px-4 py-2.75 text-body leading-detail text-muted-foreground">{label}</p> : (
          <>
            {complete.attachments > 0 && <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><PictureGlyph />{complete.attachments === 1 ? "Picture" : `${complete.attachments} pictures`}</span>}
            {complete.body && <p data-alpha-message-body className={`rounded-tile px-4 py-2.75 text-body leading-detail whitespace-pre-wrap wrap-anywhere ${outgoing ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground"}`}><MessageText text={complete.body} onOpenLink={onOpenLink} /></p>}
          </>
        )}
        <span data-alpha-message-meta title={new Date(row.date).toLocaleString()} className="px-1.5 text-2xs text-muted-foreground">{[stamp(row.date, now), status].filter(Boolean).join(" · ")}</span>
        {failed && <CircleAlert className="size-4 text-hangup" role="img" aria-label="Message failed" />}
      </div>
      {actions && <MessageActionMenu ref={watchMenu} actions={actions} focusOnOpen={keyboardMenu} close={() => { choose(""); triggerRef.current?.focus({ preventScroll: true }); }} />}
    </div>
  );
});

/** One conversation: provider rows, their actions, and the draft belonging to this exact thread. */
function Conversation({ runtime, messages: { state, can, send }, onOpenLink, view }: MessagesProps & { messages: MessagesUI; view: HTMLElement | null }) {
  const phone = usePhone(runtime).state;
  const [selected, setSelected] = useState("");
  const cancelFocusRef = useRef<{ id: string; element: HTMLElement } | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearEndRef = useRef(true);
  const earlierAnchorRef = useRef<{ height: number; top: number; oldestId: string | undefined } | null>(null);
  const held = runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.get()));
  const now = runtime.runSync(Effect.flatMap(Time, (time) => time.latest()));
  const rows = state?.shown.rows && held.messagesThread === state.thread ? held.messages : noMessages;
  const chronological = rows.toReversed();
  const oldest = chronological[0]?.id;
  const latest = rows[0]?.id;
  const anchor = useCallback((element: HTMLDivElement | null) => {
    const viewport = scrollRef.current;
    if (!element || !viewport) return;
    const saved = earlierAnchorRef.current;
    if (saved && element.dataset.oldest !== (saved.oldestId ?? "")) {
      earlierAnchorRef.current = null;
      viewport.scrollTop = saved.top + (viewport.scrollHeight - saved.height);
      return;
    }
    if (nearEndRef.current) viewport.scrollTop = viewport.scrollHeight;
  }, []);
  const viewport = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    if (!element || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(() => {
      const saved = earlierAnchorRef.current;
      if (saved && element.scrollHeight !== saved.height) {
        earlierAnchorRef.current = null;
        element.scrollTop = saved.top + (element.scrollHeight - saved.height);
        return;
      }
      if (nearEndRef.current) element.scrollTop = element.scrollHeight;
    });
    resize.observe(element);
    const log = element.querySelector('[role="log"]');
    if (log) resize.observe(log);
    return () => { resize.disconnect(); scrollRef.current = null; };
  }, []);
  const choose = useCallback((id: string, toggle = false) => {
    const next = runtime.runSync(Effect.flatMap(Inbox, (inbox) => Effect.flatMap(inbox.get(), ({ chosen }) => {
      const picked = toggle && chosen === id ? "" : id;
      return picked === chosen ? Effect.succeed(picked) : Effect.as(inbox.set({ chosen: picked, copyRequest: undefined }), picked);
    })));
    setSelected(next);
  }, [runtime]);
  const hold = useCallback((held: () => void) => {
    const fiber = runtime.runFork(commsHeld(held));
    return () => fiber.interruptUnsafe();
  }, [runtime]);
  if (!state || !phone) return null;
  const conversation = runtime.runSync(Effect.flatMap(Conversations, (numbering) => numbering.get(state.thread)));
  const conversationId = conversation._tag === "Some" ? conversation.value.id : "";
  const addresses = conversation._tag === "Some" ? conversation.value.addresses : [];
  const title = titleOf(addresses, held.names) || "Conversation";
  const selectedRow = rows.find((row) => row.id === selected);
  const confirm = { type: "confirmDelete", clear: clear(phone) } as const;
  const keep = { type: "keep" } as const;
  const cancelDelete = () => {
    if (!can(keep)) return;
    const trigger = Array.from(view?.querySelectorAll<HTMLElement>("[data-alpha-message-id]") ?? []).find((node) => node.dataset.alphaMessageId === selected);
    cancelFocusRef.current = trigger ? { id: selected, element: trigger } : undefined;
    void send(keep);
  };
  const focusAfterCancel = (event: Event) => {
    const focused = cancelFocusRef.current;
    cancelFocusRef.current = undefined;
    if (!focused?.element.isConnected) return;
    const current = runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.get()));
    if (current.chosen !== focused.id || current.messagesThread !== state.thread) return;
    event.preventDefault();
    choose("");
    focused.element.focus({ preventScroll: true });
  };
  const actions = selectedRow && !("incomplete" in selectedRow) && content(state) ? state.confirming ? {
    covered: true,
    copy: selectedRow.body ? (report: CopyReport) => report(undefined) : undefined,
    remove: () => undefined,
  } : {
    copy: selectedRow.body && can({ type: "copy" }) ? (report: CopyReport) => {
      runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ copyRequest: { row: selectedRow, report } })));
      void send({ type: "copy" }).then((result) => { if (result._tag !== "Success") report("failed"); });
    } : undefined,
    remove: state.smsApp && state.removal.outcome !== "Unknown" && can({ type: "askDelete" }) ? () => {
      const { id, kind, threadId, date } = selectedRow;
      runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ deleteTarget: { id, kind, threadId, date } })));
      void send({ type: "askDelete" });
    } : undefined,
  } : undefined;
  return (
    <>
      <header className={`${header} pb-2`} data-alpha-navigation-header data-alpha-stage-header>
        {(can({ type: "back" }) || state.confirming) && <Button variant="ghost" size="icon" aria-label="Back" onClick={() => { clearChoice(runtime); void send({ type: "back" }); }}><ChevronLeft /></Button>}
        <Avatar name={avatarName(title)} aria-hidden size="sm" data-alpha-stage-avatar className="text-caption font-bold group-data-[sheet=closed]/messages:size-9" />
        <h1 data-alpha-messages-title className="min-w-0 flex-1 truncate pl-1.5 text-lg font-bold">{title}</h1>
        {addresses.length === 1 && (can({ type: "call" }) || state.confirming) && <Button variant="ghost" size="icon" aria-label={`Call ${title}`} onClick={() => void send({ type: "call" })}><Call /></Button>}
      </header>
      <div ref={viewport} data-alpha-messages-thread className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-3.5" onScroll={(event) => {
        const viewport = event.currentTarget;
        nearEndRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 64;
      }}>
        <div className="flex min-h-full flex-col gap-1.5">
          {state.page.status === "Loading" && state.shown.rows === 0 && <span role="status" className="sr-only">Reading the conversation</span>}
          {state.page.status === "Failed" && <p role="status" className="my-2">The conversation could not be read</p>}
          {can({ type: "earlierMessages" }) && <Button className="self-center" size="icon" variant="secondary" aria-label="Older messages" onClick={() => {
            if (scrollRef.current) earlierAnchorRef.current = { height: scrollRef.current.scrollHeight, top: scrollRef.current.scrollTop, oldestId: oldest };
            void send({ type: "earlierMessages" });
          }}><ChevronUp className="size-5" /></Button>}
          <div role="log" aria-label="Messages" className="mt-auto flex flex-col gap-1.5">
            {chronological.map((row) => <Bubble key={row.id} row={row} now={now} choose={choose} hold={hold} actions={row.id === selected && (actions?.copy || actions?.remove) ? actions : undefined} onOpenLink={onOpenLink} />)}
          </div>
          {selectedRow && "incomplete" in selectedRow && can({ type: "openElsewhere" }) && <Button size="sm" variant="outline" className="self-start" onClick={() => void send({ type: "openElsewhere" })}>Open in messaging app</Button>}
          <div key={`${latest ?? ""}:${oldest ?? ""}`} data-oldest={oldest ?? ""} ref={latest ? anchor : undefined} aria-hidden />
        </div>
      </div>
      {state.removal.outcome === "Unknown" && <p role="status" className={`${notice} px-3`}>Alpha cannot tell whether the message was deleted</p>}
      {state.removal.outcome === "Refused" && held.deleteTarget && conversationId !== "" && held.deleteTarget.threadId === conversationId && <p role="status" className={`${notice} px-3`}>The message was not deleted</p>}
      <DeleteMessageDialog open={state.confirming} container={view}
        onCancel={cancelDelete}
        onDelete={() => {
          if (!selectedRow || "incomplete" in selectedRow || !can(confirm)) return;
          choose("");
          void send(confirm);
        }}
        onCloseAutoFocus={focusAfterCancel} />
      <Compose runtime={runtime} title={title} addresses={addresses} thread={state.thread} />
    </>
  );
}

/** The thread's one person-target input, or its complete draft while the Alpha sheet is up. */
function Compose({ runtime, title, addresses, thread }: MessagesProps & { title: string; addresses: ReadonlyArray<string>; thread: number }) {
  const composer = useComposer(runtime);
  const phone = usePhone(runtime).state;
  const dock = useCommsDock(runtime);
  const voice = useVoice(runtime);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const picturesInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef(false);
  const subscriptionChoice = useMemo(() => runtime.runSync(Effect.map(Drafts, (drafts) => drafts.subscriptionChoice)), [runtime]);
  const simChoice = useSyncExternalStore(subscriptionChoice.subscribe, subscriptionChoice.get, subscriptionChoice.get);
  const simControls = useCallback((node: HTMLDivElement | null) => {
    if (node) return () => subscriptionChoice.leave(thread);
  }, [subscriptionChoice, thread]);
  const selectedSim = simChoice?.thread === thread ? simChoice.subscription : undefined;
  const { state, can, send } = composer;
  if (!state || !phone || addresses.length === 0) return <CommsBar runtime={runtime} />;
  if (state.thread !== thread) return <>
    {state.thread === 0 && <button type="button" className={`${textLink} mx-4`} onClick={() => void runtime.runPromise(openMessageDraft(thread))}>Open saved draft</button>}
    {state.saveFailed && can({ type: "retrySave" }) && <Banner variant="warn" action={<Button size="sm" onClick={() => void send({ type: "retrySave" })}>Retry save</Button>}>Your previous message draft couldn’t be saved</Banner>}
    {state.slot.draft.sync === "Conflicted" && <Banner variant="warn" action={<>
      {can({ type: "keepMine" }) && <Button size="sm" onClick={() => void send({ type: "keepMine" })}>Keep mine</Button>}
      {can({ type: "takeSaved" }) && <Button size="sm" variant="outline" onClick={() => void runtime.runPromise(takeSavedMessageDraft(state.thread))}>Use the saved draft</Button>}
    </>}>Your previous message draft has a conflict</Banner>}
    <CommsBar runtime={runtime} />
  </>;
  const person = { label: title, initials: callerInitials(title) };
  const text = state.slot.author === "Nobody" ? "" : runtime.runSync(Effect.flatMap(Drafts, (drafts) => drafts.text(thread)));
  const pictures = runtime.runSync(Effect.flatMap(Drafts, (drafts) => drafts.pictures(thread)));
  const subscriptions = runtime.runSync(Effect.flatMap(Drafts, (drafts) => drafts.subscriptions()));
  const write = (next: string) => {
    const event = { type: "typeText", empty: next.length === 0 } as const;
    if (!can(event)) return;
    void runtime.runPromise(writeMessageDraft(thread, next));
  };
  const outgoing = state.outgoing;
  const here = outgoing.thread === thread;
  const checking = here && uncertain(outgoing);
  const sendNow = { type: "send", supported: runtime.runSync(supported(state.recipients, pictures.length)), clear: clear(phone) } as const;
  const simReady = selectedSim === undefined ? state.sims <= 1 : subscriptions.some((sim) => sameSubscription(sim, selectedSim));
  const sendable = (checking || simReady && (Boolean(text.trim()) || pictures.length > 0) && text.length <= MMS_MAX_BODY) && can(sendNow);
  const submit = (event: MouseEvent<HTMLButtonElement>) => {
    if (!sendable) return;
    const trustedTap = event.nativeEvent.isTrusted && event.currentTarget.matches("[data-alpha-bar-send],[data-alpha-draft-send]");
    if (!checking && !runtime.runSync(prepare(thread, selectedSim, trustedTap))) return;
    void send(sendNow);
  };
  const edit = () => {
    if (!can({ type: "typeText", empty: false })) return;
    write(text);
    if (!dock.open) { fieldRef.current?.focus(); return; }
    focusRef.current = true;
    dock.close();
  };
  const sendLabel = checking ? "Check send status" : "Send";
  const alpha = state.slot.author === "AlphaWrote";
  const recipients = addresses.join(", ");
  const addressed = title === addresses.map(displayNumber).join(", ") ? recipients : `${title} · ${recipients}`;
  const draft = text && (alpha || dock.open);
  const editable = can({ type: "typeText", empty: text.length === 0 });
  const attachment = { type: "attach", fits: true } as const;
  const canPicture = runtime.runSync(supported(state.recipients, 1)) && can(attachment);
  const canSuggest = can({ type: "suggest" });
  const handoff = { type: "handOff", supported: sendNow.supported } as const;
  const recorder = voice.state?.recorder;
  const recording = recorder?.field === "MessagesBar" && recorder.stage !== "Closed";
  const stop = { type: "stopRecording", now: untimed } as const;
  const discard = { type: "closeRecorder" } as const;
  const retry = { type: "transcribeAgain", now: untimed } as const;
  const messageForm = recording ? (
    <div data-alpha-composer data-alpha-bar-recorder="" aria-label="Message dictation" role="group" className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1"><span role="status" className="sr-only">{recorder.stage === "Recording" ? "Recording" : recorder.stage === "Recorded" ? "Couldn’t transcribe" : recorder.stage === "Transcribing" ? "Transcribing" : "Starting microphone"}</span></span>
      {voice.can(retry) && <Button variant="ghost" size="icon" aria-label="Try transcription again" onClick={() => void voice.send(retry)}><RefreshCw /></Button>}
      {voice.can(discard) && <Button variant="ghost" size="icon" aria-label="Discard transcription" onClick={() => void voice.send(discard)}><X /></Button>}
      {voice.can(stop) && <Button size="icon" aria-label="Stop recording" onClick={() => void voice.send(stop)}><Square fill="currentColor" /></Button>}
    </div>
  ) : (
    <div data-alpha-composer data-alpha-messages-composer className="flex min-w-0 flex-1 items-center gap-1">
      <MessageAttachmentsMenu media={canPicture ? {
        camera: () => cameraInputRef.current?.click(),
        files: () => picturesInputRef.current?.click(),
      } : undefined} onSuggest={canSuggest ? () => void send({ type: "suggest" }) : undefined} />
      <Textarea className="max-h-[min(10.5rem,28dvh)] min-h-11 min-w-0 flex-1 overflow-y-auto rounded-none border-0 bg-transparent py-2.75 pr-0.5 pl-2 leading-field shadow-none focus-visible:outline-none" aria-label={`Text ${firstName(title)}`} placeholder={`Text ${firstName(title)}`} rows={1} value={text} maxLength={MMS_MAX_BODY} readOnly={!editable}
        ref={(element) => {
          fieldRef.current = element;
          if (element && focusRef.current) { focusRef.current = false; element.focus(); }
        }}
        onChange={(event) => write(event.target.value)} />
      {([["Attach a picture", picturesInputRef, false], ["Take a picture", cameraInputRef, true]] as const).map(([label, input, camera]) => (
        <Input key={label} ref={input} hidden className="hidden" type="file" aria-label={label} multiple={!camera} capture={camera ? "environment" : undefined} accept={MMS_ATTACHMENT_TYPES.join(",")} disabled={!canPicture} onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) void runtime.runPromise(attachAll(files));
        }} />
      ))}
      {sendable && <Button size="icon" aria-label={sendLabel} data-alpha-bar-send onClick={submit}>{checking ? <RefreshCw /> : <ArrowUp />}</Button>}
      {editable && !liveCall(phone) && voice.can({ type: "openRecorder", target: "MessagesBar" }) && <Button variant="ghost" size="icon" aria-label={`Dictate a text to ${firstName(title)}`} onClick={() => void runtime.runPromise(dictateMessage(thread))}><Mic /></Button>}
    </div>
  );
  return (
    <>
      {draft && (
        <div data-alpha-draft-bubble={alpha ? "alpha" : "owner"} role="group" aria-label={alpha ? `Message draft to ${addressed}` : "Your draft, not sent"}
          className={`mx-3 my-2 flex max-h-[55%] max-w-[84%] min-h-0 shrink flex-col gap-2 self-end overflow-y-auto rounded-xl rounded-br-box border-[1.5px] border-dashed px-3.5 py-2.5 wrap-anywhere text-foreground ${alpha ? "border-alpha bg-background" : "border-muted-foreground bg-secondary"}`}>
          <span aria-hidden className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {alpha && <span className="inline-flex size-4.5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-alpha text-alpha-foreground"><Mark aria-hidden className="size-[118%]" /></span>}
            {alpha ? `To ${addressed}` : "Your draft"}
          </span>
          <p className="text-body leading-detail whitespace-pre-wrap">{text}</p>
          <div className="sticky bottom-0 flex shrink-0 flex-wrap justify-end gap-2 bg-inherit">
            {can({ type: "undo" }) && <button type="button" className={`${draftAction} px-3`} onClick={() => void runtime.runPromise(discardMessageDraft(thread))}>Don’t send</button>}
            {editable && <button type="button" className={`${draftAction} px-4 inset-ring-[1.5px] inset-ring-muted-foreground`} data-alpha-draft-edit onClick={edit}>Edit</button>}
            {dock.open && <button type="button" className={`${draftAction} bg-alpha px-4.5 font-semibold text-alpha-foreground disabled:opacity-50`} data-alpha-draft-send disabled={!sendable} onClick={submit}>{sendLabel}</button>}
          </div>
        </div>
      )}
      <div ref={simControls} data-alpha-messages-accessories className={cn("flex max-h-[34%] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-y-auto px-3 text-caption text-muted-foreground empty:hidden", pictures.length > 0 && "pb-1.5")}>
        {state.slot.draft.sync === "Conflicted" && (
          <Banner variant="warn" action={<>
            {can({ type: "keepMine" }) && <Button size="sm" onClick={() => void send({ type: "keepMine" })}>Keep mine</Button>}
            {can({ type: "takeSaved" }) && <Button size="sm" variant="outline" onClick={() => void runtime.runPromise(takeSavedMessageDraft(thread))}>Use the saved draft</Button>}
          </>}>Another draft was saved for this conversation</Banner>
        )}
        {state.saveFailed && <Banner variant="warn" action={can({ type: "retrySave" }) && <Button size="sm" onClick={() => void send({ type: "retrySave" })}>Retry save</Button>}>Message draft couldn’t be saved</Banner>}
        {state.pendingClear.source === "ConversationDraft" && state.pendingClear.thread === thread && can({ type: "clearSentDraft" }) && <button type="button" className={textLink} onClick={() => void send({ type: "clearSentDraft" })}>Finish updating the saved draft</button>}
        {checking && <p role="status" data-alpha-messages-notice className={notice}>Alpha is still waiting for the send result</p>}
        {here && outgoing.denied && <p role="status" data-alpha-messages-notice className={notice}>The phone did not send the message</p>}
        {here && outgoing.op.outcome === "Refused" && !outgoing.denied && outgoing.failed > 0 && <p role="status" data-alpha-messages-notice className={notice}>The message did not reach everyone</p>}
        {here && (outgoing.denied || outgoing.op.outcome === "Refused" && outgoing.failed > 0) && <CircleAlert className="mx-2 size-4 text-hangup" role="img" aria-label="Message failed" />}
        {here && sentAll(outgoing) && <p role="status" data-alpha-messages-notice className={notice}>{`${delivered(outgoing) ? "Delivered" : "Sent"} to ${title}`}</p>}
        {pictures.map((picture, at) => (
          <MessagePictureChip key={picture.name} name={picture.name} disabled={!can({ type: "detach" })} onRemove={() => {
            if (!can({ type: "detach" })) return;
            void runtime.runPromise(removeMessagePicture(thread, at));
          }} />
        ))}
        {(subscriptions.length > 1 || selectedSim !== undefined && subscriptions.length === 1) && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="SIM">
            {subscriptions.map((subscription, at) => {
              const pick = { type: "pickSim", sim: at + 1 } as const;
              const canPick = can(pick);
              const samePosition = state.simInfo.grant === "Granted" && (state.sim === pick.sim || state.sims === 1);
              const picked = selectedSim !== undefined && sameSubscription(subscription, selectedSim);
              return <button type="button" key={subscription.id} aria-pressed={picked} disabled={!canPick && !samePosition} className={`${accessoryChip} px-3.5 ${picked ? "bg-foreground text-background" : "bg-secondary text-foreground"}`}
                onClick={() => {
                  if (!canPick && !samePosition) return;
                  subscriptionChoice.pick(thread, subscription);
                  if (canPick) void send(pick);
                }}>{subscription.displayName || `SIM ${subscription.slot + 1}`}</button>;
            })}
          </div>
        )}
        {(["SendAccess", "SimAccess"] as const).map((need) => {
          const right = need === "SendAccess" ? "SMS send" : "SIM";
          if (need === "SimAccess" && state.sims <= 1) return null;
          const allow = { type: "allow", need } as const;
          const settings = { type: "goToSettings", need } as const;
          if (can(allow)) return <button type="button" key={need} className={textLink} onClick={() => void send(allow)}>{`Allow ${right} access`}</button>;
          if (can(settings)) return <button type="button" key={need} className={textLink} onClick={() => void send(settings)}>{`Open Settings for ${right} access`}</button>;
          return null;
        })}
        {can(handoff) && <button type="button" className={textLink} onClick={() => void send(handoff)}>{pictures.length > 0 ? "Review text in messaging app" : "Review in messaging app"}</button>}
      </div>
      <CommsBar runtime={runtime} person={person} closed={messageForm} />
    </>
  );
}

type NewTextEdit = {
  readonly body?: string | undefined;
  readonly to?: { readonly value: string; readonly closePicker: boolean } | undefined;
};

type NewTextSave = { readonly status: "Saving" | "Failed"; readonly edit: NewTextEdit };

/** A recipient choice either addresses the separate New draft or completes an existing handoff. */
function Picker({ runtime, messages: { state, can, send }, handoff, discardHandoff }: MessagesProps & HandoffProps & { messages: MessagesUI }) {
  const composer = useComposer(runtime);
  const [typed, setTyped] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [textSave, setTextSave] = useState<NewTextSave>();
  const latestTextSaveRef = useRef<NewTextSave | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [composingHeight, setComposingHeight] = useState<number>();
  const prefill = state?.pane === "New" && handoff !== undefined && "visit" in handoff && handoff.visit === state.newDraft.visit ? handoff : undefined;
  const textIsSaved = useCallback(() => latestTextSaveRef.current === undefined && prefill === undefined, [prefill]);
  const showSave = (next: NewTextSave | undefined) => {
    latestTextSaveRef.current = next;
    setTextSave(next);
  };
  // spec/app/messages/index.md, "The owner can write before choosing To, then adjust To without moving or losing the message"
  const flushText = async (visit: number) => {
    let saving = latestTextSaveRef.current;
    while (saving?.status === "Saving") {
      const { body, to } = saving.edit;
      const edit = { ...(body === undefined ? {} : { body }), ...(to === undefined ? {} : { recipients: to.value }) };
      const saved = await runtime.runPromise(editNewMessage(visit, edit, to?.closePicker ?? false)).catch(() => false);
      const latest = latestTextSaveRef.current;
      if (latest === undefined) return;
      if (!saved) {
        showSave({ ...latest, status: "Failed" });
        return;
      }
      if (to?.closePicker) setTyped("");
      const remaining = { body: latest.edit.body === body ? undefined : latest.edit.body, to: latest.edit.to === to ? undefined : latest.edit.to };
      saving = remaining.body === undefined && remaining.to === undefined ? undefined : { status: "Saving", edit: remaining };
      showSave(saving);
    }
  };
  const saveText = (visit: number, edit: NewTextEdit) => {
    const previous = latestTextSaveRef.current;
    showSave({ status: "Saving", edit: { ...previous?.edit, ...edit } });
    if (previous?.status !== "Saving") void flushText(visit);
  };
  if (!state) return null;
  const fresh = state.pane === "New" ? state.newDraft : undefined;
  const editable = !fresh || !composer.state || !newDraftHeld(composer.state, fresh.revision);
  const kept = fresh && runtime.runSync(Effect.flatMap(Drafts, (drafts) => drafts.newDraft()));
  const selecting = fresh?.picking ?? browsing;
  const draftTo = textSave?.edit.to?.value ?? prefill?.address ?? kept?.recipients ?? "";
  const savingChoice = textSave?.status === "Saving" && textSave.edit.to?.closePicker === true;
  const typedTo = kept && !selecting ? draftTo : typed;
  const before = kept ? messageRecipients(draftTo) : [];
  const held = runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.get()));
  const query = (text: string) => {
    runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ typed: text.split(",").at(-1)?.trim() ?? "" })));
    if (can({ type: "findChoices" })) void send({ type: "findChoices" });
  };
  const find = (text: string) => {
    if (fresh && !selecting) {
      if (prefill !== undefined) discardHandoff();
      saveText(fresh.visit, { to: { value: text, closePicker: false } });
    }
    else setTyped(text);
    query(text);
  };
  const open = (addresses: ReadonlyArray<string>, typedIn: boolean) => {
    if (fresh) {
      if (!editable || (latestTextSaveRef.current?.status === "Saving" && latestTextSaveRef.current.edit.to?.closePicker)) return;
      const previous = selecting ? before : messageRecipients(typedTo.split(",").slice(0, -1).join(","));
      const recipients = [...new Set([...previous, ...addresses])].join(", ");
      if (prefill !== undefined) discardHandoff();
      saveText(fresh.visit, { to: { value: recipients, closePicker: true } });
      return;
    }
    clearChoice(runtime);
    const thread = runtime.runSync(Effect.flatMap(Conversations, (numbering) => numbering.of({ id: "", addresses })));
    const event = { type: state.offeredPicture > 0 ? "choosePictureRecipient" : "choose", thread, typed: typedIn } as const;
    if (can(event)) void send(event);
  };
  const offer = state.offeredPicture > 0 ? runtime.runSync(Effect.flatMap(Drafts, (drafts) => drafts.offeredPicture())) : undefined;
  const to = typedTo.split(",").map((part) => part.trim());
  const numbers = messageRecipients(typedTo);
  const showChoices = !fresh || selecting || fresh.recipient === 0;
  const togglePicker = () => {
    if (!fresh) setBrowsing(!browsing);
    else if (selecting) {
      if (numbers.length > 0) open(numbers, true);
      else { setTyped(""); void send({ type: "back" }); }
    } else {
      const event = { type: "openNewContacts", visit: fresh.visit } as const;
      if (!can(event)) return;
      setComposingHeight(messageRef.current?.offsetHeight);
      setTyped("");
      runtime.runSync(Effect.flatMap(Inbox, (inbox) => inbox.set({ typed: "" })));
      void send(event);
    }
    inputRef.current?.focus();
  };
  const allow = { type: "allow", need: "ContactsAccess" } as const;
  const settings = { type: "goToSettings", need: "ContactsAccess" } as const;
  return (
    <>
      <header data-alpha-navigation-header className={`${header} pr-4 pb-2`}>
        {can({ type: "back" }) && <Button variant="ghost" size="icon" aria-label="Back" disabled={textSave?.status === "Saving"} onClick={() => void send({ type: "back" })}><ChevronLeft /></Button>}
        <form className="min-w-0 flex-1" onSubmit={(event) => {
          event.preventDefault();
          if (numbers.length > 0 && (!fresh || selecting)) open(numbers, true);
          else if (fresh && selecting) query(typedTo);
        }}>
          <Input ref={inputRef} type="text" aria-label="To" placeholder={selecting ? `Recipient ${fresh ? before.length + 1 : to.slice(0, -1).filter(Boolean).length + 1}` : "To"} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={230}
            data-alpha-messages-recipients value={typedTo} readOnly={!editable || savingChoice} onChange={(event) => find(event.target.value)} className="h-11 rounded-tile border-0 px-4 text-body leading-normal focus-visible:outline-none" />
        </form>
        <Button variant="ghost" size="icon" aria-label={selecting ? "Close contact picker" : "Choose contacts"} aria-expanded={selecting} disabled={savingChoice || !editable && !selecting} onClick={togglePicker}><Plus /></Button>
      </header>
      {offer?.ticket === state.offeredPicture && (
        <div aria-label="Picture for this message" className="flex px-5 py-2">
          <Chip clearLabel={`Remove ${offer.picture.name}`} onClear={can({ type: "clearPictureOffer", ticket: offer.ticket }) ? () => void send({ type: "clearPictureOffer", ticket: offer.ticket }) : undefined}>
            <PictureIcon aria-hidden />{offer.picture.name}
          </Chip>
        </div>
      )}
      <div data-alpha-messages-picks className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-2">
        {!fresh && numbers.length > 0 && <div className="px-5 py-1"><Button variant="outline" disabled={!can({ type: state.offeredPicture > 0 ? "choosePictureRecipient" : "choose", thread: 1, typed: true })} onClick={() => open(numbers, true)}>{numbers.length === 1 ? `Text ${numbers[0]}` : `Text ${numbers.length} recipients`}</Button></div>}
        {state.picker.status === "Loading" && <p role="status" className="mx-4 my-2 text-muted-foreground">Checking Contacts</p>}
        {state.picker.status === "Failed" && can({ type: "findChoices" }) && <p role="status" className="mx-4 my-2 text-muted-foreground">Contacts could not be read <button type="button" className={textLink} onClick={() => void send({ type: "findChoices" })}>Retry</button></p>}
        {can(allow) && <button type="button" className={`${textLink} mx-4`} onClick={() => void send(allow)}>Allow Contacts access</button>}
        {can(settings) && <button type="button" className={`${textLink} mx-4`} onClick={() => void send(settings)}>Open Settings for Contacts access</button>}
        {state.choices > 0 && showChoices && (
          <ul aria-label="Contacts" data-alpha-messages-contact-picker={selecting || undefined}>
            {held.choices.flatMap((contact) => contact.phones.filter((phone) => !fresh || !before.some((number) => number === phone)).map((phone) => (
              <li key={`${contact.id}:${phone}`}>
                <button type="button" className={contactRow} aria-label={contact.name} aria-description={phone} disabled={savingChoice || (!fresh && to.length === 1 && !can({ type: state.offeredPicture > 0 ? "choosePictureRecipient" : "choose", thread: 1, typed: false }))} onClick={() => {
                  if (fresh || to.length === 1) { open([phone], false); return; }
                  find([...to.slice(0, -1), phone].join(", "));
                }}>
                  <Avatar name={contact.name} aria-hidden className="size-11 text-base font-bold" />
                  <span className="min-w-0 flex-1 truncate text-md font-semibold">{contact.name}</span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{displayNumber(phone)}</span>
                </button>
              </li>
            )))}
          </ul>
        )}
        {showChoices && can({ type: "loadMoreChoices" }) && <button type="button" className={`${textLink} mx-4`} onClick={() => void send({ type: "loadMoreChoices" })}>More contacts</button>}
      </div>
      {fresh && kept ? <NewMessageDock runtime={runtime} scope={fresh} contactsAllowed={state.book.grant === "Granted"} draft={kept} textarea={messageRef}
        minHeight={selecting ? composingHeight : undefined}
        body={textSave?.edit.body ?? kept.body} saveStatus={textSave?.status ?? (prefill?.phase === "Saving" ? "Saving" : prefill?.phase === "SaveFailed" ? "Failed" : undefined)} textIsSaved={textIsSaved}
        onBody={(body) => { setComposingHeight(undefined); saveText(fresh.visit, { body }); }}
        onRetrySave={() => {
          if (textSave?.status === "Failed") saveText(fresh.visit, {});
          else if (prefill?.phase === "SaveFailed") void runtime.runPromise(retryMessageHandoff(prefill)).catch(() => false);
        }} /> : <CommsBar runtime={runtime} />}
    </>
  );
}
