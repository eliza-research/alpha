/**
 * Alpha's phone half of the canonical device-action queue: the shared
 * coordinator (plugin-assistant device-actions/client-coordinator) with the
 * owner-facing presentation Alpha owns. It binds each review to the exact
 * screen it was shown on, writes the review card and context notices, and runs
 * approve → claim → execute → receipt with a durable journal reserved before
 * any device effect.
 *
 * The wire and journal types, operation validation, action scopes, receipt
 * statuses, executor refusals and committed-change publication are read from
 * the shared module; the per-domain review text is Alpha's (ui/clock, ui/files,
 * ui/notes, ui/photos and ./device-record-presentation).
 *
 * Invariants:
 * - Only authenticated structured proposals enter; reply prose never does.
 * - A journal reservation precedes dispatch; an existing reservation refuses
 *   a second effect for the same proposal.
 * - An effect whose outcome is not confirmed is recorded as `unknown` and is
 *   never repeated automatically. Receipt upload retries only replay the exact
 *   journaled result; recovery reads durable native evidence, never dispatches.
 * - Cancellation retires the renderer attempt; a result already produced by the
 *   journaled native attempt is still recorded.
 */
import { NOTES_LIST_FILTER_CAPABILITY } from "@elizaos/contracts";
import {
  browserDestinationMatches,
  directBrowserDestination,
  directBrowserSearchQuery,
  groundBrowserDestination,
  groundBrowserSearchQuery,
} from "@elizaos/contracts/browser-request-grounding";
import { createDeviceActionExecution } from "@elizaos/contracts/device-action-execution";
import {
  isNativeNotesQuery,
  isOriginalDeviceReadOperationType,
  type NativeNotesReadReply,
  type NativeNotesReadReplyHint,
  type NativeNotesReadReplyOrigin,
  NOTES_QUERY_CAPABILITY,
  validateNativeNotesReadReply,
  validateNativeNotesReadReplyHint,
  validateNativeNotesReadReplyOrigin,
} from "@elizaos/contracts/native-notes-query";
import {
  isPhoneDial,
  type PhoneDialResult,
  phoneDialCapabilityAvailable,
  validatePhoneDialResult,
} from "@elizaos/contracts/phone-dial";
import {
  isSmsSend,
  SMS_SEND_CAPABILITY,
  type SmsSendResult,
  validateSmsResult,
} from "@elizaos/contracts/sms-send";
import {
  CALENDAR_AGENDA_CAPABILITY,
  type CalendarOperation,
  type CalendarResult,
  calendarCapabilityAvailable,
  calendarSource,
  isCalendarOperation,
  validateCalendarResult,
} from "@elizaos/plugin-assistant/device-calendar-contract";
import {
  type CameraCaptureResult,
  cameraCaptureCapabilityAvailable,
  isCameraCapture,
  validateCameraCaptureResult,
} from "@elizaos/plugin-assistant/device-actions/camera-contract";
import {
  BROWSER_CONTROL_DIRECT_TYPES,
  browserControlCapabilityAvailable,
  describeBrowserControl,
  isBrowserControl,
} from "@elizaos/plugin-assistant/device-actions/browser-contract";
import type {
  ClockHandoffResult,
} from "@elizaos/plugin-assistant/device-actions/clock-contract";
import {
  assertClockHandoffTimeZone,
  clockHandoffReceipt,
  isClockHandoffOperation,
} from "@elizaos/plugin-assistant/device-clock-review";
import {
  FILES_CAPABILITY,
  FILES_DIRECT_TYPES,
  type FilesAgentOperation,
  type FilesIdentity,
  filesContextAllowed,
  filesNeedsIdentity,
  isFilesOperation,
  validateFilesOperation,
} from "@elizaos/plugin-assistant/device-actions/files-browser-contract";
import {
  type ForegroundReviewOperation,
  type ForegroundReviewResult,
  foregroundReviewOperationAvailable,
  isForegroundReviewOperation,
  validateForegroundReviewResult,
} from "@elizaos/plugin-assistant/device-foreground-review";
import {
  isMapsOperation,
  type MapsOperation,
  type MapsResult,
  validateMapsResult,
} from "@elizaos/plugin-assistant/device-actions/maps-contract";
import {
  isNotesOperation,
  type NotesOperation,
  type NotesResult,
  validateNotesResult,
} from "@elizaos/plugin-assistant/device-actions/notes-contract";
import {
  isNotesOrganizeOperation,
  NOTES_ORGANIZE_CAPABILITY,
  NOTES_ORGANIZE_DIRECT_TYPES,
  notesOrganizeContextAllowed,
} from "@elizaos/plugin-assistant/device-actions/notes-organize-contract";
import {
  type NotesQueryResult,
  validateNotesQueryResult,
} from "@elizaos/plugin-assistant/device-actions/notes-query-result";
import {
  isLibraryOperation,
  type LibraryAgentResult,
  PHOTO_LIBRARY_CAPABILITY,
  validateLibraryResult,
} from "@elizaos/plugin-assistant/device-actions/photo-library-contract";
import {
  isPhotosViewOperation,
  PHOTOS_VIEW_DIRECT_TYPES,
  type PhotosViewResult,
  photosViewCapabilityAvailable,
  photosViewContextAllowed,
  validatePhotosViewResult,
} from "@elizaos/plugin-assistant/device-actions/photos-view-contract";
import {
  isReminderOperation,
  type ReminderOperation,
  type ReminderResult,
  validateReminderResult,
} from "@elizaos/plugin-assistant/device-actions/reminder-contract";
import {
  isReminderCreate,
  type ReminderCreateResult,
  validateReminderCreateResult,
} from "@elizaos/plugin-assistant/device-actions/reminder-create-contract";
import {
  isSmsCompose,
  isTelephonyAction,
  isTelephonyRead,
  selectedTelephonyView,
  type TelephonyActionOperation,
  type TelephonyActionResult,
  smsComposeTarget,
  telephonyActionCapabilityAvailable,
  telephonyActionFormAvailable,
  validateTelephonyActionResult,
} from "@elizaos/plugin-assistant/device-actions/telephony-actions-contract";
import type {
  WorkflowDeviceBinding,
  WorkflowDeviceTarget,
  WorkflowReadResult,
} from "@elizaos/plugin-assistant/device-actions/workflow-contract";
import {
  actionScope,
  type CurrentDeviceActionRequest,
  type DeviceActionClientProfile,
  type DeviceActionCoordinatorPorts,
  type DeviceActionJournal,
  type DeviceActionProposalCard,
  DeviceActionNotStarted,
  type DeviceClientSession,
  type DeviceContextEnvelope,
  type DeviceCommittedChange,
  type DeviceCredential,
  type DeviceExecutionResult,
  type DeviceJournalEntry,
  type DeviceOperationReceipt,
  type DeviceProposal,
  type DeviceWorkflowReview,
  deviceJournalContext,
  dialDeviceStatus,
  type PendingReviewItem,
  type ReviewableDeviceOperation,
  smsAgentHash,
  smsDeviceStatus,
  telephonyDeviceStatus,
  validateReviewableDeviceOperation,
} from "@elizaos/plugin-assistant/device-actions/client-coordinator";
import { describeClockHandoff } from "../clock/clock-handoff-presentation.ts";
import { describeFilesOperation } from "../files/files-operation-presentation.ts";
import { describeNotesOrganizeOperation } from "../notes/notes-organize-presentation.ts";
import { describeLibraryOperation } from "../photos/library-presentation.ts";
import { describePhotosViewOperation } from "../photos/photos-view-presentation.ts";
import { formatDeviceRecordDateTime } from "./device-record-presentation.ts";
import { sharedValidatorRefusal } from "./device-action-messages.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid device action response");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error("Invalid device action field");
  return value;
}
function id(value: unknown): string {
  const valueText = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(valueText))
    throw new Error("Invalid device action identifier");
  return valueText;
}

// ── Screen binding ──────────────────────────────────────────────────────────

export const CAMERA_CONTEXT_NOTICE = "Open Camera to take the requested photo.";
/** A camera capture that only needs Camera open also names the message that asked for it. */
export type ReviewItem = PendingReviewItem & {
  cameraRequestMessageId?: string;
};
/**
 * Whether a reply must open Camera on this phone for the photo its own message asked for.
 * A photo is only ever taken on the visible Camera viewfinder, so a photo waiting only on
 * Camera is shown there first. Camera is not opened when the agent already navigates
 * (`viewHandoff`), when the request was not this message's, or when another action of
 * this turn is reviewable on the current screen and leaving it would drop that review.
 */
export function requestedCameraNeedsCameraView(
  items: readonly ReviewItem[],
  messageId: string | undefined,
  viewHandoff: boolean,
): boolean {
  if (!messageId || viewHandoff) return false;
  return (
    items.some((item) => item.cameraRequestMessageId === messageId) &&
    !items.some((item) => item.proposal)
  );
}
/** A pending proposal that does not fit the current screen. Its message is shown to the owner. */
export class ContextNotice extends Error {
  override readonly name = "ContextNotice";
}
type ScreenPorts<C extends DeviceContextEnvelope> = Pick<
  DeviceActionClientProfile<C, DeviceWorkflowReview>,
  "mapsSelectionCurrent" | "namedCalendarReadTarget" | "foregroundHidden"
>;
function contextKey(value: DeviceContextEnvelope): string {
  const selected = value.selectedObject;
  return JSON.stringify([
    value.view,
    value.sensitive === true,
    value.revision,
    value.timeZone ?? null,
    selected
      ? [
          selected.kind,
          selected.id,
          selected.revision ?? null,
          selected.accountId ?? null,
          selected.sourceRevision ?? null,
          selected.occurrenceId ?? null,
        ]
      : null,
  ]);
}
function assertCalendarContext(
  operation: CalendarOperation,
  context: DeviceContextEnvelope,
) {
  if (
    operation.type === "calendar_create_local" ||
    operation.type === "calendar_read_next"
  ) {
    if (context.sensitive)
      throw Error("Return to the unlocked phone and review Calendar access");
    return;
  }
  const selected = context.selectedObject;
  if (context.view !== "calendar" || context.sensitive || !selected)
    throw Error("Open the selected calendar source or event");
  if (operation.type === "calendar_create") {
    if (
      selected.kind !== "calendar-source" ||
      selected.id !== operation.source.sourceId ||
      selected.revision !== operation.source.sourceRevision
    )
      throw Error("Calendar source changed");
  } else if (
    selected.kind !== "calendar-event" ||
    selected.id !== operation.target.eventId ||
    selected.revision !== operation.target.revision ||
    selected.accountId !== operation.target.sourceId ||
    selected.sourceRevision !== operation.target.sourceRevision
  )
    throw Error("Selected calendar event changed");
}
function assertMapsContext(
  operation: MapsOperation,
  context: DeviceContextEnvelope,
  ports: Pick<ScreenPorts<DeviceContextEnvelope>, "mapsSelectionCurrent">,
) {
  const selected = context.selectedObject,
    t = operation.target;
  if (
    context.sensitive ||
    context.view !== "maps" ||
    !selected ||
    selected.kind !== t.kind ||
    selected.id !== t.id ||
    selected.revision !== t.revision ||
    !ports.mapsSelectionCurrent(t)
  )
    throw Error("Selected Maps context changed");
}
/** Device library operations run only where the owner sees Photos on the unlocked phone. */
function assertLibraryContext(context: DeviceContextEnvelope) {
  if (context.sensitive || context.view !== "photos")
    throw Error("Open Photos to review this library action");
}
function assertReminderContext(
  operation: ReminderOperation,
  context: DeviceContextEnvelope,
) {
  const s = context.selectedObject,
    t = operation.target;
  if (
    context.sensitive ||
    context.view !== "calendar" ||
    !s ||
    s.kind !== "reminder" ||
    s.id !== t.reminderId ||
    s.revision !== t.revision ||
    s.accountId !== t.sourceId ||
    s.sourceRevision !== t.sourceRevision ||
    s.occurrenceId !== t.occurrenceId ||
    s.timingVersion !== t.timingVersion
  )
    throw Error("Selected reminder context changed");
}
function assertNotesQueryContext(context: DeviceContextEnvelope) {
  if (context.sensitive || !["home", "notes"].includes(context.view))
    throw Error("Review this Notes query from Home or Notes");
}
function assertNotesContext(
  operation: NotesOperation,
  context: DeviceContextEnvelope,
) {
  const s = context.selectedObject,
    t = operation.target;
  if (
    context.sensitive ||
    context.view !== "notes" ||
    !s ||
    s.kind !== "note" ||
    s.id !== t.noteId ||
    s.revision !== t.revision ||
    s.accountId !== t.sourceId ||
    s.sourceRevision !== t.sourceRevision
  )
    throw Error("Selected note context changed");
}
/** Foreground reviews resolve locally; they are offered only where the owner can see the result. */
function assertForegroundContext<C extends DeviceContextEnvelope>(
  operation: ForegroundReviewOperation,
  context: C,
  ports: Pick<ScreenPorts<C>, "namedCalendarReadTarget">,
) {
  if (context.sensitive)
    throw new ContextNotice("Unlock the phone to review this action.");
  if (operation.type === "calendar_availability") {
    if (!["home", "calendar"].includes(context.view))
      throw new ContextNotice(
        "Open Home or Calendar to review this availability check.",
      );
    // All-day events block the owner's local days, so the check must use this phone's time zone.
    if (operation.timeZone !== context.timeZone)
      throw new ContextNotice(
        "This availability check used a different time zone. Ask again from this phone.",
      );
    return;
  }
  if (operation.type === "calendar_named" && operation.action === "read") {
    if (!ports.namedCalendarReadTarget(context))
      throw new ContextNotice(
        "Choose the matching event in Calendar before sharing it.",
      );
    return;
  }
  if (operation.type === "notes_search") {
    if (!["home", "notes"].includes(context.view))
      throw new ContextNotice(
        "Open Home or Notes to review this Notes search.",
      );
    return;
  }
  // Name-targeted edits are requested from Home and resolved by a local choice, never by a selection elsewhere.
  if (context.view !== "home")
    throw new ContextNotice(
      "Return to Home to choose the record for this action.",
    );
}
/** Every screen rule for a proposal; throws when the current screen cannot review it. */
function assertProposalContext<C extends DeviceContextEnvelope>(
  operation: ReviewableDeviceOperation,
  context: C,
  ports: ScreenPorts<C>,
) {
  if (
    operation.type === "read_calendar_range" &&
    (context.sensitive || ports.foregroundHidden())
  )
    throw new ContextNotice(
      "Unlock this foreground Calendar read before approving it.",
    );
  if (
    isCameraCapture(operation) &&
    (context.sensitive || context.view !== "camera")
  )
    throw new ContextNotice(CAMERA_CONTEXT_NOTICE);
  if (isForegroundReviewOperation(operation))
    assertForegroundContext(operation, context, ports);
  if (isPhoneDial(operation) && (context.sensitive || ports.foregroundHidden()))
    throw new ContextNotice(
      "Unlock the phone and keep it open to review this number.",
    );
  // Calls, contact changes, contact SMS, voicemail deletion and reads of the
  // open thread or voicemail never run on a locked or hidden phone.
  if (
    isTelephonyAction(operation) &&
    (context.sensitive || ports.foregroundHidden())
  )
    throw new ContextNotice(
      isTelephonyRead(operation)
        ? "Unlock the phone and keep it open to share this."
        : "Unlock the phone and keep it open to review this action.",
    );
  if (
    isSmsSend(operation) &&
    (context.sensitive ||
      context.view !== "messages" ||
      context.selectedObject?.kind !== "sms-subscription" ||
      context.selectedObject.id !== String(operation.subscriptionId))
  )
    throw new ContextNotice(
      "Open Messages and select the reviewed SIM before approving SMS.",
    );
  if (isClockHandoffOperation(operation))
    assertClockHandoffTimeZone(operation, context.timeZone);
  if (isMapsOperation(operation)) assertMapsContext(operation, context, ports);
  if (isLibraryOperation(operation)) assertLibraryContext(context);
  if (
    isNotesOrganizeOperation(operation) &&
    !notesOrganizeContextAllowed(context, operation)
  )
    throw new ContextNotice(
      operation.type === "notes_list_filter"
        ? "Open the Notes list to filter it."
        : operation.type === "notes_record"
          ? "Open Notes to record a voice note."
          : "Open Home or Notes to review this Notes action.",
    );
  if (isFilesOperation(operation) && !filesContextAllowed(operation, context))
    throw new ContextNotice(
      context.sensitive
        ? "Unlock the phone to review this action."
        : "Open Files to review this action.",
    );
  if (isPhotosViewOperation(operation) && !photosViewContextAllowed(context))
    throw new ContextNotice(
      context.sensitive
        ? "Unlock the phone to review this action."
        : "Open Photos to review this action.",
    );
  if (isBrowserControl(operation) && context.sensitive)
    throw new ContextNotice("Unlock the phone to review this action.");
  if (isReminderOperation(operation)) assertReminderContext(operation, context);
  if (isNativeNotesQuery(operation)) assertNotesQueryContext(context);
  if (isNotesOperation(operation)) assertNotesContext(operation, context);
  if (isCalendarOperation(operation)) assertCalendarContext(operation, context);
}
/** Owner-facing reason a pending proposal cannot be reviewed from this screen, or undefined. */
export function proposalContextNotice<C extends DeviceContextEnvelope>(
  operation: ReviewableDeviceOperation,
  context: C,
  ports: ScreenPorts<C>,
): string | undefined {
  try {
    assertProposalContext(operation, context, ports);
    return undefined;
  } catch (error) {
    if (error instanceof ContextNotice) return error.message;
    if (context.sensitive) return "Unlock the phone to review this action.";
    if (isClockHandoffOperation(operation))
      return "This Clock request used a different time zone. Ask again from this phone.";
    if (isMapsOperation(operation))
      return "Open the selected place or route in Maps to review this action.";
    if (isLibraryOperation(operation))
      return "Open Photos to review this action.";
    if (isReminderOperation(operation))
      return "Open the selected reminder in Calendar to review this action.";
    if (isNativeNotesQuery(operation))
      return "Open Home or Notes to review this Notes search.";
    if (isNotesOperation(operation))
      return "Open the selected note to review this action.";
    if (isCalendarOperation(operation))
      return operation.type === "calendar_create"
        ? "Open the selected calendar to review this action."
        : "Open the selected calendar event to review this action.";
    return "Return to the screen this action was requested from to review it.";
  }
}

