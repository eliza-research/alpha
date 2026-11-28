import type { DeviceOperation, JournalEntry } from "@elizaos/agent";
import type { WorkflowDeviceBinding } from "@elizaos/plugin-workflow-client";
import { type Faked, plugin } from "./phone.ts";
import { readJsonBody, type Route } from "./routes.ts";

const enrollmentId = "this-phones-enrollment";
const key = "a".repeat(64);
const attemptId = "device-attempt-1";

type Sms = Extract<DeviceOperation, { type: "sms_send" }>;
type ReviewOperation = Extract<DeviceOperation, { type: "sms_send" | "sms_compose" | "sms_latest_sender" | "messages_read_selected" | "voicemail_read_selected" | "voicemail_delete_selected" | "files_filter" | "files_open" | "files_move" | "files_share" | "files_trash" | "files_folder_create" | "browser_navigate" | "camera_capture_photo" | "calendar_availability" | "create_note" | "post_notification" | "speak_text" }>;
interface ReadOrigin { readonly version: 1; readonly requestId: string; readonly conversationId: string; readonly inReplyTo: string }

type Confirmation = Pick<Sms, "recipients" | "body" | "subscriptionId"> & { operationId: string; confirm(): void };

export function textReview(agentId: string, id: string, operation: ReviewOperation, requestMessageId?: string) {
  return {
    agentId,
    proposal: {
      id, digest: "b".repeat(64), state: "pending", expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { installationId: agentId, enrollmentId, operation, requestMessageId },
    },
    cameraLibraryId: false,
    extraCapabilities: [] as string[],
    attemptId,
    workflow: undefined as { binding: WorkflowDeviceBinding; offered(): boolean; answered?(): void } | undefined,
    pendingReads: 0,
    /** While set, each read of the pending proposals waits for it. */
    proposalsGate: undefined as Promise<void> | undefined,
    readOrigin: undefined as ReadOrigin | undefined,
    senderReads: [] as boolean[],
    completions: [] as unknown[],
    journal: new Map<string, JournalEntry>(),
    confirmations: [] as Confirmation[],
    decisions: [] as string[],
    rejections: [] as string[],
    decisionGate: undefined as Promise<void> | undefined,
    claims: [] as string[],
    receipts: [] as unknown[],
    /** Further pending proposals the resident lists after this one, for review only: none of them can be decided here. */
    others: [] as { id: string; digest: string; state: string; expiresAt: string; payload: { installationId: string; enrollmentId: string; operation: ReviewOperation | DeviceOperation; requestMessageId?: string } }[],
  };
}

/** One more pending proposal of `review`'s enrollment, listed for review beside it. */
export function alsoPending(review: TextReviewScene, id: string, operation: DeviceOperation, requestMessageId?: string) {
  review.others.push({ id, digest: (review.others.length + 1).toString(16).padStart(64, "c"), state: "pending", expiresAt: review.proposal.expiresAt,
    payload: { installationId: review.agentId, enrollmentId, operation, requestMessageId } });
}

export type TextReviewScene = ReturnType<typeof textReview>;

/**
 * eliza's grounding of the Browser open the owner's whole `message` asked for: bound to that message, to run at once, only on a
 * turn that declared `browser.open-direct.v1`, and otherwise kept for the owner's review (eliza's spec/agent/deviceActions/index.md,
 * "A proposal carries the owner's message only for a live turn that asked for it directly, so otherwise the phone shows its card").
 */
export function askedPage(review: TextReviewScene, message: string, capabilities: readonly string[]): readonly unknown[] {
  const direct = capabilities.includes("browser.open-direct.v1");
  review.proposal.payload.requestMessageId = direct ? message : undefined;
  return [{ action: "PROPOSE_DEVICE_ACTION", data: direct
    ? { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: false, awaitingDeviceExecution: true, directRequest: true }
    : { proposalId: review.proposal.id, state: "pending", executed: false, approvalRequired: true, awaitingUserInput: true } }];
}

export const textReviewEnrollment: Faked = plugin<{
  enrollmentKey(input: { slot: string }): Promise<{ key: string }>;
  authority(): Promise<{ active: boolean }>;
}>(() => ({ enrollmentKey: () => Promise.resolve({ key }), authority: () => Promise.resolve({ active: true }) }));

