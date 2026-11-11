import {test,expect} from '@playwright/test';
// The illustrated DOM mock map was removed (31f04d4e7); street and place names are now drawn by MapLibre
// with the host palette's label colour on a land-coloured halo (plugin-maps map-plane "street-names" and
// "place-names" layers). Resolve those tokens exactly as the app does for MapLibre and keep them readable.
for(const theme of ['light','dark'] as const)for(const state of ['maps','maps:route','maps:nav'])test(`map labels remain readable ${theme} ${state}`,async({page},info)=>{
 await page.goto(`/?mode=mock&theme=${theme}&start=${state}`);
 const root=page.locator('[data-alpha-maps-root]');await expect(root).toBeAttached();
 const colors=await root.evaluate(async(element,theme)=>{
  const {resolveMapColors}=await import('/src/maps/map-plane.ts');
  return resolveMapColors(element as HTMLElement,{label:`var(--alpha-map-${theme}-label)`,halo:`var(--alpha-map-${theme}-land)`});
 },theme);
 const numbers=(s:string)=>s.match(/[\d.]+/g)!.map(Number);
 const fg=numbers(colors.label),bg=numbers(colors.halo);
 expect(bg[3]??1).toBe(1);
 const lum=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const x=lum(fg),y=lum(bg);expect((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:info.outputPath('map-labels.png'),animations:'disabled'});
});
