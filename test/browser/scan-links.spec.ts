import {test,expect} from '@playwright/test';

test('recognized links require a current, reviewed click and open without opener access',async({page,context},info)=>{
 let requested=0;await context.route(/^https:\/\//,async route=>{requested++;await route.fulfill({status:200,contentType:'text/html',body:'<h1>Test destination</h1>'});});
 await page.goto('/');await page.evaluate(async()=>{
  const {openScanReview}=await import('/src/prototype/scan-review.ts');const canvas=document.createElement('canvas');canvas.width=700;canvas.height=240;const c=canvas.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,700,240);c.fillStyle='black';c.font='44px Arial';c.fillText('https://example.com/scan',20,100);const image=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/jpeg'));openScanReview(image,async()=>true);
 });
 const dialog=page.getByRole('dialog',{name:'Review scanned text'});const text=dialog.getByRole('textbox',{name:'Scanned text'});await expect(text).toBeEnabled({timeout:60000});await expect(text).toHaveValue(/^https:\/\/[a-z.]+\/scan/);const recognized=(await text.inputValue()).trim();
 const details=dialog.locator('details');await expect(details).toBeVisible();expect(await details.getAttribute('open')).toBeNull();expect(requested).toBe(0);
 await details.locator('summary').click();await expect(details.getByText(new URL(recognized).href,{exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as any).oldScanLink=document.querySelector('details a');});
 await text.fill('Edited https://example.com/corrected\nDo not execute javascript:alert(1)');
 expect(await details.getAttribute('open')).not.toBeNull();await expect(details.getByRole('link')).toHaveCount(1);await expect(details.getByRole('link')).toHaveAttribute('href','https://example.com/corrected');
 await page.evaluate(()=>(window as any).oldScanLink.click());expect(requested).toBe(0);
 await details.getByRole('link').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('review-links.png'),animations:'disabled'});
 await details.getByRole('link',{name:'Open https://example.com/corrected',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','browser');
 const destination=page.locator('iframe[title="Website"]:visible');
 await expect(destination).toHaveAttribute('src','https://example.com/corrected');
 await expect(destination.contentFrame().getByRole('heading',{name:'Test destination'})).toBeVisible();
 expect(await destination.contentFrame().locator('body').evaluate(()=>window.opener)).toBeNull();
 expect(context.pages()).toHaveLength(1);expect(requested).toBe(1);
});

test('closing a scan retires its link controls',async({page,context})=>{
 let requested=0;await context.route(/^https:\/\//,route=>{requested++;return route.abort();});await page.goto('/');
 await page.evaluate(async()=>{
  const {createScanLinkReview}=await import('/src/prototype/scan-link-review.ts');let active=true;const links=createScanLinkReview(()=>'https://example.com/retired',()=>active);document.body.append(links.element);links.update();const anchor=links.element.querySelector('a')!;active=false;links.element.remove();anchor.click();
 });expect(requested).toBe(0);expect(context.pages()).toHaveLength(1);
});
