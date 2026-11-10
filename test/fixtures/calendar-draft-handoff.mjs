import {startMountedCalendar} from './calendar-mounted-editor.mjs';

export {startMountedCalendar};
export const earlierTitle = 'Earlier Calendar draft';
export const noteTitle = 'Fixture schedule note';
export const fixtureNote = {
  id: 'fixture-schedule-note', title: noteTitle, body: 'Plan the meeting',
  color: 'yellow', createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z',
};
export const noteRefusal = "Calendar can't open this event yet. Finish any open Calendar draft and try again.";
export const titleInput = f => f.page.getByRole('textbox', {name: 'Title', exact: true});

export async function goHome(f) {
  await f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await f.page.waitForFunction(() => window.quintCalendar.snapshot().view === 'home');
}
export async function retainCalendarDraft(f) {
  await f.button('Calendar').click();
  await f.button('New event').click();
  await titleInput(f).fill(earlierTitle);
  await f.button('Back to calendar').click();
  await f.button('Resume event draft').waitFor();
  const old = await f.snapshot();
  await f.page.waitForFunction(async raw => await window.quintCalendar.saved('owner-a') === raw, old.retained, {polling: 100});
  return old.retained;
}
export async function discardCalendarDraft(f) {
  const dialog = f.page.waitForEvent('dialog').then(async dialog => dialog.accept());
  await Promise.all([f.button('Discard event draft').click(), dialog]);
  await f.button('Resume event draft').waitFor({state: 'detached'});
}
export async function openNote(f) {
  await f.button('Notes').click();
  const editor = f.page.getByRole('textbox', {name: 'Note', exact: true});
  const row = f.button('Open ' + noteTitle);
  await editor.or(row).first().waitFor();
  if (!await editor.isVisible()) await row.click();
  await editor.waitFor();
}
export async function reviewNote(f, kind = 'event') {
  // Contract coverage: the owner removed these controls from the Notes menu.
  await f.page.evaluate(kind => {
    const notes = window.quintMountedCalendar.renderVals().notes;
    const action = (notes.vo || notes.ed)?.[kind === 'event' ? 'toEvent' : 'toCal'];
    if (typeof action !== 'function') throw Error('The note scheduling contract is unavailable');
    action();
  }, kind);
}
export {openCameraReview, scanRefusal, scanTitle, submitCameraReview} from './camera-calendar-review.mjs';
