import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,fenceNetwork,residentHome} from './flag-off-android';
// Flag-off renderer/CSS; a closed native failure does not qualify WebView capability.
async function failingBrowser(page:Page,message:string){await page.addInitScript(message=>{
 const w=window as any,c=w.Capacitor,previous=c.nativePromise;w.browserFailureCalls=[];
 c.PluginHeaders.push({name:'AlphaBrowser',methods:['create','navigate','present','close','bookmarks','browsingState','saveBrowsingState','readingSupport','share','openExternalBrowser'].map(name=>({name,rtype:'promise'})).concat([{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}])});
 c.nativePromise=async(p:string,m:string,i:any)=>{if(p!=='AlphaBrowser')return previous(p,m,i);w.browserFailureCalls.push(m);if(m==='create')throw new Error(message);if(m==='bookmarks')return {urls:[]};if(m==='browsingState')return {};if(m==='readingSupport')return {available:false};return {};};
},message);}
for(const width of [360,412])for(const unsupported of [true,false])test(`Browser ${unsupported?'profile refusal stays explained':'unrelated error stays distinct'} ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:780});await fenceNetwork(page);await flagOffAndroid(page);await failingBrowser(page,unsupported?'This Android WebView does not support isolated browser profiles':'Transient browser creation failed');await residentHome(page);
 await page.getByRole('button',{name:'Browser',exact:true}).click();await page.getByRole('button',{name:'Search or type address',exact:true}).click();
 const address=page.getByRole('textbox',{name:'Address',exact:true});await address.fill('https://example.invalid/');await address.press('Enter');
 const notice=page.getByRole('status',{name:'In-app browsing unavailable',exact:true});await expect.poll(()=>page.evaluate(()=>(window as any).browserFailureCalls.filter((m:string)=>m==='create').length)).toBe(1);
 if(unsupported){await expect(notice).toBeVisible();await expect(notice).toContainText('needs a newer Android System WebView');await page.waitForTimeout(4200);await expect(notice).toBeVisible();expect(await notice.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||!!hit&&el.contains(hit);})).toBe(true);const rect=(await notice.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath('unsupported-explanation.png'),animations:'disabled'});}else await expect(notice).toHaveCount(0);
 await expect(address).toBeEditable();await expect(address).toHaveValue('https://example.invalid/');expect(await page.evaluate(()=>(window as any).browserFailureCalls.filter((m:string)=>['navigate','share','openExternalBrowser'].includes(m)))).toEqual([]);
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Edit address',exact:true})).toBeVisible();if(unsupported)await expect(notice).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));await expect(page.getByRole('button',{name:'Browser',exact:true})).toBeVisible();
});
