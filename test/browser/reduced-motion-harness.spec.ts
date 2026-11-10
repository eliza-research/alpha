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

// Under reduced motion an infinite animation is not shortened into a strobe: nothing loops, and
// the typing dots, skeleton bars, call ring and sign-in spinner hold still where they are visible.
test('reduced motion leaves no looping animation and holds the loading indicators still',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 await page.evaluate(()=>{const host=document.createElement('div');host.id='motion-probe';host.innerHTML='<span class="dot" style="display:inline-block;width:7px;height:7px"></span><span class="bar" style="display:inline-block;width:3px;height:14px"></span><span class="ring" style="display:inline-block;width:20px;height:20px"></span><span class="alpha-spinner"></span>';document.querySelector('.os')!.append(host);});
 const looping=()=>page.evaluate(()=>document.getAnimations().filter(item=>item.playState==='running'&&item.effect?.getComputedTiming().iterations===Infinity).map(item=>(item as CSSAnimation).animationName));
 expect(await looping()).toEqual([]);
 const sample=()=>page.evaluate(()=>Array.from(document.querySelectorAll('#motion-probe > *'),el=>{const style=getComputedStyle(el);const transform=style.transform==='none'||new DOMMatrixReadOnly(style.transform).isIdentity?'none':style.transform;return `${el.className} ${style.opacity} ${transform}`;}));
 const first=await sample();
 expect(first).toEqual(['dot 1 none','bar 1 none','ring 1 none','alpha-spinner 1 none']);
 for(let i=0;i<5;i++){await page.waitForTimeout(90);expect(await sample()).toEqual(first);}
});
