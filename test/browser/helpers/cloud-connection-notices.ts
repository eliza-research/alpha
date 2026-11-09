import type {Page} from '@playwright/test';

/** Observe the actual rendered notice, clipping, and point ownership without invoking actions. */
export function observeCloudNotices(page: Page) {
  return page.evaluate(() => ({
    view: document.documentElement.dataset.activeView ?? 'home',
    notices: [...document.querySelectorAll<HTMLElement>('.alpha-plan-notice')].map(region => {
      const label = region.getAttribute('aria-label') ?? '';
      const box = region.getBoundingClientRect();
      return {
        kind: label.endsWith(' sign-in notice') ? 'sign-in' : 'plan',
        label,
        visible: box.width > 0 && box.height > 0,
        bounds: {left: box.left, top: box.top, right: box.right, bottom: box.bottom},
        actions: [...region.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          const hitButton = hit?.closest('button');
          return {
            name: button.getAttribute('aria-label') || button.textContent.trim(),
            owned: button.contains(hit),
            hit: hitButton?.getAttribute('aria-label') || hitButton?.textContent.trim() ||
              hit?.closest('.alpha-plan-notice')?.getAttribute('aria-label'),
          };
        }),
      };
    }),
  }));
}
