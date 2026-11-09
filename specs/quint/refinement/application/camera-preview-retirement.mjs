import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources, startMountedCalendar} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {mountCameraPreviewPort} from '../../../../test/fixtures/camera-preview-port.mjs';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'CameraPreviewRetirement';
const inputs = ['test/fixtures/camera-preview-port.mjs', 'apps/app/src/prototype/camera-adapter.ts',
  'apps/app/src/prototype/browser-camera.ts', 'apps/app/src/prototype/model.js', 'apps/app/src/prototype/template.html',
  '.eliza/client-features/plugins/plugin-native-camera/src/session.ts'];

function project(state) {
  assert.ok(['home', 'camera'].includes(state.view));
  assert.equal(typeof state.released, 'boolean');
  assert.ok(state.requests.every(request => request.view === 'camera' && request.phase === 'starting'));
  return {'s.view': state.view, 's.phase': state.phase, 's.released': state.released, 's.current': state.current,
    's.preview': state.preview, 's.lastRequest': state.requests.length,
    's.requests': qmap(state.requests.map(({id, status}) => [id, status]))};
}

export async function checkCameraPreviewRetirement(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({observeCamera: true, onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    captureSources([path]);
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page();
      try {
        const port = await mountCameraPreviewPort(f);
        const t = trace(name, project(await port.snapshot()));
        const mark = async (label, action) => checkpoint(t, label, action, project(await port.snapshot()));
        const open = async id => {
          await port.open(id);
          await mark('Intentional Camera open requests one preview under its new token', call('open'));
        };
        const firstFrame = async id => {
          await port.release(id);await port.ready(id);
          await mark('Current synthetic stream becomes the visible preview', call('firstFrame', id));
        };
        const leave = async () => {
          await port.leave();
          const {retired, microtask} = await port.retirement();
          assert.equal(retired.view, 'camera', 'The real onLeave returns before the next view commits');
          assert.equal(retired.released, true);
          assert.equal(retired.phase, 'off');
          checkpoint(t, 'Camera onLeave returns before the Home commit', call('beginLeave'), project(retired));
          let releaseObserved = false;
          if (microtask.view === 'camera') {
            assert.equal(microtask.requests.length, retired.requests.length, 'Pre-commit sync cannot restart preview');
            releaseObserved = microtask.preview === 0;
            checkpoint(t, 'Pending Camera sync sees the release latch before Home',
              releaseObserved ? call('releasePreview') : null, project(microtask));
          }
          await f.page.waitForFunction(() => {
            const s = window.quintCameraLeave.snapshot();
            return s.view === 'home' && !s.released && !s.preview;
          });
          await mark('Committed Home clears the latch after preview retirement',
            releaseObserved ? call('commitHome') : [call('releasePreview'), call('commitHome')]);
        };
        const late = async id => {
          await port.release(id);await port.ended([id]);
          await mark('A retired stream ends without taking over the visible preview', call('lateStream', id));
        };
        await run({open, firstFrame, leave, late});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('leave while a preview is pending, deliver it late, then reopen', async c => {
      await c.open(1);await c.leave();await c.late(1);await c.open(2);await c.firstFrame(2);await c.leave();
    });
    await schedule('leave while a ready track is visible, then reopen', async c => {
      await c.open(1);await c.firstFrame(1);await c.leave();await c.open(2);await c.firstFrame(2);await c.leave();
    });
    await schedule('a retired stream can resolve after a newer preview is already visible', async c => {
      await c.open(1);await c.leave();await c.open(2);await c.firstFrame(2);await c.late(1);await c.leave();
    });
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['The actual mounted Camera and shell run in Chromium with synthetic canvas MediaStreams. The source uses real camera session and browser preview ownership.',
      'Two explicit Camera visits over a controlled pending media port. App commit, camera request token, released latch, video source and ended tracks are observed directly.',
      'The projection covers Home and active Camera with a closed conversation. Native OS permission behavior, capture writes and camera hardware remain separate.']}));
}
