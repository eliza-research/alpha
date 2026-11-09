import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';
import {mountCameraPreviewPort} from './fixtures/camera-preview-port.mjs';

test('mounted Camera Leave retires preview before Home commits', {timeout: 240_000}, async t => {
  const browser = await startMountedCalendar({observeCamera: true});
  try {
    for (const phase of ['starting', 'ready']) {
      await t.test('leave while ' + phase + ' and reenter deliberately', async () => {
        const f = await browser.page();
        try {
          const port = await mountCameraPreviewPort(f);
          await port.open(1);
          if (phase === 'ready') {await port.release(1);await port.ready(1);}
          await port.leave();
          const afterLeave = await port.snapshot();
          await port.releaseAll();
          await port.ended(afterLeave.requests.map(request => request.id));
          assert.equal(await f.page.locator('[data-alpha-camera="viewfinder"] video').count(), 0);
          assert.deepEqual(afterLeave.requests.map(({view, phase}) => ({view, phase})), [{view: 'camera', phase: 'starting'}],
            'Retirement must not start a new preview against the previously committed Camera view');

          await port.open(2);await port.release(2);await port.ready(2);
          assert.deepEqual((await port.snapshot()).requests.map(({view, phase}) => ({view, phase})), [
            {view: 'camera', phase: 'starting'}, {view: 'camera', phase: 'starting'},
          ]);
          await port.leave();
          await port.ended([1, 2]);
        } finally {await f.close();}
      });
    }
  } finally {await browser.close();}
});
