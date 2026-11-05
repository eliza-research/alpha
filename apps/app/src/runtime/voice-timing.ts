/**
 * Per-turn voice latency records, kept only on this device. A record holds a random turn
 * id, the speech route, whether the turn was cold, and millisecond offsets from the end of
 * recording. It never holds transcript or reply text, account, agent or conversation
 * identifiers. Export produces the JSON that `scripts/aggregate-voice-latency.mjs` reads.
 *
 * Marks: recording-end (offset 0), transcript-ready, send, first-token, final-reply,
 * first-audio. Each mark is recorded once (first wins) and must not precede the mark before
 * it, so a late or out-of-order observation cannot shorten a measured phase.
 *
 * A record started by an app entrypoint also names that entry ('conversation' for the Cloud
 * voice conversation on Home or another view, 'notes' for the Notes recorder) and the send
 * policy in force. The marks are raw: whether review time counts toward a target (A-10) is
 * decided by the aggregator's boundary, never by moving a mark.
 *
 * A live turn (the agent's streaming ASR, live-voice.ts) also carries `live`: the ASR mode and
 * numbers only — partial count, speech-start to first partial, speech-end to final on this
 * client, and the agent's own last-frame to final. Never text.
 *
 * A voice-assistant turn (#423) also carries `endpoint`: which path submitted it (`semantic`, the
 * end-of-turn chain, or `gap`, the long silence gap), the chain's outcome enum, its unavailable
 * reason enum (scorer or `clef-*`), latency and the chain stage that answered (`path`: `local`, the
 * resident's fused scorer, or `clef`); and `heard`: the outcome enum of recording heard-only content
 * after an interruption, including a reply interrupted before any of it played (voice-turn-routes.ts).
 * Never text.
 *
 * On the phone, a conversation turn's transcript-ready, send and first-token marks are also
 * reported to the native latency collector (issue #395) through a sink the platform installs
 * (native-voice-turn.ts). Native stamps them on its monotonic clock and links them to the live
 * capture turn by a random native turn id, which this record keeps as `nativeTurn` and the reply's
 * synthesis echoes. Only the stage name and that id cross the bridge: never text.
 *
 * The recorder is the shared upstream `@elizaos/voice/turn-timing` (projected from the reviewed
 * pin). Alpha keeps only its installed identifiers (storage key, export format), its speech route
 * and entry names, and these function exports so callers, the aggregator and diagnostics keep
 * their contract. Function declarations only: Node contract tests evaluate this source.
 */
import { createVoiceTurnTiming, type NativeVoiceStageSink, type VoiceTimingEndpoint as SharedVoiceTimingEndpoint, type VoiceTimingLive as SharedVoiceTimingLive, type VoiceTimingMark, type VoiceTimingPolicy } from '../../../../.eliza/client-features/packages/voice/src/voice-turn-timing.ts';
/** The shared record shapes diagnostics copies (diagnostics-export.ts). */
export type VoiceTimingLive = SharedVoiceTimingLive;
export type VoiceTimingEndpoint = SharedVoiceTimingEndpoint;
const voiceTimingRoutes = ['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual'];
type VoiceTimingEntry = 'conversation' | 'notes';
// Storage and clock are read from this realm per access, so a test realm's fakes are the ones used.
const voiceTiming = createVoiceTurnTiming({ storageKey: 'alphaphone:voice-timing:v1', format: 'alpha-voice-timing-v1', routes: voiceTimingRoutes, entries: ['conversation', 'notes'], nativeEntry: 'conversation', storage: () => globalThis.localStorage, clock: () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) });
/** Mark order, as exported. */
export function voiceTimingMarks() { return [...voiceTiming.marks]; }
/** Every stored record that passes validation, oldest first. */
export function voiceTimingRecords() { return voiceTiming.records(); }
/** Start a conversation turn at the end of recording. Any unfinished turn is abandoned. */
export function beginVoiceTurn(input: { route: string; cold: boolean; entry?: VoiceTimingEntry; policy?: VoiceTimingPolicy }): string | undefined { return voiceTiming.begin(input); }
/** Record one mark for the active turn (or the named turn while it is still active). */
export function markVoiceTiming(mark: VoiceTimingMark, turn?: string): boolean { return voiceTiming.mark(mark, turn); }
/** Installs (or removes) the native stage reporter. Conversation turns only. */
export function setNativeVoiceStageSink(sink: NativeVoiceStageSink | undefined) { voiceTiming.setNativeStageSink(sink); }
/** The native latency turn the active conversation turn is linked to, for its reply's synthesis. */
export function nativeVoiceTurnId(): string | undefined { return voiceTiming.nativeTurnId(); }
/** Attach live ASR numbers to the active turn (or the named one while it is still active). */
export function recordLiveVoiceTiming(live: unknown, turn?: string): boolean { return voiceTiming.recordLive(live, turn); }
/** Attach how the active voice-assistant turn was endpointed. Enums and numbers only. */
export function recordEndpointVoiceTiming(endpoint: unknown, turn?: string): boolean { return voiceTiming.recordEndpoint(endpoint, turn); }
/** Attach the heard-content outcome to a stored turn by id. First outcome wins. */
export function recordHeardVoiceTiming(turn: string | undefined, heard: unknown): boolean { return voiceTiming.recordHeard(turn, heard); }
/** The turn ended without a reply (cancelled, discarded, typed instead). Kept as abandoned. */
export function abandonVoiceTurn() { voiceTiming.abandon(); }
/** Finish the active turn after its final reply when no audio will follow. */
export function finishVoiceTurn(turn?: string) { voiceTiming.finish(turn); }
export function activeVoiceTurn() { return voiceTiming.active(); }
/** The send boundary of one voice entry turn whose transcript is ready (see the shared recorder). */
export function sendVoiceEntry<T>(input: { policy: VoiceTimingPolicy; transcript: string; review: (text: string) => Promise<string | null>; send: (text: string) => Promise<T> }): Promise<{ text: string; result: T } | null> { return voiceTiming.sendEntry(input); }
/** JSON export for the latency aggregator. Contains no text or account identifiers. */
export function exportVoiceTiming(): string { return voiceTiming.exportJson(); }
export function clearVoiceTiming() { voiceTiming.clear(); }
/** Test hook: a deterministic clock. */
export function setVoiceTimingClock(clock: () => number) { voiceTiming.setClock(clock); }

// Realtime control/arrival diagnostics use the same localStorage engine, a distinct versioned document.
import {createRealtimeVoiceTiming} from '../../../../.eliza/client-features/packages/voice/src/realtime-voice-timing.ts';
const realtimeVoiceTiming=createRealtimeVoiceTiming({storageKey:'alphaphone:realtime-voice-timing:v1',storage:()=>globalThis.localStorage});
export const beginRealtimeVoiceTiming=(route:'direct-cartesia'|'cloud-cartesia')=>realtimeVoiceTiming.start(route);
export const exportRealtimeVoiceTiming=()=>realtimeVoiceTiming.exportJson();
