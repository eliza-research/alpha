import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {earlierTitle, fixtureNote, goHome, noteRefusal, noteTitle, openCameraReview, openNote, retainCalendarDraft, reviewCalendarDraftDiscard, reviewNote,
  scanRefusal, scanTitle, startMountedCalendar, submitCameraReview, titleInput} from '../../../../test/fixtures/calendar-draft-handoff.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'CanonicalCalendarDraftHandoff';
const inputs = ['test/fixtures/calendar-draft-handoff.mjs', 'test/fixtures/camera-calendar-review.mjs', 'apps/app/src/prototype/canonical-calendar-drafts.ts',
  'apps/app/src/prototype/canonical-notes-ui.ts', 'apps/app/src/prototype/camera-adapter.ts',
  'apps/app/src/prototype/scan-review.ts', 'apps/app/src/prototype/scan-event-review.ts', 'apps/app/src/runtime/agent-calendar.ts',
  'apps/app/src/runtime/assistant-draft-store.ts', 'apps/app/src/browser/documents.ts', 'scripts/local-ocr-assets.ts'];
const titles = new Map([['', ''], [earlierTitle, 'earlier'], [noteTitle, 'note'], [scanTitle, 'scan']]);
// The fixture records toast events; accepted Note event and reminder drafts emit Check time.
const noteNotices = new Map([[noteRefusal, 'note-refused'], ['Check time', 'review-time']]);