// ── Review copy ─────────────────────────────────────────────────────────────

const quoted = (value: string) => `“${value}”`;
function describeForegroundReview(
  op: ForegroundReviewOperation,
  timeZone?: string,
): { title: string; description: string } {
  if (op.type === "calendar_availability") {
    const zone = timeZone ?? op.timeZone;
    return {
      title: "Check availability",
      description: `Check whether you are free from ${formatDeviceRecordDateTime(op.start, zone)} to ${formatDeviceRecordDateTime(op.end, zone)} (${zone}).\nYou choose which calendars this phone reads. Only busy times are shared with the agent, not event titles or details. Events marked free are ignored; all-day events count as busy.`,
    };
  }
  if (op.type === "calendar_named" && op.action === "read")
    return {
      title: "Share matching event",
      description: `Choose the event named ${quoted(op.name)} in Calendar, then review the details to share. The edit needs a separate confirmation.`,
    };
  if (op.type === "notes_search")
    return op.query.kind === "content"
      ? {
          title: "Search notes",
          description: `Search your notes for ${quoted(op.query.text)} on this phone.\nChoose and review one note before its text is shared. Other notes stay on this phone.`,
        }
      : {
          title: "List note titles",
          description: `List up to ${op.query.limit} note titles on this phone.\nReview the exact titles before they are shared. Note text is not shared.`,
        };
  const noun =
    op.type === "notes_named"
      ? "note"
      : op.type === "calendar_named"
        ? "event"
        : "reminder";
  const verb =
    op.action === "update"
      ? "Edit"
      : op.action === "delete"
        ? "Delete"
        : "Cancel";
  const where =
    op.type === "notes_named"
      ? "Notes"
      : op.type === "calendar_named"
        ? "Calendar"
        : "Reminders";
  let change = "";
  if (op.action === "update") {
    if (op.type === "notes_named")
      change = `\nNew title: ${quoted(op.fields.title)}\n${op.fields.body}`;
    else if (op.type === "calendar_named")
      change = `\nNew title: ${quoted(op.fields.title)}\n${formatDeviceRecordDateTime(op.fields.start, op.fields.timeZone)} to ${formatDeviceRecordDateTime(op.fields.end, op.fields.timeZone)} (${op.fields.timeZone})`;
    else
      change = `\nNew title: ${quoted(op.fields.title)}${op.fields.body ? `\n${op.fields.body}` : ""}`;
  }
  return {
    title: `${verb} ${noun} by name`,
    description: `Find ${quoted(op.name)} in ${where} on this phone. You choose the exact ${noun}, then review this ${verb.toLowerCase()} again before anything changes.${change}`,
  };
}

// ── Coordinator ─────────────────────────────────────────────────────────────

type ExecutionResult = DeviceExecutionResult & {
  foregroundResult?: ForegroundReviewResult;
  cancelledBeforeCapture?: true;
  /**
   * The view change that shows a successful telephony outcome (the drafted
   * conversation, the filtered Contacts list). Like `presentBrowser`, it ends
   * the review it ran under, so it runs after the receipt attempt.
   */
  present?: () => void;
};
type CommittedReceiptResult = { result: unknown } | Record<string, never>;

/** Authenticated structured actions only. Neither reply prose nor restored history
 * can enter this boundary. A durable journal gates every device effect. */
export class DeviceActionCoordinator<
  C extends DeviceContextEnvelope = DeviceContextEnvelope,
  R extends DeviceWorkflowReview = DeviceWorkflowReview,
