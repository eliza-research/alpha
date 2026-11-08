import { test, expect } from '@playwright/test';
import { auditPage, auditReadingOrder, auditTabOrder, auditTree, blocking, format } from './accessibility-audit';
import { LIVE_STATES } from './accessibility-states';

// The same renderer checks against the flag-off production bundle: no mocks, fixtures or
// developer surfaces, so these are the screens a disconnected phone actually shows, with names,
// focus, contrast and TalkBack reading order. Large text
// is checked on the development server only (the scale is applied through a source module).
// Not a TalkBack, physical large-font, rotation or device pass (MVP-48 acceptance stays open).
test.describe.configure({ mode: 'parallel' });

for (const state of LIVE_STATES) {
  test(`production names, roles, focus, contrast and clipping: ${state.name}`, async ({ page }) => {
    await state.open(page);
    const found = blocking(format([
      ...await auditTree(page),
      ...await auditPage(page, { contrast: true, targetSize: 24, clipping: true, overlap: true, dock: true }),
      ...await auditTabOrder(page),
      ...await auditReadingOrder(page),
    ]));
    expect(found, found.join('\n')).toEqual([]);
  });
}

test.describe('landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const state of LIVE_STATES) {
    test(`production landscape keeps every control on screen: ${state.name}`, async ({ page }) => {
      await state.open(page);
      await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
      const found = blocking(format([...await auditPage(page, { clipping: true, overlap: true, dock: true }), ...await auditTree(page), ...await auditTabOrder(page), ...await auditReadingOrder(page)]));
      expect(found, found.join('\n')).toEqual([]);
    });
  }
});
