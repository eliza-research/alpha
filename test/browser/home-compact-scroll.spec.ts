import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
import {setTextScale} from './accessibility-states';
for(const theme of ['light','dark'])test(`compact Home reaches lower apps and horizontal widgets in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:360,height:640});await page.goto('/?mode=dev&theme='+theme);
 const settings=page.getByRole('button',{name:'Settings',exact:true});await settings.scrollIntoViewIfNeeded();expect(await settings.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);expect(await page.locator('[data-alpha-layer=home]').evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.top-document.querySelector('[data-screen]')!.getBoundingClientRect().top)<1&&!el.contains(document.elementFromPoint(r.left+r.width/2,r.top-2));})).toBe(true);await page.screenshot({path:info.outputPath('home-bottom.png')});await settings.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 await returnToApps(page);await page.getByRole('button',{name:'Open workflows',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');await returnToApps(page);await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
});

// Home may flow beneath the floating assistant, but its final row must scroll clear.
async function homeOrder(page:Page){
 return page.evaluate(()=>{
  const layer=document.querySelector<HTMLElement>('[data-alpha-layer="home"]')!,view=layer.getBoundingClientRect();
  const composer=document.querySelector<HTMLElement>('[data-alpha-layer="composer"]')!.getBoundingClientRect();
  type Box={top:number;bottom:number;left:number;right:number};
  const cut=(a:Box,b:Box):Box|null=>{const box={top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom),left:Math.max(a.left,b.left),right:Math.min(a.right,b.right)};return box.bottom-box.top>1&&box.right-box.left>1?box:null;};
  // Each control's own visible part: the card row scrolls sideways, so its clipped cards are left out too.
  const clip=(el:Element)=>{let box=cut(el.getBoundingClientRect(),view);for(let parent=el.parentElement;box&&parent&&parent!==layer;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.overflowX!=='visible'||style.overflowY!=='visible')box=cut(box,parent.getBoundingClientRect());}return box;};
  const controls=[...layer.querySelectorAll<HTMLElement>('button,a[href],input,textarea,[tabindex]:not([tabindex="-1"])')].map(el=>({name:el.getAttribute('aria-label')||el.textContent!.trim().slice(0,30),box:clip(el)})).filter((row):row is {name:string;box:Box}=>!!row.box);
  const under=controls.filter(row=>cut(row.box,composer)).map(row=>row.name);
  // DOM order is reading order: each next control starts on a lower row, or further right on the same row.
  const backwards:string[]=[];
  for(let i=1;i<controls.length;i++){const a=controls[i-1].box,b=controls[i].box,sameRow=Math.abs(a.top-b.top)<4;if(sameRow?b.left<a.left-1:b.top<a.top-1)backwards.push(controls[i-1].name+' -> '+controls[i].name);}
  const lowest=Math.max(...controls.map(row=>row.box.bottom));
  return {names:controls.map(row=>row.name),under,backwards,composerBelow:composer.top>=lowest-1,scrollable:layer.scrollHeight>layer.clientHeight};
 });
}
// The standalone app's Home (three columns, four rows) fits the screen at 200% text since the shared
// mobile shell Home (38fe6354b, #775); only the launcher Home must scroll there (accessibility-resilience).
// Whether it scrolls or not, its last app row stays clear of the composer.
test('Home at 200% text fills the screen and its last app row stays above the composer',async({page})=>{
 await page.setViewportSize({width:412,height:915});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
 await setTextScale(page,2);
 await expect.poll(()=>page.locator('[data-alpha-home-apps] > button').evaluateAll(list=>new Set(list.map(el=>Math.round(el.getBoundingClientRect().left))).size)).toBe(3);
 const layer=page.locator('[data-alpha-layer="home"]');
 for(const at of ['top','bottom'] as const){
  await layer.evaluate((el,at)=>{el.scrollTop=at==='top'?0:el.scrollHeight;},at);await page.waitForTimeout(100);
  const order=await homeOrder(page);
  if(at==='bottom')expect(order.under,at+': under the composer').toEqual([]);
  expect(order.backwards,at+': reading order goes back up').toEqual([]);
  if(at==='bottom')expect(order.composerBelow,at+': the composer is below every visible Home control').toBe(true);
  if(at==='bottom')expect(order.names).toContain('All apps');
 }
 // The Home scroller fills the phone instead of clipping labels above the assistant.
 const edges=await page.evaluate(()=>({home:document.querySelector('[data-alpha-layer="home"]')!.getBoundingClientRect().bottom,screen:document.querySelector('[data-screen]')!.getBoundingClientRect().bottom}));
 expect(Math.abs(edges.home-edges.screen)).toBeLessThanOrEqual(1);
});
