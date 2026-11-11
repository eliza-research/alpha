// VideoEditReview against openVideoEditReview in apps/app/src/prototype/video-edit-review.ts,
// mounted in a DOM. Ports: the media element's play, pause and load, animation frames and the
// save callback. The four-tenths model source is a 0.4 second video; no decoder runs.
import {JSDOM} from 'jsdom';
import {loadProductModule, modelTraces, replayTraces, settle} from '../application/notes-files-media-itf.mjs';

const source = 'apps/app/src/prototype/video-edit-review.ts';
const globals = ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame'];
const tenths = value => Math.round(value * 10);

export async function replayVideoEditReview({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/native/VideoEditReview.qnt', main: 'VideoEditReview', ...options});
  const product = await loadProductModule(source, {rewrite, stubs: {
    './media-review-controls': 'export const mediaToolIcon=()=>{};',
    './video-transcode': 'export const transcodeVideo=async()=>undefined;',
    './video-codecs': 'export const videoRecorders=()=>[];',
  }});
  let framesLeftRunning = 0;
  const receipt = await replayTraces(traces, {
    required: ['sourceLoaded', 'sourceError', 'trim', 'rotate', 'toggleCrop', 'play', 'pause', 'commit', 'saveSettled', 'close', 'hide', 'show'],
    reached: {
      'a result dropped after the editor closed': state => state.s.outcome === 'dropped',
      'a saved copy': state => state.s.outcome === 'saved',
      'an unconfirmed save': state => state.s.outcome === 'unconfirmed',
      'a source error during playback': state => !state.s.loaded && !state.s.closed && state.s.edit.rotation + state.s.edit.start > 0,
      'the tightest trim': state => state.s.edit.end - state.s.edit.start === 1,
    },
    // `loaded` is not exposed; the controls show whether the editor accepts an edit.
    project: ({s}) => ({editable: s.loaded && !s.busy && !s.closed, busy: s.busy, closed: s.closed, hidden: s.hidden,
      playing: s.playing, edit: s.edit, submitted: s.submitted, saves: s.saves, outcome: s.outcome, aborted: s.aborted}),
    async start() {
      const dom = new JSDOM('<!doctype html><div class="os"></div>', {url: 'https://alpha.example/'}), {window} = dom;
      const saved = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
      let hidden = false, frame = 0;
      const frames = new Set();
      Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => hidden});
      const media = window.HTMLMediaElement.prototype;
      Object.defineProperty(media, 'paused', {configurable: true, get() { return this.alphaPlaying !== true; }});
      Object.defineProperty(media, 'currentTime', {configurable: true, get() { return this.alphaTime ?? 0; }, set(value) { this.alphaTime = value; }});
      media.play = function () { if (this.alphaPlaying !== true) { this.alphaPlaying = true;this.dispatchEvent(new window.Event('play')); } return Promise.resolve(); };
      media.pause = function () { if (this.alphaPlaying === true) { this.alphaPlaying = false;this.dispatchEvent(new window.Event('pause')); } };
      media.load = () => {};
      for (const type of [window.HTMLElement.prototype]) {
        type.showModal ??= function () { this.setAttribute('open', ''); };
        type.setPointerCapture = () => {};type.releasePointerCapture = () => {};
      }
      const values = {window, document: window.document, HTMLElement: window.HTMLElement,
        requestAnimationFrame: () => { frames.add(++frame);return frame; }, cancelAnimationFrame: id => { frames.delete(id); }};
      for (const name of globals) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: values[name]});
      const saves = [];
      let closes = 0, outcome = 'none';
      product.openVideoEditReview({path: 'https://alpha.example/video', duration: .4, stream: true},
        (edit, signal) => new Promise((resolve, reject) => { saves.push({edit, signal, resolve, reject}); }), () => { closes++; });
      const dialog = window.document.querySelector('dialog'), video = dialog.querySelector('video');
      const named = label => [...dialog.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
      const track = dialog.querySelector('.video-editor-track');
      track.getBoundingClientRect = () => ({left: 0, width: 100});
      const pointer = (target, type, clientX) => {
        const event = new window.MouseEvent(type, {bubbles: true, cancelable: true, button: 0, clientX});
        Object.defineProperty(event, 'pointerId', {value: 1});
        // The handles assign pointer handlers as properties; a DOM without pointer event
        // handler attributes still has to reach them.
        if (typeof target[`on${type}`] === 'function' && !('onpointerdown' in window.HTMLElement.prototype)) target[`on${type}`](event);
        else target.dispatchEvent(event);
      };
      const buttons = {rotate: 'Rotate video', toggleCrop: 'Crop video', play: 'Preview trim', pause: 'Pause preview', commit: 'Save video copy', close: 'Close video editor'};
      const click = name => async () => {
        const button = name === 'rotate' || name === 'toggleCrop' ? [...dialog.querySelectorAll('.video-editor-tools button')][name === 'rotate' ? 0 : 1] : named(buttons[name]);
        button.click();await settle();
      };
      const status = () => dialog.querySelector('[role="status"]').textContent;
      const editOf = edit => ({start: tenths(edit.start), end: tenths(edit.end), rotation: edit.rotation, crop: edit.crop});
      // The editor's working edit is read back from what it shows: handle positions, the pressed
      // crop control and, for rotation, the count of accepted rotate presses.
      let rotation = 0;
      return {
        actions: {
          async sourceLoaded() { video.dispatchEvent(new window.Event('loadeddata'));await settle(); },
          async sourceError() { video.dispatchEvent(new window.Event('error'));await settle(); },
          async trim({key, value}) {
            const handle = named(key === 'start' ? 'Start seconds' : 'End seconds');
            pointer(handle, 'pointerdown', 0);pointer(handle, 'pointerup', value * 25);await settle();
          },
          async rotate() { const before = named('Save video copy').disabled;await click('rotate')();if (!before) rotation = (rotation + 90) % 360; },
          toggleCrop: click('toggleCrop'), play: click('play'), pause: click('pause'), commit: click('commit'), close: click('close'),
          async saveSettled({result}) {
            const save = saves[0], open = dialog.isConnected;
            if (result === 'rejected') save.reject(Error('unknown outcome'));else save.resolve(result === 'saved');
            await settle();
            // What the editor reported for this save, read when it settles: a later media event
            // may replace the status line.
            outcome = !open ? 'dropped' : status() === 'Not saved' ? 'not-saved'
              : status() === 'Save unconfirmed' ? 'unconfirmed' : !dialog.isConnected ? 'saved' : 'unreported';
          },
          async hide() { hidden = true;window.document.dispatchEvent(new window.Event('visibilitychange'));await settle(); },
          async show() { hidden = false;window.document.dispatchEvent(new window.Event('visibilitychange'));await settle(); },
        },
        observe() {
          const closed = !dialog.isConnected, handle = name => Number(named(name).getAttribute('aria-valuenow'));
          const edit = {start: tenths(handle('Start seconds')), end: tenths(handle('End seconds')), rotation,
            crop: dialog.querySelector('.video-editor-tools button[aria-pressed]').getAttribute('aria-pressed') === 'true'};
          if (closed) framesLeftRunning += frames.size;
          return {editable: !closed && !named('Save video copy').disabled, busy: saves.length > 0, closed, hidden,
            playing: !video.paused, edit, submitted: saves[0] ? editOf(saves[0].edit) : {start: 0, end: 4, rotation: 0, crop: false},
            saves: saves.length, outcome, aborted: saves[0] ? saves[0].signal.aborted : closes > 0};
        },
        close() {
          for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
          window.close();
        },
      };
    },
  });
  return {...receipt, framesLeftRunning};
}
