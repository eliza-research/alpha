export const scanTitle = 'Synthetic scanned event';
export const scanRefusal = 'Calendar unavailable';

export async function openCameraReview(f) {
  await f.page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {throw new DOMException('Closed fixture camera', 'NotAllowedError');};
  });
  await f.button('Camera').click();
  await f.page.waitForFunction(() => window.quintCalendar.snapshot().view === 'camera');
  return openMountedCameraReview(f);
}
export async function openMountedCameraReview(f) {
  await f.page.evaluate(async () => {
    const {openScanReview} = await import('/src/prototype/scan-review.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 700;canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';ctx.fillRect(0, 0, 700, 240);ctx.fillStyle = 'black';
    ctx.font = '48px Arial';ctx.fillText('Synthetic scan meeting', 25, 100);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    const camera = window.quintMountedCalendar.api('camera');
    openScanReview(blob, async () => {throw Error('Fixture does not save notes');},
      draft => camera.isActive() && camera.reviewScannedCalendarDraft(draft), 'selected');
  });
  const dialog = f.page.getByRole('dialog', {name: 'Review scanned text', exact: true});
  await dialog.locator('summary').filter({hasText: 'Create event draft'}).click({timeout: 90_000});
  await f.page.waitForFunction(() => !!document.querySelector('dialog[aria-label="Review scanned text"] input[aria-label="Event duration in minutes"]')?.value);
  const allDay = dialog.getByRole('checkbox', {name: 'All day', exact: true});
  if (await allDay.isChecked()) await allDay.uncheck();
  await dialog.getByRole('textbox', {name: 'Event title', exact: true}).fill(scanTitle);
  await dialog.getByLabel('Event date', {exact: true}).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await dialog.getByLabel('Event start time', {exact: true}).fill('14:00');
  await dialog.getByRole('spinbutton', {name: 'Event duration in minutes', exact: true}).fill('60');
  const valid = await dialog.locator('form').evaluate(form => form.checkValidity());
  if (!valid) throw Error('The synthetic scan event fields must be valid before submission');
  return dialog;
}
export function submitCameraReview(dialog) {
  return dialog.getByRole('button', {name: 'Review in Calendar', exact: true}).click();
}
