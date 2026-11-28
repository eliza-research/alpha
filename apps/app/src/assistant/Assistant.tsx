// spec/app/assistant/index.md, "Story: Ask Alpha something"; spec/app/assistant/index.md, "Story: Stop a reply"; spec/app/assistant/chats.md, "Story: Find my conversations"; spec/app/assistant/composer.md, "Story: Send what I wrote"; spec/app/assistant/dock.md, "Focusing the composer on the bar raises Ask Alpha to typing"; spec/app/assistant/dock.md, "Sending from the bar opens the sheet, where the reply shows"; spec/app/assistant/dock.md, "Story: Drag Ask Alpha where I want it"; spec/app/assistant/dock.md, "Inside an app other than the Browser, Ask Alpha at rest is the pill; Type raises it to typing, where the whole bar shows, and a swipe up from it opens the sheet"; spec/app/assistant/search.md, "Story: Search my conversations"; spec/app/assistant/reply.md, "Story: Hear a brief acknowledgment and still get the whole answer"; spec/app/assistant/reply.md, "A recognized tool block outside a fence becomes its card; inside a fence every line stays code"
import {
  Alert, AssistantCard, AssistantCardFrame, AssistantDeviceReceipt, Button, AssistantConversation, AssistantGrabber, AssistantMessageDraftCard, AssistantNoticeCard, AssistantPhotoPreview, ConfirmDialog, Sheet, SheetContent, SmsReviewCard, Textarea,
  type AssistantAttachment, type AssistantComposerProps, type AssistantPull, type AssistantDraftNoticeProps, type AssistantMessageProps, type AssistantTranscriptProps, type AssistantTurnNoteProps,
} from "@repo/ui";
import { Effect, Option, type ManagedRuntime } from "effect";
import type * as KeyValueStore from "effect/persistence/KeyValueStore";
import { FileText, FileWarning } from "lucide-react";
import { type FormEvent, type ReactNode, type RefObject, useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Conversation as Talking, Machine as ConversationMachine } from "../../gen/app__assistant.effect.vibe";
import { askable, inFlight, pending } from "../../gen/app__assistant.ts";
import { useMachine as useConversation } from "../../gen/app__assistant.react.ts";
import { Machine as AttachmentMachine, canOpenPicker } from "../../gen/app__assistant__attachments.effect.vibe";
import { useMachine as useAttachments } from "../../gen/app__assistant__attachments.react.ts";
import type { Machine as ChatsMachine } from "../../gen/app__assistant__chats.effect.vibe";
import { loading as pageLoading } from "../../gen/app__assistant__chats.ts";
import { useMachine as useCards } from "../../gen/app__assistant__cards.react.ts";
import { offerShown } from "../../gen/app__assistant__cards.ts";
import { useMachine as useChats } from "../../gen/app__assistant__chats.react.ts";
import { type Composer as Writing, type Event as ComposerEvent, Machine as ComposerMachine } from "../../gen/app__assistant__composer.effect.vibe";
import { enabled as composerAllows, maxFiles, textLimit } from "../../gen/app__assistant__composer.ts";
import { useMachine as useComposer } from "../../gen/app__assistant__composer.react.ts";
import type { Machine as DockMachine } from "../../gen/app__assistant__dock.effect.vibe";
import { browserFieldPull, composerLift, isOpen as dockOpen, pill as dockPill, sent as dockSent, touched as dockTouched } from "../../gen/app__assistant__dock.ts";
import { useMachine as useDock } from "../../gen/app__assistant__dock.react.ts";
import type { Machine as ReplyMachine } from "../../gen/app__assistant__reply.effect.vibe";
import { live as replyLive, liveAddsToHistory } from "../../gen/app__assistant__reply.ts";
import { useMachine as useReply } from "../../gen/app__assistant__reply.react.ts";
import type { Machine as SearchMachine } from "../../gen/app__assistant__search.effect.vibe";
import { useMachine as useSearch } from "../../gen/app__assistant__search.react.ts";
import { Machine as CommsMachine } from "../../gen/app__phone__comms.effect.vibe";
import { useMachine as useComms } from "../../gen/app__phone__comms.react.ts";
import type { Machine as ContactMachine } from "../../gen/app__contacts.effect.vibe";
import { useMachine as useContact } from "../../gen/app__contacts.react.ts";
import { Machine as ShellMachine, showing } from "../../gen/app__shell.effect.vibe";
import { Machine as CanvasMachine } from "../../gen/app__shell__keyboard.effect.vibe";
import type { Machine as LayersMachine } from "../../gen/app__shell__layers.effect.vibe";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { untimed } from "../runtime/index.vibe";
import { acceptMailReview, MailQuestions, type MailQuestion } from "../inbox/mail-context.vibe";
import { MessagingBridge, type MessagingBridgeApi, type MessagingDraftProposal } from "../messaging/bridge.vibe";
import { type Backs, home } from "../shell/index.vibe";
import { isCommsView } from "../shell/views.tsx";
import { type MediaCard, type MediaNote, MediaReview, namedReviewQuery } from "./media-review.vibe";
import type { Agent } from "../platform/index.vibe";
import { native, type Device } from "../platform/index.vibe";
import type { NoteStore } from "../platform/index.vibe";
import type { Machine as NotesMachine } from "../../gen/app__notes.effect.vibe";
import type { Documents } from "../platform/index.vibe";
import { AttachmentSources, type AttachmentSourceRow } from "./AttachmentSources.tsx";
import { AttachmentPicker, choosePickerRow, clearPickerChoice, importPickerFiles, openAttachmentPicker, openContactAttachmentPicker, pickSystemDocument, selectPickerVolume, upPickerFolder } from "./attachment-picker.vibe";
import { askComms, checkAgain, damagedCopyKept, draftCardOf, freedom, holdAndSend, itWasSent, keepBoth, openChatSearch, restTyping, startAndSend } from "./assistant.vibe";
import { contactChatActionsId } from "./contact-chat-id.ts";
import { acceptedFiles, acceptedPhotos, attachmentAuthority, previewFile, removeContactFile, removeFile, retireTranscript, sameBinding } from "./attachments.vibe";
import { chip, type MessageActions, useHistorySheets, useMessageRows } from "./history.tsx";
import { ChatScrim, DragStrip, useSheetFollow } from "./follow.tsx";
import { holdMessagePress } from "./message-actions.vibe";
import { ReplyFailure, UntoldSteps } from "./ReplyFailure.tsx";
import {
  actionsOf, actionUnits, type RecordingSummary, reviewRecordingSummary, saveRecordingSummary, summaryActions, summaryUnits,
} from "./recording-summary.vibe";
import { type Attached, type Board, type Line, type Seen, Talk } from "./talk.vibe";
import { CommsTarget, type CommsTargetServices } from "../comms/ui.tsx";
import { CommsBriefing, commsViewOf } from "../comms/index.vibe";
import { displayNumber } from "../comms/index.vibe";
import { replyBlocks, wordsOf } from "./words.ts";
import { handToMaps } from "../maps/handoff.ts";
import { AskedRequest, asked, boundIn, filedBy } from "../calendar/asked.ts";
import { shownInAskAlpha } from "../../gen/app__calendar__agent.ts";
import type { MapsCard } from "@elizaos/plugin-maps-client";
import { type DictationKeyboard, useTalkKeyboard } from "../voice/useTalkKeyboard.ts";

