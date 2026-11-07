/**
 * Notes voice recorder (design/view-refresh-2026-11 PLAN.md section 3; spec
 * artifacts/review-2026-11/specs/notes-view, Design.cfg).
 *
 * The recording has no length limit. The native recorder (AlphaNoteRecorder) writes it as
 * finished segments of under 30 s, so a crash keeps every finished segment
 * (CrashKeepsAudio). Each finished segment is transcribed in order while recording goes on and
 * Notes is shown (TranscriptKeepsUp); segments recorded while it is hidden (screen off, another
 * view) are transcribed when it is shown again, or at Done. Any route the user selected is used; every route accepts a segment, since
 * each is under the on-device window and the 60 s request bound of the paired and Cloud
 * routes. The transcript is always a prefix of the audio (TranscriptPrefixOfAudio). Only
 * Done, Discard, low storage or a microphone error end a recording (NoLengthLimit).
 *
 * While recording, an optional live port (the on-device streaming ASR) adds words as they are
 * spoken. Live text is display only: it is never journaled or saved, and it is shown only for
 * audio after the last transcribed segment, so the committed per-segment transcript stays the
 * source of truth.
 *
 * This module has no imports so its logic runs under `node --test`.
 */
export type NoteSegment = { segmentId: string; durationMs: number; text?: string };
export type NoteRecordingStatus = {
  state: 'idle' | 'recording' | 'paused' | 'stopped';
  recordingId?: string; recovered?: boolean; stopReason?: string;
  durationMs?: number; segments?: NoteSegment[]; peak?: number;
};
export type SavedNoteAudio = { audioId: string; noteId: string; durationMs: number; transcript: string };
export interface NoteRecorderDriver {
  start(): Promise<NoteRecordingStatus>;
  status(): Promise<NoteRecordingStatus>;
  pause(recordingId: string): Promise<NoteRecordingStatus>;
  resume(recordingId: string): Promise<NoteRecordingStatus>;
  stop(recordingId: string): Promise<NoteRecordingStatus>;
  discard(recordingId: string): Promise<NoteRecordingStatus>;
  setText(recordingId: string, segmentId: string, text: string): Promise<void>;
  save(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedNoteAudio>;
  listen(callback: (status: NoteRecordingStatus) => void): Promise<{ remove(): Promise<void> | void }>;
}
/** Callbacks from a live transcription stream; the session tags each utterance with recording time. */
export interface NoteLiveHandlers { speechStart(): void; interim(text: string): void; final(text: string): void; lost(): void }
/** Opens a live transcription stream for display, or null when none is available. */
export type NoteLivePort = (handlers: NoteLiveHandlers) => Promise<{ close(): Promise<void> | void } | null>;
type NoteRecorderOptions = { pollMs?: number; visible?: () => boolean; live?: NoteLivePort };
/** Text of one finished segment; '' for silence. Throws when the route fails. */
export type SegmentTranscriber = (segmentId: string, signal: AbortSignal) => Promise<string>;
/** `failed`: the microphone did not start; the recorder stays open with one error line. */
export type NoteRecorderPhase = 'closed' | 'starting' | 'failed' | 'recording' | 'paused' | 'stopped' | 'finishing';

const LEVELS = 44;
const aborted = (error: unknown) => (error as { name?: string })?.name === 'AbortError';

/** One short line, only for errors the user can act on. */
export function noteRecorderError(reason: string | undefined): string {
  if (reason === 'storage') return 'Storage is full.';
  if (reason === 'permission') return 'Allow the microphone in Settings.';
  if (reason === 'call') return 'Paused for a call.';
  if (reason === 'transcription') return 'Transcription stopped. The audio is kept.';
  if (reason === 'sign-in') return 'Sign in to transcribe. The audio is kept.';
  if (reason === 'save') return 'Couldn’t save. Try Done again.';
  if (reason === 'capture') return 'The microphone isn’t available.';
  return 'The microphone stopped.';
}
/** Why the microphone did not start or resume, as a noteRecorderError reason. */
function startFailure(error: unknown): string {
  const { code, name, message } = (error ?? {}) as { code?: string; name?: string; message?: string };
  if (String(code || message || '').toLowerCase().includes('storage')) return 'storage';
  if (code === 'permission-denied' || name === 'NotAllowedError') return 'permission';
  if (code === 'call-active') return 'call';
  return 'capture';
}
export function formatRecordingClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export class NoteRecorderSession {
  phase: NoteRecorderPhase = 'closed';
  recordingId?: string;
  durationMs = 0;
  segments: NoteSegment[] = [];
  /** Recent microphone peaks (0..1), newest last. Flat while paused. */
  levels: number[] = [];
  error = '';
  confirmingDiscard = false;
  private texts = new Map<string, string>();
  private transcribing?: AbortController;
  private pumping?: Promise<void>;
  private transcriptionFailed = false;
  private handle?: { remove(): Promise<void> | void };
  private poll?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  /** The epoch a Discard ended while the microphone was still starting. */
  private abandoned = -1;
  /** Live utterances (display only), tagged with the recording time their speech started. */
  private liveFinals: { text: string; at: number }[] = [];
  private liveInterim = '';
  private liveAt = 0;
  private liveStream?: { close(): Promise<void> | void };
  private liveOpening = false;
  /** A lost live stream is not reopened until the recording pauses and resumes, or Notes is shown again. */
  private liveLost = false;

  private driver: NoteRecorderDriver;
  private transcriber: () => Promise<SegmentTranscriber | null>;
  private changed: () => void;
  private options: NoteRecorderOptions;
  // Plain fields, not parameter properties: this module runs under Node's type stripping.
  constructor(driver: NoteRecorderDriver, transcriber: () => Promise<SegmentTranscriber | null>, changed: () => void, options: NoteRecorderOptions = {}) {
    this.driver = driver; this.transcriber = transcriber; this.changed = changed; this.options = options;
  }

  get open() { return this.phase !== 'closed'; }
  /** The finished segments' text, in order, up to the first one not yet transcribed. */
  transcript(): string {
    const parts: string[] = [];
    for (const segment of this.segments) { const text = this.texts.get(segment.segmentId); if (text === undefined) break; if (text.trim()) parts.push(text.trim()); }
    return parts.join(' ');
  }
  /** Recording time covered by the transcribed prefix of segments. */
  private committedMs(): number {
    let ms = 0;
    for (const segment of this.segments) { if (!this.texts.has(segment.segmentId)) break; ms += segment.durationMs; }
    return ms;
  }
  /**
   * What the recorder shows: the committed transcript, then live words for speech that started
   * after it. A live utterance drops out once a transcribed segment covers its start.
   */
  displayTranscript(): string {
    const committed = this.committedMs();
    const live = this.liveFinals.filter(u => u.at >= committed).map(u => u.text);
    if (this.liveInterim && this.liveAt >= committed) live.push(this.liveInterim);
    return [this.transcript(), ...live].map(t => t.trim()).filter(Boolean).join(' ');
  }
  /** Opens the live stream while recording and visible; closes it otherwise. */
  private syncLive() {
    const want = this.phase === 'recording' && !!this.options.live && !this.liveLost && this.options.visible?.() !== false;
    if (!want) { this.closeLive(); return; }
    if (this.liveStream || this.liveOpening) return;
    const epoch = this.epoch; this.liveOpening = true;
    let stream: { close(): Promise<void> | void } | null | undefined;
    const handlers: NoteLiveHandlers = {
      speechStart: () => { if (epoch !== this.epoch) return; this.liveAt = this.durationMs; this.liveInterim = ''; },
      interim: text => { if (epoch !== this.epoch) return; this.liveInterim = String(text || ''); this.changed(); },
      final: text => {
        if (epoch !== this.epoch) return;
        const value = String(text || '').trim();
        if (value) this.liveFinals.push({ text: value, at: this.liveAt });
        this.liveInterim = ''; this.liveAt = this.durationMs;
        // Older utterances already covered by transcribed segments are no longer needed.
        const committed = this.committedMs(); this.liveFinals = this.liveFinals.filter(u => u.at >= committed);
        this.changed();
      },
      // An older stream (closed by a pause) reporting late is ignored.
      lost: () => { if (epoch !== this.epoch || (stream && this.liveStream !== stream)) return; this.liveLost = true; this.liveStream = undefined; this.liveInterim = ''; this.changed(); },
    };
    void Promise.resolve().then(() => this.options.live!(handlers)).then(opened => {
      stream = opened;
      this.liveOpening = false;
      if (!opened) { if (epoch === this.epoch) this.liveLost = true; return; }
      if (epoch !== this.epoch || this.phase !== 'recording' || this.liveLost) { void Promise.resolve(opened.close()).catch(() => {}); return; }
      this.liveStream = opened; this.liveAt = this.durationMs;
    }, () => { this.liveOpening = false; if (epoch === this.epoch) this.liveLost = true; });
  }
  private closeLive() {
    const stream = this.liveStream; this.liveStream = undefined; this.liveInterim = '';
    if (stream) void Promise.resolve(stream.close()).catch(() => {});
  }
  /** Notes is shown again: a lost live stream may reopen. */
  visibilityChanged() { this.liveLost = false; this.syncLive(); if (this.open) void this.pump(); }
  /** Adopt a recording that is already open (a recovered one, or one left running), else start one. */
  async begin(): Promise<void> {
    if (this.open && this.phase !== 'failed') return;
    const epoch = ++this.epoch;
    this.phase = 'starting'; this.error = ''; this.changed();
    try {
      await this.attach(epoch);
      const existing = await this.driver.status();
      if (epoch !== this.epoch) return;
      const status = existing.state === 'idle' ? await this.driver.start() : existing;
      // Discarded while starting: the recording the microphone just began goes too.
      if (epoch !== this.epoch) { if (this.abandoned === epoch && existing.state === 'idle' && status.recordingId) await this.driver.discard(status.recordingId).catch(() => {}); return; }
      this.apply(status);
      // Say at once when transcription needs the user (Cloud sign-in); recording goes on regardless.
      void this.transcriber().then(() => {}, error => {
        if (epoch !== this.epoch || (error as { code?: string })?.code !== 'sign-in') return;
        this.transcriptionFailed = true; this.error = noteRecorderError('sign-in'); this.changed();
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.detach(); this.phase = 'failed';
      this.error = noteRecorderError(startFailure(error));
      this.changed(); throw error;
    }
  }
  /** Show an open recording left by an earlier process or page without starting one. */
  async adopt(): Promise<boolean> {
    if (this.open) return true;
    const status = await this.driver.status();
    if (status.state === 'idle' || this.open) return this.open;
    const epoch = ++this.epoch;
    await this.attach(epoch);
    if (epoch !== this.epoch) return false;
    this.phase = 'starting'; this.apply(status); return true;
  }
  private async attach(epoch: number) {
    if (this.handle) return;
    const handle = await this.driver.listen(status => { if (epoch === this.epoch) this.apply(status); });
    if (epoch !== this.epoch) { await handle.remove(); return; }
    this.handle = handle;
  }
  private detach() {
    this.closeLive();
    if (this.poll) clearTimeout(this.poll); this.poll = undefined;
    this.transcribing?.abort(); this.transcribing = undefined;
    const handle = this.handle; this.handle = undefined; if (handle) void Promise.resolve(handle.remove()).catch(() => {});
  }
  /** A status from the recorder (a poll answer or an event). */
  apply(status: NoteRecordingStatus) {
    if (!this.open || this.phase === 'finishing' && status.state !== 'idle') { if (this.phase === 'finishing') this.absorb(status); return; }
    if (status.state === 'idle') { if (this.phase !== 'starting') this.close(); return; }
    if (this.recordingId && status.recordingId !== this.recordingId) return;
    this.recordingId = status.recordingId;
    this.absorb(status);
    const previous = this.phase;
    this.phase = status.state;
    if (status.state === 'recording') {
      this.levels = [...this.levels, Math.max(0, Math.min(1, Number(status.peak) || 0))].slice(-LEVELS);
      if (!this.transcriptionFailed && this.error && previous !== 'recording') this.error = '';
    } else if (status.state === 'stopped' && status.stopReason && status.stopReason !== 'user') this.error = noteRecorderError(status.stopReason);
    if (status.state !== 'recording' && previous === 'recording') this.liveLost = false;
    this.schedulePoll();
    this.syncLive();
    void this.pump();
    this.changed();
  }
  private absorb(status: NoteRecordingStatus) {
    if (Number.isFinite(status.durationMs)) this.durationMs = Number(status.durationMs);
    if (Array.isArray(status.segments)) {
      this.segments = status.segments.map(s => ({ segmentId: String(s.segmentId), durationMs: Number(s.durationMs) || 0, ...(typeof s.text === 'string' ? { text: s.text } : {}) }));
      // A recovered recording brings back the text journaled with each segment.
      for (const s of this.segments) if (typeof s.text === 'string' && !this.texts.has(s.segmentId)) this.texts.set(s.segmentId, s.text);
    }
  }
  private schedulePoll() {
    if (this.poll) clearTimeout(this.poll); this.poll = undefined;
    if (this.phase !== 'recording' || !this.recordingId) return;
    const epoch = this.epoch;
    this.poll = setTimeout(() => {
      this.poll = undefined;
      void this.driver.status().then(status => { if (epoch === this.epoch) this.apply(status); }, () => { if (epoch === this.epoch) this.schedulePoll(); });
    }, this.options.pollMs ?? 120);
  }
  /** Transcribes finished segments in order, one at a time, while the recording goes on. */
  pump(force = false): Promise<void> {
    if (force) this.transcriptionFailed = false;
    if (this.pumping) return this.pumping;
    const epoch = this.epoch;
    const run = (async () => {
      let route: SegmentTranscriber | null = null, resolved = false;
      for (;;) {
        if (epoch !== this.epoch || this.transcriptionFailed || this.options.visible?.() === false) return;
        const next = this.segments.find(s => !this.texts.has(s.segmentId));
        if (!next || !this.recordingId) return;
        if (!resolved) {
          resolved = true;
          try { route = await this.transcriber(); }
          catch (error) {
            if (epoch !== this.epoch) return;
            // A route that needs the user (Cloud sign-in) says so once; the audio is still kept.
            if ((error as { code?: string })?.code === 'sign-in') { this.transcriptionFailed = true; this.error = noteRecorderError('sign-in'); this.changed(); }
            return;
          }
          if (epoch !== this.epoch) return;
        }
        if (!route) return; // No transcription route: the recording is saved with its audio only.
        const controller = new AbortController(); this.transcribing = controller;
        let text: string;
        try { text = await route(next.segmentId, controller.signal); }
        catch (error) {
          if (epoch !== this.epoch || controller.signal.aborted || aborted(error)) return; // Hidden or closed: resumes later.
          this.transcriptionFailed = true; if (this.phase !== 'stopped' || !this.error) this.error = noteRecorderError('transcription'); this.changed(); return;
        } finally { if (this.transcribing === controller) this.transcribing = undefined; }
        if (epoch !== this.epoch) return;
        this.texts.set(next.segmentId, typeof text === 'string' ? text : '');
        // Journaled with the segment, so a crash keeps the transcript up to here.
        try { await this.driver.setText(this.recordingId, next.segmentId, this.texts.get(next.segmentId)!); } catch { /* The audio is kept; the text is saved with the note. */ }
        this.changed();
      }
    })();
    this.pumping = run.finally(() => { if (this.pumping === tracked) this.pumping = undefined; });
    const tracked = this.pumping;
    return tracked;
  }
  async pause() { if (this.phase === 'recording' && this.recordingId) this.apply(await this.driver.pause(this.recordingId)); }
  async resume() {
    if (!this.recordingId || !['paused', 'stopped'].includes(this.phase)) return;
    try { this.error = this.transcriptionFailed ? this.error : ''; this.apply(await this.driver.resume(this.recordingId)); }
    catch (error) { this.error = noteRecorderError(startFailure(error)); this.changed(); }
  }
  async togglePause() { if (this.phase === 'failed') await this.begin().catch(() => {}); else if (this.phase === 'recording') await this.pause(); else await this.resume(); }
  /**
   * Done: stop, let the transcript catch up with the audio, and save both as one voice note
   * through `persist` (with `keepAudio` false, only the transcript and length, and only once every
   * segment is transcribed: the segments are discarded once the note is saved). The recording
   * closes only after `persist` confirms the note; saving the same recording again returns the
   * audio already saved into the same note, so Done can be retried.
   */
  async finish(persist: (saved: SavedNoteAudio, transcript: string) => Promise<boolean>, keepAudio = true): Promise<boolean> {
    const id = this.recordingId;
    if (!id || !['recording', 'paused', 'stopped'].includes(this.phase)) return false;
    const epoch = this.epoch;
    this.phase = 'finishing'; this.confirmingDiscard = false; if (this.poll) clearTimeout(this.poll); this.poll = undefined; this.closeLive(); this.changed();
    try {
      this.absorb(await this.driver.stop(id));
      if (epoch !== this.epoch) return false;
      await this.pump(true);
      if (epoch !== this.epoch) return false;
      if (!this.segments.length) throw Error('No audio');
      // A destination that keeps no audio saves only a transcript of every segment; until then
      // the recording stays, so Done never leaves a note without the words or the audio.
      if (!keepAudio && (this.transcriptionFailed || this.segments.some(s => !this.texts.has(s.segmentId)))) {
        this.phase = 'stopped'; if (!this.transcriptionFailed || !this.error) this.error = noteRecorderError('transcription'); this.changed(); return false;
      }
      const transcript = this.transcript();
      // The note is named by its recording, so a retried Done (also after a restart) saves into
      // the note the stored audio already belongs to.
      const noteId = id;
      // A destination that keeps no audio (agent notes) gets the transcript and length only.
      const saved = keepAudio ? await this.driver.save({ recordingId: id, noteId, transcript }) : { audioId: id, noteId, durationMs: this.durationMs, transcript };
      if (epoch !== this.epoch) return false;
      if (saved.noteId !== noteId || saved.audioId !== id || !Number.isFinite(saved.durationMs)) throw Error('Invalid saved recording');
      if (!await persist(saved, transcript)) throw Error('Note not saved');
      // The note holds the audio now; the segments go. Until here a failed save can retry.
      if (epoch === this.epoch) this.close();
      await this.driver.discard(id).catch(() => {});
      return true;
    } catch {
      if (epoch !== this.epoch) return false;
      this.phase = 'stopped'; this.error = noteRecorderError('save'); this.changed(); return false;
    }
  }
  /** Discard asks once; the second call deletes every segment. */
  async discard(confirmed = false) {
    if (!this.open) return;
    if (!confirmed && this.durationMs >= 1000 && this.phase !== 'starting') { this.confirmingDiscard = true; this.changed(); return; }
    const id = this.recordingId;
    if (this.phase === 'starting') this.abandoned = this.epoch;
    this.close();
    if (id) await this.driver.discard(id);
  }
  keep() { if (this.confirmingDiscard) { this.confirmingDiscard = false; this.changed(); } }
  /** Detach the view; the recorder keeps the recording (and its segments) until Done or Discard. */
  close() {
    ++this.epoch; this.detach();
    this.phase = 'closed'; this.recordingId = undefined; this.durationMs = 0; this.segments = []; this.levels = [];
    this.texts.clear(); this.transcriptionFailed = false; this.confirmingDiscard = false; this.error = '';
    this.liveFinals = []; this.liveInterim = ''; this.liveLost = false;
    this.changed();
  }
  /**
   * Leaving Notes detaches the view; reopening Notes adopts the recording again. A native
   * recording goes on (its foreground service shows a notification); `pause` (the browser,
   * which has no such notification) pauses it first.
   */
  leave(pause = false) {
    if (!this.open) return;
    const id = this.recordingId, recording = this.phase === 'recording';
    ++this.epoch; this.detach(); this.phase = 'closed'; this.recordingId = undefined; this.segments = []; this.texts.clear(); this.levels = []; this.error = ''; this.confirmingDiscard = false; this.transcriptionFailed = false; this.liveFinals = []; this.liveInterim = ''; this.liveLost = false;
    if (pause && recording && id) void this.driver.pause(id).catch(() => { /* Closed already. */ });
  }
}
