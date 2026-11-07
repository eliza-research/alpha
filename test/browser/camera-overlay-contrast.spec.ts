import {test,expect} from '@playwright/test';
for(const state of ['camera'])test(`camera text has contrast over a white feed: ${state}`,async({page},info)=>{
 await page.goto('/?mode=mock&start='+state);
 const controls=page.locator(state==='camera'?'button[aria-label^="Zoom "]':'button[aria-label="Save to Files"],button[aria-label="Open link"]');
 await expect(controls.first()).toBeVisible();
 // Composite the real rendered surface over the brightest possible camera pixel.
 const ratios=await controls.evaluateAll(elements=>elements.map(element=>{
  const css=getComputedStyle(element),rgba=(value:string)=>value.match(/[\d.]+/g)!.map(Number);
  const bg=rgba(css.backgroundColor),fg=rgba(css.color),a=bg[3]??1;
  const luminance=(rgb:number[])=>rgb.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
  const l1=luminance(bg.slice(0,3).map(x=>x*a+255*(1-a))),l2=luminance(fg);
  return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
 }));
 expect(ratios.length).toBe(state==='camera'?4:2);for(const ratio of ratios)expect(ratio).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:info.outputPath('camera-controls.png'),animations:'disabled'});
});