export interface AssistantProps {
  runtime: ManagedRuntime.ManagedRuntime<ConversationMachine | AttachmentMachine | ChatsMachine | ComposerMachine | SearchMachine | ReplyMachine | DockMachine | ShellMachine | CommsMachine | ContactMachine | CommsTargetServices | CommsBriefing | Talk | MailQuestions | MessagingBridge | LayersMachine | MediaReview | Documents | AttachmentPicker | Agent | Device | KeyValueStore.KeyValueStore | NoteStore | NotesMachine | Backs, unknown>;
  messageActions?: MessageActions;
  speech?: Pick<AssistantComposerProps, "onTalk" | "onDictate" | "showUnavailableTalk"> & {
    voicePanel?: (onKeyboard: DictationKeyboard) => ReactNode;
    interim?: ReactNode;
    voice?: (presentation: { compactDock: boolean; atBar: boolean }) => ReactNode;
  };
  canReadAloud?: boolean;
  onBack?: () => void;
  /** Calendar's card for a change a reply filed (calendar/sheet.tsx). */
  calendarReview?: ReactNode;
}

function turnOf(talking: Talking, label: string, writing: boolean, live: boolean): AssistantTurnNoteProps["status"] | undefined {
  const { turn, check } = talking;
  if (turn.stopping) return "stopping";
  if (check === "Aborting" || talking.recheck.status === "Loading") return "checking";
  if (check === "Finished") return "finished";
  if (check === "StoppedForSure") return "stopped";
  if (check === "NotRecorded") return "neverArrived";
  if (check === "LookLater") return "lookLater";
  if (turn.send.outcome === "Recorded" || turn.send.outcome === "Sent") return "sending";
  // spec/app/assistant/reply.md, "The planning label shows until the first settled text, and provisional text is neither shown nor spoken": a reply still being written with neither text shown nor a label shows as replying.
  if (turn.reply === "Streaming") return label !== "" || (!writing && live) ? "replying" : undefined;
  if (turn.reply === "Broken") return "cutOff";
  if (turn.reply === "Stopped") return "stopped";
  if (turn.send.outcome === "Unknown") return "unknown";
  return undefined;
}

function noticeOf(writing: Writing): AssistantDraftNoticeProps["status"] | undefined {
  if (writing.read.status === "Loading") return "opening";
  if (writing.long) return "long";
  return undefined;
}

function waiting(writing: Writing, files: readonly Attached[], transcriptTitle: string | undefined): AssistantAttachment[] {
  const { editor } = writing;
  return [
    ...files.slice(0, editor.files).map(chip),
    ...(editor.mail ? [{ id: "mail", kind: "mail", name: "Mail" } as const] : []),
    ...(editor.transcript && transcriptTitle !== undefined ? [{ id: "transcript", kind: "transcript", name: transcriptTitle } as const] : []),
    ...(editor.shown ? [{ id: "shown", kind: "image", name: "Photo" } as const] : []),
  ];
}

const detached = { mail: "Mail", shown: "Shown" } as const;

const emptyLines: readonly Line[] = [];
const settings = { type: "openView", view: "Settings" } as const;
const maps = { type: "openView", view: "Maps" } as const;
const back = { type: "goBack" } as const;
const check = { type: "checkForReply" } as const;

function focusChatActions(field: HTMLTextAreaElement | null) {
  const trigger = field?.parentElement?.querySelector<HTMLButtonElement>('button[aria-label="Chat actions"]');
  if (trigger && !trigger.disabled && !trigger.closest("[inert], [hidden]")) trigger.focus({ preventScroll: true });
}

function DeviceReview({ runtime, card }: { runtime: AssistantProps["runtime"]; card: MediaCard }) {
  const decide = (approve: boolean, confirmation?: "Tap") => void runtime.runPromise(Effect.flatMap(MediaReview, (review) => review.decide(card, approve, confirmation)));
  const deciding = card.decision === "Deciding";
  const unavailable = card.decision === "Unconfirmed";
  const text = card.operation.type === "sms_send" ? { body: card.operation.body, recipients: card.operation.recipients }
    : card.operation.type === "sms_compose" && card.composeLine !== undefined
      ? { body: card.operation.body, recipients: card.phone?.tag === "Exact" ? [card.phone.selected.number]
        : "target" in card.operation && card.operation.target.kind === "number" ? [card.operation.target.number] : [] }
      : undefined;
  const line = card.sms?.subscription ?? card.composeLine?.subscription;
  const textCard = text !== undefined && card.phone?.tag !== "Choices" && card.phone?.tag !== "Unavailable" && card.notice === undefined;
  const decisionCard = text === undefined && card.phone?.tag !== "Choices" && card.phone?.tag !== "Unavailable" && card.notice === undefined;
  return (
    <div className="grid gap-2" aria-busy={deciding}>
      {card.phone?.tag === "Choices" ? (
        <div role="group" aria-label="Choose a phone number" className="grid gap-2 rounded-sheet bg-secondary p-3">
          <p className="font-semibold">Choose a number for {namedReviewQuery(card.operation)}</p>
          {card.phone.options.map((choice, index) => (
            <Button key={`${choice.contact}\n${choice.number}`} variant="ghost" className="h-auto min-h-11 justify-start text-left whitespace-normal" disabled={card.decision !== undefined}
              onClick={() => void runtime.runPromise(Effect.flatMap(MediaReview, (review) => review.choosePhone(card, index)))}>
              {choice.name} · {displayNumber(choice.number)}
            </Button>
          ))}
          {card.phone.more && <p className="text-sm text-muted-foreground">More contacts matched. Use a more specific name if needed.</p>}
        </div>
      ) : card.phone?.tag === "Unavailable" ? (
        <Alert role="status">{card.phone.reason}</Alert>
      ) : card.notice !== undefined ? (
        <Alert role="status">{`${card.title}: ${card.detail}. ${card.notice}`}</Alert>
      ) : text !== undefined ? (
        <SmsReviewCard review={card.id} body={text.body}
          to={card.phone?.tag === "Exact" ? card.phone.selected.name : card.recipientName ?? text.recipients.map(displayNumber).join(", ")}
          number={card.phone?.tag === "Exact" ? displayNumber(card.phone.selected.number) : card.recipientName !== undefined ? text.recipients.map(displayNumber).join(", ") : undefined}
          note={line === undefined ? undefined : `SIM ${line.slot + 1} · ${line.displayName}`}
          sendDisabled={deciding || unavailable} declineDisabled={deciding}
          onSend={(event) => decide(true, event.nativeEvent.isTrusted ? "Tap" : undefined)} onDecline={unavailable ? undefined : () => decide(false)} />
      ) : (
        <AssistantCard card={{ kind: "decision", variant: "proposal", title: card.title, detail: card.detail, waiting: deciding, action: card.operation.type === "sms_compose" ? "Open draft" : card.operation.type === "browser_navigate" ? "Open" : "Approve",
          ...(unavailable ? {} : { onDecline: () => decide(false), declineDisabled: deciding }) }}
          onHandOn={unavailable ? undefined : () => decide(true)} />
      )}
      {unavailable
        ? <Alert role="status">Alpha couldn’t confirm the decision. Check Activity before trying again.</Alert>
        : !textCard && !decisionCard && <Button className="justify-self-end" variant="ghost" disabled={deciding} onClick={() => decide(false)}>Decline</Button>}
    </div>
  );
}

interface AssistantAttachmentsProps {
  runtime: AssistantProps["runtime"];
  attachments: ReturnType<typeof useAttachments>;
  preview: Attached | undefined;
  notice: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  route: number | undefined;
}

