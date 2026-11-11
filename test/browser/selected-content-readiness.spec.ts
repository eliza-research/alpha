import {test,expect,type Page} from '@playwright/test';

async function openStoredFile(page:Page,name:string){
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Open '+name,exact:true}).click();
 const preview=page.locator('[data-alpha-subview="files-preview"]');
 await expect(preview).toBeVisible();
 return preview;
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
});

test('a selected text file offers Ask only after its readable excerpt arrives',async({page})=>{
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  await registerPlugin<any>('AlphaFiles').importFile(new File(['Actual file text'],'pending-excerpt.txt',{type:'text/plain'}));
  const {BrowserFiles}=await import('/src/browser/files.ts'),fixture=(window as any).excerptRead={started:false};
  BrowserFiles.prototype.readSelected=async()=>{
   fixture.started=true;
   return new Promise(resolve=>{fixture.finish=()=>resolve({status:'read',text:'Actual file text'});});
  };
 });
 const preview=await openStoredFile(page,'pending-excerpt.txt'),ask=preview.getByRole('button').filter({hasText:/^Ask Alpha$/});
 await expect.poll(()=>page.evaluate(()=>(window as any).excerptRead.started)).toBe(true);
 await expect(ask).toHaveCount(0);
 await page.evaluate(()=>(window as any).excerptRead.finish());
 await expect(ask).toBeVisible();await ask.click();
 const review=page.getByRole('dialog',{name:'Ask about selected content',exact:true});
 await expect(review.getByRole('textbox',{name:'Content excerpt',exact:true})).toHaveValue('Actual file text');
});

test('a selected unsupported file has no empty Ask review',async({page})=>{
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  await registerPlugin<any>('AlphaFiles').importFile(new File([new Uint8Array([0,1,2,3])],'unsupported.bin',{type:'application/octet-stream'}));
 });
 const preview=await openStoredFile(page,'unsupported.bin');
 await expect(preview.getByText('Open or download this file.',{exact:true})).toBeVisible();
 await expect(preview.getByRole('button').filter({hasText:/^Ask Alpha$/})).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Ask about selected content',exact:true})).toHaveCount(0);
});

test('a selected image keeps the local text and description review',async({page})=>{
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
  await registerPlugin<any>('AlphaFiles').importFile(new File([bytes],'review-image.png',{type:'image/png'}));
 });
 const preview=await openStoredFile(page,'review-image.png');
 await preview.getByRole('button').filter({hasText:/^Ask Alpha$/}).click();
 const review=page.getByRole('dialog',{name:'Ask about selected content',exact:true});
 await expect(review.getByRole('button',{name:'Extract text locally',exact:true})).toBeEnabled();
 await expect(review.getByRole('img',{name:'Image for question review',exact:true})).toBeVisible();
});
