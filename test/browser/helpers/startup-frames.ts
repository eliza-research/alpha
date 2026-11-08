import {expect,type Page} from '@playwright/test';
// Owner report 2026-10-31: Home was painted for about a second, then a startup prompt (sign-in or
// access setup) covered it. Startup shows a neutral loading screen until it knows which comes first.
type Frame={t:number;home:boolean;prompt:boolean};
/** Records each change in what the page paints, sampled every frame from the first: Home, a startup prompt, both or neither. */
export async function recordStartupFrames(page:Page){await page.addInitScript(()=>{
 const frames:Frame[]=(window as any).startupFrames=[],start=performance.now();
 const sample=()=>{const home=!!document.querySelector('[data-alpha-layer="home"]'),prompt=!!document.querySelector('.alpha-connection,dialog.alpha-startup-permissions[open]'),last=frames.at(-1);if(!last||last.home!==home||last.prompt!==prompt)frames.push({t:Math.round(performance.now()-start),home,prompt});requestAnimationFrame(sample);};
 requestAnimationFrame(sample);
});}
/** A startup prompt was painted, and no frame before it showed Home. */
export async function expectNoHomeBeforePrompt(page:Page){
 const frames=await page.evaluate(()=>(window as any).startupFrames as Frame[]),first=frames.findIndex(frame=>frame.prompt);
 expect(first).toBeGreaterThanOrEqual(0);expect(frames.slice(0,first)).not.toContainEqual(expect.objectContaining({home:true}));
}
export const startupLoading=(page:Page)=>page.getByRole('status',{name:'Loading Alpha',exact:true});
