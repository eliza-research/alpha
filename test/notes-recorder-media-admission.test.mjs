import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';
import {mountNotesRecorderMedia, noteMediaRecord} from './fixtures/notes-recorder-media.mjs';

test('Notes recorder entry points wait for saved audio to stop', {timeout: 240_000}, async () => {
  const browser = await startMountedCalendar();
  try {
    const before = {};
    for (const entry of ['button', 'control']) {
      const f = await browser.page({notes: [noteMediaRecord]});
      try {
        const media = await mountNotesRecorderMedia(f);
        await media.play();
        await media.closeRecording();
        await media.start(entry);
        await media.wait('recorder', 'recording');
        before[entry] = await media.snapshot();
        await media.release();
        await media.wait('playback', 'stopped');
      } finally {await f.close();}
    }
    for (const state of Object.values(before)) assert.equal(state.forbidden, 0);
    assert.deepEqual(Object.values(before).map(state => state.captures), [0, 0],
      `Before stop confirmation: ${JSON.stringify(before)}`);
  } finally {await browser.close();}
});