function AssistantAttachments({ runtime, attachments, preview, notice, composerRef, route }: AssistantAttachmentsProps) {
  const board = useMemo(() => runtime.runSync(AttachmentPicker).board, [runtime]);
  const view = useSyncExternalStore(board.subscribe, board.snapshot);
  const state = attachments.state;
  const active = state?.open && view.visit === state.visit;
  const currentRows = active && state.rows.status === "Loaded" && view.ticket === state.rows.ticket;
  const chooseMore = { type: "choosePhotoItems" } as const;
  const request = { type: "requestAccess" } as const;
  const settings = { type: "openSettings" } as const;
  const retry = { type: "retryList" } as const;
  const refresh = { type: "refresh" } as const;
  const more = { type: "more" } as const;
  const attach = { type: "attachChosen" } as const;
  const cancel = { type: "cancel" } as const;
  const source = state?.tab === "Photos" ? "photos" : "files";
  const permission = active && view.availability === "available"
    ? attachments.can(chooseMore) ? { label: "Choose more photos", run: () => void attachments.send(chooseMore) }
      : attachments.can(request) ? { label: `Allow ${source} access`, run: () => void attachments.send(request) }
      : attachments.can(settings) ? { label: `Open ${source} settings`, run: () => void attachments.send(settings) }
      : undefined
    : undefined;
  const chosen = active ? new Set(view.selected.map((row) => row.id)) : undefined;
  const visible = currentRows ? view.rows : [];
  const imported = active ? view.selected.filter((row) => row.external && (state.tab === "Photos") === (row.kind === "photo")
    && row.name.toLowerCase().includes(state.query.trim().toLowerCase())) : [];
  const rows: AttachmentSourceRow[] = active ? [...visible, ...imported].map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    thumbnail: row.image,
    thumbnailFile: row.imageFile,
    bytes: row.bytes,
    selected: chosen?.has(row.id) === true,
    onPress: row.available === false ? undefined : () => void runtime.runPromise(choosePickerRow(row.id, state.visit, state.rows.ticket)),
  })) : [];
  const location = currentRows && state.tab === "Documents" && view.location ? {
    label: view.location.name,
    onUp: view.location.up ? () => void runtime.runPromise(upPickerFolder(state.visit)) : undefined,
    volumes: view.volumes.length > 1 ? view.volumes.map((volume) => ({
      id: volume.id, name: volume.name, selected: view.location?.volume === volume.id,
      onPress: () => void runtime.runPromise(selectPickerVolume(volume.id, state.visit)),
    })) : undefined,
  } : undefined;
  const browsingNativePhotos = active && native() && state.tab === "Photos"
    && state.photos.grant === "Granted" && view.availability === "available" && state.rows.status !== "Failed";
  return (
    <>
      {preview !== undefined && <AssistantPhotoPreview
        open
        name={preview.name}
        src={`data:${preview.mimeType};base64,${preview.data}`}
        onOpenChange={(open) => { if (!open && attachments.can({ type: "closePreview" })) void attachments.send({ type: "closePreview" }); }}
      />}
      {state?.open && <AttachmentSources
        tab={state.tab}
        room={state.room}
        accept={state.tab === "Photos" ? acceptedPhotos : acceptedFiles}
        query={state.query}
        rows={rows}
        selected={state.selected}
        reading={state.reading.outcome === "Sent" || (active && view.preparing) === true}
        status={!active || view.availability === "checking" ? "Loading" : view.availability === "failed" ? "Failed" : state.rows.status}
        problem={active ? view.problem ?? (state.refused > 0 ? (notice || "Could not attach the selected files") : undefined) : undefined}
        access={permission}
        location={location}
        truncated={currentRows && view.truncated}
        onClose={() => { if (attachments.can(cancel)) void attachments.send(cancel); }}
        onReturnFocus={() => {
          const origin = view.contact;
          if (origin === undefined || composerRef.current) focusChatActions(composerRef.current);
          else if (origin.route === route) document.getElementById(contactChatActionsId(origin.route, origin.person))?.focus();
        }}
        onTab={(tab) => { const event = { type: "switchTab", tab } as const; if (attachments.can(event)) void attachments.send(event); }}
        onSearch={(query) => { const event = { type: "setQuery", query } as const; if (attachments.can(event)) void attachments.send(event); }}
        onRetry={attachments.can(retry) ? () => void attachments.send(retry) : view.availability === "failed" && attachments.can(refresh) ? () => void attachments.send(refresh) : undefined}
        onMore={attachments.can(more) ? () => void attachments.send(more) : undefined}
        onClear={active && state.selected > 0 ? () => void runtime.runPromise(clearPickerChoice(state.visit)) : undefined}
        onAttach={active && attachments.can(attach) ? () => void attachments.send(attach) : undefined}
        onBrowse={active && state.tab === "Documents" && view.systemDocuments ? () => void runtime.runPromise(pickSystemDocument(state.visit)) : undefined}
        onImport={active && !browsingNativePhotos && (!view.systemDocuments || state.tab === "Photos") ? (files) => void runtime.runPromise(importPickerFiles(files, state.visit)) : undefined}
        importLabel={view.systemDocuments ? "Choose photos" : undefined}
      />}
    </>
  );
}

interface MailReviewDialogsProps {
  open: boolean;
  review: ReturnType<MailQuestions.Shape["snapshot"]>;
  attach: () => void;
  dismiss: () => void;
}

function MailReviewDialogs({ open, review, attach, dismiss }: MailReviewDialogsProps) {
  const source = review.question?.review.source;
  return (
    <>
      <ConfirmDialog open={open && source !== undefined} title="Share this email with Alpha?" confirmLabel="Add to chat" onConfirm={attach} onCancel={dismiss}>
        {source && <span className="block max-h-72 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
          {source.subject || "(no subject)"}{"\n"}{source.from}{"\n"}{source.to.join(", ")}{"\n\n"}{source.bodyText}
        </span>}
      </ConfirmDialog>
      <ConfirmDialog open={open && review.failure !== undefined} title={review.failure === "tooLarge" ? "This email is too long to share in full" : "Review this email again before sharing"}
        confirmLabel="OK" onConfirm={dismiss} onCancel={dismiss} />
    </>
  );
}

// spec/app/assistant/cards.md, "The owner reviews the summary before it can be saved"
function RecordingSummaryReview({ runtime, offer }: { runtime: AssistantProps["runtime"]; offer: RecordingSummary }) {
  const card = useCards(offer.runtime);
  const formId = useId();
  const headingId = useId();
  const actionItemsId = useId();
  const dismiss = { type: "dismissSummary" } as const;
  const dismissReview = () => { if (card.can(dismiss)) void card.send(dismiss); };
  const outcome = card.state?.save.outcome;
  const message = card.state?.settled ? "Recording is unavailable. Ask about its current transcript again."
    : outcome === "Confirmed" ? "Recording summary saved. No reminders scheduled."
    : outcome === "Unknown" ? "Save is unconfirmed. Check Notes before trying again."
    : outcome === "Sent" ? "Saving recording summary…"
    : outcome === "Refused" ? "Recording summary could not be saved." : undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!card.can({ type: "saveToNotes" })) return;
    const values = new FormData(event.currentTarget);
    const summary = values.get("summary");
    const actions = values.get("actions");
    if (typeof summary !== "string" || typeof actions !== "string") return;
    if (summary.trim() === "") {
      const field = event.currentTarget.elements.namedItem("summary");
      if (field instanceof HTMLTextAreaElement) {
        field.setCustomValidity("Enter a summary.");
        field.reportValidity();
      }
      return;
    }
    const field = event.currentTarget.elements.namedItem("actions");
    const items = actionsOf(actions);
    if (items.length > summaryActions || items.some((item) => item.length > actionUnits)) {
      if (field instanceof HTMLTextAreaElement) {
        field.setCustomValidity(`Use up to ${summaryActions} lines of ${actionUnits} characters each.`);
        field.reportValidity();
      }
      return;
    }
    void runtime.runPromise(saveRecordingSummary(offer, summary, actions));
  };
  return <>
    {card.state && <AssistantCardFrame icon={<FileText />} title="Review summary note" detail={offer.source.title}
      settled={card.state.settled || outcome === "Confirmed" || outcome === "Unknown"}
      onOpen={card.can({ type: "reviewSummary" }) ? () => void runtime.runPromise(reviewRecordingSummary(offer)) : undefined}>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </AssistantCardFrame>}
    <Sheet open={card.state?.reviewing === true} onOpenChange={(open) => { if (!open) dismissReview(); }}>
      <SheetContent title="Review recording summary" description={offer.source.title} actions={<>
        <Button variant="secondary" onClick={dismissReview}>Cancel</Button>
        <Button type="submit" form={formId} disabled={!card.can({ type: "saveToNotes" })}>Save recording summary</Button>
      </>}>
        <form id={formId} onSubmit={submit} className="grid gap-3">
          <label htmlFor={headingId} className="grid gap-1.5 text-sm font-medium">
            Summary
            <Textarea id={headingId} aria-label="Summary" name="summary" defaultValue={offer.words} maxLength={summaryUnits} required
              onInput={(event) => event.currentTarget.setCustomValidity("")} />
          </label>
          <label htmlFor={actionItemsId} className="grid gap-1.5 text-sm font-medium">
            Action items
            <Textarea id={actionItemsId} aria-label="Action items" name="actions" placeholder="One action per line" maxLength={summaryActions * (actionUnits + 1)}
              onInput={(event) => event.currentTarget.setCustomValidity("")} />
          </label>
        </form>
      </SheetContent>
    </Sheet>
  </>;
}

