import {test,expect} from '@playwright/test';

test('Camera cover, menu selection, info swipe and photo chat share use the saved image',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{
  const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
  const context=canvas.getContext('2d')!;context.fillStyle='green';context.fillRect(0,0,100,100);
  await importBrowserPhoto({original:new File(['fixture'],'sample.png'),image:canvas.toDataURL('image/png'),width:100,height:100},new AbortController().signal);
 });
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Select photos',exact:true})).toBeHidden();
 await page.getByLabel('Photos tools',{exact:true}).click();
 await page.getByRole('button',{name:'Select photos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cancel selection',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel selection',exact:true}).click();
 await page.getByRole('button',{name:'Albums',exact:true}).click();
 const album=page.getByRole('button',{name:'Camera',exact:true});
 await expect(album).toBeVisible();
 await expect(album.locator('span[style*="background: url"]')).toHaveCount(1);
 await album.click();
 await page.getByRole('button',{name:/^Photo, /}).first().click();
 await page.getByRole('button',{name:'Photo info',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Photo info',exact:true});await expect(dialog).toBeVisible();
 const box=(await dialog.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+15);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+135,{steps:8});await page.mouse.up();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Ask Alpha about this photo',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Ask about selected content'})).toHaveCount(0);
 await expect(page.getByAltText('Captured photo')).toBeVisible();
});
