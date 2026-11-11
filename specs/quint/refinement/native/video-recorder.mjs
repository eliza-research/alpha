// VideoRecorder against BrowserVideoCapture in apps/app/src/browser/video-capture.ts.
// Ports: MediaRecorder, the camera track, timers and the frame drawer. The recorder session
// half of the model is observed; the Camera view half (shutter state, leaving, the preview)
// lives in the DOM-bound camera adapter and is supplied by the driver as the calls that adapter
// makes: start, stop and cancel. Sizes are bytes against a limit of two.
import assert from 'node:assert/strict';
import {loadProductModule, modelTraces, replayTraces, settle} from '../application/notes-files-media-itf.mjs';

const source = 'apps/app/src/browser/video-capture.ts';
const causes = [[/Recording contains no video|Video exceeded the size limit/, 'empty'], [/video at the size limit could not be read/, 'prefix-invalid'], [/Video recording interrupted/, 'recorder-error'], [/Video did not finish/, 'deadline']];
const globals = ['document', 'MediaStream', 'MediaRecorder', 'setTimeout', 'clearTimeout', 'readVideoPrefix'];

export async function replayVideoRecorder({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/native/VideoRecorder.qnt', main: 'VideoRecorder', ...options});
  const product = await loadProductModule(source, {rewrite, stubs: {
    './sensor-policy': 'export class BrowserMicrophone{close(){}}',
    './camera-frame': 'export const drawCameraFrame=()=>({toDataURL:()=>"data:image/jpeg;base64,AA=="});',
    './video-capture-prefix': 'export const measureVideoPrefix=(blob,signal)=>globalThis.readVideoPrefix(blob,signal);',
  }});
  return replayTraces(traces, {
    required: ['startResolved', 'chunk', 'limitOrTrackEnded', 'recorderStopped', 'prefixRead', 'recorderError', 'stopDeadline', 'finish', 'finalized', 'finishOnLeave', 'stopPreview'],
    reached: {
      'a recording saved after the size limit stopped it': ({s}) => s.full && s.bytes > 0 && s.rows > 0,
      'an overflowing chunk left out': ({s}) => s.full && s.bytes === 1,
      'an unreadable prefix refused': ({s}) => s.cause === 'prefix-invalid',
      'a failed finalisation': ({s}) => s.failures > 0,
      'a stop deadline': ({s}) => s.cause === 'deadline',
    },
    project: ({s}) => ({session: ['none', 'cancelled'].includes(s.session) ? 'idle' : s.session, bytes: s.session === 'none' || s.session === 'cancelled' ? 0 : s.bytes,
      cause: s.cause, rows: s.rows, failures: s.failures}),
    async start() {
      const saved = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
      const realTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout, timers = new Map();
      let timer = 0, recorder, ended, completePrefix;
      const track = {readyState: 'live', clone: () => ({stop() {}}), addEventListener(type, listener) { if (type === 'ended') ended = listener; },
        removeEventListener(type, listener) { if (type === 'ended' && ended === listener) ended = undefined; }};
      const video = {srcObject: {getVideoTracks: () => [track]}, readyState: 4, videoWidth: 640, videoHeight: 480};
      const values = {document: {hidden: false},
        readVideoPrefix: (_blob, signal) => new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, {once: true});
          completePrefix = ok => {
            completePrefix = undefined;
            signal.removeEventListener('abort', abort);
            if (ok) resolve(0.125);
            else reject(Error('The video at the size limit could not be read.'));
          };
        }),
        MediaStream: class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } },
        // The recorder emits nothing by itself: every chunk, stop and error event is a model step.
        MediaRecorder: class { constructor() { this.state = 'inactive';this.mimeType = 'video/webm;codecs=vp8';recorder = this; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; } },
        setTimeout: (run, delay, ...rest) => delay ? (timers.set(++timer, {run, delay}), -timer) : realTimeout(run, delay, ...rest),
        clearTimeout: id => { if (typeof id === 'number' && id < 0) timers.delete(-id);else realClear(id); }};
      for (const name of globals) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: values[name]});
      const capture = new product.BrowserVideoCapture();
      let outcome, cause = 'none', finalizing, consumed = true, rows = 0, failures = 0;
      const record = error => { const found = causes.find(([pattern]) => pattern.test(String(error?.message)));if (found) cause = found[1]; };
      return {
        actions: {
          shutter() {},
          async startResolved({ok}, before) {
            const start = ok && !before.s.previewStopped;
            track.readyState = start ? 'live' : 'ended';
            try {
              await capture.start(video, {audio: false, maxDuration: 300, maxFileSize: 2});
              assert.ok(start, 'recording started without a live preview');
              outcome = undefined;cause = 'none';consumed = false;
              const session = capture.current;
              session.done.then(clip => {
                if (session.prefixRead) assert.equal(clip.duration, 0.125, 'saved prefix uses the measured media duration');
                if (capture.current === session || !consumed) outcome = 'saved-pending';
              },
                error => { record(error);if (error?.name !== 'AbortError') outcome = 'failed-pending'; });
            } catch (error) { assert.ok(!start, `recording could not start: ${error?.message}`); }
            track.readyState = 'live';
          },
          async chunk({units}) { recorder.ondataavailable({data: new Blob([new Uint8Array(units)], {type: 'video/webm'})});await settle(); },
          async limitOrTrackEnded() { ended();await settle(); },
          async recorderStopped() { recorder.onstop();await settle(); },
          async prefixRead({ok}) { completePrefix(ok);await settle(); },
          async recorderError() { recorder.onerror();await settle(); },
          async stopDeadline() {
            const [id, deadline] = [...timers].find(([, entry]) => entry.delay === 5000);
            timers.delete(id);deadline.run();await settle();
          },
          async finish() { finalizing = capture.stop().then(clip => ({clip}), error => ({error}));await settle(); },
          async finishOnLeave() { finalizing = capture.stop().then(clip => ({clip}), error => ({error}));await settle(); },
          async finalized(_picks, before) {
            const {clip, error} = await finalizing;finalizing = undefined;consumed = true;
            if (clip) { assert.equal(clip.blob.size, before.s.bytes, 'the saved video holds exactly the admitted chunks');rows++; }
            else { record(error);failures = Math.min(2, failures + 1); }
          },
          leave() {}, returnToCamera() {},
          async stopPreview() { capture.cancel();consumed = true;await settle(); },
        },
        observe() {
          const session = capture.current, fresh = session && !consumed;
          return {session: !fresh ? 'idle' : outcome ?? (session.prefixRead ? 'reading-prefix' : session.ended === undefined ? 'recording' : 'stopping'),
            bytes: fresh ? capture.state().fileSize : 0, cause, rows, failures};
        },
        close() {
          capture.cancel();
          for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
        },
      };
    },
  });
}
