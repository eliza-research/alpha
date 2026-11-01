package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.agent.connection.SecureSlotPolicy;
import java.util.Arrays;

/**
 * Alpha's renderer-slot data for the shared SecureSlotPolicy (plugin-native-agent): public
 * credential storage must not bypass native journal/provider state machines, compare-and-exchange
 * is admitted only for local drafts and pending device actions, and Cloud sign-in slots take a
 * credential intent. The rules live upstream; only Alpha's slot names are here.
 */
final class RendererCredentialSlots {
 private static final String[] NATIVE_NAMESPACES = {
  "canonical-notification-owner", "gmail-background", "native-calendar-sync", "native-delete-journal", "native-delete-installation", "native-digest-source", "resident-results", "local-agent-provider", "workflow-notice-taps",
  "workflow-notice-delivery", "workflow-notice-owner", "workflow-approval-notices", "action-journal", "hosted-background",
  "hosted-digests", "hosted-notices", "note-audio-metadata", "reminder-taps",
  // In-app Cloud sign-in: the pending Google PKCE record and the key acknowledgement receipt.
  "cloud-signin", "google-workspace-return",
  // Physical deployment slots are native-owned. Renderer calls must use logical names.
  "cloud-deployment"
 };
 /** Full-match patterns of the draft and pending-action slots that admit compare-and-exchange. */
 private static final String[] COMPARE_EXCHANGE = {
  "inbox-drafts:v1:[\\s\\S]*", "inbox-operation:v1:[a-f0-9]{64}", "calendar-linked-sync:v1:[a-f0-9]{64}",
  "connected-read-cache:v1:[a-f0-9]{64}", "workflow-draft:v1:[a-f0-9]{64}", "assistant-draft:v1:[a-f0-9]{64}",
  "notes-records:v1:device", "reminder-deletions:v1:device", "reminder-creations:v1:device", "clock-handoff:v1:device",
  "notes-audio-deletions:v1:device", "notes-trash:v1:device", "notes-draft:v1:device", "note-origins:v1:device",
  "cloud-delegation:v1:[a-f0-9]{64}"
 };
 /** Cloud sign-in credentials: renderer writes and removals reserve a credential intent (AlphaLocalAgentPlugin). */
 private static final String[] CREDENTIAL_SLOTS = { "cloud:production", "cloud:staging" };
 static final SecureSlotPolicy POLICY = new SecureSlotPolicy(Arrays.asList(NATIVE_NAMESPACES), Arrays.asList(COMPARE_EXCHANGE), Arrays.asList(CREDENTIAL_SLOTS));
 static String requireAllowed(String slot) { return POLICY.requireRendererSlot(slot); }
 static boolean compareExchangeAllowed(String slot) { return POLICY.compareExchangeAllowed(slot); }
 static boolean credentialSlot(String slot) { return POLICY.credentialSlot(slot); }
}
