import {test,expect,type Locator} from '@playwright/test';

async function expectWhiteImageContrast(elements:Locator) {
 const ratios=await elements.evaluateAll(nodes=>nodes.map(el=>{
  const style=getComputedStyle(el),rgb=(s:string)=>s.match(/[\d.]+/g)!.map(Number),bg=rgb(style.backgroundColor),fg=rgb(style.color),alpha=bg[3]??1;
  const lum=(c:number[])=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
  const x=lum(bg.map(c=>c*alpha+255*(1-alpha))),y=lum(fg);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
 }));
 expect(ratios.length).toBeGreaterThan(0);
 for(const ratio of ratios)expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for(const theme of ['light','dark']) {
 test(`photo metadata and selection stay readable over white images ${theme}`,async({page})=>{
  await page.goto(`/?mode=mock&theme=${theme}&start=photos`);
  await expect(page.locator('.photo-media-badge').first()).toBeAttached();
  await expect(page.locator('.photo-favorite-badge').first()).toBeAttached();
  await expectWhiteImageContrast(page.locator('.photo-media-badge,.photo-favorite-badge'));
  await page.locator('.photo-media-badge').first().scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'Select photos',exact:true}).click();
  await expect(page.locator('.photo-selection-badge').first()).toBeVisible();
  await expectWhiteImageContrast(page.locator('.photo-selection-badge'));
 });
 test(`compact video controls remain readable over bright media ${theme}`,async({page})=>{
  await page.setViewportSize({width:360,height:420});
  await page.goto(`/?mode=mock&theme=${theme}&start=photos`);
  await page.getByRole('button',{name:/^Video,/}).first().click();
  const play=page.getByRole('button',{name:'Play video',exact:true});
  await expect(play).toBeVisible();await expectWhiteImageContrast(play);
  // Worst-case photograph underneath the actual viewer controls.
  await page.locator('[data-alpha-subview="photos-viewer"] > button:first-child > span > span').first().evaluate(el=>(el as HTMLElement).style.background='#fff');
  await play.click();
  const pause=page.getByRole('button',{name:'Pause video',exact:true});
  await expect(pause).toBeVisible();await expectWhiteImageContrast(pause);
  await pause.click();await expect(play).toBeVisible();
  await page.getByRole('button',{name:'Back from photo',exact:true}).click();
  await expect(page.locator('[data-alpha-subview="photos-viewer"]')).toHaveCount(0);
 });
}
