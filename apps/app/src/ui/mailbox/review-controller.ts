/**
 * Headless controller for reviewed managed-Gmail effects of one selected
 * account: send and provider-draft reviews bound to the exact composer email,
 * archive/trash with a reviewed Undo, saved receipts, explicit retry and
 * withdrawn-grant handling. A host renders `render()` and supplies its Cloud
 * binding, storage and notification ports.
 *
 * Every effect goes through the durable InboxOperation journal: a review is
 * prepared, confirmed once and dispatched once. An uncertain outcome is shown
 * as uncertain and is never repeated; recovery only reads the saved receipt.
 * Review state never enters agent context or app persistence other than the
 * journal itself.
 *
 * Alpha owns this controller, its review text and its tap guard. The journal,
 * the protocol-failure reading, the grant policy, the attachment review and the
 * mailbox types stay upstream (`@elizaos/plugin-inbox/mailbox/*`).
 */
import type { MailAttachmentReviewer } from "@elizaos/plugin-inbox/mailbox/attachments";
import { protocolFailure } from "@elizaos/plugin-inbox/mailbox/failures";
import { gmailInboxAllows } from "@elizaos/plugin-inbox/mailbox/grants";
import {
  type ComposerEmail,
  composerContent,
  composerKind,
  InboxOperation,
  type InboxOperationClient,
  type InboxOperationRecord,
  type InboxOperationStore,
  type ReviewBinding,
  renderReviewBinding,
  reviewBinding,
} from "@elizaos/plugin-inbox/mailbox/operation-journal";
import type {
  GmailInboxCapabilities,
  GmailInboxReceipt,
  GmailMailboxAction,
} from "@elizaos/plugin-inbox/mailbox/types";
import { classifyGmailFailure, type GmailFailureKind } from "./failures";
import { MailReviewNotice, mailOperationText } from "./mail-operation-messages";
import { reviewBindingRefusal } from "./review-binding-refusal";

// biome-ignore lint/suspicious/noExplicitAny: proposals and reviews are validated JSON from the journal.
type Bag = Record<string, any>;

export type MailSelectionAction = Extract<
  GmailMailboxAction,
  "archive" | "unarchive" | "trash" | "untrash" | "star" | "unstar" |
  "mark-read" | "mark-unread"
>;

export interface MailReviewClient extends InboxOperationClient {
  gmailInboxCapabilities(
    grant: string,
    signal: AbortSignal,
  ): Promise<GmailInboxCapabilities>;
  gmailDraft(
    grant: string,
    draftId: string,
    signal: AbortSignal,
  ): Promise<{ draftId: string; messageId: string; providerDigest: string }>;
}

/** The host's current managed-service binding. */
interface MailReviewBinding {
  client: MailReviewClient;
  sessionId: string;
  /**
   * Owner identity of the signed-in account (for example
   * `JSON.stringify([environment, userId, organizationId])`). Null while the
   * account is not known; nothing is bound then.
   */
  owner: string | null;
}

interface MailReviewControllerOptions {
  publish(): void;
  toast(message: string): void;
  /** The current binding; null when signed out. Read on every check. */
  binding(): MailReviewBinding | null;
  /** True while provider effects are disabled (for example a fixture connection). */
  disabled?(): boolean;
  store: InboxOperationStore;
  reviewAttachment: MailAttachmentReviewer;
  /** Monotonic clock for the double-tap guard. Defaults to performance.now(). */
  now?(): number;
  /** Schedules the discard of a review whose composer email changed. Defaults to queueMicrotask. */
  defer?(task: () => void): void;
  /**
   * Called first for a failed review step, with the session the step started
   * in. True means the host found that session's Cloud sign-in expired: the
   * review then asks the user to sign in again instead of classifying the error.
   */
  onSessionError?(sessionId: string, error: unknown): boolean;
}

/** The local draft a send came from, and the Gmail draft it was opened from, if any. */
type MailSentSource = {
  draftId: string;
  providerDraft?: { draftId: string; providerDigest: string };
};

