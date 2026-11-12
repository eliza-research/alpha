import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mountedCalendarFixtureSources, startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';
import {openMountedCameraReview} from './fixtures/camera-calendar-review.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const model = 'CameraSession';
const driver = fileURLToPath(import.meta.url);
const call = name => ({name, args: []});
const inputs = ['specs/quint/legacy/CameraSession.qnt', 'test/fixtures/camera-calendar-review.mjs',
  'apps/app/src/prototype/camera-adapter.ts', 'apps/app/src/prototype/browser-camera.ts',
  'apps/app/src/prototype/model.js', 'apps/app/src/prototype/template.html', 'apps/app/src/prototype/scan-review.ts',
  'apps/app/src/prototype/scan-event-review.ts', 'scripts/local-ocr-assets.ts',
  '.eliza/client-features/plugins/plugin-native-camera/src/session.ts'];

function installMediaPort() {
  const state = window.quintCameraPort = {pending: [], streams: [], requests: []};
  navigator.mediaDevices.getUserMedia = constraints => {
    if (constraints.audio !== false || !constraints.video?.facingMode) throw Error('The closed Camera fixture accepts synthetic preview only');
    state.requests.push(constraints.video.facingMode);
    return new Promise(resolve => state.pending.push(resolve));
  };
  state.release = () => {
    const send = state.pending.shift();
    if (!send) throw Error('No synthetic preview is pending');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const paint = () => {
      ctx.fillStyle = frame++ % 2 ? '#4675a8' : '#67a873';
      ctx.fillRect(0, 0, 320, 240);
    };
    paint();
    const stream = canvas.captureStream(10);
    state.streams.push(stream);
    const timer = setInterval(() => {
      if (stream.getVideoTracks().every(track => track.readyState === 'ended')) clearInterval(timer);
      else paint();
    }, 80);
    send(stream);
  };
}

