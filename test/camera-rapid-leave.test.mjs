import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

function installPreviewPort() {
  const shell = window.quintMountedCalendar;
  const port = window.quintCameraLeave = {requests: [], pending: [], streams: []};
  navigator.mediaDevices.getUserMedia = constraints => {
    if (constraints.audio !== false) throw Error('The closed fixture forbids microphone requests');
    port.requests.push({view: shell.S().view, phase: window.quintMountedCamera().phase});
    return new Promise(resolve => port.pending.push(resolve));
  };
  port.release = () => {
    while (port.pending.length) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      let frame = 0;
      const paint = () => {
        context.fillStyle = frame++ % 2 ? '#4675a8' : '#67a873';
        context.fillRect(0, 0, 320, 240);
      };
      paint();
      const stream = canvas.captureStream(10);
      port.streams.push(stream);
      const timer = setInterval(() => {
        if (stream.getVideoTracks().every(track => track.readyState === 'ended')) clearInterval(timer);
        else paint();
      }, 80);
      port.pending.shift()(stream);
    }
  };
}

test('mounted Camera Leave retires preview before Home commits', {timeout: 240_000}, async t => {
  const browser = await startMountedCalendar({observeCamera: true});
  try {
    for (const phase of ['starting', 'ready']) {
      await t.test('leave while ' + phase + ' and reenter deliberately', async () => {
        const f = await browser.page();
        try {
          await f.page.evaluate(installPreviewPort);
          const pending = () => f.page.waitForFunction(() => window.quintCameraLeave.pending.length === 1);
          const ready = () => f.page.waitForFunction(() => {
            const video = document.querySelector('[data-alpha-camera="viewfinder"] video');
            return window.quintMountedCamera().phase === 'ready' && video?.srcObject === window.quintCameraLeave.streams.at(-1) &&
              video.readyState >= 2;
          });
          const release = () => f.page.evaluate(() => window.quintCameraLeave.release());
          const ended = () => f.page.waitForFunction(() => window.quintCameraLeave.streams.every(stream =>
            stream.getVideoTracks().every(track => track.readyState === 'ended')));
          const home = async () => {
            await f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
            await f.page.waitForFunction(() => window.quintMountedCalendar.S().view !== 'camera' &&
              window.quintMountedCamera().phase === 'off');
          };
          await f.button('Camera').click();
          await pending();
          if (phase === 'ready') {await release();await ready();}
          await home();
          const afterLeave = await f.page.evaluate(() => window.quintCameraLeave.requests);
          await release();await ended();
          assert.equal(await f.page.locator('[data-alpha-camera="viewfinder"] video').count(), 0);
          assert.deepEqual(afterLeave, [{view: 'camera', phase: 'starting'}],
            'Retirement must not start a new preview against the previously committed Camera view');

          await f.button('Camera').click();
          await pending();await release();await ready();
          assert.deepEqual(await f.page.evaluate(() => window.quintCameraLeave.requests), [
            {view: 'camera', phase: 'starting'}, {view: 'camera', phase: 'starting'},
          ]);
          await home();await release();await ended();
        } finally {await f.close();}
      });
    }
  } finally {await browser.close();}
});