interface DockHandleProps {
  dock: ReturnType<typeof useDock>;
  /** Alpha's mark on the resting bar or pill, or the handle of a sheet that is open or following the finger. */
  variant: "mark" | "handle";
  /** The press, drag, release and cancel of the handle, which the sheet follows. */
  gesture: AssistantPull;
  /** The press ended without moving: the gesture is over. */
  done: () => void;
}

function DockHandle({ dock, variant, gesture, done }: DockHandleProps) {
  return (
    <AssistantGrabber
      variant={variant}
      {...gesture}
      onLift={() => {
        done();
        void dock.send({ type: "lift", now: untimed });
      }}
      onTap={() => { void dock.send({ type: "click", now: untimed }); }}
    />
  );
}

function readCanvasMetrics(runtime: AssistantProps["runtime"]): { bar: number; lift: number } {
  const held = runtime.runSyncExit(Effect.gen(function* () {
    const found = yield* Effect.serviceOption(CanvasMachine);
    if (Option.isNone(found)) return { bar: 0, lift: 0 };
    const state = yield* found.value.get();
    return { bar: state.bar, lift: state.covered ? Math.max(0, state.base.h - state.visible) : 0 };
  }));
  return held._tag === "Success" ? held.value : { bar: 0, lift: 0 };
}

function openLiveAttachments(
  runtime: AssistantProps["runtime"],
  attachments: ReturnType<typeof useAttachments>,
  board: { change: (patch: { attachmentNotice: string }) => void },
) {
  const initial = runtime.runSyncExit(Effect.flatMap(ComposerMachine, (machine) => machine.get()));
  if (initial._tag !== "Success") return;
  const initialRequest = { type: "openPicker", room: maxFiles - initial.value.editor.files } as const;
  if (!attachments.can(initialRequest)) return;
  void runtime.runPromise(attachmentAuthority()).then((authority) => {
    if (authority === undefined) {
      board.change({ attachmentNotice: "Could not verify the owner for these attachments. Try again." });
      return;
    }
    const live = runtime.runSyncExit(Effect.gen(function* () {
      const comp = yield* Effect.flatMap(ComposerMachine, (machine) => machine.get());
      const conv = yield* Effect.flatMap(ConversationMachine, (machine) => machine.get());
      const picker = yield* Effect.flatMap(AttachmentMachine, (machine) => machine.get());
      return { comp, conv, picker };
    }));
    if (live._tag !== "Success") return;
    const room = maxFiles - live.value.comp.editor.files;
    if (room <= 0 || !canOpenPicker(live.value.picker, room)) return;
    void runtime.runPromise(openAttachmentPicker({ binding: live.value.comp.binding, slot: live.value.comp.read.ticket, revision: live.value.conv.context.revision, authority }, room));
  });
}

function draftMessageCards(
  drafts: ReadonlyArray<MessagingDraftProposal>,
  bridge: MessagingBridgeApi,
  runSend: (id: string) => void,
  runOpen: (draft: MessagingDraftProposal) => void,
): (AssistantMessageProps & { id: string })[] {
  return drafts.map((draft) => ({
    id: `messaging-draft-${draft.id}`,
    author: "alpha",
    text: "",
    children: (
      <AssistantMessageDraftCard
        platform={draft.platform}
        target={draft.target}
        replyContext={draft.replyContext}
        body={draft.body}
        onBodyChange={(body) => bridge.editDraft(draft.id, body)}
        status={draft.status}
        error={draft.error}
        settled={draft.settled}
        onSend={() => runSend(draft.id)}
        onOpenInApp={() => runOpen(draft)}
        onDecline={() => bridge.declineDraft(draft.id)}
      />
    ),
  }));
}

function useMessagingDrafts(
  runtime: AssistantProps["runtime"],
  shell: ReturnType<typeof useShell>,
): (AssistantMessageProps & { id: string })[] {
  const bridge = useMemo(() => runtime.runSync(MessagingBridge), [runtime]);
  const store = useMemo(() => ({ subscribe: (listener: () => void) => bridge.subscribe(listener), snapshot: () => bridge.snapshot() }), [bridge]);
  const snap = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return draftMessageCards(
    snap.drafts,
    bridge,
    (id) => { void runtime.runPromise(bridge.sendDraft(id)); },
    (draft) => {
      void runtime.runPromise(bridge.openDraftInApp(draft.id));
      const openView = { type: "openView", view: draft.platform } as const;
      if (shell.can(openView)) void shell.send(openView);
    },
  );
}

function useExternal<T>(store: { readonly subscribe: (listener: () => void) => () => void; readonly snapshot: () => T }): T {
  const bound = useMemo(() => ({ subscribe: (listener: () => void) => store.subscribe(listener), snapshot: () => store.snapshot() }), [store]);
  return useSyncExternalStore(bound.subscribe, bound.snapshot);
}

/** The route and draft that own the composer during a dictation-to-keyboard request. */
function keyboardScope(runtime: AssistantProps["runtime"]): string | undefined {
  const held = runtime.runSyncExit(Effect.gen(function* () {
    const route = yield* ShellMachine.use((machine) => machine.get());
    const draft = yield* ComposerMachine.use((machine) => machine.get());
    const { context } = yield* ConversationMachine.use((machine) => machine.get());
    const subject = isCommsView(route.trail.at(-1)) ? (yield* CommsMachine.use((machine) => machine.get())).key : undefined;
    return JSON.stringify([route.trail, route.assistant, subject, context.revision, draft.binding.owner, draft.binding.conversation, draft.read.ticket]);
  }));
  return held._tag === "Success" ? held.value : undefined;
}

