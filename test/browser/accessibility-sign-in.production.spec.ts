// The first screen of a signed-out production phone (P-43's required Eliza Cloud sign-in page),
// in the flag-off bundle with the synthetic Android bridge of flag-off-android.ts: names and roles,
// keyboard order, contrast, TalkBack reading order and nothing of the phone behind the page, at
// the default size, at 200% text and on its side. AccessibilityInstrumentedTest makes the same
// check on an emulator (requiredCloudSignInAtDoubleFontScale). No address or code is entered and
// nothing reaches Eliza Cloud: this is renderer evidence, not TalkBack, WebView or device acceptance.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, fenceNetwork, expectNoDevelopmentSurface } from './flag-off-android';
import { residentStub, type StubAccount } from './resident-stub';
import { ASSISTANT_GROUP, auditPage, auditReadingOrder, auditTabOrder, auditTree, format } from './accessibility-audit';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const account: StubAccount = { token: 'accessibility-sign-in-key', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', email: 'owner@example.invalid', balance: 5 };
const blocking = (lines: string[]) => lines.filter(line => !line.startsWith('text-truncated:'));

/**
 * Large text as Android WebView text zoom delivers it to this bundle: every declared pixel font size
 * multiplied. The development server applies the product's own browser display module for this
 * (accessibility-states.ts setTextScale); the flag-off Android bundle under test runs the native
 * text zoom path instead, so the same rewrite is made here, at the test boundary.
 */
async function zoomText(page: Page, scale: number) {
  await page.evaluate(value => {
    const w = window as any;
    if (!w.__alphaTestTextZoom) {
      const scaled = (style: CSSStyleDeclaration) => { const size = style.fontSize; if (/^\d*\.?\d+px$/.test(size)) style.setProperty('font-size', `calc(${size} * var(--test-text-zoom, 1))`, style.getPropertyPriority('font-size')); };
      const rules = (list: CSSRuleList) => { for (const rule of Array.from(list)) { if ('style' in rule) scaled((rule as CSSStyleRule).style); if ('cssRules' in rule) rules((rule as CSSGroupingRule).cssRules); } };
      const all = () => {
        for (const sheet of Array.from(document.styleSheets)) { try { rules(sheet.cssRules); } catch { /* cross-origin */ } }
        for (const el of document.querySelectorAll<HTMLElement>('[style]')) scaled(el.style);
      };
      all();
      w.__alphaTestTextZoom = new MutationObserver(all);
      w.__alphaTestTextZoom.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    }
    document.documentElement.style.setProperty('--test-text-zoom', String(value));
  }, scale);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function signedOut(page: Page) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { freshAccess: true });
  await residentStub(page, { nativeSignIn: true, emptyKeystore: true, accounts: [account] });
  await page.goto('/');
  const welcome = page.getByRole('main', { name: 'Welcome to Alpha.', exact: true });
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await expectNoDevelopmentSurface(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { foreign, welcome };
}

/** Everything the page offers can be brought on screen by scrolling and nothing is painted over it. */
async function unreachable(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.alpha-auth-page :is(button,input:not([type=hidden]),a[href],textarea,select)')) {
      if ((el as HTMLButtonElement).disabled || !el.getClientRects().length || el.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const box = el.getBoundingClientRect(), name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.getAttribute('placeholder') || el.tagName;
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) { out.push(`${name} off screen`); continue; }
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!hit || !(hit === el || el.contains(hit) || hit.closest('label')?.contains(el))) out.push(`${name} covered`);
    }
    document.getElementById('cloud-sign-in-title')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    return out;
  });
}

/** Nothing of the phone behind the page reaches assistive technology or the keyboard. */
async function phoneBehind(page: Page) {
  return page.evaluate(group => {
    const out: string[] = [];
    const exposed = (el: Element) => el.getClientRects().length && !el.closest('[inert],[aria-hidden="true"],[hidden]');
    for (const el of document.querySelectorAll(`[role="group"][aria-label="${group}"]`)) if (exposed(el)) out.push(`${group} exposed`);
    for (const el of document.querySelectorAll('.os :is(button,a[href],input,textarea,select)')) if (exposed(el) && !el.closest('.alpha-auth-page')) out.push(`${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.tagName} behind the sign-in page`);
    return [...new Set(out)].slice(0, 12);
  }, ASSISTANT_GROUP);
}

for (const scale of [1, 2]) {
  test(`the required sign-in page at ${scale * 100}% text: names, focus, reading order and nothing behind it`, async ({ page }) => {
    const { foreign } = await signedOut(page);
    if (scale !== 1) {
      await zoomText(page, scale);
      // The page measures the text it is drawn at (runtime/text-scale.ts), as on a phone.
      await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')))).toBeCloseTo(scale, 1);
    }
    const found = blocking(format([
      ...await auditTree(page),
      ...await auditPage(page, scale === 1 ? { contrast: true, targetSize: 24, clipping: true, overlap: true } : { clipping: true, overlap: true }),
      ...await auditReadingOrder(page),
      ...await auditTabOrder(page),
    ]));
    expect(found, found.join('\n')).toEqual([]);
    expect(await phoneBehind(page)).toEqual([]);
    expect(await unreachable(page)).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

test.describe('landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  for (const scale of [1, 2]) test(`the required sign-in page on its side at ${scale * 100}% text keeps every control reachable`, async ({ page }) => {
    const { foreign } = await signedOut(page);
    if (scale !== 1) await zoomText(page, scale);
    const found = blocking(format([...await auditTree(page), ...await auditPage(page, { clipping: true, overlap: true }), ...await auditReadingOrder(page), ...await auditTabOrder(page)]));
    expect(found, found.join('\n')).toEqual([]);
    expect(await phoneBehind(page)).toEqual([]);
    expect(await unreachable(page)).toEqual([]);
    expect(foreign).toEqual([]);
  });
});
