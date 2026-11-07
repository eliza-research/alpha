/**
 * One continuous live capture mapped onto the agent's live ASR session, with stop reconciliation
 * and discard (#423). The implementation is the shared upstream `@elizaos/voice/live-session`
 * segment stream, authenticated and projected from the reviewed pin. Alpha keeps this module path
 * for its native transport and tests; it adds no behavior of its own.
 */
export {
  createLiveSegmentStream,
  type LiveSegmentHandlers,
  type LiveSegmentStream,
} from '../../../../.eliza/client-features/packages/voice/src/live-voice-session.ts';
