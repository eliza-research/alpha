import {test,expect} from '@playwright/test';
import {deviceAppsStub} from './device-apps-stub';
for(const height of [600,915])test(`Apps fills the screen and its last control clears the chat bar at ${height}px`,async({page})=>{
 await page.setViewportSize({width:412,height});
 await deviceAppsStub(page);
 await page.goto('/');await page.getByRole('button',{name:'Apps',exact:true}).click();
 const list=page.locator('[data-installed-apps-scroll]');
 await expect(list).toBeVisible();
 await expect(list.getByRole('button',{name:'Open App 39'})).toBeAttached();
 expect(await list.evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-document.querySelector('[data-screen]')!.getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
 for(const raised of [false,true]){
  if(raised)await page.evaluate(()=>{document.documentElement.classList.add('native-phone');document.documentElement.style.setProperty('--native-bottom-inset','72px');});
  await expect.poll(()=>list.evaluate(el=>{const screen=document.querySelector('[data-screen]')!.getBoundingClientRect(),dock=document.querySelector('[data-alpha-layer="composer"] [data-alpha-input-bar]')!.getBoundingClientRect();return parseFloat(getComputedStyle(el).paddingBottom)>=screen.bottom-dock.top+4;})).toBe(true);
  await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const last=list.getByRole('button').last();await expect(last).toBeInViewport({ratio:1});
  await expect.poll(()=>last.evaluate(el=>{
   const r=el.getBoundingClientRect(),dock=document.querySelector('[data-alpha-layer="composer"] [data-alpha-input-bar]')!.getBoundingClientRect();
   return {clear:r.bottom<=dock.top-4,reachable:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
  })).toEqual({clear:true,reachable:true});
 }
});
