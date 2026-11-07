/**
 * Voice assistant turn controller (#423). The implementation is the shared upstream
 * `@elizaos/voice/assistant-session` controller (endpointing, generations, barge-in and
 * heard-content accounting), authenticated and projected from the reviewed pin. Alpha keeps
 * this module path for its adapter, routes and tests; it adds no behavior of its own.
 */
export {
  ASSISTANT_TIMING_DEFAULTS,
  splitSpokenSentences,
  VoiceAssistantError,
  VoiceAssistantSession,
  type AssistantAwaitingInput,
  type AssistantCapture,
  type AssistantClock,
  type AssistantHeard,
  type AssistantListenHandlers,
  type AssistantPhase,
  type AssistantPorts,
  type AssistantReply,
  type AssistantState,
  type AssistantTiming,
  type EndpointDecision,
  type EndpointOutcome,
  type EndpointRecord,
  type EndpointResult,
} from '../../../../.eliza/client-features/packages/voice/src/voice-assistant-session.ts';
