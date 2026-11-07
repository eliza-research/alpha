import {test,expect} from '@playwright/test';

// `reducedMotion` is a browser context option, not a Playwright test option: a bare
// `use.reducedMotion` is silently ignored. Specs that opt out of screen-entry motion use
// contextOptions, and this check proves that opt-in reaches the page and its entry animation.
test.use({contextOptions:{reducedMotion:'reduce'}});
test('a spec that opts into reduced motion gets no screen-entry animation',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const entering=page.locator('.enter').first();
 await expect(entering).toBeVisible();
 expect(await entering.evaluate(el=>parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(0.001);
});
