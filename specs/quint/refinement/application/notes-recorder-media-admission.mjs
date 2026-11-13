import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources, startMountedCalendar} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {mountNotesRecorderMedia, noteMediaRecord} from '../../../../test/fixtures/notes-recorder-media.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'NotesRecorderMediaAdmission';
const inputs = ['test/fixtures/notes-recorder-media.mjs', 'apps/app/src/prototype/voice-adapter.ts',
  'apps/app/src/prototype/note-recorder.ts', 'apps/app/src/runtime/voice-states.ts', 'apps/app/src/prototype/notes-recorder-control.ts',
  'apps/app/src/prototype/canonical-notes-ui.ts', 'apps/app/src/prototype/template.html',
  'apps/app/src/browser/voice.ts', 'apps/app/src/browser/audio-capture.ts', 'apps/app/src/browser/note-audio-store.ts',
  'apps/app/src/browser/note-recording-journal.ts'];

function project(state) {
  assert.equal(state.forbidden, 0, 'The physical media port must stay closed');
  assert.ok(['owner-a', 'owner-b'].includes(state.owner));
  assert.ok(['home', 'notes'].includes(state.view));
  return {'s.view': state.view, 's.owner': state.owner === 'owner-a' ? 'A' : 'B', 's.playback': state.playback,
    's.recorder': state.recorder, 's.attempts': state.attempts, 's.active': state.active, 's.drains': state.lastDrain,
    's.control': state.control, 's.controlAttempt': state.controlAttempt, 's.captures': state.captures,
    's.lastCapture': state.lastCapture, 's.unconfirmedCapture': state.unconfirmedCapture};
}

export async function checkNotesRecorderMediaAdmission(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    captureSources([path]);
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page({notes: [noteMediaRecord]});
      try {
        const media = await mountNotesRecorderMedia(f);
        const t = trace(name, project(await media.snapshot()));
        const mark = async (label, action) => checkpoint(t, label, action, project(await media.snapshot()));
        await media.openNotes();
        await media.wait('view', 'notes');
        await mark('Open mounted canonical Notes', call('openNotes'));
        await media.play();
        await mark('Real saved audio selection plays through the synthetic speaker', call('playSaved'));
        const retirePlayback = async () => {
          await media.closeRecording();
          await mark('Return to the Notes list and hold the saved audio stop', call('requestStop'));
        };
        const start = async (entry, id = 1, stopsPlaying = false) => {
          await media.start(entry);
          await media.waitForAttempt(id);
          await media.wait('recorder', 'starting');
          if (stopsPlaying) await media.wait('playback', 'stopping');
          const state = await media.snapshot();
          assert.equal(state.captures, 0, 'Capture must wait while the saved audio stop is held');
          const actions = [call('start', entry), call('awaitDrain', id)];
          if (stopsPlaying) actions.push(call('requestStop'));
          await mark('Exact recorder attempt waits on the outstanding media drain', actions);
        };
        const capture = async (id, control) => {
          await media.release();
          await media.wait('recorder', 'recording');
          if (control) await media.wait('control', control);
          const state = await media.snapshot();
          assert.equal(state.captures, 1);
          assert.equal(state.lastCapture, id);
          assert.ok(state.events.indexOf('stop-confirmed') < state.events.indexOf('capture-start'));
          const actions = [call('confirmStop')];
          if (control === 'failed') actions.push(call('settleRetiredControl'));
          actions.push(call('capture', id));
          await mark('Only the current attempt opens the synthetic microphone after the stop confirms', actions);
        };
        await run({media, mark, retirePlayback, start, capture});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('mounted Record button waits for the saved recording to stop', async c => {
      await c.retirePlayback();await c.start('button');await c.capture(1);
    });
    await schedule('agent-facing control retires audio that is still playing and waits', async c => {
      await c.start('control', 1, true);await c.capture(1, 'started');
    });
    await schedule('stop refusal closes microphone admission for a current attempt', async c => {
      await c.retirePlayback();await c.start('control');await c.media.release(true);
      await c.media.wait('recorder', 'failed');await c.media.wait('control', 'failed');
      assert.equal((await c.media.snapshot()).message, 'Speech could not be stopped. Restart Alpha.');
      await c.mark('Unconfirmed audio shutdown refuses capture and reports the current failure',
        [call('refuseStop'), call('refuseCapture', 1)]);
    });
    await schedule('leaving and reentering retires the old control before a fresh button start', async c => {
      await c.retirePlayback();await c.start('control');
      await c.media.leaveNotes();await c.media.wait('view', 'home');
      await c.mark('Home retires the previous Notes attempt', call('leaveNotes'));
      await c.media.openNotes();await c.media.wait('view', 'notes');
      await c.mark('A fresh Notes visit keeps the old attempt retired', call('openNotes'));
      await c.start('button', 2);await c.capture(2, 'failed');
    });
    await schedule('replacing the canonical owner retires an attempt before its stop completes', async c => {
      await c.retirePlayback();await c.start('control');
      await c.media.switchOwner();await c.media.wait('recorder', 'failed');
      await c.mark('Current Notes controller switches to owner B and retires A’s attempt', call('replaceOwner'));
      await c.media.release();await c.media.wait('control', 'failed');
      await c.mark('A’s late stop settles its own control without opening the microphone',
        [call('confirmStop'), call('settleRetiredControl')]);
      await c.mark('A retired capture is disabled after the old media stop is confirmed', {...call('capture', 1), reject: true});
    });
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['Mounted Alpha canonical Notes runs unchanged in Chromium. Its record transport and playback/capture ports are closed to foreign network and physical media.',
      'The driver observes the actual begin epoch and preflight invocation without changing their decisions. Synthetic audio is retained in the actual browser recording store. An event records which exact attempt reaches the synthetic microphone port.',
      'A saved audio session, at most two fresh attempts, two canonical owners and one agent-facing start result per schedule. The replay ends before saving or adopting a recording.',
      'The mounted recorder result and browser port confirmation are checked. Installed Android media, native recording recovery, provider speech and concurrent user actions outside the selected schedules are separate.']}));
}