async function checkHistoricalCameraSession(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  const driverHashes = captureInputs([...sources]);
  const browser = await startMountedCalendar({observeCamera: true, onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    driverHashes[path] ??= createHash('sha256').update(readFileSync(path)).digest('hex');
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page();
      await f.page.evaluate(installMediaPort);
      async function observe() {
        const actual = await f.page.evaluate(() => {
          const camera = window.quintMountedCamera();
          const view = window.quintMountedCalendar.S().view === 'camera' ? 'camera' : 'away';
          const preview = document.querySelector('[data-alpha-camera="viewfinder"] video');
          return {...camera, view, preview: !!preview && preview.readyState >= 2};
        });
        assert.ok(actual.zoom === 1 || actual.zoom === 2);
        if (actual.phase === 'ready') assert.equal(actual.preview, true, 'Ready Camera displays the actual synthetic stream');
        return {'s.view': actual.view, 's.phase': actual.phase, 's.capture': actual.capture, 's.lens': actual.lens,
          's.flash': actual.flash, 's.zoom': actual.zoom === 1 ? 'one' : 'half',
          's.chat': actual.view === 'camera' && actual.chat ? 'open' : 'closed',
          Ready: actual.view === 'camera' && actual.phase === 'ready' && actual.preview};
      }
      const t = {name, init: call('init'), expect: await observe(), steps: []};
      const mark = async (label, action) => t.steps.push({label, action, expect: await observe()});
      const pending = () => f.page.waitForFunction(() => window.quintCameraPort.pending.length === 1);
      const release = () => f.page.evaluate(() => window.quintCameraPort.release());
      const ready = () => f.page.waitForFunction(() => {
        const preview = document.querySelector('[data-alpha-camera="viewfinder"] video');
        return window.quintMountedCamera().phase === 'ready' && preview?.srcObject === window.quintCameraPort.streams.at(-1) &&
          preview.readyState >= 2;
      });
      const off = () => f.page.waitForFunction(() => window.quintMountedCamera().phase === 'off');
      const ended = () => f.page.waitForFunction(() => window.quintCameraPort.streams.every(stream =>
        stream.getVideoTracks().every(track => track.readyState === 'ended')));
      const open = async () => {
        await f.button('Camera').click();await pending();
        await mark('Open Camera while the closed media port is held', call('Open'));
      };
      const firstFrame = async (grant = true) => {
        await release();await ready();
        await mark('The accepted synthetic stream publishes the first visible frame',
          grant ? [call('Grant'), call('FirstFrame')] : call('FirstFrame'));
      };
      const leave = async () => {
        await f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
        await off();await ended();
        await f.page.waitForFunction(() => window.quintMountedCalendar.S().view !== 'camera');
        await mark('Leave the current Camera view and release its stream', call('Leave'));
      };
      try {
        await run({f, mark, pending, release, ready, off, ended, open, firstFrame, leave});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('current Camera controls match the historical ready and lens reset path', async c => {
      await c.open();await c.firstFrame();
      await c.f.button('Zoom 2x').click();
      await c.f.page.waitForFunction(() => window.quintMountedCamera().zoom === 2);
      await c.mark('Choose the observed non-default back zoom', call('SetZoom'));
      await c.f.button('Switch camera').click();await c.pending();await c.release();await c.ready();
      assert.deepEqual(await c.f.page.evaluate(() => window.quintCameraPort.requests), ['environment', 'user']);
      assert.equal(await c.f.button('Zoom 2x').isVisible(), false);
      await c.mark('Switch to the front lens and reset its zoom', call('Flip'));
      await c.leave();
    });
    await schedule('a late preview after Leave stops before fresh Camera reentry', async c => {
      await c.open();await c.leave();
      const retiredRequests = await c.f.page.evaluate(() => {
        const port = window.quintCameraPort;
        const count = port.pending.length;
        while (port.pending.length) port.release();
        return count;
      });
      assert.ok(retiredRequests >= 1, 'The held preview request remains independently deliverable');
      await c.ended();
      assert.equal(await c.f.page.locator('[data-alpha-camera="viewfinder"] video').count(), 0);
      await c.mark('Retired stream receipts release without reopening Camera', null);
      await c.open();await c.firstFrame();await c.leave();
    });
    await schedule('real scan review opens and closes without a historical capture transition', async c => {
      await c.open();await c.firstFrame();
      const review = await openMountedCameraReview(c.f);
      assert.ok(await review.isVisible());
      await c.mark('Open the real scanned event review over the ready Camera', null);
      await review.getByRole('button', {name: 'Close scan', exact: true}).click();
      await review.waitFor({state: 'detached'});
      await c.mark('Close scan review without a saved photo', null);
      await c.leave();
    });
    await schedule('conversation covers Camera through grace and a fresh first frame', async c => {
      await c.open();await c.firstFrame();
      await c.f.button('Open conversation').click();
      await c.f.page.waitForFunction(() => window.quintMountedCamera().chat);
      await c.mark('The actual conversation cover leaves preview alive during grace', call('ChatOpen'));
      await c.off();await c.ended();
      await c.mark('The actual grace expiry releases the covered preview', call('ChatGraceEnds'));
      await c.f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
      await c.pending();
      await c.mark('Back closes the conversation and starts a new preview', call('ChatClose'));
      await c.firstFrame(false);await c.leave();
    });
  } finally {await browser.close();}
  const receipt = await checkTraces({id: 'historical-camera-session', model, scope: 'bounded-orchestration',
    sources: [...sources], driverHashes, traces,
    assumptions: ['Unchanged historical Design profile. Chromium mounts the actual Camera renderer and shared session over synthetic canvas media streams.',
      'A granted synthetic stream and its visible preview are grouped into the historical Grant and FirstFrame steps. Only the selected back zoom and lens reset are projected.',
      'Scan review uses the real dialog and local OCR with a generated image. Its open and close are stutters for the historical Camera state.',
      'Raw preview request interleavings are separate from committed camera state. The fixture can deliver multiple already-retired synthetic requests before fresh reentry.',
      'Photo and video save, permission denial and OS resume, focus and flash hardware, agent queue settlement and historical ablations remain separate.']});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Compare historical capture settlement and native resume',
      reason: 'The selected browser controls and scan-review stutters do not establish Android media save, recording finalization, focus, flash, or permission and native resume behavior.'},
    {model, obligation: 'Map historical agent and as-built Camera configurations',
      reason: 'Only the unchanged Design navigation, synthetic preview and control projection is replayed. Raw permission request ordering, historical agent queue, fairness and ablation comparisons remain separate.'},
  ]};
}

test('current mounted Camera matches selected original Design session transitions', {timeout: 240_000}, async () => {
  const {receipts: [receipt], obligations} = await checkHistoricalCameraSession([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 4);
  assert.equal(receipt.checkpoints, 27);
  assert.equal(obligations.length, 2);
});
