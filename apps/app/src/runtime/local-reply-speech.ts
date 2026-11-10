import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '../platform-plugins';
import { planLocalSpeech } from './local-speech-text';
import { nativeVoiceTurnId } from './voice-timing';

/**
 * On-device playback of a spoken reply, one sentence per call, for the voice session's pipelined
 * speech: a sentence handed over while the previous one plays joins the same native utterance
 * (`synthesizeLocal` with `append`), so it is synthesized during playback and plays without a gap.
 * A call settles when its own sentence has finished playing: the next sentence's start on the same
 * utterance, or the utterance's end.
 */
type Bridge = {
  synthesizeLocal(input: { text: string; requestId: string; append: true; voiceTurnId?: string }): Promise<{ playbackId?: string; execution?: string; appended?: boolean }>;
  play(input: { playbackId: string }): Promise<unknown>;
  cancel(input: { requestId: string }): Promise<unknown>;
  stopPlayback(input: { playbackId?: string; requestId: string }): Promise<unknown>;
  addListener(event: string, listener: (value: { playbackId?: string; requestId?: string; atMs?: number; reason?: string; message?: string }) => void): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
  holdSpeechEngine?(): Promise<unknown>;
  releaseSpeechEngineHold?(): Promise<unknown>;
};
type Sentence = { requestId: string; playbackId?: string; started(): void; ended(): void; failed(error: unknown): void };
const SENTENCE_LIMIT_MS = 120_000;

export function createLocalReplySpeaker(bridge: Bridge = registerPlugin<Bridge>('AlphaVoiceCloud')) {
  const sentences = new Map<string, Sentence>(), playing = new Map<string, Sentence>();
  let listening: Promise<unknown> | undefined;
  const finish = (playbackId: string | undefined, settle: (sentence: Sentence) => void) => {
    if (!playbackId) return;
    playing.delete(playbackId);
    for (const sentence of [...sentences.values()]) if (sentence.playbackId === playbackId) settle(sentence);
  };
  const listen = () => listening ??= Promise.all([
    bridge.addListener('playbackSegmentStarted', value => {
      const sentence = value.requestId ? sentences.get(value.requestId) : undefined;
      if (!sentence || !value.playbackId) return;
      sentence.playbackId = value.playbackId;
      // `atMs` is when the sentence is heard; the one before it on this utterance ends then.
      setTimeout(() => {
        const previous = playing.get(value.playbackId!);
        if (!sentences.has(sentence.requestId)) return;
        playing.set(value.playbackId!, sentence);
        if (previous && previous !== sentence) previous.ended();
        sentence.started();
      }, Math.max(0, Math.min(10_000, Number(value.atMs) - Date.now() || 0)));
    }),
    bridge.addListener('playbackEnded', value => finish(value.playbackId, sentence => { sentence.started(); sentence.ended(); })),
    bridge.addListener('playbackFailed', value => finish(value.playbackId, sentence => sentence.failed(Error(value.message || 'Speech playback failed.')))),
    bridge.addListener('playbackStopped', value => finish(value.playbackId, sentence => sentence.failed(Object.assign(Error(value.reason === 'call-active' ? 'Speech stopped for a phone call.' : 'Speech stopped.'), value.reason ? { code: value.reason, reason: value.reason } : {})))),
  ]);
  async function sentence(text: string, signal: AbortSignal, onStarted: () => void) {
    signal.throwIfAborted();
    await listen();
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    let started!: () => void, ended!: () => void, failed!: (error: unknown) => void;
    const audible = new Promise<void>(resolve => { started = resolve; });
    const done = new Promise<void>((resolve, reject) => { ended = resolve; failed = reject; });
    void done.catch(() => {});
    const own: Sentence = { requestId, started, ended, failed };
    sentences.set(requestId, own);
    const abort = () => failed(signal.reason ?? new DOMException('Speech cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    const limit = setTimeout(() => failed(Error('Speech did not finish.')), SENTENCE_LIMIT_MS);
    let settled = false;
    try {
      const voiceTurnId = nativeVoiceTurnId();
      const result = await Promise.race([bridge.synthesizeLocal({ text, requestId, append: true, ...(voiceTurnId ? { voiceTurnId } : {}) }), done.then(() => undefined)]);
      if (result) {
        if (result.execution !== 'device' || typeof result.playbackId !== 'string' || !result.playbackId) throw Error('Invalid local speech execution');
        own.playbackId = result.playbackId;
        if (result.appended !== true) {
          await Promise.race([bridge.play({ playbackId: result.playbackId }), done]);
          playing.set(result.playbackId, own);
          started();
        }
      }
      await Promise.race([audible, done]);
      signal.throwIfAborted();
      onStarted();
      await done;
      settled = true;
    } finally {
      clearTimeout(limit);
      signal.removeEventListener('abort', abort);
      sentences.delete(requestId);
      if (own.playbackId && playing.get(own.playbackId) === own) playing.delete(own.playbackId);
      // An interrupted or failed sentence stops the whole utterance, queued sentences included.
      if (!settled) try { await bridge.cancel({ requestId }); await bridge.stopPlayback({ ...(own.playbackId ? { playbackId: own.playbackId } : {}), requestId }); }
        catch (cause) { throw Object.assign(Error('Owned speech cleanup could not be confirmed.'), { code: 'speech-cleanup-unconfirmed', cause }); }
    }
  }
  return {
    /** Speaks one reply sentence; `onStarted` fires when it is audible. */
    async speak(text: string, signal: AbortSignal, onStarted: () => void) {
      const chunks = planLocalSpeech(text, { mode: 'conversation' });
      if (!chunks.length) { signal.throwIfAborted(); onStarted(); return; }
      let first = true;
      for (const chunk of chunks) await sentence(chunk, signal, () => { if (first) { first = false; onStarted(); } });
    },
    /** Keeps the speech engine loaded while a conversation is open (advisory). */
    hold() { try { void Promise.resolve(bridge.holdSpeechEngine?.()).catch(() => {}); } catch { /* An older bridge has no hold. */ } },
    release() { try { void Promise.resolve(bridge.releaseSpeechEngineHold?.()).catch(() => {}); } catch { /* An older bridge has no hold. */ } },
  };
}

/** The open microphone needs the phone's own capture and speaker (platform echo cancellation). */
export function openMicrophoneAvailable(): boolean { return Capacitor.isNativePlatform(); }