> {
  readonly session: DeviceClientSession;
  readonly credential: DeviceCredential;
  readonly scope: string;
  private reviewSequence = 0;
  private readonly filesReviews = new Map<
    string,
    { digest: string; identities: FilesIdentity[] }
  >();
  private proposals = new Map<
    string,
    {
      proposal: DeviceProposal;
      context: C;
      workflowReview?: R;
      requestKey?: string;
      currentRequest?: CurrentDeviceActionRequest;
    }
  >();
  private readReplies = new Map<
    string,
    {
      digest: string;
      origin: NativeNotesReadReplyOrigin;
      hint?: NativeNotesReadReplyHint;
      consumed?: boolean;
    }
  >();
  private busy = false;
  /** The proposal this instance is executing now; sync never settles it. */
  private executing: string | undefined;
  private readonly ports: DeviceActionCoordinatorPorts<C, R>;
  private browserAttempts = new Map<string, CurrentDeviceActionRequest>();
  private browserPolicy = new Map<
    string,
    { key: string; allowed: boolean; grounded: boolean }
  >();
  private selectedTelephonyRequests = new Map<
    string,
    { context: string; expiresAt: number }
  >();
  constructor(
    ports: DeviceActionCoordinatorPorts<C, R>,
    private readonly options: {
      currentRequestBrowserPolicy?: boolean;
      currentRequestTelephonyPolicy?: boolean;
      /** Whether a tab switch's words match several open tabs on this phone. */
      browserTabNeedsChoice?: (target: string) => boolean;
    } = {},
  ) {
    this.ports = ports;
    this.session = ports.session;
    this.credential = ports.credential;
    this.scope = ports.scope;
  }
  private requestKey(messageId: string): string {
    return JSON.stringify([
      this.scope,
      this.session.ownerId,
      this.session.agentId,
      this.session.sessionId,
      this.session.origin,
      this.credential.installationId,
      this.credential.enrollmentId,
      messageId,
    ]);
  }
  private browserAllowed(
    proposal: DeviceProposal,
    proof?: CurrentDeviceActionRequest,
  ): boolean {
    return this.browserRequest(proposal, proof).allowed;
  }
  /** How the owner's current message asks for a proposed destination or web
   * search: `allowed` when it is a direct request that may run without review,
   * `grounded` when the owner at least typed that address without refusing it,
   * or typed those search words. */
  private browserRequest(
    proposal: DeviceProposal,
    proof?: CurrentDeviceActionRequest,
  ): { allowed: boolean; grounded: boolean } {
    const operation = proposal.operation;
    if (
      !this.options.currentRequestBrowserPolicy ||
      (operation.type !== "browser_navigate" &&
        operation.type !== "browser_search")
    )
      return { allowed: true, grounded: true };
    if (!proof || proof.messageId !== proposal.requestMessageId)
      return { allowed: false, grounded: false };
    proof.current();
    const key = JSON.stringify([
      this.requestKey(proof.messageId),
      proposal.digest,
      proposal.operation,
      proof.text,
    ]);
    const cached = this.browserPolicy.get(proposal.id);
    if (cached?.key === key) return cached;
    // Automatic client effects need direct intent, not merely a URL or search
    // words mentioned in prose. The server reads the same grammar with the same
    // assistant name, so both agree on what a direct request is.
    const name = this.profile.assistantName;
    const allowed =
      operation.type === "browser_search"
        ? directBrowserSearchQuery(proof.text, name)?.toLowerCase() ===
          operation.query.toLowerCase()
        : browserDestinationMatches(
            operation,
            directBrowserDestination(proof.text, name),
          );
    const policy = {
      key,
      allowed,
      grounded:
        allowed ||
        (operation.type === "browser_search"
          ? groundBrowserSearchQuery(proof.text, operation.query) !== undefined
          : browserDestinationMatches(
              operation,
              groundBrowserDestination(proof.text, operation.url, name),
            )),
    };
    if (this.browserPolicy.has(proposal.id) || this.browserPolicy.size < 128)
      this.browserPolicy.set(proposal.id, policy);
    return policy;
  }
  private consumeBrowserRequest(proof: CurrentDeviceActionRequest): boolean {
    for (const [key, previous] of this.browserAttempts) {
      try {
        previous.current();
      } catch {
        this.browserAttempts.delete(key);
      }
    }
    const key = this.requestKey(proof.messageId);
    if (this.browserAttempts.has(key) || this.browserAttempts.size >= 128)
      return false;
    proof.current();
    this.browserAttempts.set(key, proof);
    return true;
  }
  get supportsCalendarAgenda(): boolean {
    return this.capability(CALENDAR_AGENDA_CAPABILITY);
  }
  private capability(name: string): boolean {
    return this.credential.capabilities?.includes(name) === true;
  }
  private get profile(): DeviceActionClientProfile<C, R> {
    return this.ports.profile;
  }
  private request(path: string, body: unknown, signal: AbortSignal) {
    return this.ports.request(path, body, signal);
  }
  private get journal(): DeviceActionJournal {
    return this.ports.journal;
  }
  private workflowTarget(): WorkflowDeviceTarget {
    return {
      installationId: this.credential.installationId,
      enrollmentId: this.credential.enrollmentId as string,
    };
  }
  private bindingHash(
    sessionId: string,
    proposal: Pick<DeviceProposal, "id" | "digest">,
    operationId: string,
  ): Promise<string> {
    return actionScope(
      JSON.stringify([
        this.scope,
        this.session.ownerId,
        this.session.agentId,
        sessionId,
        this.session.origin,
        this.credential.installationId,
        this.credential.enrollmentId,
        proposal.id,
        proposal.digest,
        operationId,
      ]),
    );
  }
  /** The journal entry was written by this owner, agent, origin and enrollment for this proposal. */
  private ownEntry(entry: DeviceJournalEntry, p: DeviceProposal): boolean {
    return (
      entry.record.digest === p.digest &&
      entry.record.ownerId === this.session.ownerId &&
      entry.record.agentId === this.session.agentId &&
      entry.record.origin === this.session.origin
    );
  }
  private ownDevice(entry: DeviceJournalEntry): boolean {
    return (
      entry.record.installationId === this.credential.installationId &&
      entry.record.enrollmentId === this.credential.enrollmentId
    );
  }
  private parse(value: unknown): DeviceProposal {
    const p = object(value),
      payload = object(p.payload),
      execution =
        p.execution && typeof p.execution === "object"
          ? (p.execution as Record<string, unknown>)
          : {};
    if (
      p.subjectUserId !== this.session.ownerId ||
      p.requestedBy !== this.session.agentId ||
      p.action !== "device_action" ||
      payload.action !== "device_action" ||
      payload.version !== 1 ||
      payload.installationId !== this.credential.installationId ||
      payload.enrollmentId !== this.credential.enrollmentId
    )
      throw new Error("Device action belongs to another identity");
    const expiresAt = Date.parse(text(p.expiresAt, 40)),
      digest = text(p.digest, 64);
    if (!Number.isFinite(expiresAt) || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Invalid action expiry or digest");
    const workflow =
        payload.workflow === undefined
          ? undefined
          : this.profile.workflow.parseBinding(payload.workflow),
      op = validateReviewableDeviceOperation(
        payload.operation,
        this.profile.operations,
      );
    if (
      isCameraCapture(op) &&
      !cameraCaptureCapabilityAvailable(op, this.credential.capabilities)
    )
      throw Error("Camera capture was not negotiated with this agent");
    if (
      isPhoneDial(op) &&
      !phoneDialCapabilityAvailable(op, this.credential.capabilities)
    )
      throw Error("Dialing was not negotiated with this phone");
    if (
      isTelephonyAction(op) &&
      (!telephonyActionCapabilityAvailable(
        op.type,
        this.credential.capabilities,
      ) ||
        !telephonyActionFormAvailable(op, this.credential.capabilities))
    )
      throw Error("This telephony action was not negotiated with this phone");
    if (isSmsSend(op) && !this.capability(SMS_SEND_CAPABILITY))
      throw Error("Native SMS was not negotiated with this phone");
    if (
      isCalendarOperation(op) &&
      (op.type === "calendar_create_local" ||
        op.type === "calendar_read_next") &&
      !calendarCapabilityAvailable(op.type, this.credential.capabilities)
    )
      throw Error(
        "This agent has not negotiated native Calendar creation or discovery. Reconnect to a compatible agent.",
      );
    if (isNativeNotesQuery(op) && !this.capability(NOTES_QUERY_CAPABILITY))
      throw Error("Notes discovery was not negotiated with this agent");
    if (isLibraryOperation(op) && !this.capability(PHOTO_LIBRARY_CAPABILITY))
      throw Error("Device library access was not negotiated with this agent");
    if (isFilesOperation(op) && !this.capability(FILES_CAPABILITY))
      throw Error("Files access was not negotiated with this agent");
    if (
      isNotesOrganizeOperation(op) &&
      !this.capability(
        op.type === "notes_list_filter"
          ? NOTES_LIST_FILTER_CAPABILITY
          : NOTES_ORGANIZE_CAPABILITY,
      )
    )
      throw Error("Notes folders were not negotiated with this agent");
    if (
      isPhotosViewOperation(op) &&
      !photosViewCapabilityAvailable(this.credential.capabilities)
    )
      throw Error("Photos actions were not negotiated with this agent");
    if (
      isBrowserControl(op) &&
      !browserControlCapabilityAvailable(op.type, this.credential.capabilities)
    )
      throw Error("This Browser action was not negotiated with this agent");
    if (
      isForegroundReviewOperation(op) &&
      (!foregroundReviewOperationAvailable(op, this.credential.capabilities) ||
        !this.ports.executeForeground)
    )
      throw Error(
        "This action was not negotiated with this agent. Reconnect to a compatible agent.",
      );
    if (isReminderCreate(op) && !this.ports.reminderCreate)
      throw Error(
        "This agent does not support reviewed reminder creation. Reconnect to a compatible agent.",
      );
    if (
      isReminderOperation(op) &&
      (op.target.timingVersion === 2 ||
        (op.type === "reminder_update" &&
          op.fields.schedule?.alertMinutes !== undefined)) &&
      !this.ports.reminderTimingV2
    )
      throw Error(
        "This agent does not support this reminder timing. Reconnect to a compatible agent.",
      );
    const agendaSource =
      payload.calendarAgendaSource === undefined
        ? undefined
        : calendarSource(payload.calendarAgendaSource);
    if (
      agendaSource &&
      (op.type !== "read_calendar_range" ||
        workflow ||
        !payload.requestMessageId ||
        op.calendarIds.length !== 1 ||
        op.calendarIds[0] !== agendaSource.sourceId ||
        !this.capability(CALENDAR_AGENDA_CAPABILITY))
    )
      throw Error("Standalone Calendar read was not negotiated or bound");
    if (
      [
        "read_selected_notes",
        "read_calendar_range",
        "read_selected_reminders",
        "post_notification",
        "speak_text",
      ].includes(op.type) &&
      !workflow &&
      !(op.type === "read_calendar_range" && agendaSource)
    )
      throw new Error("Workflow binding required for phone reads");
    const readReplyOrigin =
      p.readReplyOrigin === undefined
        ? undefined
        : validateNativeNotesReadReplyOrigin(p.readReplyOrigin);
    if (
      readReplyOrigin &&
      (workflow || !isOriginalDeviceReadOperationType(op.type))
    )
      throw Error("Unexpected original Notes reply");
    return {
      ...(agendaSource ? { calendarAgendaSource: agendaSource } : {}),
      providerReceipt: execution.providerReceipt,
      ...(payload.requestMessageId === undefined
        ? {}
        : { requestMessageId: id(payload.requestMessageId) }),
      id: id(p.id),
      digest,
      state: text(p.state, 32),
      expiresAt,
      operation: op,
      ...(workflow ? { workflow } : {}),
      ...(execution.providerIdempotencyKey
        ? { providerIdempotencyKey: id(execution.providerIdempotencyKey) }
        : {}),
      ...(execution.attemptId ? { attemptId: id(execution.attemptId) } : {}),
      ...(readReplyOrigin ? { readReplyOrigin } : {}),
    };
  }
  /** Each proposal is parsed on its own: one invalid proposal never hides valid siblings. */
  private async listing(signal: AbortSignal): Promise<{
    valid: DeviceProposal[];
    invalid: { pending: boolean; error: Error }[];
  }> {
    const response = object(
      await this.request("/api/client-devices/proposals", undefined, signal),
    );
    if (!Array.isArray(response.proposals))
      throw new Error("Invalid device action list");
    const valid: DeviceProposal[] = [],
      invalid: { pending: boolean; error: Error }[] = [];
    for (const value of response.proposals) {
      try {
        valid.push(this.parse(value));
      } catch (error) {
        const raw =
          value && typeof value === "object"
            ? (value as { state?: unknown; expiresAt?: unknown })
            : {};
        // An invalid proposal that is finished or has expired is history, not a pending notice.
        const expiresAt =
          typeof raw.expiresAt === "string"
            ? Date.parse(raw.expiresAt)
            : Number.NaN;
        invalid.push({
          pending:
            (raw.state === undefined || raw.state === "pending") &&
            !(expiresAt <= Date.now()),
          error:
            error instanceof Error ? error : new Error("Invalid device action"),
        });
      }
    }
    return { valid, invalid };
  }
  async list(signal: AbortSignal): Promise<DeviceProposal[]> {
    return (await this.listing(signal)).valid;
  }
  private notice(operation: ReviewableDeviceOperation, context: C) {
    return proposalContextNotice(operation, context, this.profile);
  }
  private card(proposal: DeviceProposal, context: C): DeviceActionProposalCard {
    const op = proposal.operation;
    const readReply = proposal.readReplyOrigin
      ? {
          readReply: {
            origin: structuredClone(proposal.readReplyOrigin),
            digest: proposal.digest,
          },
        }
      : {};
    const base = {
      id: proposal.id,
      expiresAt: proposal.expiresAt,
      contextRevision: context.revision,
    };
    if (isForegroundReviewOperation(op)) {
      const namedReadReady =
        op.type === "calendar_named" &&
        op.action === "read" &&
        !!this.profile.namedCalendarReadTarget(context);
      return {
        ...(op.type === "calendar_named" &&
        op.action === "read" &&
        !context.sensitive &&
        ["home", "calendar"].includes(context.view) &&
        !namedReadReady
          ? { reviewDestination: "calendar" as const }
          : {}),
        id: proposal.id,
        ...describeForegroundReview(op, context.timeZone),
        expiresAt: proposal.expiresAt,
        contextRevision: context.revision,
        ...((op.type === "calendar_availability" || namedReadReady) &&
          readReply),
      };
    }
    if (isPhoneDial(op))
      return {
        ...base,
        title: "Open dial screen",
        description: `${op.target.kind === "number" ? `Number: ${op.target.number}` : `Contact: ${op.target.query}`}\n\nOpens your phone app with this number. You place the call there.`,
      };
    if (isTelephonyAction(op))
      return { ...base, ...describeTelephonyAction(op), ...readReply };
    if (isSmsSend(op)) {
      const sim = this.profile.simLabel?.(op.subscriptionId);
      return {
        ...base,
        title: "Review SMS",
        description: `To: ${op.recipients.join(", ")}${sim ? `\nFrom: ${sim}` : ""}\n\n${op.body}\n\nConfirm again in Android.`,
      };
    }
    if (isCameraCapture(op))
      return {
        ...base,
        title: "Take photo",
        description: `Use the ${op.lens ?? "current"} camera and save one photo in Photos. The photo stays on this device.`,
      };
    if (isLibraryOperation(op))
      return { ...base, ...describeLibraryOperation(op, this.profile.appName) };
    if (isNotesOrganizeOperation(op))
      return { ...base, ...describeNotesOrganizeOperation(op) };
    if (isFilesOperation(op)) return { ...base, ...describeFilesOperation(op) };
    if (isPhotosViewOperation(op))
      return { ...base, ...describePhotosViewOperation(op) };
    if (isBrowserControl(op)) return { ...base, ...describeBrowserControl(op) };
    const notesDestination =
      (op.type === "notes_delete" || op.type === "notes_update") &&
      !context.sensitive &&
      ["home", "notes"].includes(context.view) &&
      this.notice(op, context)
        ? {
            reviewDestination: "notes" as const,
            reviewNoteTarget: structuredClone(op.target),
          }
        : {};
    const record =
      isReminderCreate(op) ||
      isReminderOperation(op) ||
      isNotesOperation(op) ||
      isCalendarOperation(op) ||
      op.type === "create_note" ||
      op.type === "create_reminder" ||
      op.type === "open_view"
        ? this.profile.presentRecord(op, context.timeZone)
        : undefined;
    const agenda = op.type === "read_calendar_range" && !proposal.workflow;
    const description = agenda
      ? `Share this app Calendar from ${formatDeviceRecordDateTime(op.start, op.timeZone)} to ${formatDeviceRecordDateTime(op.end, op.timeZone)} (end not included), in ${op.timeZone}. Only this range is shared; other calendars, descriptions, locations and guests stay private.`
      : isNativeNotesQuery(op)
        ? op.query.kind === "title"
          ? `Look for the title “${op.query.text}” locally. Choose and review one note before sharing its text.`
          : `Find the latest ${op.query.by} note locally. Unknown dates or ties require your choice; only the chosen note is shared.`
        : (record?.description ??
          (isClockHandoffOperation(op)
            ? describeClockHandoff(op, this.profile.appName)
            : isMapsOperation(op)
              ? "Share this place or route, with its mode and distance, with the agent."
              : op.type === "open_view"
                ? `Open ${op.view} on this phone`
                : op.type === "browser_navigate"
                  ? `Open browser destination ${op.url}`
                  : "Workflow phone read"));
    return {
      ...base,
      title: agenda
        ? "Share Calendar agenda"
        : (record?.title ?? op.type.replaceAll("_", " ")),
      description,
      ...notesDestination,
      ...(isNativeNotesQuery(op) && !["home", "notes"].includes(context.view)
        ? { reviewDestination: "home" as const }
        : {}),
      ...(isNativeNotesQuery(op) || op.type === "notes_read_selected"
        ? { privateNotesRead: true as const }
        : {}),
      ...readReply,
    };
  }
  private async review(
    context: C,
    signal: AbortSignal,
    proof?: CurrentDeviceActionRequest,
  ): Promise<{ items: ReviewItem[]; failures: Error[] }> {
    const sequence = ++this.reviewSequence;
    const assertCurrentReview = () => {
      signal.throwIfAborted();
      if (sequence !== this.reviewSequence)
        throw new DOMException(
          "A newer device action review replaced this request",
          "AbortError",
        );
    };
    const browserRequestKey = proof
      ? this.requestKey(proof.messageId)
      : undefined;
    const currentRequestPolicy =
      this.options.currentRequestBrowserPolicy ||
      this.options.currentRequestTelephonyPolicy;
    if (currentRequestPolicy) proof?.current();
    const { valid, invalid } = await this.listing(signal);
    assertCurrentReview();
    if (currentRequestPolicy && proof) {
      proof.current();
      if (browserRequestKey !== this.requestKey(proof.messageId))
        throw Error("The current device action request changed");
    }
    this.proposals.clear();
    for (const [id, binding] of this.selectedTelephonyRequests)
      if (binding.expiresAt <= Date.now())
        this.selectedTelephonyRequests.delete(id);
    const pendingIds = new Set(valid.map((proposal) => proposal.id));
    for (const id of this.filesReviews.keys())
      if (!pendingIds.has(id)) this.filesReviews.delete(id);
    for (const id of this.browserPolicy.keys())
      if (!pendingIds.has(id)) this.browserPolicy.delete(id);
    const items: ReviewItem[] = [];
    for (const proposal of valid) {
      // An approval whose claim never arrived is shown again: deciding is
      // idempotent for it, so a second tap reaches the claim.
      if (
        proposal.workflow ||
        !(
          proposal.state === "pending" ||
          (proposal.state === "approved" && !proposal.attemptId)
        ) ||
        proposal.expiresAt <= Date.now()
      )
        continue;
      if (
        this.options.currentRequestBrowserPolicy &&
        proof &&
        proposal.requestMessageId === proof.messageId &&
        // An address the owner typed without directly asking for it is not opened
        // automatically, but it keeps its ordinary review card below.
        !this.browserRequest(proposal, proof).grounded
      ) {
        items.push({
          proposalId: proposal.id,
          proposal: null,
          notice:
            "Browser action blocked: a matching current user request is required.",
        });
        continue;
      }
      const card = this.card(proposal, context),
        notice =
          (isNativeNotesQuery(proposal.operation) && !context.sensitive) ||
          card.reviewDestination === "notes" ||
          card.reviewDestination === "calendar"
            ? undefined
            : this.notice(proposal.operation, context);
      if (notice) {
        items.push({
          proposalId: proposal.id,
          proposal: null,
          notice: `${card.title}: ${notice}`,
          ...(notice === CAMERA_CONTEXT_NOTICE &&
          !context.sensitive &&
          proposal.requestMessageId
            ? { cameraRequestMessageId: proposal.requestMessageId }
            : {}),
        });
        continue;
      }
      const selectedView =
        this.options.currentRequestTelephonyPolicy &&
        selectedTelephonyView(proposal.operation);
      if (selectedView) {
        const messageId = proposal.requestMessageId;
        const binding = messageId
          ? this.selectedTelephonyRequests.get(messageId)
          : undefined;
        const selectionContext = contextKey(context);
        if (
          !messageId ||
          context.view !== selectedView ||
          (binding
            ? binding.context !== selectionContext
            : proof?.messageId !== messageId ||
              this.selectedTelephonyRequests.size >= 128)
        ) {
          items.push({
            proposalId: proposal.id,
            proposal: null,
            notice: `${card.title}: Ask again from the open ${selectedView === "messages" ? "conversation" : selectedView === "contacts" ? "contact" : "voicemail"}.`,
          });
          continue;
        }
        this.selectedTelephonyRequests.set(messageId, {
          context: selectionContext,
          expiresAt: Math.max(binding?.expiresAt ?? 0, proposal.expiresAt),
        });
      }
      // A Files move or trash binds the identity of each file as the card shows
      // it; whatever identity the agent sent is replaced.
      let reviewed = proposal;
      if (
        isFilesOperation(proposal.operation) &&
        filesNeedsIdentity(proposal.operation)
      ) {
        const op = proposal.operation;
        let operation: FilesAgentOperation | undefined;
        try {
          const before = this.filesReviews.get(proposal.id);
          const identities =
            before?.identities ??
            (await this.ports.filesIdentity?.(op.paths, signal));
          assertCurrentReview();
          // Once a card has been shown, a refresh must not bind its approval to replacement files.
          const recorded = this.filesReviews.get(proposal.id);
          if (
            identities &&
            (!recorded || recorded.digest === proposal.digest)
          ) {
            operation = validateFilesOperation({
              ...op,
              reviewed: recorded?.identities ?? identities,
            });
            if (
              !recorded &&
              isFilesOperation(operation) &&
              filesNeedsIdentity(operation) &&
              operation.reviewed
            )
              this.filesReviews.set(proposal.id, {
                digest: proposal.digest,
                identities: operation.reviewed,
              });
          }
        } catch {
          operation = undefined;
        }
        assertCurrentReview();
        if (!operation) {
          items.push({
            proposalId: proposal.id,
            proposal: null,
            notice: `${card.title}: These files are not in Files.`,
          });
          continue;
        }
        reviewed = { ...proposal, operation };
      }
      this.proposals.set(proposal.id, {
        proposal: reviewed,
        context: structuredClone(context),
        requestKey: browserRequestKey,
      });
      if (proposal.readReplyOrigin && !this.readReplies.has(proposal.id))
        this.readReplies.set(proposal.id, {
          digest: proposal.digest,
          origin: proposal.readReplyOrigin,
        });
      items.push({ proposalId: proposal.id, proposal: card });
    }
    const failures = invalid
      .filter((item) => item.pending)
      .map((item) => item.error);
    // The reason stays in `failures` for diagnostics; the owner sees a plain notice.
    items.push(
      ...failures.map(() => ({
        proposal: null,
        notice: "This action isn't available on this phone.",
      })),
    );
    return { items, failures };
  }
  /** Reviewable proposals plus owner-visible notices for pending ones that do not fit this screen. */
  async pendingReview(
    context: C,
    signal: AbortSignal,
    proof?: CurrentDeviceActionRequest,
  ): Promise<ReviewItem[]> {
    return (await this.review(context, signal, proof)).items;
  }
  /** Reviewable proposals only. An invalid proposal fails the call only when nothing else is reviewable. */
  async pending(
    context: C,
    signal: AbortSignal,
  ): Promise<DeviceActionProposalCard[]> {
    const { items, failures } = await this.review(context, signal);
    const proposals = items.flatMap((item) =>
      item.proposal ? [item.proposal] : [],
    );
    // The shared validator's reason stays the thrown error; the owner reads Alpha's notice for it.
    if (!proposals.length && failures.length)
      throw sharedValidatorRefusal(failures[0]);
    return proposals;
  }
  /** Only proposals bound by the host to this exact freshly sent user message may run.
   * Only reversible local actions bypass the optional review. Sends, deletes, private
   * reads and Calendar/reminder writes retain their recorded separate review policy.
   * A reply draft is such a local action: it lands in the open conversation's text
   * field, visible and editable, and only the owner's own Send tap sends it.
   * Recovery, workflows and old hosts remain review-only; ordinary OS permissions still apply. */
  async performRequested(
    messageId: string,
    context: C,
    signal: AbortSignal,
    allowed: () => Promise<boolean>,
    operationType?: ReviewableDeviceOperation["type"],
    proof?: CurrentDeviceActionRequest,
  ): Promise<DeviceOperationReceipt[]> {
    const directTypes: readonly ReviewableDeviceOperation["type"][] = [
      "create_note",
      "open_view",
      "browser_navigate",
      "camera_capture_photo",
      "photo_library_select",
      "sms_reply_selected",
      ...NOTES_ORGANIZE_DIRECT_TYPES,
      ...FILES_DIRECT_TYPES,
      ...PHOTOS_VIEW_DIRECT_TYPES,
      ...BROWSER_CONTROL_DIRECT_TYPES,
    ];
    const results: DeviceOperationReceipt[] = [];
    for (const [proposalId, entry] of [...this.proposals]) {
      if (
        results.length >= 4 ||
        !directTypes.includes(entry.proposal.operation.type) ||
        entry.proposal.workflow ||
        entry.proposal.requestMessageId !== messageId ||
        (operationType !== undefined &&
          entry.proposal.operation.type !== operationType)
      )
        continue;
      // A navigation-only card is not an executable read/write, even in direct-request mode.
      if (this.card(entry.proposal, context).reviewDestination) continue;
      // Words that match several tabs need the owner's pick, and only the
      // action's review card can show it.
      if (
        entry.proposal.operation.type === "browser_tab_switch" &&
        this.options.browserTabNeedsChoice?.(entry.proposal.operation.target)
      )
        continue;
      const browser =
        this.options.currentRequestBrowserPolicy &&
        (entry.proposal.operation.type === "browser_navigate" ||
          entry.proposal.operation.type === "browser_search");
      const requestKey = this.requestKey(messageId);
      if (
        browser &&
        proof?.messageId === messageId &&
        entry.requestKey === requestKey
      )
        signal.throwIfAborted();
      if (
        browser &&
        (!proof ||
          entry.requestKey !== requestKey ||
          proof.messageId !== messageId ||
          !this.browserAllowed(entry.proposal, proof))
      )
        continue;
      if (!(await allowed())) break;
      signal.throwIfAborted();
      if (browser) {
        if (
          this.proposals.get(proposalId) !== entry ||
          requestKey !== this.requestKey(messageId) ||
          !this.browserAllowed(entry.proposal, proof) ||
          !proof ||
          !this.consumeBrowserRequest(proof)
        )
          continue;
        entry.currentRequest = proof;
      }
      const result = await this.approve(proposalId, context, signal);
      results.push(result);
      if (result.status !== "succeeded" || signal.aborted) break;
    }
    return results;
  }
  private assertWorkflow(review: R, p: DeviceProposal) {
    this.profile.workflow.assertOperation(
      review,
      p.workflow as WorkflowDeviceBinding,
      this.workflowTarget(),
      p.operation as { type: string; [key: string]: unknown },
    );
  }
  /** Notice restoration validates pending metadata without creating an executable foreground review. */
  async pendingWorkflowNotice(
    review: R,
    signal: AbortSignal,
  ): Promise<Array<{ id: string; expiresAt: number }>> {
    if (review.finished || review.cancellationRequestedAt) return [];
    const pending = (await this.list(signal)).filter(
      (p) =>
        p.workflow?.runId === review.runId &&
        p.state === "pending" &&
        p.expiresAt > Date.now(),
    );
    signal.throwIfAborted();
    return pending.map((p) => {
      this.assertWorkflow(review, p);
      return { id: p.id, expiresAt: p.expiresAt };
    });
  }
  async pendingForWorkflow(
    review: R,
    context: C,
    signal: AbortSignal,
  ): Promise<DeviceActionProposalCard[]> {
    if (
      context.view !== "workflows" ||
      context.sensitive ||
      context.selectedObject?.kind !== "workflow-run" ||
      context.selectedObject.id !== review.runId ||
      context.selectedObject.revision !== review.versionId
    )
      throw new Error(
        "Open this exact workflow execution before reviewing phone steps",
      );
    const pending = (await this.list(signal)).filter(
      (p) =>
        p.workflow?.runId === review.runId &&
        p.state === "pending" &&
        p.expiresAt > Date.now(),
    );
    signal.throwIfAborted();
    this.proposals.clear();
    return pending.map((p) => {
      this.assertWorkflow(review, p);
      this.proposals.set(p.id, {
        proposal: p,
        context: structuredClone(context),
        workflowReview: structuredClone(review),
      });
      const op = p.operation;
      const w = p.workflow as WorkflowDeviceBinding;
      const scope =
        op.type === "read_selected_reminders"
          ? `Read reminders open by the end of ${op.day} (overdue included) and reminders completed that day, in ${op.timeZone}. At most ${op.maximumItems} reminders; overflow fails. Titles, due times and completion times will be sent; reminder notes and alarms are excluded.`
          : op.type === "read_selected_notes"
            ? `Read only ${op.notes.length} selected Notes at the recorded revisions. Text and titles will be sent to this agent.\nSelected IDs: ${op.notes.map((n: { id: string }) => n.id).join(", ")}`
            : op.type === "read_calendar_range"
              ? `Read calendars ${op.calendarIds.join(", ")} from ${op.start} up to (excluding) ${op.end}, shown in ${op.timeZone}. At most ${op.maximumEvents} events; overflow fails. Event titles, times and IDs will be sent; descriptions, locations and attendees are excluded.`
              : op.type === "create_note"
                ? `Save one note “${op.title}” on this phone:\n${op.body}`
                : op.type === "post_notification"
                  ? `Post this notification on this device: ${op.title}\n${op.body}`
                  : op.type === "speak_text"
                    ? `Read this exact text aloud on this device:\n${op.text}`
                    : "Unsupported phone step";
      const identity = `Owner: ${this.session.ownerId}\nWorkflow: ${w.workflowId}\nRun: ${w.runId}\nVersion: ${w.versionId}\nStep: ${w.stepId}\nSpec: ${w.specDigest}`;
      return {
        id: p.id,
        title: op.type.replaceAll("_", " "),
        reviewScope: `${scope}\nAgent: ${this.session.origin}`,
        reviewIdentity: identity,
        description: `Agent: ${this.session.origin}\n${identity}\n${scope}`,
        expiresAt: p.expiresAt,
        contextRevision: context.revision,
      };
    });
  }
  private async mutation(
    p: DeviceProposal,
    suffix: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<DeviceProposal> {
    if (
      isMapsOperation(p.operation) &&
      (suffix === "receipt" || suffix === "reconciliation") &&
      !this.profile.mapsSelectionCurrent(p.operation.target)
    )
      throw Error("Maps selection changed before upload");
    const response = object(
      await this.request(
        `/api/client-devices/proposals/${p.id}/${suffix}`,
        { digest: p.digest, ...body },
        signal,
      ),
    );
    const result = this.parse({
      ...object(response.proposal),
      digest: response.digest,
    });
    if (result.id !== p.id || result.digest !== p.digest)
      throw new Error("Device action changed during review");
    return result;
  }
  /** Validates an executor result against the reviewed operation before it is journaled. */
  private async typedResults(
    p: DeviceProposal,
    result: ExecutionResult,
    operationId: string,
    context: C,
  ) {
    const op = p.operation;
    let dialResult: PhoneDialResult | undefined;
    if (isPhoneDial(op)) {
      if (result.dialResult !== undefined) {
        dialResult = validatePhoneDialResult(op, result.dialResult);
        if (dialDeviceStatus(dialResult) !== result.status)
          throw Error("Dial outcome mismatch");
      } else if (result.status !== "unknown")
        throw Error("Missing dial result");
    } else if (result.dialResult !== undefined)
      throw Error("Unexpected dial result");
    let telephonyResult: TelephonyActionResult | undefined;
    if (isTelephonyAction(op)) {
      if (result.telephonyResult !== undefined) {
        telephonyResult = validateTelephonyActionResult(
          op,
          result.telephonyResult,
        );
        if (telephonyDeviceStatus(telephonyResult) !== result.status)
          throw Error("Telephony outcome mismatch");
      } else if (result.status !== "unknown")
        throw Error("Missing telephony result");
    } else if (result.telephonyResult !== undefined)
      throw Error("Unexpected telephony result");
    let smsResult: SmsSendResult | undefined;
    if (isSmsSend(op)) {
      if (result.smsResult !== undefined) {
        smsResult = validateSmsResult(
          op,
          result.smsResult,
          operationId,
          await smsAgentHash(op),
        );
        if (smsDeviceStatus(smsResult) !== result.status)
          throw Error("SMS outcome mismatch");
      } else if (result.status !== "unknown")
        throw Error("Missing SMS evidence");
    } else if (result.smsResult !== undefined)
      throw Error("Unexpected SMS result");
    let clockResult: ClockHandoffResult | undefined;
    if (isClockHandoffOperation(op)) {
      if (result.clockResult !== undefined) {
        clockResult = clockHandoffReceipt(op, result.clockResult);
        const expected =
          clockResult.status === "opened"
            ? "succeeded"
            : clockResult.status === "unknown"
              ? "unknown"
              : "failed";
        if (result.status !== expected)
          throw Error("Clock handoff outcome mismatch");
      } else if (result.status === "succeeded")
        throw Error("Missing Clock handoff result");
    } else if (result.clockResult !== undefined)
      throw Error("Unexpected Clock handoff result");
    let mapsResult: MapsResult | undefined;
    if (isMapsOperation(op)) {
      if (result.status === "succeeded")
        mapsResult = validateMapsResult(op, result.mapsResult);
      else if (result.mapsResult !== undefined)
        throw Error("Failed Maps read cannot return content");
    } else if (result.mapsResult !== undefined)
      throw Error("Unexpected Maps result");
    let cameraResult: CameraCaptureResult | undefined;
    if (isCameraCapture(op)) {
      if (result.status === "succeeded")
        cameraResult = validateCameraCaptureResult(
          result.cameraResult,
          operationId,
        );
      else if (result.cameraResult !== undefined)
        throw Error("Unconfirmed camera capture cannot return a saved photo");
    } else if (result.cameraResult !== undefined)
      throw Error("Unexpected camera result");
    let photoLibraryResult: LibraryAgentResult | PhotosViewResult | undefined;
    if (isLibraryOperation(op) || isPhotosViewOperation(op)) {
      if (result.status === "succeeded")
        photoLibraryResult = isPhotosViewOperation(op)
          ? validatePhotosViewResult(op, result.photoLibraryResult)
          : validateLibraryResult(op, result.photoLibraryResult);
      else if (result.photoLibraryResult !== undefined)
        throw Error("Failed library action cannot return content");
    } else if (result.photoLibraryResult !== undefined)
      throw Error("Unexpected library result");
    let reminderResult: ReminderResult | ReminderCreateResult | undefined;
    if (isReminderCreate(op)) {
      if (result.status === "succeeded")
        reminderResult = validateReminderCreateResult(
          op,
          result.reminderResult,
          operationId,
        );
      else if (result.reminderResult !== undefined)
        throw Error("Unconfirmed creation cannot return a result");
    } else if (isReminderOperation(op)) {
      if (result.status === "succeeded")
        reminderResult = validateReminderResult(op, result.reminderResult);
      else if (result.reminderResult !== undefined)
        throw Error("Unconfirmed reminder cannot return a result");
    } else if (result.reminderResult !== undefined)
      throw Error("Unexpected reminder result");
    if (isReminderOperation(op)) assertReminderContext(op, context);
    let notesResult: NotesResult | NotesQueryResult | undefined;
    if (isNativeNotesQuery(op)) {
      if (result.status === "succeeded")
        notesResult = validateNotesQueryResult(op, result.notesResult);
      else if (result.notesResult !== undefined)
        throw Error("Unconfirmed Notes query cannot return content");
    } else if (isNotesOperation(op)) {
      if (result.status === "succeeded")
        notesResult = validateNotesResult(op, result.notesResult);
      else if (result.notesResult !== undefined)
        throw Error("Failed Notes action cannot return content");
    } else if (result.notesResult !== undefined)
      throw Error("Unexpected Notes result");
    let calendarResult: CalendarResult | undefined;
    if (isCalendarOperation(op)) {
      if (result.status === "succeeded")
        calendarResult = validateCalendarResult(op, result.calendarResult);
      else if (result.calendarResult !== undefined)
        throw Error("Failed Calendar action cannot return content");
    } else if (result.calendarResult !== undefined)
      throw Error("Unexpected Calendar result");
    let foregroundResult: ForegroundReviewResult | undefined;
    if (isForegroundReviewOperation(op)) {
      if (result.status === "succeeded")
        foregroundResult = validateForegroundReviewResult(
          op,
          result.foregroundResult,
        );
      else if (result.foregroundResult !== undefined)
        throw Error("An unconfirmed review cannot return a result");
    } else if (result.foregroundResult !== undefined)
      throw Error("Unexpected foreground review result");
    let readResult: WorkflowReadResult | undefined;
    if (
      op.type === "read_selected_notes" ||
      op.type === "read_calendar_range" ||
      op.type === "read_selected_reminders"
    ) {
      if (result.status === "succeeded")
        readResult = await this.profile.workflow.validateResult(
          op,
          result.readResult,
        );
      else if (result.readResult !== undefined)
        throw new Error("Failed read cannot return content");
    } else if (result.readResult !== undefined)
      throw new Error("Unexpected read content");
    // Journal field order is part of the stored record shape; keep it stable.
    return {
      smsResult,
      dialResult,
      telephonyResult,
      clockResult,
      mapsResult,
      photoLibraryResult,
      cameraResult,
      readResult,
      calendarResult,
      notesResult,
      reminderResult,
      foregroundResult,
    };
  }
  async approve(
    proposalId: string,
    context: C,
    signal: AbortSignal,
  ): Promise<DeviceOperationReceipt> {
    if (this.busy) throw new Error("Another device action is being reviewed");
    const reviewed = this.proposals.get(proposalId);
    if (
      !reviewed ||
      contextKey(reviewed.context) !== contextKey(context) ||
      context.sensitive ||
      reviewed.proposal.expiresAt <= Date.now()
    )
      throw new Error("Review this action again from the current screen");
    if (isClockHandoffOperation(reviewed.proposal.operation))
      assertClockHandoffTimeZone(reviewed.proposal.operation, context.timeZone);
    if (isNativeNotesQuery(reviewed.proposal.operation))
      assertNotesQueryContext(context);
    if (
      isFilesOperation(reviewed.proposal.operation) &&
      filesNeedsIdentity(reviewed.proposal.operation) &&
      !reviewed.proposal.operation.reviewed
    )
      throw Error("Review these files again before making changes");
    const p = reviewed.proposal,
      // Minted before `busy` is taken: a context without randomUUID refuses
      // this approval instead of leaving the coordinator busy for good.
      // Both SMS operations use the proposal as the native journal identity.
      minted =
        isSmsSend(p.operation) || isSmsCompose(p.operation)
          ? p.id
          : crypto.randomUUID();
    this.busy = true;
    this.executing = proposalId;
    this.proposals.delete(proposalId);
    let execution: ReturnType<typeof createDeviceActionExecution> | undefined;
    try {
      const operationHash = await actionScope(JSON.stringify(p.operation));
      // A reservation left by an approval that never reached its claim is
      // adopted: nothing was dispatched under it, so this is the same attempt.
      const { entry: earlier } = await this.journal.get({
        scope: this.scope,
        proposalId,
      });
      const adopted =
        earlier?.phase === "reserved" &&
        !earlier.attemptId &&
        earlier.operationHash === operationHash &&
        this.ownEntry(earlier, p) &&
        this.ownDevice(earlier) &&
        (!(isSmsSend(p.operation) || isSmsCompose(p.operation)) ||
          earlier.operationId === p.id)
          ? earlier
          : undefined;
      const operationId = adopted?.operationId ?? minted;
      const assertCurrent = () => {
        assertProposalContext(p.operation, context, this.profile);
        if (reviewed.currentRequest) {
          reviewed.currentRequest.current();
          if (
            reviewed.requestKey !==
            this.requestKey(reviewed.currentRequest.messageId)
          )
            throw Error("The current device action request changed");
        }
      };
      execution = createDeviceActionExecution(
        { scope: this.scope, proposalId, operationId },
        signal,
        assertCurrent,
      );
      if (p.workflow) {
        if (!reviewed.workflowReview)
          throw new Error("Workflow step must be reviewed from its execution");
        this.assertWorkflow(reviewed.workflowReview, p);
      }
      execution.assertPrepared();
      const reserved = await this.journal.reserve({
        scope: this.scope,
        proposalId,
        operationId,
        operationHash,
        record: {
          digest: p.digest,
          operation: p.operation,
          context: deviceJournalContext(context),
          expiresAt: p.expiresAt,
          installationId: this.credential.installationId,
          enrollmentId: this.credential.enrollmentId,
          sessionId: this.session.sessionId,
          ownerId: this.session.ownerId,
          agentId: this.session.agentId,
          origin: this.session.origin,
          ...(p.workflow ? { workflow: p.workflow } : {}),
        },
      });
      if (
        !reserved.created &&
        !(
          adopted &&
          reserved.entry.phase === "reserved" &&
          !reserved.entry.attemptId &&
          reserved.entry.operationId === adopted.operationId &&
          reserved.entry.operationHash === operationHash
        )
      )
        return {
          proposalId,
          status: "unknown",
          summary:
            "This action already has a device journal entry. Review action history; it was not repeated.",
        };
      execution.assertIdentity(reserved.entry);
      execution.assertPrepared();
      await this.mutation(p, "decision", { decision: "approve" }, signal);
      execution.assertPrepared();
      const claimed = await this.mutation(p, "claim", {}, signal);
      if (
        (isSmsSend(p.operation) || isSmsCompose(p.operation)) &&
        claimed.providerIdempotencyKey !== operationId
      )
        throw Error("SMS execution claim identity changed");
      if (!claimed.attemptId || claimed.state !== "executing")
        throw new Error("The server did not grant an execution claim");
      execution.assertPrepared();
      await this.journal.markApplying({
        scope: this.scope,
        proposalId,
        attemptId: claimed.attemptId,
      });
      let result: ExecutionResult;
      let notDispatched = false;
      try {
        signal.throwIfAborted();
        const bindingHash = await this.bindingHash(
          this.session.sessionId,
          p,
          operationId,
        );
        if (p.expiresAt <= Date.now())
          throw new DeviceActionNotStarted("This action expired.");
        execution.markDispatched(reserved.entry);
        const journalIdentity = { scope: this.scope, proposalId: p.id };
        if (isForegroundReviewOperation(p.operation)) {
          if (!this.ports.executeForeground)
            throw Error("Foreground review is unavailable");
          result = await this.ports.executeForeground(
            p.operation,
            operationId,
            context,
            signal,
            bindingHash,
            journalIdentity,
            this.credential.capabilities ?? [],
          );
        } else
          result = await this.ports.execute(
            p.operation,
            operationId,
            context,
            signal,
            bindingHash,
            p.workflow
              ? {
                  scope: this.scope,
                  origin: this.session.origin,
                  ownerId: this.session.ownerId,
                  agentId: this.session.agentId,
                  workflowId: p.workflow.workflowId,
                  runId: p.workflow.runId,
                  versionId: p.workflow.versionId,
                }
              : undefined,
            journalIdentity,
            p.calendarAgendaSource,
          );
      } catch (error) {
        // `markDispatched` runs before any port call, so an attempt that never
        // reached it had no effect, and an executor that throws
        // DeviceActionNotStarted refused before its effect. Any other failure
        // after dispatch stays uncertain.
        const refused = error instanceof DeviceActionNotStarted;
        notDispatched = refused || !execution.dispatched;
        result = notDispatched
          ? {
              status: "failed",
              summary:
                refused && error.message
                  ? `Not started: ${error.message.replace(/[.!]\s*$/, "")}.`
                  : NOT_DISPATCHED_SUMMARY,
            }
          : { status: "unknown", summary: UNKNOWN_SUMMARY };
      }
      const typed: TypedResults = notDispatched
        ? {}
        : await this.typedResults(p, result, operationId, context);
      await this.journal.finish({
        scope: this.scope,
        proposalId,
        status: result.status,
        summary: result.summary,
        result: {
          operationId,
          ...definedResults(typed),
          ...(result.status === "failed"
            ? { dispatch: notDispatched ? "not_started" : "attempted" }
            : {}),
        },
      });
      if (execution.dispatched) execution.settle(reserved.entry);
      // A completed device effect is journaled even if the UI epoch was cancelled.
      // Receipt upload is retried only by the explicit history control.
      const committedChanges: DeviceCommittedChange[] = [];
      if (result.status === "succeeded") {
        const op = p.operation;
        if (
          isCalendarOperation(op) &&
          op.type !== "calendar_read_selected" &&
          op.type !== "calendar_read_next"
        )
          committedChanges.push("calendar");
        if (
          isNotesOperation(op) ||
          (isNotesOrganizeOperation(op) &&
            !NOTES_ORGANIZE_DIRECT_TYPES.includes(op.type))
        )
          committedChanges.push("notes");
        if (
          isReminderOperation(op) ||
          isReminderCreate(op) ||
          op.type === "create_reminder"
        )
          committedChanges.push("reminders");
        const fg = typed.foregroundResult;
        if (
          fg &&
          "operation" in fg &&
          !(fg.kind === "calendar_named" && fg.action === "read")
        )
          committedChanges.push(
            fg.kind === "notes_named"
              ? "notes"
              : fg.kind === "calendar_named"
                ? "calendar"
                : "reminders",
          );
      }
      // Presentation changes the foreground context and cancels its approval.
      // Run it only after this exact action's receipt attempt, never as a retry.
      const presentBrowser = () => {
        if (result.status !== "succeeded") return;
        try {
          if (p.operation.type === "browser_navigate" || isBrowserControl(p.operation)) {
            if (reviewed.currentRequest) assertCurrent();
            result.presentBrowser?.();
          } else if (isTelephonyAction(p.operation)) result.present?.();
        } catch {
          /* A retired foreground must not replace a journaled outcome. */
        }
      };
      let confirmed: DeviceProposal;
      try {
        if (isMapsOperation(p.operation))
          assertMapsContext(p.operation, context, this.profile);
        confirmed = await this.mutation(
          p,
          "receipt",
          {
            attemptId: claimed.attemptId,
            receipt: notDispatched
              ? { outcome: "failed", operationId, code: NOT_DISPATCHED_CODE }
              : {
                  outcome: receiptOutcome(result.status),
                  operationId,
                  ...receiptResult(typed),
                },
          },
          signal,
        );
      } catch {
        presentBrowser();
        return {
          proposalId,
          status: result.status,
          summary:
            isCameraCapture(p.operation) && result.status === "failed" && result.cancelledBeforeCapture
              ? result.summary
              : unsyncedSummary(result.summary),
          committedChanges,
        };
      }
      presentBrowser();
      const retained = this.readReplies.get(proposalId);
      const fg = typed.foregroundResult;
      const readReply =
        result.status === "succeeded" &&
        isOriginalDeviceReadOperationType(p.operation.type) &&
        (typed.notesResult ||
          typed.calendarResult ||
          typed.reminderResult ||
          typed.mapsResult ||
          typed.telephonyResult ||
          typed.readResult ||
          fg?.kind === "calendar_availability" ||
          (fg?.kind === "calendar_named" && fg.action === "read")) &&
        p.readReplyOrigin &&
        confirmed.state === "done" &&
        confirmed.attemptId === claimed.attemptId &&
        retained &&
        !retained.consumed &&
        retained.digest === p.digest &&
        JSON.stringify(retained.origin) === JSON.stringify(p.readReplyOrigin)
          ? validateNativeNotesReadReplyHint({
              ...p.readReplyOrigin,
              proposalId,
              digest: p.digest,
              attemptId: claimed.attemptId,
            })
          : undefined;
      if (readReply && retained) retained.hint = readReply;
      return {
        proposalId,
        status: result.status,
        summary: result.summary,
        committedChanges,
        ...(readReply ? { readReply } : {}),
      };
    } catch {
      return {
        proposalId,
        status: "unknown",
        summary:
          "Action did not reach a confirmed result. Check action history before requesting it again.",
      };
    } finally {
      execution?.retire();
      this.executing = undefined;
      this.busy = false;
    }
  }
  async completeReadReply(
    hint: NativeNotesReadReplyHint,
    signal: AbortSignal,
  ): Promise<NativeNotesReadReply> {
    const valid = validateNativeNotesReadReplyHint(hint),
      retained = this.readReplies.get(valid.proposalId);
    if (
      !retained ||
      retained.consumed ||
      JSON.stringify(retained.hint) !== JSON.stringify(valid)
    )
      throw Error(
        "This original Notes answer is unavailable. Check conversation history.",
      );
    signal.throwIfAborted();
    retained.consumed = true;
    const response = object(
      await this.request(
        `/api/client-devices/proposals/${valid.proposalId}/read-completion`,
        valid,
        signal,
      ),
    );
    signal.throwIfAborted();
    const reply = validateNativeNotesReadReply(response.reply);
    if (
      reply.requestId !== valid.requestId ||
      reply.conversationId !== valid.conversationId ||
      reply.inReplyTo !== valid.inReplyTo ||
      reply.messageId === valid.inReplyTo
    )
      throw Error(
        "The original Notes answer changed. Check conversation history.",
      );
    return reply;
  }
  async cancelReadReply(
    proposalId: string,
    digest: string,
    signal: AbortSignal,
  ): Promise<void> {
    const retained = this.readReplies.get(proposalId);
    if (!retained || retained.digest !== digest) return;
    retained.consumed = true;
    signal.throwIfAborted();
    await this.request(
      `/api/client-devices/proposals/${proposalId}/cancel-read-completion`,
      { digest },
      signal,
    );
  }
  async reject(proposalId: string, signal: AbortSignal): Promise<void> {
    const p = (await this.list(signal)).find((item) => item.id === proposalId);
    // A re-shown approval whose claim never arrived can still be closed.
    if (
      !p ||
      !(p.state === "pending" || (p.state === "approved" && !p.attemptId))
    )
      throw new Error("This proposal can no longer be rejected");
    await this.mutation(p, "decision", { decision: "reject" }, signal);
    this.proposals.delete(proposalId);
  }
  /** Reconstruct only committed Notes-create, calendar-write and browser-open acknowledgments for fetched user messages.
   * Both the authenticated server receipt and this device's exact journal must agree. */
  async conversationReceipts(
    requestMessageIds: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<
    Array<{
      id: string;
      requestMessageId: string;
      summary: string;
      browserDestination?: string;
    }>
  > {
    if (!requestMessageIds.size) return [];
    const proposals = await this.list(signal);
    signal.throwIfAborted();
    const results: Array<{
      id: string;
      requestMessageId: string;
      summary: string;
      browserDestination?: string;
    }> = [];
    for (const p of proposals) {
      const op = p.operation;
      if (
        p.workflow ||
        p.state !== "done" ||
        !p.requestMessageId ||
        !requestMessageIds.has(p.requestMessageId) ||
        !(
          op.type === "create_note" ||
          op.type === "browser_navigate" ||
          ([
            "calendar_create",
            "calendar_create_local",
            "calendar_update",
            "calendar_delete",
          ].includes(op.type) &&
            isCalendarOperation(op))
        )
      )
        continue;
      try {
        const receipt = object(p.providerReceipt),
          { entry } = await this.journal.get({
            scope: this.scope,
            proposalId: p.id,
          });
        signal.throwIfAborted();
        if (
          receipt.outcome !== "applied" ||
          !entry ||
          entry.scope !== this.scope ||
          entry.phase !== "terminal" ||
          entry.status !== "succeeded" ||
          !p.attemptId ||
          entry.attemptId !== p.attemptId ||
          !this.ownEntry(entry, p) ||
          typeof entry.record.sessionId !== "string" ||
          !this.ownDevice(entry) ||
          receipt.operationId !== entry.operationId ||
          entry.result?.operationId !== entry.operationId ||
          entry.operationHash !== (await actionScope(JSON.stringify(op)))
        )
          continue;
        if (isCalendarOperation(op)) {
          const server = validateCalendarResult(op, receipt.result),
            saved = validateCalendarResult(op, entry.result?.calendarResult);
          if (JSON.stringify(server) !== JSON.stringify(saved)) continue;
        } else if (
          op.type === "create_note" ||
          op.type === "browser_navigate"
        ) {
          // These operations return no typed record result. Restore only
          // this exact terminal journal's acknowledgment, never infer a new effect.
          if (
            JSON.stringify(entry.record.operation) !== JSON.stringify(op) ||
            receipt.result !== undefined ||
            entry.result?.notesResult !== undefined
          )
            continue;
        } else continue;
        results.push({
          id: `device-receipt:${p.id}`,
          requestMessageId: p.requestMessageId,
          summary:
            op.type === "browser_navigate"
              ? this.profile.browserNavigationSummary(op.url)
              : text(entry.summary, 2000),
          ...(op.type === "browser_navigate"
            ? { browserDestination: op.url }
            : {}),
        });
      } catch {
        /* An incomplete, foreign or contradictory receipt is not a success. */
      }
    }
    signal.throwIfAborted();
    return results;
  }
  /**
   * Each entry names the owner resolutions it can take now. An SMS, dial or
   * Clock handoff offers only what its saved evidence allows; other actions
   * may still need exact saved receipts in `reconcile`.
   */
  async history(signal: AbortSignal) {
    const proposals = await this.list(signal),
      local = await this.journal.list({ scope: this.scope });
    const rows = [];
    for (const p of proposals) {
      const entry = local.entries.find((item) => item.proposalId === p.id);
      rows.push({
        id: p.id,
        state: p.state,
        operation: p.operation,
        local: entry,
        resolutions: await this.resolutions(p, entry ?? null, signal),
      });
    }
    return rows;
  }
  private async resolutions(
    p: DeviceProposal,
    entry: DeviceJournalEntry | null,
    signal: AbortSignal,
  ): Promise<Array<"applied" | "not_applied" | "unresolved">> {
    if (p.state !== "reconciliation_required" || !p.attemptId) return [];
    if (!handoffOperation(p.operation)) return ["applied", "not_applied"];
    const settled = await this.handoffEvidence(p, entry, signal);
    return settled === undefined
      ? ["unresolved"]
      : [settled === "succeeded" ? "applied" : "not_applied"];
  }
  /** Settled SMS, dial or Clock evidence, or undefined when it is missing or unknown. */
  private async handoffEvidence(
    p: DeviceProposal,
    entry: DeviceJournalEntry | null,
    signal: AbortSignal,
  ): Promise<"succeeded" | "failed" | undefined> {
    if (!entry) return undefined;
    const op = p.operation;
    try {
      if (isSmsSend(op)) {
        const result = await this.smsReconciliationResult(p, entry, signal);
        const status = result && smsDeviceStatus(result);
        return status === "unknown" ? undefined : status;
      }
      if (isPhoneDial(op)) {
        const result = await this.savedDialResult(p, entry);
        return result && dialDeviceStatus(result);
      }
      if (isTelephonyAction(op)) {
        const result = await this.savedTelephonyResult(p, entry);
        const status = result && telephonyDeviceStatus(result);
        return status === "unknown" ? undefined : status;
      }
      const result = await this.savedClockResult(p, entry);
      return !result || result.status === "unknown"
        ? undefined
        : result.status === "opened"
          ? "succeeded"
          : "failed";
    } catch (error) {
      // error-policy:J1 A refused or foreign saved entry is no evidence.
      if (signal.aborted) throw error;
      return undefined;
    }
  }
  private async recoverNotification(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<DeviceJournalEntry> {
    if (p.operation.type !== "post_notification") return entry;
    if (!p.workflow) throw Error("Notification workflow binding is missing");
    if (
      entry.scope !== this.scope ||
      entry.proposalId !== p.id ||
      entry.attemptId !== p.attemptId ||
      !this.ownEntry(entry, p) ||
      !this.ownDevice(entry) ||
      typeof entry.record.sessionId !== "string" ||
      JSON.stringify(entry.record.workflow) !== JSON.stringify(p.workflow) ||
      (await actionScope(JSON.stringify(p.operation))) !== entry.operationHash
    )
      throw Error("Notification recovery identity changed");
    const bindingHash = await this.bindingHash(
      entry.record.sessionId,
      p,
      entry.operationId,
    );
    if (
      !this.journal.recoverNotification ||
      entry.status === "succeeded" ||
      !entry.attemptId ||
      (entry.phase !== "applying" &&
        !(entry.phase === "terminal" && entry.status === "unknown"))
    )
      return entry;
    signal.throwIfAborted();
    const recovered = await this.journal.recoverNotification({
      scope: this.scope,
      proposalId: p.id,
      bindingHash,
    });
    signal.throwIfAborted();
    const next = recovered.entry;
    if (!next) return entry;
    assertSameAttempt(next, entry, "Recovered notification identity changed");
    if (
      next.status === "succeeded" &&
      (next.phase !== "terminal" ||
        next.result?.operationId !== entry.operationId)
    )
      throw Error("Recovered notification result changed");
    return next;
  }
  private async recoverDeletion(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<DeviceJournalEntry> {
    if (
      !this.journal.recoverDeletion ||
      !["calendar_delete", "reminder_cancel"].includes(p.operation.type) ||
      entry.status === "succeeded" ||
      entry.status === "failed" ||
      !entry.attemptId ||
      !this.ownEntry(entry, p) ||
      !this.ownDevice(entry)
    )
      return entry;
    signal.throwIfAborted();
    const { entry: next } = await this.journal.recoverDeletion({
      scope: this.scope,
      proposalId: p.id,
    });
    signal.throwIfAborted();
    if (!next) return entry;
    assertSameAttempt(next, entry, "Recovered deletion identity changed");
    if (next.status === "succeeded") {
      if (
        next.phase !== "terminal" ||
        next.result?.operationId !== entry.operationId
      )
        throw Error("Recovered deletion result changed");
      if (isReminderOperation(p.operation))
        validateReminderResult(p.operation, next.result?.reminderResult);
      else if (isCalendarOperation(p.operation))
        validateCalendarResult(p.operation, next.result?.calendarResult);
    }
    return next;
  }
  private async recoverReminder(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<DeviceJournalEntry> {
    const op = p.operation;
    if (
      !this.ports.recover ||
      !(isReminderOperation(op) || isReminderCreate(op)) ||
      entry.status === "succeeded" ||
      !entry.attemptId ||
      !this.ownEntry(entry, p) ||
      !this.ownDevice(entry) ||
      typeof entry.record.sessionId !== "string"
    )
      return entry;
    const bindingHash = await this.bindingHash(
      entry.record.sessionId,
      p,
      entry.operationId,
    );
    signal.throwIfAborted();
    const result = await this.ports.recover(
      op,
      entry.operationId,
      bindingHash,
      signal,
    );
    signal.throwIfAborted();
    if (result.status !== "succeeded") return entry;
    const validate = (value: unknown) =>
      isReminderCreate(op)
        ? validateReminderCreateResult(op, value, entry.operationId)
        : validateReminderResult(op as ReminderOperation, value);
    validate(result.reminderResult);
    if (!this.journal.recoverReminder) return entry;
    const recovered = await this.journal.recoverReminder({
      scope: this.scope,
      proposalId: p.id,
      bindingHash,
    });
    if (recovered.entry?.status === "succeeded")
      validate(recovered.entry.result?.reminderResult);
    return recovered.entry ?? entry;
  }
  private async recoverEntry(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<DeviceJournalEntry> {
    let next = await this.recoverDeletion(p, entry, signal);
    next = await this.recoverNotification(p, next, signal);
    return this.recoverReminder(p, next, signal);
  }
  /**
   * Uploads exact journaled receipts. Never re-executes; unknown stays unknown.
   *
   * A receipt is posted only while the server still awaits this attempt's
   * outcome (`executing`, or `reconciliation_required` for the same attempt).
   * A proposal the owner already reconciled (`done`/`retryable`) keeps its
   * server outcome; replaying the stale local receipt would only be refused.
   * Each entry is uploaded on its own, so one refused upload never holds back
   * the receipts journaled after it; the first failure is reported at the end.
   */
  async syncReceipts(
    signal: AbortSignal,
    workflow?: { runId: string; versionId: string; specDigest: string },
  ): Promise<void> {
    const proposals = await this.list(signal),
      local = await this.journal.list({ scope: this.scope });
    const failures: unknown[] = [];
    const otherWorkflow = (p: DeviceProposal) =>
      !!p.workflow &&
      (!workflow ||
        p.workflow.runId !== workflow.runId ||
        p.workflow.versionId !== workflow.versionId ||
        p.workflow.specDigest !== workflow.specDigest);
    for (const journaled of local.entries) {
      signal.throwIfAborted();
      try {
        await this.syncReceipt(journaled, proposals, otherWorkflow, signal);
      } catch (error) {
        // error-policy:J1 Cancellation stops the sweep; other refusals are reported after it.
        if (signal.aborted) throw error;
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }
  private async syncReceipt(
    journaled: DeviceJournalEntry,
    proposals: readonly DeviceProposal[],
    otherWorkflow: (p: DeviceProposal) => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    let entry = journaled;
    const p = proposals.find((item) => item.id === entry.proposalId);
    if (!p || otherWorkflow(p) || this.executing === p.id) return;
    entry = await this.settleAbandoned(p, entry, signal);
    if (!notDispatchedEntry(entry))
      entry = await this.recoverEntry(p, entry, signal);
    if (
      notDispatchedEntry(entry) &&
      entry.attemptId &&
      entry.record.digest === p.digest &&
      p.attemptId === entry.attemptId &&
      (p.state === "executing" || p.state === "reconciliation_required")
    ) {
      await this.mutation(
        p,
        "receipt",
        {
          attemptId: entry.attemptId,
          receipt: {
            outcome: "failed",
            operationId: entry.operationId,
            code: NOT_DISPATCHED_CODE,
          },
        },
        signal,
      );
      return;
    }
    if (
      entry.phase !== "terminal" ||
      !entry.attemptId ||
      entry.record.digest !== p.digest ||
      !entry.status
    )
      return;
    // Only an attempt the server still awaits takes a receipt. After owner
    // reconciliation (`done`/`retryable`) or a newer attempt, the server's
    // outcome stands and the local entry is history.
    if (
      p.attemptId !== entry.attemptId ||
      (p.state !== "executing" && p.state !== "reconciliation_required")
    )
      return;
    const saved = await this.savedResults(p, entry);
    if (
      p.state === "reconciliation_required" &&
      entry.status === "succeeded" &&
      (((isReminderOperation(p.operation) || isReminderCreate(p.operation)) &&
        saved.reminderResult) ||
        p.operation.type === "post_notification")
    ) {
      await this.mutation(
        p,
        "reconciliation",
        {
          attemptId: entry.attemptId,
          resolution: {
            confirmed: true,
            outcome: "applied",
            operationId: entry.operationId,
            ...(saved.reminderResult ? { result: saved.reminderResult } : {}),
          },
        },
        signal,
      );
    } else
      await this.mutation(
        p,
        "receipt",
        {
          attemptId: entry.attemptId,
          receipt: {
            outcome: receiptOutcome(entry.status),
            operationId: entry.operationId,
            ...receiptResult(saved),
          },
        },
        signal,
      );
  }
  /**
   * Closes a journal entry no live attempt in this instance owns, while the
   * server still awaits that claim. A reservation never reached dispatch, so it
   * failed with nothing sent. An entry left applying keeps any recovered native
   * evidence and is otherwise unknown; it is never dispatched again.
   */
  private async settleAbandoned(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<DeviceJournalEntry> {
    if (
      entry.phase === "terminal" ||
      p.state !== "executing" ||
      !p.attemptId ||
      !this.ownEntry(entry, p) ||
      !this.ownDevice(entry)
    )
      return entry;
    const identity = { scope: this.scope, proposalId: p.id };
    if (entry.phase === "reserved") {
      if (entry.attemptId) return entry;
      // Dispatch happens only after markApplying, so nothing ran under this claim.
      await this.journal.markApplying({ ...identity, attemptId: p.attemptId });
      await this.journal.finish({
        ...identity,
        status: "failed",
        summary: NOT_DISPATCHED_SUMMARY,
        result: { operationId: entry.operationId, dispatch: "not_started" },
      });
    } else {
      if (entry.attemptId !== p.attemptId) return entry;
      const recovered = await this.recoverEntry(p, entry, signal);
      if (recovered.phase === "terminal") return recovered;
      const smsResult = await this.smsReconciliationResult(p, entry, signal);
      const status = smsResult ? smsDeviceStatus(smsResult) : "unknown";
      signal.throwIfAborted();
      await this.journal.finish({
        ...identity,
        status,
        summary:
          status === "succeeded"
            ? "SMS submitted."
            : status === "failed"
              ? "SMS not sent."
              : UNKNOWN_SUMMARY,
        result: {
          operationId: entry.operationId,
          ...(smsResult ? { smsResult } : {}),
          ...(status === "failed" ? { dispatch: "attempted" } : {}),
        },
      });
    }
    const { entry: next } = await this.journal.get(identity);
    if (!next || next.operationId !== entry.operationId)
      throw Error("Device journal entry changed while it was closed");
    return next;
  }
  private async savedResults(p: DeviceProposal, entry: DeviceJournalEntry) {
    return {
      smsResult: await this.savedSmsResult(p, entry),
      dialResult: await this.savedDialResult(p, entry),
      telephonyResult: await this.savedTelephonyResult(p, entry),
      clockResult: await this.savedClockResult(p, entry),
      mapsResult: await this.savedMapsResult(p, entry),
      cameraResult: await this.savedCameraResult(p, entry),
      photoLibraryResult: await this.savedLibraryResult(p, entry),
      readResult: await this.savedReadResult(p, entry),
      calendarResult: await this.savedCalendarResult(p, entry),
      notesResult: await this.savedNotesResult(p, entry),
      reminderResult: await this.savedReminderResult(p, entry),
      foregroundResult: await this.savedForegroundResult(p, entry),
    };
  }
  /** Exact terminal journal entry for this proposal and attempt, or a refusal. */
  private async savedEntry(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
    refusal: string,
    rules: { succeeded?: boolean; device?: boolean; session?: boolean } = {},
  ): Promise<DeviceJournalEntry> {
    const { entry } = await this.journal.get({
      scope: this.scope,
      proposalId: p.id,
    });
    if (
      !entry ||
      entry.phase !== "terminal" ||
      (rules.succeeded && entry.status !== "succeeded") ||
      entry.operationId !== summary.operationId ||
      !this.ownEntry(entry, p) ||
      (rules.device && !this.ownDevice(entry)) ||
      (rules.session && entry.record.sessionId !== this.session.sessionId)
    )
      throw Error(refusal);
    return entry;
  }
  private async savedSmsResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<SmsSendResult | undefined> {
    const op = p.operation;
    if (!isSmsSend(op)) return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved SMS receipt; the message will not be repeated",
      { device: true },
    );
    if (
      entry.operationId !== p.id ||
      p.providerIdempotencyKey !== entry.operationId
    )
      throw Error(
        "No exact saved SMS receipt; the message will not be repeated",
      );
    if (entry.result?.smsResult === undefined) {
      if (entry.status !== "unknown") throw Error("Missing saved SMS evidence");
      return undefined;
    }
    const result = validateSmsResult(
      op,
      entry.result.smsResult,
      entry.operationId,
      await smsAgentHash(op),
    );
    if (entry.status !== smsDeviceStatus(result))
      throw Error("Saved SMS outcome mismatch");
    return result;
  }
  /** Explicit owner reconciliation may read newer durable native evidence, never dispatch again. */
  private async smsReconciliationResult(
    p: DeviceProposal,
    entry: DeviceJournalEntry,
    signal: AbortSignal,
  ): Promise<SmsSendResult | undefined> {
    const op = p.operation;
    if (!isSmsSend(op)) return undefined;
    if (
      entry.operationId !== p.id ||
      p.providerIdempotencyKey !== p.id ||
      entry.attemptId !== p.attemptId ||
      !this.ownEntry(entry, p) ||
      !this.ownDevice(entry) ||
      entry.operationHash !== (await actionScope(JSON.stringify(op)))
    )
      throw Error("SMS reconciliation identity changed");
    const historical =
      entry.phase === "terminal"
        ? await this.savedSmsResult(p, entry)
        : undefined;
    if (historical && smsDeviceStatus(historical) !== "unknown")
      return historical;
    if (!this.ports.recover) return historical;
    signal.throwIfAborted();
    const read = await this.ports.recover(
      op,
      entry.operationId,
      await smsAgentHash(op),
      signal,
    );
    signal.throwIfAborted();
    if (read.smsResult === undefined) return historical;
    const result = validateSmsResult(
      op,
      read.smsResult,
      entry.operationId,
      await smsAgentHash(op),
    );
    if (read.status !== smsDeviceStatus(result))
      throw Error("Reconciled SMS outcome mismatch");
    return result;
  }
  private async savedDialResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<PhoneDialResult | undefined> {
    if (!isPhoneDial(p.operation)) return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved dial receipt; the handoff will not be repeated",
      { device: true },
    );
    if (entry.result?.dialResult === undefined) {
      if (entry.status !== "unknown") throw Error("Missing saved dial receipt");
      return undefined;
    }
    const result = validatePhoneDialResult(
      p.operation,
      entry.result.dialResult,
    );
    if (entry.status !== dialDeviceStatus(result))
      throw Error("Saved dial outcome mismatch");
    return result;
  }
  /** Saved native evidence only; a call, change or send is never repeated to obtain it. */
  private async savedTelephonyResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<TelephonyActionResult | undefined> {
    const op = p.operation;
    if (!isTelephonyAction(op)) return undefined;
    const refusal =
      "No exact saved telephony receipt; the action will not be repeated";
    const entry = await this.savedEntry(p, summary, refusal, { device: true });
    if (
      isSmsCompose(op) &&
      (entry.operationId !== p.id ||
        p.providerIdempotencyKey !== entry.operationId)
    )
      throw Error(refusal);
    if (entry.result?.telephonyResult === undefined) {
      if (entry.status !== "unknown")
        throw Error("Missing saved telephony receipt");
      return undefined;
    }
    const result = validateTelephonyActionResult(
      op,
      entry.result.telephonyResult,
    );
    if (entry.status !== telephonyDeviceStatus(result))
      throw Error("Saved telephony outcome mismatch");
    return result;
  }
  private async savedClockResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<ClockHandoffResult | undefined> {
    const op = p.operation;
    if (!isClockHandoffOperation(op)) return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved Clock receipt; handoff will not be repeated",
      { device: true },
    );
    if (entry.result?.clockResult === undefined) {
      if (entry.status === "succeeded") throw Error("Missing Clock receipt");
      return undefined;
    }
    const result = clockHandoffReceipt(op, entry.result.clockResult);
    const status =
      result.status === "opened"
        ? "succeeded"
        : result.status === "unknown"
          ? "unknown"
          : "failed";
    if (entry.status !== status) throw Error("Saved Clock outcome mismatch");
    return result;
  }
  private async savedCameraResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<CameraCaptureResult | undefined> {
    if (!isCameraCapture(p.operation) || summary.status !== "succeeded")
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved photo receipt; capture will not be repeated",
      { succeeded: true, device: true },
    );
    return validateCameraCaptureResult(
      entry.result?.cameraResult,
      entry.operationId,
    );
  }
  private async savedMapsResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<MapsResult | undefined> {
    const op = p.operation;
    if (!isMapsOperation(op) || summary.status !== "succeeded")
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved Maps receipt; the selection will not be read again",
      { succeeded: true, device: true, session: true },
    );
    // Replay only the already approved snapshot while its current capability is
    // still valid. Reload/leave does not authorize a fresh read or late upload.
    assertMapsContext(
      op,
      entry.record.context as DeviceContextEnvelope,
      this.profile,
    );
    return validateMapsResult(op, entry.result?.mapsResult);
  }
  private async savedLibraryResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<LibraryAgentResult | PhotosViewResult | undefined> {
    const op = p.operation;
    if (
      !(isLibraryOperation(op) || isPhotosViewOperation(op)) ||
      summary.status !== "succeeded"
    )
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved library receipt; the library will not be read again",
      { succeeded: true },
    );
    return isPhotosViewOperation(op)
      ? validatePhotosViewResult(op, entry.result?.photoLibraryResult)
      : validateLibraryResult(op, entry.result?.photoLibraryResult);
  }
  private async savedCalendarResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<CalendarResult | undefined> {
    const op = p.operation;
    if (!isCalendarOperation(op) || summary.status !== "succeeded")
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved Calendar receipt; operation will not be repeated",
      { succeeded: true },
    );
    return validateCalendarResult(op, entry.result?.calendarResult);
  }
  private async savedReminderResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<ReminderResult | ReminderCreateResult | undefined> {
    const op = p.operation;
    if (
      !(isReminderOperation(op) || isReminderCreate(op)) ||
      summary.status !== "succeeded"
    )
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved Reminder receipt; operation will not be repeated",
      { succeeded: true },
    );
    return isReminderCreate(op)
      ? validateReminderCreateResult(
          op,
          entry.result?.reminderResult,
          entry.operationId,
        )
      : validateReminderResult(
          op as ReminderOperation,
          entry.result?.reminderResult,
        );
  }
  private async savedNotesResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<NotesResult | NotesQueryResult | undefined> {
    const op = p.operation;
    if (
      (!isNotesOperation(op) && !isNativeNotesQuery(op)) ||
      summary.status !== "succeeded"
    )
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved Notes receipt; operation will not be repeated",
      { succeeded: true },
    );
    return isNativeNotesQuery(op)
      ? validateNotesQueryResult(op, entry.result?.notesResult)
      : validateNotesResult(op as NotesOperation, entry.result?.notesResult);
  }
  private async savedForegroundResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<ForegroundReviewResult | undefined> {
    const op = p.operation;
    if (!isForegroundReviewOperation(op) || summary.status !== "succeeded")
      return undefined;
    const entry = await this.savedEntry(
      p,
      summary,
      "No exact saved review receipt; the phone will not read or change anything again",
      { succeeded: true },
    );
    return validateForegroundReviewResult(op, entry.result?.foregroundResult);
  }
  private async savedReadResult(
    p: DeviceProposal,
    summary: DeviceJournalEntry,
  ): Promise<WorkflowReadResult | undefined> {
    const op = p.operation;
    if (
      op.type !== "read_selected_notes" &&
      op.type !== "read_calendar_range" &&
      op.type !== "read_selected_reminders"
    )
      return undefined;
    if (summary.status !== "succeeded") return undefined;
    const refusal =
      "No exact saved read receipt is available; the source will not be read again";
    const entry = await this.savedEntry(p, summary, refusal, {
      succeeded: true,
    });
    if (JSON.stringify(entry.record.workflow) !== JSON.stringify(p.workflow))
      throw new Error(refusal);
    return this.profile.workflow.validateResult(op, entry.result?.readResult);
  }
  /**
   * Owner-confirmed reconciliation of a dispatched action from exact saved
   * evidence. `unresolved` closes an SMS, dial or Clock handoff whose evidence
   * is missing or unknown without claiming it was or was not applied.
   */
  async reconcile(
    proposalId: string,
    outcome: "applied" | "not_applied" | "unresolved",
    signal: AbortSignal,
  ): Promise<void> {
    const p = (await this.list(signal)).find((item) => item.id === proposalId);
    if (!p?.attemptId) throw new Error("No dispatched action to reconcile");
    const op = p.operation;
    let { entry } = await this.journal.get({ scope: this.scope, proposalId });
    if (outcome === "unresolved") {
      if (!handoffOperation(op))
        throw Error("Only an SMS, dial or Clock outcome can stay unresolved");
      if ((await this.handoffEvidence(p, entry, signal)) !== undefined)
        throw Error(
          "Saved evidence settles this outcome; reconcile it as applied or not applied",
        );
      await this.mutation(
        p,
        "reconciliation",
        {
          attemptId: p.attemptId,
          resolution: { confirmed: true, outcome: "unresolved" },
        },
        signal,
      );
      return;
    }
    const applied = outcome === "applied";
    if (entry && applied) entry = await this.recoverEntry(p, entry, signal);
    if (
      applied &&
      op.type === "post_notification" &&
      (!entry || entry.phase !== "terminal" || entry.status !== "succeeded")
    )
      throw Error(
        "Applied notification reconciliation requires its exact saved delivery receipt",
      );
    const smsResult = entry
      ? await this.smsReconciliationResult(p, entry, signal)
      : undefined;
    if (
      isSmsSend(op) &&
      (!smsResult ||
        smsDeviceStatus(smsResult) === "unknown" ||
        applied !== (smsDeviceStatus(smsResult) === "succeeded"))
    )
      throw Error(
        "SMS reconciliation requires exact saved evidence; unknown or partial sends cannot be called not sent",
      );
    const dialResult = entry ? await this.savedDialResult(p, entry) : undefined;
    if (
      isPhoneDial(op) &&
      (!dialResult ||
        applied !== (dialDeviceStatus(dialResult) === "succeeded"))
    )
      throw Error("Dial reconciliation requires exact saved handoff evidence");
    const telephonyResult = entry
      ? await this.savedTelephonyResult(p, entry)
      : undefined;
    if (
      isTelephonyAction(op) &&
      (!telephonyResult ||
        telephonyDeviceStatus(telephonyResult) === "unknown" ||
        applied !== (telephonyDeviceStatus(telephonyResult) === "succeeded"))
    )
      throw Error(
        "Telephony reconciliation requires exact saved evidence; an unknown outcome cannot be called applied or not applied",
      );
    const clockResult = entry
      ? await this.savedClockResult(p, entry)
      : undefined;
    if (
      isClockHandoffOperation(op) &&
      (!clockResult ||
        clockResult.status === "unknown" ||
        applied !== (clockResult.status === "opened"))
    )
      throw Error(
        "Clock reconciliation requires the exact saved handoff result; alarm state cannot be inferred",
      );
    const saved = <T>(read: () => Promise<T>) =>
      applied && entry ? read() : Promise.resolve(undefined);
    const e = entry as DeviceJournalEntry;
    const mapsResult = await saved(() => this.savedMapsResult(p, e));
    if (applied && isMapsOperation(op) && !mapsResult)
      throw Error("Applied Maps read requires exact saved receipt");
    const cameraResult = await saved(() => this.savedCameraResult(p, e));
    if (applied && isCameraCapture(op) && !cameraResult)
      throw Error(
        "Applied camera capture requires its exact saved photo receipt",
      );
    const photoLibraryResult = await saved(() => this.savedLibraryResult(p, e));
    if (
      applied &&
      (isLibraryOperation(op) || isPhotosViewOperation(op)) &&
      !photoLibraryResult
    )
      throw Error("Applied library action requires its exact saved receipt");
    const readResult = await saved(() => this.savedReadResult(p, e));
    const calendarResult = await saved(() => this.savedCalendarResult(p, e));
    const notesResult = await saved(() => this.savedNotesResult(p, e));
    const reminderResult = await saved(() => this.savedReminderResult(p, e));
    const foregroundResult = await saved(() =>
      this.savedForegroundResult(p, e),
    );
    if (applied && isForegroundReviewOperation(op) && !foregroundResult)
      throw Error(
        "Applied review reconciliation requires its exact saved receipt",
      );
    if (
      applied &&
      (isReminderOperation(op) || isReminderCreate(op)) &&
      !reminderResult
    )
      throw Error(
        "Applied reminder reconciliation requires exact saved receipt",
      );
    if (
      applied &&
      (isNotesOperation(op) || isNativeNotesQuery(op)) &&
      !notesResult
    )
      throw Error(
        "Applied Notes reconciliation requires its exact saved receipt",
      );
    if (applied && isCalendarOperation(op) && !calendarResult)
      throw Error(
        "Applied Calendar reconciliation requires exact saved provider receipt",
      );
    if (
      applied &&
      (op.type === "read_selected_notes" ||
        op.type === "read_calendar_range" ||
        op.type === "read_selected_reminders") &&
      !readResult
    )
      throw new Error("Applied read requires its exact saved result");
    await this.mutation(
      p,
      "reconciliation",
      {
        attemptId: p.attemptId,
        resolution: {
          confirmed: true,
          outcome,
          ...((applied ||
            isClockHandoffOperation(op) ||
            isSmsSend(op) ||
            isPhoneDial(op) ||
            isTelephonyAction(op)) &&
          entry
            ? { operationId: entry.operationId }
            : {}),
          ...receiptResult({
            smsResult,
            dialResult,
            telephonyResult,
            foregroundResult,
            clockResult,
            mapsResult,
            cameraResult,
            photoLibraryResult,
            readResult,
            calendarResult,
            notesResult,
            reminderResult,
          }),
        },
      },
      signal,
    );
  }
}

type TypedResults = {
  smsResult?: SmsSendResult;
  dialResult?: PhoneDialResult;
  telephonyResult?: TelephonyActionResult;
  clockResult?: ClockHandoffResult;
  mapsResult?: MapsResult;
  cameraResult?: CameraCaptureResult;
  photoLibraryResult?: LibraryAgentResult | PhotosViewResult;
  readResult?: WorkflowReadResult;
  calendarResult?: CalendarResult;
  notesResult?: NotesResult | NotesQueryResult;
  reminderResult?: ReminderResult | ReminderCreateResult;
  foregroundResult?: ForegroundReviewResult;
};
/** Handoffs whose effect happens outside this app; their outcome may stay unresolved. */
function handoffOperation(operation: ReviewableDeviceOperation): boolean {
  return (
    isSmsSend(operation) ||
    isPhoneDial(operation) ||
    (isTelephonyAction(operation) && !isTelephonyRead(operation)) ||
    isClockHandoffOperation(operation)
  );
}
/** Review-card copy. The phone's own review shows the resolved name, number and before/after. */
function describeTelephonyAction(operation: TelephonyActionOperation): {
  title: string;
  description: string;
} {
  const fields = (set: {
    displayName?: string;
    phoneNumbers?: string[];
    emailAddresses?: string[];
  }) =>
    [
      set.displayName === undefined ? undefined : `Name: ${set.displayName}`,
      set.phoneNumbers === undefined
        ? undefined
        : `Numbers: ${set.phoneNumbers.join(", ") || "none"}`,
      set.emailAddresses === undefined
        ? undefined
        : `Email: ${set.emailAddresses.join(", ") || "none"}`,
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  switch (operation.type) {
    case "phone_call":
      return {
        title: "Place call",
        description: `${operation.target.kind === "number" ? `Number: ${operation.target.number}` : `Contact: ${operation.target.query}`}\n\nCalls this number from your phone after you confirm. An emergency number opens your phone app instead.`,
      };
    case "contact_create":
      return {
        title: "Add contact",
        description: `${fields(operation.contact)}\n\nSaves this contact on your phone after you confirm.`,
      };
    case "contact_update": {
      const values = (
        label: string,
        change: { phoneNumbers?: string[]; emailAddresses?: string[] } = {},
      ) =>
        [...(change.phoneNumbers ?? []), ...(change.emailAddresses ?? [])].map(
          (value) => `${label}: ${value}`,
        );
      const lines = [
        ...(operation.set ? [fields(operation.set)] : []),
        ...values("Add", operation.add),
        ...values("Remove", operation.remove),
      ].join("\n");
      return {
        title: "Change contact",
        description: `Contact: ${operation.query}\n${lines}\n\n${
          operation.add || operation.remove
            ? operation.set
              ? "Replaces the details listed whole and adds or removes only the values marked, after you confirm."
              : "Adds or removes only these values after you confirm. The contact's other details stay."
            : "Replaces these details after you confirm."
        } Nothing else is shared with the agent.`,
      };
    }
    case "contact_delete":
      return {
        title: "Delete contact",
        description: `Contact: ${operation.query}\n\nDeletes this contact from your phone after you confirm.`,
      };
    case "contact_show":
      return {
        title: "Show contact",
        description: `Search: ${operation.query}\n\nOpens Contacts on your phone with the matches. The agent learns only whether one was found.`,
      };
    case "contact_read_selected":
      return {
        title: "Share open contact",
        description:
          "Share the name, numbers and email addresses of the open contact with the agent. Other contacts stay private.",
      };
    case "sms_compose": {
      const target = smsComposeTarget(operation);
      const to =
        target.kind === "number"
          ? `To: ${target.number}`
          : `To contact: ${target.query}`;
      return "draft" in operation
        ? {
            title: "Draft SMS",
            description: `${to}\n\n${operation.body}\n\nOpens that conversation in Messages with this in its text field. Nothing is sent until you tap Send there.`,
          }
        : {
            title: "Review SMS",
            description: `${to}\n\n${operation.body}\n\nConfirm the recipient again in Android.`,
          };
    }
    case "sms_reply_selected":
      return {
        title: "Draft reply",
        description: `${operation.body}\n\nPuts this in the open conversation's text field. Nothing is sent until you tap Send there.`,
      };
    case "messages_read_selected":
      return {
        title: "Share open messages",
        description:
          "Share the messages showing in the open thread with the agent. Other threads and phone numbers stay private.",
      };
    case "voicemail_read_selected":
      return {
        title: "Share open voicemail",
        description:
          "Share the open voicemail and its transcript with the agent. Other voicemail stays private.",
      };
    case "voicemail_delete_selected":
      return {
        title: "Delete voicemail",
        description: "Deletes the open voicemail after you confirm.",
      };
  }
}
const UNKNOWN_SUMMARY =
  "The outcome needs review and won't be repeated automatically.";
const NOT_DISPATCHED_SUMMARY = "Not started, so nothing was sent.";
/** The fixed summary older coordinators wrote for a no-call failure; matched only to read those records. */
const LEGACY_NOT_DISPATCHED_SUMMARY = "Not started. Nothing was sent.";
/** One sentence: a completed result whose server receipt has not synced yet. */
export function unsyncedSummary(summary: string): string {
  return `${summary.replace(/[.!]\s*$/, "")}, but it isn't synced yet.`;
}
const NOT_DISPATCHED_CODE = "DEVICE_NOT_DISPATCHED";
/** A journal entry this device finished with no effect: failed, with no typed result. */
function notDispatchedEntry(entry: DeviceJournalEntry): boolean {
  const result = entry.result;
  if (
    entry.phase !== "terminal" ||
    entry.status !== "failed" ||
    result?.operationId !== entry.operationId
  )
    return false;
  if (result.dispatch === "not_started")
    return Object.keys(result).every(
      (key) => key === "operationId" || key === "dispatch",
    );
  // Old coordinator records used one fixed no-call summary. New failures
  // always carry a marker; executor display copy cannot acquire this authority.
  return (
    result.dispatch === undefined &&
    (entry.summary === LEGACY_NOT_DISPATCHED_SUMMARY ||
      entry.summary === NOT_DISPATCHED_SUMMARY) &&
    Object.keys(result).every((key) => key === "operationId")
  );
}
function receiptOutcome(
  status: NonNullable<DeviceJournalEntry["status"]>,
): "applied" | "failed" | "unknown" {
  return status === "succeeded"
    ? "applied"
    : status === "failed"
      ? "failed"
      : "unknown";
}
/** The one typed result a receipt carries, in a fixed precedence. */
function receiptResult(results: TypedResults): CommittedReceiptResult {
  const value =
    results.smsResult ??
    results.dialResult ??
    results.telephonyResult ??
    results.foregroundResult ??
    results.clockResult ??
    results.mapsResult ??
    results.cameraResult ??
    results.photoLibraryResult ??
    results.readResult ??
    results.calendarResult ??
    results.notesResult ??
    results.reminderResult;
  return value === undefined ? {} : { result: value };
}
/** Journal result fields; undefined entries are omitted. */
function definedResults(results: TypedResults): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(results).filter(([, value]) => value !== undefined),
  );
}
function assertSameAttempt(
  next: DeviceJournalEntry,
  entry: DeviceJournalEntry,
  message: string,
) {
  if (
    next.operationId !== entry.operationId ||
    next.operationHash !== entry.operationHash ||
    next.attemptId !== entry.attemptId ||
    JSON.stringify(next.record) !== JSON.stringify(entry.record)
  )
    throw Error(message);
}
