// spec/app/browser/index.md, "Story: Let the agent open a page"
import { type ExecutorCall, NOT_DISPATCHED, type DeviceOperation } from "@elizaos/agent";
import { Effect } from "effect";
import type { Alpha } from "../runtime/ui.tsx";
import type { ReviewAuthority } from "./media-review.vibe";

const refused = { kind: "refused", code: NOT_DISPATCHED } as const;

/** Route an admitted operation to the owning area's normal, retained runtime. */
export async function executeMedia(alpha: Alpha, operation: DeviceOperation, call: ExecutorCall, authority: ReviewAuthority): Promise<unknown> {
  if (operation.type === "phone_keypad" || operation.type === "phone_dial" || operation.type === "phone_call") {
    const { phoneAction } = await import("../phone/agent.vibe");
    return alpha.runtime.runPromise(phoneAction(operation, authority.current, authority.phone));
  }
  if (operation.type === "sms_compose") {
    const { composeDraftOnly, messageAction } = await import("../messages/agent.vibe");
    if (!composeDraftOnly(operation)) {
      const { sendReviewedCompose } = await import("../messages/agent-send.vibe");
      return alpha.runtime.runPromise(sendReviewedCompose(operation, call, authority.current, authority.composeLine, authority.sms, authority.phone, authority.approvedText));
    }
    return alpha.runtime.runPromise(messageAction(operation, authority.target, authority.current, authority.continueDraft, authority.phone));
  }
  if (operation.type === "sms_reply_selected") {
    const { messageAction } = await import("../messages/agent.vibe");
    return alpha.runtime.runPromise(messageAction(operation, authority.target, authority.current));
  }
  if (operation.type === "sms_send") {
    const { reviewAgentSms } = await import("../messages/agent-send.vibe");
    return alpha.runtime.runPromise(reviewAgentSms(operation, call, authority.current, authority.sms, authority.approvedText));
  }
  if (operation.type === "messages_read_selected") {
    const { shareSelectedMessage } = await import("../messages/agent.vibe");
    return alpha.runtime.runPromise(shareSelectedMessage(authority.target, authority.current));
  }
  if (operation.type === "voicemail_read_selected") {
    const { shareSelectedVoicemail } = await import("../contacts/reads.vibe");
    return alpha.runtime.runPromise(shareSelectedVoicemail(authority.voicemail, authority.current));
  }
  if (operation.type === "voicemail_delete_selected") {
    if (authority.voicemailDeletion === undefined) return refused;
    const { deleteReviewedVoicemail } = await import("../phone/agent.vibe");
    return alpha.runtime.runPromise(deleteReviewedVoicemail(authority.voicemailDeletion, authority.current));
  }
  if (operation.type === "sms_latest_sender") {
    const { shareLatestSender } = await import("../contacts/reads.vibe");
    return alpha.runtime.runPromise(shareLatestSender(operation, authority.current));
  }
  if (operation.type === "camera_capture_photo") {
    const [{ default: camera }, { requestCapture }, { default: assistant }, { capturePhotoDraft }] = await Promise.all([
      import("../camera/index.tsx"), import("../camera/camera.vibe"), import("./index.tsx"), import("./attachments.vibe"),
    ]);
    const draft = await assistant.runtime(alpha).runPromise(capturePhotoDraft()).catch(() => undefined);
    if (!(await authority.current().catch(() => false))) return refused;
    const cameraRuntime = camera.runtime(alpha);
    const answer = await cameraRuntime.runPromise(requestCapture(operation.lens, draft));
    if (answer.result === "Uncertain") return undefined;
    if (answer.result !== "Taken") return refused;
    const media = answer.media;
    const mediaId = media?.libraryId?.match(/:i:([1-9][0-9]{0,24})$/)?.[1];
    if (media === undefined || mediaId === undefined || media.width <= 0 || media.height <= 0) return undefined;
    if (answer.offerDraft !== undefined) cameraRuntime.runFork(answer.offerDraft);
    return { kind: "applied", result: { version: 1, kind: operation.type, operationId: call.operationId, mediaId, libraryId: media.libraryId, width: Math.round(media.width), height: Math.round(media.height), mime: "image/jpeg" } };
  }
  if (operation.type === "read_selected_notes" || operation.type === "create_note") {
    const { createWorkflowNote, selectedWorkflowNotes } = await import("../notes/workflow-device.vibe");
    if (operation.type === "create_note") return alpha.runtime.runPromise(createWorkflowNote(operation, call, authority.current));
    const result = await alpha.runtime.runPromise(selectedWorkflowNotes(operation, authority.current));
    return result === undefined ? refused : { kind: "applied", result };
  }
  if (operation.type === "read_calendar_range" && authority.workflow) {
    const { readWorkflowCalendar } = await import("../calendar/workflow-device.vibe");
    const current = Effect.tryPromise(authority.current).pipe(Effect.orElseSucceed(() => false));
    const result = await alpha.runtime.runPromise(readWorkflowCalendar(operation, current));
    return result === undefined ? refused : { kind: "applied", result };
  }
  if (operation.type === "calendar_availability") {
    const [{ default: sheet }, { availabilityRead }] = await Promise.all([import("../calendar/availability.tsx"), import("../calendar/availability.vibe")]);
    return sheet.runtime(alpha).runPromise(availabilityRead(operation, authority.current));
  }
  if (operation.type === "read_calendar_range" || operation.type.startsWith("calendar_")) {
    const [{ default: calendar }, { calendarOperation, executeCalendar }] = await Promise.all([import("../calendar/index.tsx"), import("../calendar/device-actions.vibe")]);
    const exact = calendarOperation(operation);
    return exact === undefined ? refused : calendar.runtime(alpha).runPromise(executeCalendar(exact, call));
  }
  if (operation.type === "maps_read_selected") {
    const [{ default: maps }, { readSelected }] = await Promise.all([import("../maps/index.tsx"), import("../maps/agent.vibe")]);
    return maps.runtime(alpha).runPromise(readSelected(operation, authority.current));
  }
  if (operation.type === "read_selected_reminders") {
    const { readWorkflowReminders } = await import("../reminders/workflow-device.vibe");
    const current = Effect.tryPromise(authority.current).pipe(Effect.orElseSucceed(() => false));
    const result = await alpha.runtime.runPromise(readWorkflowReminders(operation, current));
    return result === undefined ? refused : { kind: "applied", result };
  }
  if (operation.type === "post_notification" || operation.type === "speak_text") {
    const scope = authority.workflow;
    if (scope === undefined) return refused;
    if (operation.type === "post_notification") {
      const { postWorkflowStepNotice } = await import("../workflows/native-approval.vibe");
      return alpha.runtime.runPromise(postWorkflowStepNotice(operation, call, scope, authority.current));
    }
    const { speakWorkflowStep } = await import("../workflows/presentation.vibe");
    return alpha.runtime.runPromise(speakWorkflowStep(operation.text, scope, authority.current));
  }
  if (operation.type === "browser_navigate") {
    const [{ default: browser }, { openApproved }] = await Promise.all([import("../browser/index.tsx"), import("../browser/agent.vibe")]);
    return (await browser.runtime(alpha).runPromise(openApproved(operation.url, authority.current))) ? { kind: "applied" } : refused;
  }
  if (operation.type.startsWith("files_")) {
    const [{ default: files }, { fileAction }] = await Promise.all([import("../files/index.tsx"), import("../files/agent.vibe")]);
    return files.runtime(alpha).runPromise(fileAction(operation, call, authority.files, authority.current, authority.reportFiles));
  }
  if (operation.type.startsWith("notes_")) {
    const { executeNotes, notesOperation } = await import("../notes/device-actions.vibe");
    const notes = notesOperation(operation);
    return notes === undefined ? refused : alpha.runtime.runPromise(executeNotes(notes));
  }
  const [{ default: photos }, { photoAction }] = await Promise.all([import("../photos/index.tsx"), import("../photos/agent.vibe")]);
  const result = await photos.runtime(alpha).runPromise(photoAction(operation));
  return result === undefined ? refused : { kind: "applied", result };
}
