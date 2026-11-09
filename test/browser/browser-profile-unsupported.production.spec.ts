import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,fenceNetwork,residentHome} from './flag-off-android';
// Flag-off renderer/CSS; a closed native failure does not qualify WebView capability.
async function failingBrowser(page:Page,message:string){await page.addInitScript(message=>{
 const w=window as any,c=w.Capacitor,previous=c.nativePromise;w.browserFailureCalls=[];
 c.PluginHeaders.push({name:'AlphaBrowser',methods:['create','navigate','present','close','bookmarks','browsingState','saveBrowsingState','readingSupport','share','openExternalBrowser'].map(name=>({name,rtype:'promise'})).concat([{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}])});
 c.nativePromise=async(p:string,m:string,i:any)=>{if(p!=='AlphaBrowser')return previous(p,m,i);w.browserFailureCalls.push(m);if(m==='create')throw new Error(message);if(m==='bookmarks')return {urls:[]};if(m==='browsingState')return {};if(m==='readingSupport')return {available:false};return {};};
},message);}
for (const width of [360, 412]) {
 test(`Browser profile refusal stays explained at ${width}px`, async ({page}, info) => {
  await page.clock.install();
  await openRefusedAddress(page, width, 'This Android WebView does not support isolated browser profiles');
  const notice = page.getByRole('status', {name:'In-app browsing unavailable', exact:true});
  await expect(notice).toContainText('isolated browser profiles are not supported');
  await page.clock.fastForward(4200);
  await expect(notice).toBeVisible();
  expect(await notice.evaluate(element => {
   const rect = element.getBoundingClientRect();
   return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  const rect = (await notice.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath('unsupported-explanation.png'), animations:'disabled'});
  await closeRefusedAddress(page);
  await expect(notice).toBeVisible();
  await returnHome(page);
 });
}

test('an unrelated Browser creation error stays distinct', async ({page}) => {
 await openRefusedAddress(page, 360, 'Transient browser creation failed');
 await expect(page.getByRole('status', {name:'In-app browsing unavailable', exact:true})).toHaveCount(0);
 await closeRefusedAddress(page);
 await returnHome(page);
});

async function openRefusedAddress(page:Page, width:number, message:string) {
 await page.setViewportSize({width, height:780});
 await fenceNetwork(page);
 await flagOffAndroid(page);
 await failingBrowser(page, message);
 await residentHome(page);
 await page.getByRole('button', {name:'Browser', exact:true}).click();
 await page.getByRole('button', {name:'Search or type address', exact:true}).click();
 const address = page.getByRole('textbox', {name:'Address', exact:true});
 await address.fill('https://example.invalid/');
 await address.press('Enter');
 await expect.poll(() => page.evaluate(() =>
  (window as any).browserFailureCalls.filter((method:string) => method === 'create').length,
 )).toBe(1);
}

async function closeRefusedAddress(page:Page) {
 const address = page.getByRole('textbox', {name:'Address', exact:true});
 await expect(address).toBeEditable();
 await expect(address).toHaveValue('https://example.invalid/');
 expect(await page.evaluate(() =>
  (window as any).browserFailureCalls.filter((method:string) =>
   ['navigate','share','openExternalBrowser'].includes(method)),
 )).toEqual([]);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button', {name:'Edit address', exact:true})).toBeVisible();
}

async function returnHome(page:Page) {
 await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable:true})));
 await expect(page.getByRole('button', {name:'Browser', exact:true})).toBeVisible();
}

// The existing Android fixture has no AlphaBrowser implementation. Capacitor's real proxy
// throws CapacitorException(Unimplemented); this is renderer evidence, not a device failure.
test('missing Browser implementation reports plain language without the internal plugin name',async({page})=>{
 await fenceNetwork(page);await flagOffAndroid(page);await residentHome(page);await page.getByRole('button',{name:'Browser',exact:true}).click();
 await expect(page.getByText('This feature isn’t available in this version of Alpha.',{exact:true})).toBeVisible();
 await expect(page.getByText('"AlphaBrowser" plugin is not implemented on android',{exact:true})).toHaveCount(0);
});