/** The resident lists and settles only this enrolled phone's exact proposal. */
export function textReviewRoute(review: TextReviewScene, subjectUserId: string): Route {
  const { agentId, proposal } = review;
  const operation = proposal.payload.operation;
  const files = ["files.browser.v1", "files.shown-target.v1"];
  const baseCapabilities = {
    sms_send: ["sms.send.v1"],
    sms_compose: ["sms.compose.v1", "sms.compose.v2"],
    sms_latest_sender: ["includeAddress" in operation ? "sms.latest-sender.v2" : "sms.latest-sender.v1"],
    messages_read_selected: ["messages.read.v1"],
    voicemail_read_selected: ["voicemail.read.v1"],
    voicemail_delete_selected: ["voicemail.delete.v1"],
    files_filter: files,
    files_open: files,
    files_move: files,
    files_share: files,
    files_trash: files,
    files_folder_create: files,
    browser_navigate: [...files, "browser.open-direct.v1"],
    camera_capture_photo: ["camera.capture-photo.v1", ...(review.cameraLibraryId ? ["camera.capture-library-id.v1"] : [])],
    calendar_availability: ["calendar.availability-read.v1"],
    create_note: files,
    post_notification: files,
    speak_text: files,
  }[operation.type];
  const capabilities = [...new Set([...baseCapabilities, ...review.extraCapabilities])];
  const prefix = "/api/client-devices/";
  const reject = (status: number) => Response.json({ error: "review refused" }, { status });
  return (request, url) => {
    const path = url.pathname;
    if (!path.startsWith(prefix)) return undefined;
    const resource = path.slice(prefix.length);
    if (request.method === "GET" && resource === "capabilities") {
      return Response.json({ protocol: 1, agentId, identityId: subjectUserId, deviceActions: { protocol: 1, capabilities } });
    }
    const declared = new Set(request.headers.get("x-eliza-device-capabilities")?.split(",").filter((name) => name !== "") ?? []);
    if (request.headers.get("x-eliza-device-id") !== agentId || request.headers.get("x-eliza-device-key") !== key
      || declared.size !== capabilities.length || capabilities.some((name) => !declared.has(name))) return reject(401);
    if (request.method === "GET" && resource === "context") {
      return Response.json({ agentId, installationId: agentId, enrollmentId, subjectUserId });
    }
    if (request.method === "POST" && resource === "register" && review.workflow !== undefined) {
      return readJsonBody(request).then((body) => typeof body.workflowProtocol === "number" && [1, 2, 3, 5].includes(body.workflowProtocol)
        ? Response.json({ installationId: agentId, enrollmentId }) : reject(409));
    }
    if (request.method === "GET" && resource === "proposals") {
      review.pendingReads += 1;
      const listed = (): Response => {
        if (review.workflow !== undefined && !review.workflow.offered()) return Response.json({ proposals: [] });
        const payload = { ...proposal.payload, ...(review.workflow === undefined ? {} : { workflow: review.workflow.binding }) };
        const execution = ["executing", "reconciliation_required", "done"].includes(proposal.state) ? { attemptId } : undefined;
        return Response.json({ proposals: [{ ...proposal, payload, execution, ...(review.readOrigin === undefined ? {} : { readReplyOrigin: review.readOrigin }) }, ...review.others] });
      };
      return review.proposalsGate === undefined ? listed() : review.proposalsGate.then(listed);
    }
    if (request.method !== "POST" || !resource.startsWith(`proposals/${proposal.id}/`)) return reject(404);
    const step = resource.split("/").at(-1);
    return readJsonBody(request).then(async (body) => {
      if (body.digest !== proposal.digest) return reject(409);
      if (step === "decision" && proposal.state === "pending" && body.decision === "approve") {
        review.decisions.push(proposal.id);
        proposal.state = "approved";
        return Response.json({ digest: proposal.digest, proposal });
      }
      if (step === "decision" && proposal.state === "pending" && body.decision === "reject") {
        review.rejections.push(proposal.id);
        await review.decisionGate;
        proposal.state = "rejected";
        return Response.json({ digest: proposal.digest, proposal });
      }
      if (step === "claim" && proposal.state === "approved") {
        review.claims.push(proposal.id);
        proposal.state = "executing";
        return Response.json({ digest: proposal.digest, proposal: { ...proposal, execution: { attemptId } } });
      }
      if (step === "receipt" && proposal.state === "executing" && body.attemptId === attemptId) {
        review.receipts.push(body.receipt);
        proposal.state = typeof body.receipt === "object" && body.receipt !== null && "outcome" in body.receipt && body.receipt.outcome === "unknown"
          ? "reconciliation_required" : "done";
        review.workflow?.answered?.();
        return Response.json({ digest: proposal.digest, proposal });
      }
      const origin = review.readOrigin;
      if (step === "read-completion" && proposal.state === "done" && origin !== undefined && body.version === origin.version
        && body.proposalId === proposal.id && body.attemptId === attemptId && body.requestId === origin.requestId
        && body.conversationId === origin.conversationId && body.inReplyTo === origin.inReplyTo
        && review.journal.get(proposal.id)?.acknowledged === true) {
        review.completions.push(body);
        return Response.json({ reply: { ...origin, messageId: `${proposal.id}-answer`, text: "The reviewed read answered the original request." } });
      }
      return reject(409);
    });
  };
}