interface MailReviewObservers {
  /** A stale review was discarded without dispatch; reload what the user sees. */
  stale?: () => void;
  /** A provider-confirmed receipt (reported once per request). */
  receipt?: (receipt: GmailInboxReceipt) => void;
  /** A provider-confirmed send of a local draft: remove that draft's local copies. */
  sent?: (source: MailSentSource, proposal: Bag, grant: string) => void;
  /** The note shown for a confirmed send of a local draft. */
  sentNote?: (source: MailSentSource) => string;
}

const TITLES: Record<string, string> = {
  send: "Send email",
  "draft-create": "Save Gmail draft",
  "draft-replace": "Replace Gmail draft",
  "draft-delete": "Delete Gmail draft",
  archive: "Archive message",
  unarchive: "Restore to Inbox",
  trash: "Move message to Trash",
  untrash: "Restore from Trash",
  star: "Star message",
  unstar: "Remove star",
  "mark-read": "Mark message read",
  "mark-unread": "Mark message unread",
};

/** Taps on a control that replaced another within this window are ignored. */
const MAIL_REVIEW_DOUBLE_TAP_MS = 700;

export function createMailReviewController(
  options: MailReviewControllerOptions,
) {
  const { publish, toast } = options;
  const disabled = () => options.disabled?.() === true;
  const allowed = (proposal: Bag) =>
    gmailInboxAllows(caps, proposal.kind as GmailMailboxAction) &&
    (!["star", "unstar"].includes(proposal.kind) || caps?.stars === true) &&
    (!["mark-read", "mark-unread"].includes(proposal.kind) || caps?.readState === true) &&
    (!proposal.forwardAttachments || caps?.forwardAttachments === true);
  const now = options.now ?? (() => performance.now());
  const defer = options.defer ?? ((task: () => void) => queueMicrotask(task));
  let editor:
    | ((
        proposal: Bag,
        reference: { draftId: string; providerDigest: string },
        review?: Bag | null,
      ) => Promise<boolean>)
    | null = null;
  let selected = "",
    session = "",
    epoch = 0,
    operation: InboxOperation | null = null,
    caps: GmailInboxCapabilities | null = null,
    capabilitiesFailed = false,
    busy = false,
    visible = false,
    status = "";
  // The provider answered after the dispatch attempt and reports the operation
  // as only prepared. The owner can then discard it; see abandon() in the journal.
  let notStarted = false;
  // An explicit refresh can overlap an older read without changing the account epoch.
  let capabilityRead: AbortController | null = null;
  let checkSelectionAtDispatch: (() => void) | null = null;
  let draftRead: AbortController | null = null,
    failure: GmailFailureKind | null = null;
  // A change grant withdrawn while a provider run is active is applied when that
  // run settles, or by reset() once the run has stopped, so it is never skipped.
  let owner = "",
    withdrawal: { owner: string; grant: string } | null = null,
    running: Promise<unknown> | null = null;
  let onStale: (() => void) | null = null,
    onReceipt: ((receipt: GmailInboxReceipt) => void) | null = null,
    onRestored: (() => void) | null = null,
    reported = "";
  // A review belongs to the exact email that was reviewed. `composer` reports the
  // email now in the composer with its local draft identity (null when none is
  // open). An unsent send or draft review is confirmable only while the composer
  // holds that same email with the reviewed content: after an edit, or when
  // another email is there, it is discarded without dispatch and the email is
  // reviewed again; while no email is open (after a reload, or once the email was
  // moved to another From account, sent from there or discarded) it stays saved
  // but cannot be confirmed.
  let composer: (() => ComposerEmail | null) | null = null,
    discarding = false;
  let onSent:
      | ((source: MailSentSource, proposal: Bag, grant: string) => void)
      | null = null,
    sentNote: ((source: MailSentSource) => string) | null = null;

  const currentSession = () => options.binding()?.sessionId;
  const unsent = (record = operation?.snapshot()) =>
    record &&
    (record.phase === "review" || record.phase === "preparing") &&
    composerKind(record.proposal.kind)
      ? record
      : null;
  const binding = (
    record = unsent(),
    compare = reviewBinding,
  ): ReviewBinding | "none" =>
    record && composer ? compare(record, composer()) : "none";
  const replaced = (state = binding()): state is "edited" | "other" =>
    state === "edited" || state === "other";

  /**
   * A provider-confirmed send that recorded its source draft. Unknown, rejected
   * and unsent states never qualify, nor does a succeeded receipt that names no
   * provider message or another account's operation.
   */
  const sentSource = (record: InboxOperationRecord | null) =>
    record &&
    record.phase === "observed" &&
    record.receipt?.state === "succeeded" &&
    record.receipt.kind === "send" &&
    record.proposal.kind === "send" &&
    record.receipt.requestId === record.requestId &&
    typeof record.receipt.providerResult?.messageId === "string" &&
    record.receipt.providerResult.messageId &&
    selected &&
    record.grantId === selected &&
    record.source
      ? record.source
      : null;
  const settleSent = (owned: InboxOperation) => {
    const record = owned.snapshot(),
      source = sentSource(record);
    if (record && source) onSent?.(source, record.proposal, record.grantId);
    return source;
  };

  function reset() {
    if (withdrawal) {
      const pending = withdrawal,
        inFlight = running;
      withdrawal = null;
      void (async () => {
        await inFlight?.catch(() => {});
        try {
          await InboxOperation.discardUnsent(
            options.store,
            pending.owner,
            pending.grant,
          );
        } catch {
          // The view has moved on, so the failure is told rather than shown as
          // status; the saved review stays and is discarded on the next withdrawal.
          toast(
            "Gmail change access was withdrawn, but the unsent review could not be discarded. Nothing was changed.",
          );
        }
      })();
    }
    epoch++;
    capabilityRead?.abort();
    capabilityRead = null;
    draftRead?.abort();
    draftRead = null;
    operation?.stop();
    operation = null;
    checkSelectionAtDispatch = null;
    selected = session = owner = "";
    running = null;
    caps = null;
    capabilitiesFailed = false;
    busy = visible = notStarted = false;
    status = "";
    failure = null;
    reported = "";
  }

  async function bind(grant: string) {
    const current = options.binding();
    if (
      current &&
      grant === selected &&
      current.sessionId === session &&
      operation
    ) {
      const token = epoch;
      capabilityRead?.abort();
      const read = new AbortController();
      capabilityRead = read;
      try {
        const next = await current.client.gmailInboxCapabilities(
          grant,
          read.signal,
        );
        if (token === epoch && capabilityRead === read) {
          caps = next;
          capabilitiesFailed = false;
          publish();
        }
      } catch {
        if (token === epoch && capabilityRead === read) {
          caps = null;
          capabilitiesFailed = true;
          publish();
        }
      }
      return;
    }
    reset();
    if (!current?.owner || !grant || disabled()) return;
    selected = grant;
    session = current.sessionId;
    owner = current.owner;
    const token = epoch,
      read = new AbortController();
    capabilityRead = read;
    const checkMessageResult = (receipt: GmailInboxReceipt, proposal?: Bag) => {
      if (receipt.state === "succeeded" && proposal?.expectedHistoryId &&
          receipt.providerResult?.messageId !== proposal.messageId) {
        throw new MailReviewNotice("Gmail answered for a different email. Check the saved receipt.");
      }
      return receipt;
    };
    const bound: InboxOperation = new InboxOperation({
      owner,
      grantId: grant,
      store: options.store,
      client: {
        gmailPrepareOperation: (...args) => current.client.gmailPrepareOperation(...args),
        gmailDispatchOperation: async (grant, request, digest, proposal, signal) => {
          // confirm() awaits a durable write before dispatch. A selection can retire during it.
          checkSelectionAtDispatch?.();
          const receipt = await current.client.gmailDispatchOperation(grant, request, digest, proposal, signal);
          return checkMessageResult(receipt, proposal);
        },
        gmailOperation: async (...args) => {
          const receipt = await current.client.gmailOperation(...args);
          return receipt.state === "succeeded" && !composerKind(receipt.kind)
            ? checkMessageResult(receipt, bound.snapshot()?.proposal)
            : receipt;
        },
      },
      reviewAttachment: options.reviewAttachment,
      active: () =>
        epoch === token && session === currentSession() && !disabled(),
    });
    operation = bound;
    try {
      await bound.load();
      if (token !== epoch) return;
      const restored = bound.snapshot();
      if (restored) {
        status =
          "Saved mail operation. Check its exact review and receipt before continuing.";
        const sent = sentSource(restored);
        visible = !sent || !!sent.providerDraft;
        settleSent(bound);
      }
      if (capabilityRead !== read) {
        publish();
        return;
      }
      const next = await current.client.gmailInboxCapabilities(
        grant,
        read.signal,
      );
      if (token !== epoch || capabilityRead !== read) return;
      caps = next;
      capabilitiesFailed = false;
    } catch {
      if (token === epoch && capabilityRead === read) {
        capabilitiesFailed = true;
        status =
          "Provider actions unavailable. Your local drafts remain on this device.";
      }
    }
    if (token === epoch) publish();
  }

  // The buttons inside the review change when an operation started there
  // finishes: Confirm gives way to Undo or Edit, and Undo gives way to Confirm.
  // The second tap of a double tap must not land on the control that took its
  // place (tap, tap, tap would otherwise trash, review the undo and confirm it),
  // so those controls ignore taps for a moment after such an operation settles.
  let settled = Number.NEGATIVE_INFINITY;
  const doubleTap = () => now() - settled < MAIL_REVIEW_DOUBLE_TAP_MS,
    settle = () => {
      settled = now();
    };

  async function run(
    task: (owned: InboxOperation, check: () => void) => Promise<unknown>,
  ) {
    if (busy || !operation) return;
    const token = epoch,
      owned = operation,
      ownerSession = session;
    const check = () => {
      if (
        token !== epoch ||
        owned !== operation ||
        ownerSession !== currentSession()
      )
        throw new DOMException("Inbox account changed", "AbortError");
    };
    busy = true;
    failure = null;
    publish();
    try {
      check();
      const pending = task(owned, check);
      running = pending;
      await pending;
      if (token === epoch) {
        status = "";
        const confirmedSend = settleSent(owned);
        const record = owned.snapshot(),
          receipt = record?.receipt;
        notStarted =
          record?.phase === "dispatching" && receipt?.state === "prepared";
        if (receipt?.state === "succeeded" && receipt.requestId !== reported) {
          reported = receipt.requestId;
          if (visible && confirmedSend && !confirmedSend.providerDraft) {
            visible = false;
            toast("Sent.");
          }
          onReceipt?.(receipt);
          if (receipt.kind === "unarchive" || receipt.kind === "untrash")
            onRestored?.();
        }
      }
    } catch (error) {
      if (token === epoch) {
        notStarted = false;
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (!aborted && options.onSessionError?.(ownerSession, error)) {
          // A 401 does not say whether a dispatch happened; the receipt does.
          failure = "revoked";
          status =
            "Cloud sign-in expired. Sign in again, then check this review before retrying.";
        } else {
          const classified = aborted
            ? null
            : classifyGmailFailure(error, "operation");
          failure = classified?.kind || null;
          // A protocol error's own message names only the transport
          // ("Cloud http (400)"); a plain journal refusal is worded by Alpha
          // (mail-operation-messages.ts), and any other error reads as unavailable.
          status =
            classified &&
            (classified.kind !== "unavailable" || protocolFailure(error))
              ? classified.message
              : mailOperationText(error, "Mail operation unavailable");
        }
        toast(status);
      }
    } finally {
      if (token === epoch) {
        running = null;
        busy = false;
        publish();
        if (withdrawal) void applyWithdrawal();
      }
    }
  }

  async function discardEdited() {
    if (busy || discarding || !replaced()) return;
    discarding = true;
    try {
      await run(async (owned, check) => {
        const state = binding();
        if (!replaced(state)) return;
        await owned.clear();
        check();
        visible = false;
        toast(reviewBindingRefusal[state]);
      });
    } finally {
      discarding = false;
    }
  }

  /**
   * Explicit retry after a classified failure. It never confirms or dispatches:
   * a stale review, or one for a message Gmail no longer has, is discarded
   * (it was never dispatched) and the message reloaded; otherwise the
   * idempotent review is reloaded or the saved receipt is checked.
   */
  async function retry() {
    const record = operation?.snapshot();
    if (!record) return;
    if (
      (failure === "stale" || failure === "gone") &&
      (record.phase === "preparing" || record.phase === "review")
    ) {
      await run(async (owned, check) => {
        await owned.clear();
        check();
        visible = false;
      });
      if (!operation?.snapshot()) {
        failure = null;
        onStale?.();
      }
      return;
    }
    if (record.phase === "preparing") {
      await run((owned) => owned.reloadReview());
      return;
    }
    await run((owned) => owned.refresh());
  }

  async function prepare(
    proposal: Bag,
    source?: Parameters<InboxOperation["prepare"]>[1],
    mode?: "send-from-composer",
  ) {
    if (!operation || busy) return;
    const kind = proposal.kind;
    if (!allowed(proposal)) {
      toast(
        "This account has not allowed Gmail changes. Allow them in Settings, then try again. Nothing was changed.",
      );
      return;
    }
    if (mode === "send-from-composer" && kind === "send" && source && composer) {
      const owned = operation;
      let dispatchId: string | undefined,
        blocked = false;
      visible = false;
      await run(async (operation, check) => {
        const earlier = operation.snapshot();
        const previous = sentSource(earlier);
        if (previous && !previous.providerDraft) {
          if (previous.draftId === source.draftId)
            throw new MailReviewNotice("This email was already sent.");
          await operation.clear();
          check();
        } else if (
          earlier?.phase === "observed" &&
          earlier.proposal.kind !== "send" &&
          (earlier.receipt?.state === "succeeded" ||
            earlier.receipt?.state === "rejected")
        ) {
          // A settled archive, trash or label change has its receipt already
          // reported; it never blocks the next email.
          await operation.clear();
          check();
        }
        const pending = unsent();
        if (
          pending?.phase !== "review" ||
          pending.proposal.kind !== "send" ||
          binding(pending) !== "bound" ||
          pending.composer?.draftId !== source.draftId ||
          composerContent(pending.proposal) !== composerContent(proposal)
        ) {
          if (pending) await operation.clear();
          check();
          // Any other saved operation (an unsent review of another change, or
          // an unresolved outcome) is left for the owner to resolve in the
          // review sheet, which is opened below; nothing is prepared over it.
          if (operation.snapshot()) {
            blocked = true;
            throw new MailReviewNotice(
              "Review the saved email action before starting another.",
            );
          }
          await operation.prepare(proposal, source);
        }
        check();
        const record = operation.snapshot();
        if (record?.phase !== "review" || record.receipt?.state !== "prepared") return;
        const email = composer?.() ?? null;
        if (reviewBinding(record, email) !== "bound") {
          await operation.clear();
          throw new MailReviewNotice("Email changed before sending. Check it and tap Send again.");
        }
        if (!allowed(proposal)) {
          await operation.clear();
          throw new MailReviewNotice("Gmail send access changed. Check Settings and try again.");
        }
        dispatchId = record.requestId;
        await operation.confirm(email);
      });
      if (owned !== operation) return;
      const record = owned.snapshot();
      if (dispatchId && record?.requestId === dispatchId && record.phase === "observed" && record.receipt?.state === "succeeded") {
        settle();
        toast("Sent.");
      } else if (
        (blocked && record && record.requestId !== dispatchId) ||
        record?.phase === "dispatching" ||
        (record?.phase === "observed" && record.receipt?.state !== "succeeded")
      ) {
        // An earlier saved operation blocks this send, or this send's outcome
        // is not confirmed: the owner resolves it in the review sheet.
        visible = true;
        publish();
      }
      return;
    }
    visible = true;
    // An unsent review of an earlier version of this email was never
    // dispatched. Discard it and prepare the current content under a new
    // request ID; the same content reopens its own review.
    const pending = unsent();
    if (pending && composerKind(kind)) {
      if (
        pending.proposal.kind === kind &&
        pending.composer?.draftId === source?.draftId &&
        composerContent(pending.proposal) === composerContent(proposal) &&
        pending.phase === "review"
      ) {
        publish();
        return;
      }
      await run(async (owned, check) => {
        await owned.clear();
        check();
        await owned.prepare(proposal, source);
      });
      return;
    }
    await run((owned) => owned.prepare(proposal, source));
  }

  /** One reviewed selection, serialized through the same journal as individual changes. */
  async function applySelection(
    action: MailSelectionAction,
    selectedIds: readonly string[],
    historyId: (id: string) => Promise<string | null>,
    current: () => boolean,
  ): Promise<number> {
    if (!operation || busy || visible || !allowed({kind: action})) return 0;
    const ids = [...new Set(selectedIds)];
    let applied = 0;
    await run(async (owned, check) => {
      const requireSelection = () => {
        check();
        if (!current()) throw new DOMException("Selection changed", "AbortError");
        if (withdrawal || !allowed({kind: action})) throw new MailReviewNotice("Gmail change access changed.");
      };
      requireSelection();
      for (const id of ids) {
        const prior = owned.snapshot();
        if (prior) {
          const receipt = prior.receipt;
          const sent = sentSource(prior);
          const settledChange = prior.phase === "observed" &&
            (receipt?.state === "succeeded" || receipt?.state === "rejected") &&
            !composerKind(prior.proposal.kind);
          if (!(sent && !sent.providerDraft) && !settledChange) {
            visible = true;
            throw new MailReviewNotice("Finish the saved mail review first.");
          }
        }
        const version = await historyId(id);
        requireSelection();
        if (!version) throw new MailReviewNotice("An email in this selection could not be refreshed.");
        if (prior) {
          await owned.clear();
          requireSelection();
        }
        try {
          await owned.prepare({kind: action, messageId: id, expectedHistoryId: version});
          requireSelection();
          checkSelectionAtDispatch = requireSelection;
          const confirmed = await owned.confirm().finally(() => {
            if (checkSelectionAtDispatch === requireSelection) checkSelectionAtDispatch = null;
          });
          check();
          const receipt = confirmed?.receipt;
          if (receipt?.state !== "succeeded") {
            visible = true;
            return;
          }
          applied++;
          reported = receipt.requestId;
          onReceipt?.(receipt);
          requireSelection();
        } catch (error) {
          if (operation === owned && current() && owned.snapshot()) visible = true;
          throw error;
        }
      }
    });
    return applied;
  }

  /**
   * The account no longer grants a change capability: the saved undispatched
   * review for this grant is discarded, so it can never be confirmed against
   * the withdrawn grant. A dispatched or settled operation keeps its receipt.
   * While a run is active the withdrawal waits for it to settle (a review still
   * being prepared is discarded once prepared); a reset in between still
   * discards it.
   */
  function withdrawn() {
    if (!operation || !selected || !owner) return;
    withdrawal = { owner, grant: selected };
    if (!busy) void applyWithdrawal();
  }

  async function applyWithdrawal() {
    const pending = withdrawal;
    if (!pending || busy) return;
    withdrawal = null;
    const token = epoch,
      owned = operation;
    busy = true;
    publish();
    let removed = false;
    try {
      removed = await InboxOperation.discardUnsent(
        options.store,
        pending.owner,
        pending.grant,
      );
      if (token === epoch && owned === operation && owned) await owned.load();
    } catch (error) {
      if (token === epoch)
        status = mailOperationText(
          error,
          "The unsent review could not be discarded.",
        );
    } finally {
      if (token === epoch) {
        busy = false;
        if (removed) {
          visible = false;
          status = "";
          toast(
            "Gmail change access was withdrawn, so the unsent review was discarded. Nothing was changed.",
          );
        }
        publish();
      }
    }
  }

  async function editSavedDraft() {
    await run(async (owned, check) => {
      const record = owned.snapshot(),
        reference = record?.receipt?.providerResult,
        current = options.binding(),
        grant = selected;
      if (
        !record ||
        !current ||
        !reference ||
        typeof reference.draftId !== "string" ||
        typeof reference.providerDigest !== "string"
      )
        throw new MailReviewNotice("No provider draft receipt");
      const controller = new AbortController();
      draftRead = controller;
      try {
        const draft = await current.client.gmailDraft(
          grant,
          reference.draftId,
          controller.signal,
        );
        check();
        if (draft.providerDigest !== reference.providerDigest)
          throw new MailReviewNotice(
            "Gmail draft changed outside this app. The saved content will not overwrite it. Open Gmail to inspect the conflict.",
          );
        if (!(await editor?.(record.proposal, draft, record.review)))
          throw new MailReviewNotice(
            "Save or discard changed local edits before opening this Gmail draft.",
          );
        check();
        await owned.clear();
        check();
        visible = false;
      } finally {
        if (draftRead === controller) draftRead = null;
        controller.abort();
      }
    });
  }

  /** A reviewed follow-up of a confirmed result: delete a saved draft, or Undo an archive/trash. */
  async function followup(kind: "delete-draft" | "undo") {
    await run(async (owned, check) => {
      const record = owned.snapshot(),
        result = record?.receipt?.providerResult;
      if (!record || !result) throw new MailReviewNotice("No confirmed provider result");
      // After a send, the Gmail draft it was opened from, as it was when opened.
      const draft =
        record.proposal.kind === "send"
          ? sentSource(record)?.providerDraft
          : result;
      if (kind === "delete-draft" && !draft)
        throw new MailReviewNotice("No Gmail draft to delete");
      const proposal =
        kind === "delete-draft"
          ? {
              kind: "draft-delete",
              draftId: draft?.draftId,
              expectedDigest: draft?.providerDigest,
              confirmPermanentDelete: true,
            }
          : {
              kind:
                record.proposal.kind === "archive" ? "unarchive" : "untrash",
              messageId: result.messageId,
              expectedHistoryId: result.historyId,
            };
      await owned.clear();
      check();
      await owned.prepare(proposal);
    });
  }

  function render() {
    const record = operation?.snapshot() ?? null,
      review = record?.review as Bag | null | undefined,
      bound = binding(unsent(record), renderReviewBinding),
      stale = replaced(bound),
      absent = bound === "absent",
      sent = sentSource(record);
    if (stale && !busy) defer(() => void discardEdited());
    const uncertain =
      record &&
      (record.phase === "dispatching" ||
        record.receipt?.state === "outcome-unknown" ||
        record.receipt?.state === "dispatched");
    const sending = !record || composerKind(record.proposal.kind);
    const receiptState = record?.receipt?.state;
    return {
      providerReview: visible,
      /** The last capability read failed, so a missing grant is not known to be missing. */
      capabilitiesFailed,
      provider: {
        busy,
        status: replaced(bound)
          ? reviewBindingRefusal[bound]
          : absent
            ? reviewBindingRefusal.absent
            : status ||
              (notStarted
                ? sending
                  ? "Gmail reports that this message was not sent. A late request can still deliver it. If you discard this operation, look in Sent in Gmail before you send the message again."
                  : "Gmail reports that this change was not made. A late request can still make it. If you discard this operation, look in Gmail before you repeat the change."
                : uncertain
                  ? sending
                    ? "Delivery outcome is unknown. Check the saved receipt; do not send this message again."
                    : "The outcome of this change is unknown. Check the saved receipt; do not repeat the change."
                  : receiptState === "succeeded"
                    ? "Provider confirmed this operation."
                    : receiptState === "rejected"
                      ? "Provider rejected this operation."
                      : sending
                        ? "Review every field before confirming. No mail has been sent."
                        : "Review this change before confirming. Nothing has been changed."),
        draftNote:
          (sent && sentNote?.(sent)) ||
          "The local draft stays on this device. If this operation succeeded, sending that draft again creates another message.",
        title:
          TITLES[String(review?.kind || record?.proposal.kind)] ||
          "Mail review",
        confirmLabel:
          review?.kind === "send"
            ? "Send this email"
            : review?.kind === "draft-delete"
              ? "Permanently delete draft"
              : "Confirm this change",
        replacementWarning: review?.kind === "draft-replace",
        deletionWarning: review?.kind === "draft-delete",
        clearLabel:
          record?.phase === "review" || record?.phase === "preparing"
            ? "Cancel unsent review"
            : notStarted
              ? "Discard this operation"
              : "Close receipt",
        kind: review?.kind || record?.proposal.kind || "Mail operation",
        from: review?.from || "",
        to: Array.isArray(review?.to) ? review.to.join(", ") : "",
        cc: Array.isArray(review?.cc) ? review.cc.join(", ") : "",
        bcc: Array.isArray(review?.bcc) ? review.bcc.join(", ") : "",
        subject: review?.subject || "",
        body: review?.bodyText || "",
        target:
          review?.messageId || review?.replyMessageId || review?.draftId || "",
        requestId: record?.requestId || "",
        result: record?.receipt?.providerResult
          ? JSON.stringify(record.receipt.providerResult)
          : "",
        attachments:
          [
            ...(Array.isArray(review?.attachments)
              ? review.attachments.map(
                  (a: Bag) =>
                    `${a.name} · ${a.mimeType} · ${a.size} bytes · SHA-256 ${a.sha256}`,
                )
              : []),
            ...(Array.isArray(review?.forwardedAttachments)
              ? review.forwardedAttachments.map(
                  (a: Bag) =>
                    `${a.name} (forwarded original) · ${a.size} bytes · SHA-256 ${a.sha256}`,
                )
              : []),
          ].join("\n") || "No attachments.",
        canEditDraft:
          receiptState === "succeeded" &&
          ["draft-create", "draft-replace"].includes(
            record?.receipt?.kind ?? "",
          ),
        editDraft: () => {
          if (!doubleTap()) void editSavedDraft().finally(settle);
        },
        /** Offered after a draft save, and after a send of an email opened from a Gmail draft. */
        canDeleteDraft:
          receiptState === "succeeded" &&
          (["draft-create", "draft-replace"].includes(
            record?.receipt?.kind ?? "",
          ) ||
            !!sent?.providerDraft),
        deleteDraft: () => {
          if (!doubleTap()) void followup("delete-draft").finally(settle);
        },
        canUndo:
          receiptState === "succeeded" &&
          ["archive", "trash"].includes(record?.receipt?.kind ?? "") &&
          typeof record?.receipt?.providerResult?.historyId === "string",
        undo: () => {
          if (!doubleTap()) void followup("undo").finally(settle);
        },
        canRetry: !!failure && !!record && !busy,
        retryLabel:
          failure === "stale"
            ? "Retry with the current message"
            : failure === "gone"
              ? "Refresh"
              : "Retry",
        retry: () => void retry(),
        confirm: () => {
          if (doubleTap()) return;
          const state = binding();
          if (replaced(state)) {
            void discardEdited();
            return;
          }
          if (state === "absent") {
            toast(reviewBindingRefusal.absent);
            return;
          }
          const record = operation?.snapshot();
          if (!record || !allowed(record.proposal)) {
            toast("Reconnect Gmail, then try again.");
            return;
          }
          // The composer is read in the same turn as the comparison inside confirm(), before any await.
          void run((owned) =>
            owned.confirm(
              composer && composerKind(owned.snapshot()?.proposal.kind)
                ? composer()
                : undefined,
            ),
          ).finally(settle);
        },
        canConfirm:
          !stale &&
          !absent &&
          !!record &&
          record.phase === "review" &&
          receiptState === "prepared" &&
          allowed(record.proposal),
        check: () => void run((owned) => owned.refresh()),
        reload: () => void run((owned) => owned.reloadReview()),
        canReload: record?.phase === "preparing",
        clear: () =>
          void run(async (owned, check) => {
            await (notStarted ? owned.abandon() : owned.clear());
            check();
            // An operation that the provider started after all stays on view.
            visible = !!owned.snapshot();
          }),
        canClear:
          notStarted ||
          record?.phase === "review" ||
          record?.phase === "preparing" ||
          ["succeeded", "rejected"].includes(receiptState || ""),
        close: () => {
          visible = false;
          publish();
        },
      },
    };
  }

  return {
    bind,
    reset,
    prepare,
    applySelection,
    withdrawn,
    setEditor(value: typeof editor) {
      editor = value;
    },
    setComposer(value: typeof composer) {
      composer = value;
    },
    /** A confirmed undo put a message back; the list on screen no longer shows the mailbox. */
    onRestored(value: () => void) {
      onRestored = value;
    },
    capabilities: () => caps,
    recentlySettled: doubleTap,
    setObservers(value: MailReviewObservers) {
      onStale = value.stale || null;
      onReceipt = value.receipt || null;
      onSent = value.sent || null;
      sentNote = value.sentNote || null;
    },
    close() {
      if (!visible) return false;
      visible = false;
      publish();
      return true;
    },
    chips<T>(chip: (label: string, action: () => void) => T): T[] {
      const record = operation?.snapshot() ?? null;
      const sent = sentSource(record);
      return record && (!sent || sent.providerDraft)
        ? [
            chip("Mail review / receipt", () => {
              visible = true;
              publish();
            }),
          ]
        : [];
    },
    render,
  };
}

type MailReviewController = ReturnType<
  typeof createMailReviewController
>;
export type MailReviewView = ReturnType<MailReviewController["render"]>;