export async function checkCanonicalCalendarDraftHandoff(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    captureSources([path]);
  }});
  const traces = [];
  try {
    async function schedule(name, run, {ready = true} = {}) {
      const f = await browser.page({legacyTitle: ready ? '' : 'Unapproved legacy fixture', notes: [fixtureNote]});
      const scan = f.page.getByRole('dialog', {name: 'Review scanned text', exact: true});
      const status = scan.getByRole('status', {name: 'Event draft status', exact: true});
      const draftTitle = value => {
        assert.ok(titles.has(value), 'Unexpected exact handoff form title');
        return titles.get(value);
      };
      async function observe() {
        const s = await f.snapshot();
        const scanOpen = await scan.isVisible();
        const scanNotice = scanOpen ? await status.textContent() : '';
        assert.ok(scanNotice === '' || scanNotice === scanRefusal, 'Unexpected scan review outcome');
        const noteNotice = s.notices.filter(notice => noteNotices.has(notice)).at(-1);
        return {'s.owner': s.owner === 'owner-a' ? 1 : 2, 's.view': s.view, 's.ready': s.status === 'ready',
          's.editor': s.reminderTitle ? 'reminder' : draftTitle(s.form?.title ?? ''),
          's.retained': draftTitle(s.retainedForm?.title ?? ''), 's.busy': s.draft.opening ? 'open' : s.draft.consuming ? 'consume' : '',
          's.scanOpen': scanOpen, 's.scanNotice': scanNotice ? 'scan-refused' : '', 's.noteNotice': noteNotice ? noteNotices.get(noteNotice) : ''};
      }
      const t = trace(name, await observe(), ready ? call('init') : call('initWith', false));
      const mark = async (label, action) => checkpoint(t, label, action, await observe());
      const retain = async () => {
        const old = await retainCalendarDraft(f);
        await mark('Close and persist the earlier Calendar form', call('retainEarlier'));
        return old;
      };
      const home = async () => {await goHome(f);await mark('Return to Home', call('home'));};
      const calendar = async () => {
        await f.button('Calendar').click();await f.button('New event').waitFor();
        await mark('Open Calendar’s retained draft controls', call('openCalendar'));
      };
      const note = async () => {await openNote(f);await mark('Open the exact canonical Note', call('openNote'));};
      const requestNote = async accepted => {
        await reviewNote(f);
        if (accepted) {
          await titleInput(f).waitFor();
          assert.equal(await titleInput(f).inputValue(), noteTitle);
        } else {
          await f.page.waitForFunction(refusal => window.quintCalendar.snapshot().notices.includes(refusal), noteRefusal);
          assert.equal(await f.page.getByRole('textbox', {name: 'Note', exact: true}).inputValue(), fixtureNote.body);
        }
        await mark('Activate the Note’s real Review event action', call('requestNote'));
      };
      const openScan = async () => {await openCameraReview(f);await mark('Open actual scan event review', call('openScan'));};
      const requestScan = async accepted => {
        await submitCameraReview(scan);
        if (accepted) {
          await scan.waitFor({state: 'detached'});await titleInput(f).waitFor();
          assert.equal(await titleInput(f).inputValue(), scanTitle);
        } else {
          await f.page.waitForFunction(refusal => document.querySelector('[aria-label="Event draft status"]')?.textContent === refusal, scanRefusal);
          assert.equal(await scan.getByRole('textbox', {name: 'Event title', exact: true}).inputValue(), scanTitle);
        }
        await mark('Submit the actual Camera scan event review', call('requestScan'));
      };
      const closeScan = async () => {
        await scan.getByRole('button', {name: 'Close scan', exact: true}).click();
        await scan.waitFor({state: 'detached'});
        await mark('Close the retained scan review explicitly', call('closeScan'));
      };
      const beginDiscard = async () => {
        const gate = await f.invoke('hold', 'draft-clear');
        await reviewCalendarDraftDiscard(f, true);
        await f.page.waitForFunction(id => window.quintCalendar.held(id), gate);
        await mark('Confirm discard while the actual storage clear is held', call('beginDiscard'));
        return gate;
      };
      const endDiscard = async gate => {
        await f.invoke('release', gate);
        await f.page.waitForFunction(() => {
          const s = window.quintCalendar.snapshot();
          return !s.draft.consuming && !s.retained;
        });
        await mark('The exact old slot is consumed', call('endDiscard'));
      };
      try {
        await run({f, mark, retain, home, calendar, note, requestNote, openScan, requestScan, closeScan, beginDiscard, endDiscard});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('Note refusal keeps exact note and separate reminder authority', async c => {
      const old = await c.retain();await c.home();await c.note();await c.requestNote(false);
      assert.equal(await c.f.invoke('saved', 'owner-a'), old);
      await reviewNote(c.f, 'reminder');await titleInput(c.f).waitFor();
      await c.mark('Separate reminder editor keeps the canonical retained bytes', call('requestReminder'));
      assert.equal(await c.f.invoke('saved', 'owner-a'), old);
      await c.f.button('Back to calendar').click();
      await c.mark('Close the separate reminder editor', call('closeForm'));
      await c.endDiscard(await c.beginDiscard());
      await c.home();await c.note();await c.requestNote(true);
    });
    await schedule('Camera refusal keeps the real review and admits fresh draft after discard', async c => {
      const old = await c.retain();await c.home();await c.openScan();await c.requestScan(false);
      assert.equal(await c.f.invoke('saved', 'owner-a'), old);
      await c.closeScan();await c.home();await c.calendar();
      await c.endDiscard(await c.beginDiscard());
      await c.home();await c.openScan();await c.requestScan(true);
    });
    await schedule('pending consume refuses Note until its exact clear settles', async c => {
      const old = await c.retain(), gate = await c.beginDiscard();
      await c.home();await c.note();await c.requestNote(false);
      assert.equal(await c.f.invoke('saved', 'owner-a'), old);
      await c.endDiscard(gate);
      await c.requestNote(true);
    });
    await schedule('replacement slot open keeps the prior owner’s stored draft and defers Note', async c => {
      const old = await c.retain();await c.home();
      const gate = await c.f.invoke('hold', 'draft-open');
      await c.f.invoke('switchPort', 'owner-b', 'session-b');
      await c.f.page.waitForFunction(id => {
        const s = window.quintCalendar.snapshot();
        return s.status === 'ready' && s.draft.opening && window.quintCalendar.held(id);
      }, gate);
      await c.mark('New exact owner’s canonical draft read is still pending', call('beginOwnerOpen'));
      await c.note();await c.requestNote(false);
      await c.f.invoke('release', gate);await c.f.status('ready', 'session-b');
      await c.mark('Readback confirms the new owner has an empty draft slot', call('endOwnerOpen'));
      await c.requestNote(true);
      assert.equal(await c.f.invoke('saved', 'owner-a'), old);
    });
    await schedule('unapproved preservation never admits a canonical Note event', async c => {
      await c.note();await c.requestNote(false);
      assert.equal(await c.f.invoke('saved', 'owner-a'), '');
    }, {ready: false});
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['Chromium mounts Alpha Notes, Calendar and the real scan review. The source uses actual IndexedDB, closed app-record routes, synthetic camera inputs and local OCR.',
      'Two owners, one synthetic Note and scan, and selected present, absent, loading and consuming draft slot states. Stored bytes are checked independently from the title projection.',
      'Native capture, OCR quality, provider saves, and the old owner’s process-wide retirement are separate. The Camera fixture enters at the captured-image review boundary.']}));
}
