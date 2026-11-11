// CameraFocusWrites against BrowserCameraFocus in apps/app/src/browser/camera-focus.ts.
// Ports: a DOM, navigator.mediaDevices and a camera track whose applyConstraints is answered by
// the driver. Each tap uses its own x coordinate, so a driver write names the tap it came from.
import {JSDOM} from 'jsdom';
import {loadProductModule, modelTraces, replayTraces, settle} from './notes-files-media-itf.mjs';

const source = 'apps/app/src/browser/camera-focus.ts';

export async function replayCameraFocusWrites({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/application/CameraFocusWrites.qnt', main: 'CameraFocusWrites', ...options});
  const {BrowserCameraFocus} = await loadProductModule(source, {rewrite});
  return replayTraces(traces, {
    required: ['tapFocus', 'clear', 'trackEnds', 'driverReplies'],
    project: state => state.s,
    reached: {
      'a retired tap skipped without a driver write': state => state.s.skipped.length > 0,
      'an applied target': state => state.s.confirmed !== 0,
      'a late reply for a retired tap': state => state.s.hardware !== 0 && state.s.hardware !== state.s.epoch,
      'a refused or unconfirmed write': state => state.s.written.length > 0 && state.s.hardware === 0 && state.s.writing === 0,
    },
    async start() {
      const dom = new JSDOM('<!doctype html><div id="frame"></div><video></video>');
      const saved = {document: Object.getOwnPropertyDescriptor(globalThis, 'document'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')};
      Object.defineProperty(globalThis, 'document', {configurable: true, value: dom.window.document});
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: {getSupportedConstraints: () => ({pointsOfInterest: true})}}});
      const frame = dom.window.document.getElementById('frame');
      frame.getBoundingClientRect = () => ({width: 100, height: 100});
      const video = {videoWidth: 100, videoHeight: 100};
      // The frame and the video have the same size, so the driver point equals the tapped point.
      const tapOf = point => Math.round(point.x * 10);
      let settings = {}, inFlight, hardware = 0;
      const written = new Set();
      const track = {readyState: 'live', getCapabilities: () => ({focusMode: ['single-shot']}), getSettings: () => settings,
        applyConstraints(constraints) {
          if (inFlight) throw Error('two driver writes at once');
          const request = constraints.advanced[0], tap = tapOf(request.pointsOfInterest[0]);
          written.add(tap);
          return new Promise((resolve, reject) => { inFlight = {tap, request, resolve, reject}; });
        }};
      const focus = new BrowserCameraFocus();
      const reticles = new WeakMap(), pending = new Map(), finished = new Set();
      return {
        actions: {
          async tapFocus(_picks, before) {
            const tap = before.s.epoch + 1;
            const selected = focus.select({x: tap / 10, y: .5}, {frame, video, track, zoom: 1, mirror: false, development: false});
            pending.set(tap, selected);
            void selected.then(() => { pending.delete(tap);finished.add(tap); });
            reticles.set(focus.reticle, tap);
            await settle();
          },
          async clear() { focus.clear();await settle(); },
          async trackEnds() { track.readyState = 'ended';await settle(); },
          async driverReplies({applied}) {
            const {tap, request, resolve, reject} = inFlight;inFlight = undefined;
            if (applied) { settings = {focusMode: request.focusMode, pointsOfInterest: request.pointsOfInterest};hardware = tap;resolve(); }
            else reject(Error('The lens refused the constraint.'));
            await settle();
          },
        },
        observe() {
          const reticle = focus.reticle, tap = reticle ? reticles.get(reticle) : 0;
          return {epoch: focus.epoch, trackLive: track.readyState === 'live', reticle: tap,
            queue: [...pending.keys()].sort((a, b) => a - b), writing: inFlight?.tap ?? 0, hardware,
            confirmed: reticle?.dataset.alphaCameraFocus === 'camera' ? tap : 0,
            skipped: [...finished].filter(done => !written.has(done)).sort(), written: [...written].sort()};
        },
        close() {
          for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
          dom.window.close();
        },
      };
    },
  });
}
