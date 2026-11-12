import {retainedMailDraft} from './helpers/retained-mail-draft';
import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])for(const viewport of [{width:360,height:640},{width:740,height:360}])test(`Inbox draft remains editable at large text: ${theme} ${viewport.width}`,async({page},info)=>{
 await page.setViewportSize(viewport);await page.goto(`/?mode=dev&theme=${theme}`);
 await page.evaluate(async()=>{const{BrowserDevice}=await import('/src/browser/device.ts');await BrowserDevice.prototype.setTextScale({percent:150});});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Compose',exact:true}).click();
 const body=page.getByRole('textbox',{name:'Message',exact:true});
 await body.scrollIntoViewIfNeeded();
 await expect.poll(()=>body.evaluate(el=>{const b=el.getBoundingClientRect(),p=el.parentElement!.getBoundingClientRect();return b.top>=p.top-1&&b.bottom<=p.bottom+1;})).toBe(true);
 await body.fill('A retained local draft.\nSecond paragraph.');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Compact draft');
 await page.getByRole('button', {name: 'Cc and Bcc', exact: true}).click();
  await page.getByRole('textbox', {name: 'Cc', exact: true}).fill('copy@example.invalid');
 await page.getByRole('textbox',{name:'Bcc',exact:true}).fill('blind@example.invalid');
 const address='a'.repeat(60)+'@'+'b'.repeat(60)+'.example.invalid';
 await page.getByRole('textbox',{name:'To',exact:true}).fill(address);
 await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');
 const recipient=page.getByRole('button',{name:'Remove '+address,exact:true});await recipient.scrollIntoViewIfNeeded();
 expect(await recipient.evaluate(el=>{const b=el.getBoundingClientRect(),p=el.parentElement!.getBoundingClientRect();return b.left>=p.left-1&&b.right<=p.right+1&&el.scrollWidth<=el.clientWidth+1;})).toBe(true);
 await body.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('editable-draft.png')});
 for(const name of ['Back from draft','Attach file','Send email']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);}
 await retainedMailDraft(page,'save');
 await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/^Saved locally/);await page.reload();await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Restore local draft',exact:true}).click();
 await expect(body).toHaveValue('A retained local draft.\nSecond paragraph.');await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Compact draft');
 await expect(page.getByRole('textbox',{name:'Cc',exact:true})).toHaveValue('copy@example.invalid');await expect(page.getByRole('textbox',{name:'Bcc',exact:true})).toHaveValue('blind@example.invalid');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.inbox')!).sent.length)).toBe(0);
 await expect(recipient).toBeVisible();await recipient.click();await expect(recipient).toHaveCount(0);
 await expect(body).toHaveValue('A retained local draft.\nSecond paragraph.');
});
