import { test, expect } from '@playwright/test';
import { calendarEditorReady } from './calendar-draft-readiness';

// Renderer geometry with a synthetic visual viewport. Native keyboard/IME and
// device screen-reader acceptance remain separate from this regression.
for (const editor of [false, true]) test(`${editor ? 'Calendar draft' : 'operation review'} keeps actions above a visual-only keyboard`, async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/?mode=dev');
  await page.evaluate(async editor => {
    if (editor) {
      const { editCalendarEvent } = await import('/src/browser/calendar-editor.ts');
      void editCalendarEvent({ title: 'Preserve this draft', body: 'Original description', location: '', begin: Date.now(), end: Date.now() + 3600000 }, async () => {});
    } else {
      const { BrowserReviews } = await import('/src/browser/review.ts');
      void new BrowserReviews().confirm('viewport-review', 'Review selected files', 'Exact file details\n'.repeat(100));
    }
  }, editor);
  const dialog = page.getByRole('dialog', { name: editor ? 'Edit calendar event' : 'Review selected files', exact: true });
  if (editor) {
    await calendarEditorReady(dialog);
    await dialog.getByLabel('Event title', { exact: true }).fill('Draft survives keyboard');
    await dialog.getByLabel('Event title', { exact: true }).evaluate((input: HTMLInputElement) => input.setSelectionRange(6, 14));
  }
  // Keyboard changes visual height without changing the layout viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 320 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  for (const top of [0, 110]) {
    await page.evaluate(top => {
      Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, value: top });
      window.visualViewport!.dispatchEvent(new Event('scroll'));
    }, top);
    await expect.poll(async () => {
      const rect = await dialog.boundingBox();
      return !!rect && rect.y >= top && rect.y + rect.height <= top + 320;
    }).toBe(true);
    for (const label of editor ? ['Save event', 'Cancel'] : ['Confirm', 'Cancel']) {
      const action = dialog.getByRole('button', { name: label, exact: true });
      const rect = (await action.boundingBox())!;
      expect(rect.y).toBeGreaterThanOrEqual(top);
      expect(rect.y + rect.height).toBeLessThanOrEqual(top + 320);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
  }
  if (editor) {
    const title = dialog.getByLabel('Event title', { exact: true });
    await expect(title).toHaveValue('Draft survives keyboard');
    expect(await title.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([6, 14]);
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
