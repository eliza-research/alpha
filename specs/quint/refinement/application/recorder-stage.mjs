/** Replays RecorderStage model traces against chat Transcribe in the installed voice adapter
 * (apps/app/src/prototype/voice-adapter.ts) in the voice view fixture, on the Cloud speech route:
 * `startTranscription` opens it and the recorder panel's own controls (`stop` is the primary
 * control, `toggle` is Record again, `discard` closes) drive it. The shell runs
 * `componentDidUpdate` once after the state updates of a task, as React does.
 *
 * Controlled ports: the recording driver. Its start, stop and transcription are held and then
 * resolved or rejected; `recordingStopped` is emitted for the maximum duration (with or without a
 * usable clip) and for a capture lost to a phone call.
 *
 * Correspondence notes.
 *  - `stage` is read from the primary control's label, `busy` from the disabled transcript field,
 *    `error` from the panel's failed flag, `clip` from the clip length on the panel's clock and
 *    `draft` from the review field. While the surface is still stopping an abandoned start the
 *    chat shows the stopping panel; the stage is then `closed`.
 *  - `driver` is the port's own state: opening while the current start is held, recording once it
 *    returned, stopping while a stop is held, clipped once a clip was returned, none after a
 *    cancel, a rejected start or stop, or a lost capture.
 *  - `staleStart` and `staleTask` are the held port calls made before the last close, entry,
 *    cancel or apply. `staleSettled` lets them return; the adapter must not change.
 *  - `applied` counts the transcripts that reached the composer draft.
 *
 * Not observed: `generation`, `token`, `task` (adapter-internal), `stopFailed` (history) and
 * `refusedAsRecording` (the port never refuses a start here). */
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/RecorderStage.qnt', module: 'RecorderStage'};
export const scenarios = ['recordTranscribeApplyTest', 'failedStopAllowsRetryTest', 'failedTimerStopAllowsRetryTest', 'staleStartAfterCloseTest',
  'lostCaptureReturnsReadyTest', 'cancelTranscriptionClosesTest', 'failedTranscriptionRetriesTest', 'recordAgainDiscardsClipTest'];
export const witnesses = ['RetryAfterFailedStopWitness', 'ReviewWitness', 'StaleTaskWitness', 'ReadyAfterErrorWitness', 'StaleStartBlocksEntryWitness',
  'RecordedAfterFailedTranscriptionWitness', 'RecordAgainWitness'];

const {cloudVoiceViewFixture} = await import(`${repositoryRoot}/test/fixtures/cloud-voice-view.mjs`);
const {voiceFakeClock} = await import(`${repositoryRoot}/test/fixtures/shared-batch-voice.mjs`);

export function project(state) {
  const {generation, token, task, stopFailed, refusedAsRecording, ...observed} = state;
  return observed;
}

export function createDriver() {
  const clock = voiceFakeClock();
  const f = cloudVoiceViewFixture({cloudProfile: true, native: true, platform: 'android', clock});
  f.box.React = {createElement: () => null}; f.box.VoiceActivity = () => null; f.box.HTMLElement = class {};
  f.box.nativeLiveVoiceReady = async () => false;
  const shell = f.shell, gates = [];
  const setState = shell.setState.bind(shell);
  // State updates made in one task are committed together, then componentDidUpdate runs once.
  let committing = false;
  shell.setState = (patch, callback) => { setState(patch, callback); if (committing) return; committing = true; queueMicrotask(() => { committing = false; if (shell.live !== false) shell.componentDidUpdate(); }); };
  let epoch = 0, port = 'none', recordings = 0, recordingId = null;
  const held = (kind, settle) => new Promise((resolve, reject) => gates.push({kind, epoch, open: true,
    resolve(value) { this.open = false; settle?.(true); resolve(value); }, reject(reason) { this.open = false; settle?.(false); reject(reason); }}));
  Object.assign(f.driver, {
    startRecording() { const id = `clip-${++recordings}`, mine = epoch; if (port === 'none') port = 'opening';
      return held('start', ok => { if (mine === epoch) port = ok ? 'recording' : 'none'; else if (ok) port = 'recording'; if (ok) recordingId = id; }).then(() => ({recordingId: id, maxDurationMs: 59000})); },
    stopRecording() { const id = recordingId, mine = epoch; port = 'stopping';
      return held('stop', ok => { if (mine === epoch) port = ok ? 'clipped' : 'none'; }).then(() => ({recordingId: id, durationMs: 1000})); },
    transcribeRecording() { return held('transcribe').then(() => ({text: 'spoken', local: false})); },
    async cancelRecording() { port = 'none'; },
  });
  const panel = () => f.renderChat();
  const settle = async () => { await clock.flush(); await clock.advance(0); };
  const current = kind => gates.findLast(gate => gate.open && gate.kind === kind && gate.epoch === epoch);
  const finish = async (kind, ok) => { const gate = current(kind); if (ok) gate.resolve(); else gate.reject(Error('The recorder failed.')); await settle(); };
  const emit = async value => { for (const callback of f.events.get('recordingStopped') || []) callback({recordingId, ...value}); await settle(); };
  const stages = {'Start recording': 'ready', 'Starting microphone': 'starting', 'Stop recording': 'recording', 'Cancel transcription': 'transcribing', 'Use in draft': 'review'};
  const primary = async () => { panel().stop(); await settle(); };
  const leaving = async run => { epoch++; await run(); };
  return {
    enter: () => leaving(async () => { const view = panel(); if (view) view.toggle(); else shell.startTranscription(); await settle(); }),
    // Also called once after the last step of a trace, when Transcribe may already be closed.
    close: () => leaving(async () => { panel()?.discard(); await settle(); }),
    async staleSettled() { for (const gate of gates) if (gate.open && gate.epoch < epoch) gate.resolve(); await settle(); },
    primaryStart: primary, primaryStop: primary, primaryTranscribe: primary,
    startSettled: ok => finish('start', ok), stopSettled: ok => finish('stop', ok), transcribeSettled: ok => finish('transcribe', ok),
    async maxDuration(ok) { port = ok ? 'clipped' : 'none'; await emit(ok ? {durationMs: 1000} : {}); },
    async captureLost() { port = 'none'; await emit({interrupted: 'call-active'}); },
    cancelTranscribe: () => leaving(primary),
    apply: () => leaving(primary),
    observe() {
      const view = panel(), stopping = view?.regionLabel === 'Voice conversation';
      const open = !!view && !stopping, stale = gates.filter(gate => gate.open && gate.epoch < epoch);
      const stage = !open ? 'closed' : stages[view.primaryLabel] ?? (String(view.primaryLabel).startsWith('Transcribe with') ? 'recorded' : `unknown ${view.primaryLabel}`);
      return {stage, busy: open && view.transcriptDisabled === true, staleStart: stale.some(gate => gate.kind === 'start'), staleTask: stale.some(gate => gate.kind !== 'start'),
        driver: port === 'opening' && !current('start') ? 'none' : port, clip: open && view.clock === '0:01', draft: open && view.review === true && view.transcript === 'spoken',
        error: open && view.failed === true, applied: String(shell.S().draft || '').split('spoken').length - 1};
    },
    fixture: f,
    async dispose() { try { f.close(); } catch {} for (const gate of gates) if (gate.open) gate.reject(Error('closed')); await clock.flush(); },
  };
}

export async function runRecorderStageReplay({random = 80, steps = 40} = {}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps}), drivers = [];
  try { return await replayTraces(traces, () => { const driver = createDriver(); drivers.push(driver); return driver; }, {project}); }
  finally { for (const driver of drivers) await driver.dispose(); }
}