// spec/app/assistant/composer.md, "A damaged slot is recovered on the owner's word"; spec/app/assistant/composer.md, "Retry writes the draft again after storage failed"; spec/app/assistant/composer.md, "The slot is opened when the composer is shown, and opened again after it could not be read"; spec/app/assistant/composer.md, "A message that may already have been sent is checked by itself, and what the read found settles it"
/** The one card the conversation shows about the draft once Alpha could not settle it by itself; never by the field. */
function draftCard(
  runtime: AssistantProps["runtime"],
  writing: Writing,
  seen: Seen,
  composer: ReturnType<typeof useComposer>,
  conversation: ReturnType<typeof useConversation>,
): ReactNode {
  const button = (label: string, onClick: () => void) => <Button key={label} variant="secondary" size="sm" onClick={onClick}>{label}</Button>;
  const small = (label: string, event: ComposerEvent) => composer.can(event) ? button(label, () => void composer.send(event)) : null;
  const card = (title: string, actions: ReactNode, children?: ReactNode) => (
    <AssistantCardFrame key="draft" icon={<FileWarning />} title={title} actions={actions}>{children}</AssistantCardFrame>
  );
  const due = draftCardOf(writing, seen.mending);
  if (due === "Damaged") {
    return card("Your saved draft is damaged", <>{damagedCopyKept() ? small("Keep a copy", { type: "recover", keep: true }) : null}{small("Discard", { type: "recover", keep: false })}</>);
  }
  if (due === "Unchecked") {
    return card("This may already have been sent", <>
      {conversation.state?.ready ? button("Check again", () => void runtime.runPromise(checkAgain())) : null}
      {composer.can({ type: "replaceSaved" }) ? button("It was sent", () => void runtime.runPromise(itWasSent())) : null}
      {composer.can({ type: "restoreSaved" }) ? button("Put back in the field", () => void runtime.runPromise(keepBoth())) : null}
    </>, seen.saved === "" ? undefined : <p className="line-clamp-3 break-words text-muted-foreground">{seen.saved}</p>);
  }
  if (due === "Unkept") return card("Alpha cannot keep your draft", small("Try again", { type: "retry" }));
  if (due === "Unread") return card("Alpha cannot open your draft", small("Try again", { type: "open" }));
  return undefined;
}

function removeAttachmentById(
  id: string,
  runtime: AssistantProps["runtime"],
  composer: ReturnType<typeof useComposer>,
  mail: MailQuestions.Shape,
) {
  if (id === "transcript") {
    if (composer.can({ type: "detach", kind: "Transcript" })) void runtime.runPromise(retireTranscript());
  } else if (id === "mail" || id === "shown") {
    const event = { type: "detach", kind: detached[id] } as const;
    if (!composer.can(event)) return;
    void composer.send(event).then((outcome) => {
      if (outcome._tag === "Success" && id === "mail") mail.clear();
    });
  } else void runtime.runPromise(removeFile(id));
}

function useMailReview(runtime: AssistantProps["runtime"], board: Board, composer: ReturnType<typeof useComposer>, offeredAt: number | undefined,
  type: (text: string) => void, composerRef: RefObject<HTMLTextAreaElement | null>) {
  const mail = useMemo(() => runtime.runSync(MailQuestions), [runtime]);
  const reviewed = useExternal(mail);
  const acceptingMailRef = useRef<MailQuestion | undefined>(undefined);
  const attachMail = () => {
    if (offeredAt === undefined) return;
    const question = mail.snapshot().question;
    const offer = { type: "offer", kind: "Mail", revision: offeredAt + 1 } as const;
    if (!question || acceptingMailRef.current || !composer.can(offer)) return;
    acceptingMailRef.current = question;
    void (async () => {
      const accepted = await runtime.runPromise(acceptMailReview(question));
      if (mail.snapshot().question !== question) return;
      if (!accepted || !composer.can(offer)) {
        mail.show({ failure: "changed" });
        return;
      }
      const outcome = await composer.send(offer);
      if (outcome._tag !== "Success" || mail.snapshot().question !== question) return;
      mail.attach(question);
      if (!board.snapshot().typed.trim()) type("Summarize this email");
      composerRef.current?.focus();
    })().finally(() => {
      acceptingMailRef.current = undefined;
    });
  };
  const dismissMail = () => {
    if (acceptingMailRef.current) return;
    const notice = mail.snapshot().question?.notice;
    mail.show({});
    if (notice) void runtime.runPromise(notice.dismiss());
  };
  return { mail, reviewed, attachMail, dismissMail };
}

interface TranscriptOptions extends Pick<AssistantProps, "runtime" | "messageActions" | "calendarReview"> {
  board: Board;
  seen: Seen;
  conversation: ReturnType<typeof useConversation>;
  chats: ReturnType<typeof useChats>;
  writing: Writing | undefined;
  shell: ReturnType<typeof useShell>;
  free: ReturnType<typeof freedom>;
  canReadAloud: boolean;
  onPreview?: (file: Attached) => void;
  open: boolean;
  interim: ReactNode;
  retry: () => void;
  /** Whether the turn's reply is still being written: neither settled nor ended. */
  writingNow: boolean;
}

