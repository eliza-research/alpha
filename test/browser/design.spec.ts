import { test, expect } from '@playwright/test';
const states = {
  inbox:['','mail','compose'], calendar:['','event','new','month','invite','add'],
  browser:['','book','tabs','agent'], camera:['','video','scan'], photos:['','viewer','albums','search'],
  maps:['','search','place','route','nav'], notes:['','editor','rec','voice'], files:['','folder','preview'],
  workflows:['','flow','run','failed','new'], settings:['','character','accounts','adding','privacy','wifi'],
};
for (const theme of ['light','dark']) for(const [view,subs] of Object.entries(states)) {
  test(`design ${theme}: ${view} states`,async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    for(const sub of subs){
      await page.goto(`/?mode=mock&theme=${theme}&start=${view}${sub?':'+sub:''}`);
      await expect(page.locator('.mock-mode-banner')).toBeVisible();
      await expect(page.locator('[data-screen]')).toBeVisible();
      if(view==='workflows'&&sub==='failed'){
        await expect(page.getByText('Failed', {exact:true})).toBeVisible();
        await page.getByText('Execution details', {exact:true}).click();
        await expect(page.getByText('Calendar access was revoked.', {exact:true})).toBeVisible();
      }
      await page.evaluate(()=>document.fonts.ready);
      // Let the reference app-opening transition settle before visual inspection.
      await page.waitForTimeout(450);
      await page.screenshot({path:info.outputPath(`${view}-${sub||'root'}.png`)});
      expect(await page.locator('[data-screen]').innerText()).not.toContain('undefined');
    }
    expect(errors).toEqual([]);
  });
}
for(const theme of ['light','dark']) test(`design ${theme}: shell and conversation states`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  for(const state of ['home','boot','lock','shade','sheet','full','voice','heads']){
    await page.goto(`/?mode=mock&theme=${theme}&start=${state}`);
    await expect(page.locator('.mock-mode-banner')).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(450);
    // SMS heads-up is deferred by the MVP scope and intentionally returns Home.
    if(state==='heads')await expect(page.getByRole('button',{name:'Inbox',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(`${state==='heads'?'heads-deferred-home':state}.png`)});
  }
  expect(errors).toEqual([]);
});