function useAssistantTranscript({ runtime, board, seen, conversation, chats, writing, shell, free, canReadAloud,
  messageActions, onPreview, open, interim, retry, calendarReview, writingNow }: TranscriptOptions): AssistantTranscriptProps | undefined {
  const [talking, shown] = [conversation.state, chats.state];
  const calendar = useSyncExternalStore(asked.subscribe, asked.snapshot);
  const draftCards = useMessagingDrafts(runtime, shell);
  const holdMessage = useCallback((held: () => void) => {
    const fiber = runtime.runFork(holdMessagePress(held));
    return () => fiber.interruptUnsafe();
  }, [runtime]);
  const page = shown === undefined || (shown.page.status === "Idle" && shown.chosen === 0) ? undefined : seen.pages.get(shown.page.ticket);
  const lines = page?.lines ?? emptyLines;
  const later = page?.bounds?.later;
  const onSettingsPage = shell.state && showing(shell.state, "Settings") && shell.state.assistant !== "Bar" && shell.can(back);
  const settingsAction = shell.can(settings) ? settings : onSettingsPage ? back : undefined;
  const onSettings = useCallback(() => {
    if (settingsAction) void runtime.runPromiseExit(Effect.flatMap(ShellMachine, (machine) => machine.send(settingsAction)));
  }, [runtime, settingsAction]);
  // spec/app/maps/index.md, "A map card in the conversation opens its place on the phone's map once Maps is on screen, never over navigation": a search card hands Maps its search
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const onOpenMaps = useCallback((card: MapsCard, message: number) => {
    setOpened((before) => new Set([...before, message]));
    const query = card.kind === "places" || card.kind === "locate" ? card.query : undefined;
    handToMaps(query !== undefined && query.trim() !== "" ? query : undefined);
    void runtime.runPromiseExit(Effect.flatMap(ShellMachine, (machine) => machine.send(maps)));
  }, [runtime]);
  const mapsShowing = Boolean(shell.state && showing(shell.state, "Maps"));
  // spec/app/maps/index.md, "Story: Let the agent help with Maps"
  const answeredRef = useRef(new Set<string>());
  const canAsk = talking === undefined ? undefined : askable(talking);
  const onChoose = (choice: string, value: string) => {
    if (canAsk === undefined || writing === undefined || answeredRef.current.has(choice) || board.snapshot().typed.trim() !== "") return;
    const edit = { type: "edit", blank: false, long: value.length > textLimit } as const;
    if (!composerAllows(writing, edit)) return;
    answeredRef.current.add(choice);
    board.type(value);
    const answer = { type: "hold", askable: canAsk } as const;
    const send = (event: ComposerEvent) => runtime.runPromiseExit(Effect.flatMap(ComposerMachine, (machine) => machine.send(event)));
    void send(edit)
      .then(() => {
        board.hold(value);
        board.type("");
        return send(answer);
      })
      .then((outcome) => { if (outcome._tag !== "Success") answeredRef.current.delete(choice); });
  };
  const rows = useMessageRows({
    runtime, board, lines, later, chats: shown, writing, ...free, actions: messageActions, canReadAloud,
    settled: Boolean(talking && !inFlight(talking.turn) && !pending(talking)),
    onSettings: settingsAction ? onSettings : undefined,
    onPreview,
    onOpenMaps: shell.can(maps) || mapsShowing ? onOpenMaps : undefined,
    opened,
    onChoose,
  });
  if (!talking || !shown || !writing) return undefined;
  const checkable = conversation.can(check) && !writing.unsettled && (talking.turn.send.outcome === "Unknown" || talking.turn.reply === "Stopped" || talking.check === "LookLater");
  // spec/app/assistant/chats.md, "Older or newer messages are read around a message of the conversation showing"
  const earlier = page?.bounds?.earlier;
  const readEarlier = { type: "scroll", around: board.numbered(earlier ?? "") } as const;
  const readLater = { type: "scroll", around: board.numbered(later ?? "") } as const;
  const replyWords = replyBlocks(seen.reply, true).words;
  const told = turnOf(talking, seen.label, replyWords !== "", writingNow);
  const status = writing.unsettled && (told === "checking" || told === "lookLater") ? undefined : told;
  const onOpenLink = messageActions?.openLink;
  // spec/app/assistant/reply.md, "Each step the agent marked untold draws Alpha's step notice under its reply, live and read again, and a reply with no text that marks one is answered, never declined"
  const writingReply = replyWords !== "" || seen.replyUntold.length > 0 ? [{
    id: "reply", author: "alpha", text: replyWords, onOpenLink,
    ...(seen.replyUntold.length === 0 ? {} : { children: <UntoldSteps untold={seen.replyUntold} /> }),
  } as const] : [];
  // spec/app/assistant/reply.md, "A failed reply offers the fix the agent named, and a limit reached shows its live wait, never sending the message again"; spec/app/assistant/reply.md, "Out of funds is refused before any output, is never spoken, and offers only Manage plan"
  const mediaCards = seen.media.filter((card) => !talking.context.sensitive && card.conversation === shown.chosen && card.revision === talking.context.revision).map((card) => ({
    id: `media ${card.id}`, author: "alpha" as const, text: "", children: <DeviceReview runtime={runtime} card={card} />,
  }));
  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"
  const bound = boundIn(calendar, shown.chosen);
  const latestFiled = calendar.filed.some((one) => one.conversation === shown.chosen && one.message === lines.at(-1)?.id);
  const calendarCard = calendarReview !== undefined && !talking.context.sensitive && shownInAskAlpha(calendar.shown, bound !== undefined, latestFiled)
    ? [{ id: `calendar review ${bound ?? ""}`, author: "alpha" as const, text: "",
      children: <AskedRequest.Provider value={bound}>{calendarReview}</AskedRequest.Provider> }] : [];
  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken": how a change ended draws under the reply that filed it, as v119 kept each reply's own card, so it never reads as a later reply's; a filing reply that draws no row here keeps the outcome at the foot so it is never lost.
  const filer = calendar.shown === "ChangeEnded" ? filedBy(calendar, shown.chosen) : undefined;
  const drawn = [...rows.messages, ...(rows.messagesAfterLater ?? [])];
  const endedUnder = filer !== undefined && drawn.some((row) => row.id === filer) ? filer : undefined;
  // spec/app/assistant/cards.md, "A phone step's result chip stands under the reply that offered it, and a reply that only offered the review gives way to it"
  const notes = talking.context.sensitive ? [] : seen.mediaNotes.filter((note) => note.conversation === shown.chosen);
  const offerDrawn = (note: MediaNote) => note.offer !== undefined && drawn.some((row) => row.id === note.offer?.reply);
  const receipt = (note: MediaNote) => ({ id: `media result ${note.offer?.card ?? "latest"}`, author: "alpha" as const, text: "", children: <AssistantDeviceReceipt text={note.text} /> });
  const under = (placed: typeof rows.messages) => placed.flatMap((row) => {
    const chips = notes.filter((note) => offerDrawn(note) && note.offer?.reply === row.id);
    const offer = chips.every((note) => note.offer === undefined || offerShown(note.offer.only, seen.media.some((card) => card.id === note.offer?.card), true));
    return [...(offer ? [row] : []), ...chips.map(receipt), ...(row.id === endedUnder ? calendarCard : [])];
  });
  const offer = seen.recordingSummary;
  const recordingSummary = offer !== undefined && !talking.context.sensitive && offer.conversation === shown.chosen
    && lines.some((line) => !line.mine && line.id === offer.message)
    ? [{ id: `recording summary ${offer.message}`, author: "alpha" as const, text: "",
      children: <RecordingSummaryReview runtime={runtime} offer={offer} /> }] : [];
  const mediaNote = notes.filter((note, at) => note.offer === undefined || (at === notes.length - 1 && !offerDrawn(note))).map(receipt);
  const failure = seen.failure;
  const liveFix = failure?.kind === "OutOfFunds" ? "FundingFix" : failure?.fix ?? "NoFix";
  const readAgain = failure?.messageId !== undefined && lines.some((line) => line.id === failure.messageId && line.failure === failure.kind);
  const failed = failure === undefined || (readAgain && !liveAddsToHistory(failure.kind, liveFix, failure.waitMs)) ? [] : [{ id: "failure", author: "alpha", text: "", children: <ReplyFailure kind={failure.kind} fix={liveFix} waitMs={failure.waitMs} cutOff={failure.cutOff} live onRetry={retry} onSettings={settingsAction ? onSettings : undefined} /> } as const];
  return {
    ...rows,
    messages: under(rows.messages),
    messagesAfterLater: rows.messagesAfterLater && under(rows.messagesAfterLater),
    holdMessage: open ? holdMessage : undefined,
    liveMessages: [...writingReply, ...draftCards, ...failed, ...mediaCards, ...(endedUnder === undefined ? calendarCard : []), ...mediaNote, ...recordingSummary],
    interim: open && shown.around === 0 && !talking.context.sensitive ? interim : undefined,
    position: { page: `${shown.chosen}/${shown.page.ticket}`, around: board.messageId(shown.around), earlier, later },
    visible: open,
    // spec/app/assistant/chats.md, "A conversation made new here shows what it holds while its page is read"
    status: pageLoading(shown) ? "loading" : shown.page.status === "Failed" ? "failed" : "loaded",
    turn: status === undefined ? undefined : { status, label: seen.label === "" ? undefined : seen.label, onCheck: checkable ? () => void conversation.send(check) : undefined },
    onRetry: chats.can({ type: "reread" }) ? () => void chats.send({ type: "reread" }) : undefined,
    onEarlier: earlier !== undefined && chats.can(readEarlier) ? () => void chats.send(readEarlier) : undefined,
    onLater: later !== undefined && chats.can(readLater) ? () => void chats.send(readLater) : undefined,
    onReturnToOriginal: chats.can({ type: "returnToOriginal", ...free }) ? () => void chats.send({ type: "returnToOriginal", ...free }) : undefined,
  };
}
/** @model spec/app/assistant/index.md */
export function Assistant({ runtime, messageActions, speech, canReadAloud = false, onBack, calendarReview }: AssistantProps) {
  const conversation = useConversation(runtime);
  const attachments = useAttachments(runtime);
  const chats = useChats(runtime);
  const composer = useComposer(runtime);
  const reply = useReply(runtime);
  const search = useSearch(runtime);
  const shell = useShell(runtime);
  const dock = useDock(runtime);
  const comms = useComms(runtime);
  const contact = useContact(runtime).state;
  const board = useMemo(() => runtime.runSync(Effect.map(Talk, (talk) => talk.board)), [runtime]);
  const seen = useExternal(board);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusOnRevealRef = useRef(false);
  const { voice: renderVoice, voicePanel: renderDictation, interim, ...speechProps } = speech ?? {};
  const keyboardOwner = useCallback(() => keyboardScope(runtime), [runtime]);
  const { onDictationKeyboard, takeFocus } = useTalkKeyboard(composerRef, keyboardOwner);
  const voicePanel = renderDictation?.(onDictationKeyboard);
  const currentView = shell.state?.trail.at(-1);
  const onComms = isCommsView(currentView);
  const assistantDetent = shell.state?.assistant ?? "Bar";
  const compact = shell.state !== undefined && !onComms && dockPill(shell.state, dock.state?.tucked ?? false);
  const composerField = useCallback((element: HTMLTextAreaElement | null) => {
    composerRef.current = element;
    if (element && !compact && assistantDetent === "Typing" && focusOnRevealRef.current) {
      focusOnRevealRef.current = false;
      element.focus();
    }

    takeFocus(element);
  }, [assistantDetent, compact, takeFocus]);
  const { drawn: live, underlay, leaving, style: sheetStyle, ref: sheetRef, gesture, done } = useSheetFollow({
    dock, detent: assistantDetent, pill: compact, comms: onComms, voice: dock.state?.voice ?? false,
    canLand: (detent) => detent === assistantDetent || shell.can({ type: "raise", detent }) || shell.can({ type: "goBack" }),
  });
  const [talking, shown, writing, finding] = [conversation.state, chats.state, composer.state, search.state];
  const free = talking && shown && writing ? freedom(talking, writing, shown.chosen) : { replying: true, holding: true };
  const searchRoute = shell.state?.route;
  const beginSearch = searchRoute === undefined ? undefined : () => void runtime.runPromiseExit(openChatSearch(searchRoute));
  const returnChatFocus = () => focusChatActions(composerRef.current);
  const returnSearchFocus = () => {
    const origin = finding?.origin;
    if (origin?.tag !== "ContactDock") returnChatFocus();
    else if (origin.route === searchRoute) document.getElementById(contactChatActionsId(origin.route, origin.person))?.focus();
  };
  const history = useHistorySheets(chats, search, seen, free, beginSearch, returnSearchFocus);
  const subject = onComms ? comms.state?.key : undefined;
  const priorStage = comms.state?.stage.at(-1);
  const returnTo = priorStage === undefined ? undefined : commsViewOf(priorStage.app);
  const open = dockOpen(assistantDetent);
  const canPreview = attachments.can({ type: "preview", attachment: 1 });
  const preview = useCallback((file: Attached) => void runtime.runPromise(previewFile(file)), [runtime]);
  const type = (text: string) => {
    if (subject !== undefined) {
      void comms.send({ type: "requestTyped", about: subject, request: text }, "Owner");
      return;
    }
    board.type(text);
    void composer.send({ type: "edit", blank: text.trim() === "", long: text.length > textLimit });
  };
  const retryLastSent = () => {
    if (subject !== undefined || board.lastSent === "") return;
    const current = board.snapshot().typed;
    type(current.trim() === "" ? board.lastSent : `${current}\n${board.lastSent}`);
  };
  const transcript = useAssistantTranscript({
    runtime, board, seen, conversation, chats, writing, shell, free, messageActions, canReadAloud, open, interim,
    onPreview: canPreview ? preview : undefined, retry: retryLastSent, calendarReview,
    writingNow: reply.state !== undefined && replyLive(reply.state),
  });
  const { mail, reviewed, attachMail, dismissMail } = useMailReview(runtime, board, composer, writing?.offeredAt, type, composerRef);
  if (conversation.cause || chats.cause || composer.cause || reply.cause) return <Alert variant="destructive" className="m-4">Alpha could not open Ask Alpha</Alert>;
  if (!talking || !shown || !writing || !finding || !transcript) return null;
  const hold = { type: "hold", askable: askable(talking) } as const;
  const start = { type: "start", ...free } as const;
  const newChat = shown.chosen === 0;
  const brief = subject !== undefined && comms.state?.briefed === subject && shell.state?.trail.at(-1) === "Phone"
    ? runtime.runSync(Effect.flatMap(CommsBriefing, (reading) => reading.forSubject(subject))) : "";
  const request = subject === undefined ? "" : (comms.state?.requests.find((draft) => draft.about === subject)?.request ?? "");
  const selectedContact = currentView === "Contacts" && contact?.opened && contact.form === "Shut" ? contact.contact : undefined;
  const contactDraft = seen.contactDraft?.target.about === subject && seen.contactDraft?.target.person === selectedContact && seen.contactDraft?.target.card === contact?.card.ticket
    && seen.contactDraft?.target.revision === talking.context.revision ? seen.contactDraft : undefined;
  const contactFiles = contactDraft?.files ?? [];
  const sendable = subject !== undefined
    ? (request.trim() !== "" || contactFiles.length > 0) && request.length <= textLimit && askable(talking) && (!newChat || chats.can(start))
    : newChat ? composer.can(hold) && chats.can(start) : composer.can(hold);
  const notice = noticeOf(writing);
  const heldDraft = onComms ? undefined : draftCard(runtime, writing, seen, composer, conversation);
  const draftFiles = sameBinding(seen.filesBinding, writing.binding) ? seen.files : [];
  const transcriptTitle = sameBinding(seen.transcript?.binding, writing.binding) ? seen.transcript?.offered.title : undefined;
  const previewed = seen.preview?.ticket === attachments.state?.preview ? seen.preview?.file : undefined;

  const send = () => {
    if (subject !== undefined) {
      const contact = contactDraft !== undefined && searchRoute !== undefined ? { draft: contactDraft, route: searchRoute } : undefined;
      void runtime.runPromise(askComms({ about: subject, text: request, contact }));
      return;
    }
    if (newChat) {
      void runtime.runPromise(startAndSend(start));
      return;
    }
    void runtime.runPromise(holdAndSend(hold));
  };
  const quotedLine = board.line(shown.chosen, writing.editor.quote);
  const quoted = quotedLine === undefined ? undefined : wordsOf(quotedLine);
  const view = talking.context.showing.tag === "App" ? talking.context.showing.view : "Home";
  const full = assistantDetent === "Full";
  const textAsk = shell.state?.textAsk.tag === "TextAskVisit";
  const canvasMetrics = readCanvasMetrics(runtime);
  const lift = assistantDetent === "Typing" ? composerLift(true, canvasMetrics.lift, 0) : 0;
  const raiseAll = (asks: ReturnType<typeof dockTouched>) => {
    for (const ask of asks) if (ask.tag === "Raise" && shell.can({ type: "raise", detent: ask.detent })) void shell.send({ type: "raise", detent: ask.detent });
  };
  const openSheet = () => raiseAll(dockSent(assistantDetent));
  const touchedAsks = () => dockTouched(assistantDetent, heldDraft !== undefined);
  const revealComposer = () => {
    if (heldDraft !== undefined) {
      raiseAll(touchedAsks());
      return;
    }
    const typing = { type: "raise", detent: "Typing" } as const;
    if (!shell.can(typing)) return;
    if (dock.state?.tucked) void dock.send({ type: "putAway", now: untimed });
    focusOnRevealRef.current = true;
    void shell.send(typing).then((sent) => { if (sent._tag === "Failure") focusOnRevealRef.current = false; });
  };
  const draftEditable = composer.can({ type: "edit", blank: false, long: false });
  const pullFromField = shell.state && browserFieldPull(shell.state, seen.typed === "", draftEditable);
  const handle = (variant: DockHandleProps["variant"]) => shell.state ? <DockHandle dock={dock} variant={variant} gesture={gesture} done={done} /> : undefined;
  const grabber = handle(open ? "handle" : "mark");
  const scrim = !onComms && !live && !dock.state?.voice && currentView !== "Camera" && (assistantDetent === "Sheet" || assistantDetent === "Typing");

  return (
    <>
      <AssistantAttachments runtime={runtime} attachments={attachments} preview={previewed} notice={seen.attachmentNotice} composerRef={composerRef} route={searchRoute} />
      {onComms && full && <DragStrip gesture={gesture}><CommsTarget runtime={runtime} placement="strip" /></DragStrip>}
      {scrim ? <ChatScrim typing={assistantDetent === "Typing"} field={composerRef} onLower={() => { if (shell.can(back)) void shell.send(back); }} /> : null}
      {(!onComms || open || leaving) && <AssistantConversation
        ref={sheetRef}
        data-alpha-dragging={live ? "true" : undefined}
        data-alpha-typing={assistantDetent === "Typing" ? "" : undefined}
        voicePanel={voicePanel}
        detent={live && !onComms ? "sheet" : assistantDetent === "Full" ? "full" : assistantDetent === "Sheet" ? "sheet" : "bar"}
        underlay={underlay && !onComms ? currentView !== undefined && currentView !== "Browser" ? "pill" : "bar" : undefined}
        inert={leaving || undefined}
        barDrag={shell.state ? { onStart: gesture.onPress, onDrag: gesture.onDrag, onRelease: gesture.onRelease, onCancel: gesture.onCancel, from: compact ? "pill" : "bar",
          onLift: () => { void dock.send({ type: "press", detent: assistantDetent, now: untimed }).then(() => dock.send({ type: "lift", now: untimed })); } } : undefined}
        className={onComms ? "relative w-full" : open || live ? "fixed inset-x-0 bottom-0 mx-auto max-w-md" : compact ? "pointer-events-none sticky bottom-0" : "sticky bottom-0"}
        style={onComms && !live && assistantDetent === "Full" ? { ...sheetStyle, height: "calc(100dvh - 52px)" } : sheetStyle}
        header={{
          title: seen.titles.get(shown.chosen) ?? "Ask Alpha",
          context: { view, sensitive: talking.context.sensitive },
          subtitle: onComms ? <CommsTarget runtime={runtime} placement="context" /> : undefined,
          returnOnClose: textAsk,
          onHome: textAsk ? onBack : () => void runtime.runPromise(home()),
          onClose: textAsk ? onBack : open || live ? () => {
            if (shell.can(back)) void shell.send(back).then((lowered) => { if (full && lowered._tag === "Success" && shell.can(back)) void shell.send(back); });
          } : undefined,
          expanded: assistantDetent === "Full",
          onResize: textAsk ? undefined : assistantDetent === "Full"
            ? (shell.can(back) ? () => void shell.send(back) : undefined)
            : shell.can({ type: "raise", detent: "Full" }) ? () => void shell.send({ type: "raise", detent: "Full" }) : undefined,
          grabber: textAsk ? undefined : open ? grabber : live ? handle("handle") : undefined,
        }}
        contextAction={onComms && assistantDetent === "Sheet" && onBack && returnTo !== undefined &&
          shell.can({ type: "returnCommsView", previous: returnTo }) ? (
            <div className="flex shrink-0 px-3 pb-1">
              <Button variant="secondary" className="h-11 gap-1 px-3.5 text-sm font-semibold"
                data-alpha-stage-return="" aria-label={`Return to ${returnTo}`} onClick={onBack}>
                {returnTo}
              </Button>
            </div>
          ) : undefined}
        attachmentNotice={onComms ? undefined : seen.attachmentNotice}
        transcript={{
          ...transcript, briefing: brief === "" ? undefined : <AssistantNoticeCard key={`briefing:${subject}`} title="Phone" detail={brief} />,
          standing: heldDraft,
        }}
        composer={{
          ...speechProps,
          className: compact ? "[&>div]:pointer-events-auto [&>section]:pointer-events-auto" : undefined,
          lift: lift > 0 ? lift : undefined,
          ...(live && !open ? { variant: "bar" as const } : {}),
          voice: voicePanel ?? renderVoice?.({ compactDock: compact, atBar: assistantDetent === "Bar" }),
          onDictate: onComms || inFlight(talking.turn) || !speech?.onDictate ? undefined : () => {
            openSheet();
            speech.onDictate?.();
          },
          fieldRef: composerField,
          fieldPull: pullFromField ? {
            ...gesture,
            onLift: () => { void dock.send({ type: "fieldLift", now: untimed }); },
          } : undefined,
          value: subject === undefined ? seen.typed : request,
          onValueChange: type,
          placeholder: onComms ? "Ask Alpha" : undefined,
          leading: onComms ? <CommsTarget runtime={runtime} placement="composer" /> : undefined,
          closed: subject === undefined && !draftEditable,
          notice: notice === undefined || onComms ? undefined : { status: notice },
          unavailable: !talking.ready ? "away" : talking.context.sensitive ? "sensitive" : undefined,
          attachments: onComms ? contactFiles.map(chip) : waiting(writing, draftFiles, transcriptTitle),
          onPreviewAttachment: canPreview ? (id) => {
            const file = (onComms ? contactFiles : draftFiles).find((one) => one.id === id);
            if (file) preview(file);
          } : undefined,
          quote: onComms ? undefined : quoted,
          editing: !onComms && writing.editor.editing > 0,
          opener: !open ? grabber : undefined,
          onOpen: !open && !grabber ? openSheet : undefined,
          onType: compact ? revealComposer : undefined,
          // spec/app/assistant/dock.md, "A bar or pill a drag left in place changes between them without an entrance until the sheet next opens"
          still: dock.state?.placed === true,
          onSend: sendable && !inFlight(talking.turn) ? () => {
            if (!open) openSheet();
            send();
          } : undefined,
          onStop: conversation.can({ type: "stop" }) ? () => void conversation.send({ type: "stop" }) : undefined,
          stopping: talking.turn.stopping,
          onAttach: selectedContact !== undefined && searchRoute !== undefined && contactFiles.length < maxFiles && !inFlight(talking.turn)
            ? () => { void runtime.runPromise(openContactAttachmentPicker(searchRoute, selectedContact)); }
            : !onComms && composer.can({ type: "attach", count: 1 }) ? () => {
              openLiveAttachments(runtime, attachments, board);
            } : undefined,
          onFocusField: () => raiseAll(touchedAsks()),
          onBlur: assistantDetent === "Typing" && !onComms ? (event) => {
            const next = event.relatedTarget;
            if (next instanceof Element && (event.currentTarget.contains(next) || next.closest("[role='menu'], [role='dialog'], [role='alertdialog']"))) return;
            void runtime.runPromise(restTyping);
          } : undefined,
          onSearch: history.search,
          onRemoveAttachment: onComms ? contactDraft === undefined || inFlight(talking.turn) ? undefined : (id) => {
            void runtime.runPromise(removeContactFile(contactDraft.target, id));
          } : (id) => removeAttachmentById(id, runtime, composer, mail),
          onUnquote: composer.can({ type: "unquote" }) ? () => void composer.send({ type: "unquote" }) : undefined,
          onStopEditing: composer.can({ type: "stopEditing" }) ? () => void composer.send({ type: "stopEditing" }) : undefined,
        }}
      />}
      <MailReviewDialogs open={!onComms && open} review={reviewed} attach={attachMail} dismiss={dismissMail} />
      {history.sheets}
    </>
  );
}
