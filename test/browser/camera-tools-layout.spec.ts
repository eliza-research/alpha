import {test,expect} from '@playwright/test';
import {openCameraTools} from './camera-tools';
test.use({hasTouch:true,isMobile:true});
for(const viewport of [{width:412,height:915},{width:360,height:640},{width:915,height:412}])test(`Camera tools stay outside the header and reachable at ${viewport.width}x${viewport.height}`,async({page},info)=>{
 await page.setViewportSize(viewport);
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Fixture has no hardware camera','NotFoundError');};
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 const root=page.locator('[data-alpha-camera-root]'),header=root.locator('[data-alpha-app-header]');
 await expect(root).toBeVisible();
 if(viewport.width>viewport.height)await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
 await expect(header.getByRole('button',{name:/Choose image|Scan document|Ask Alpha/})).toHaveCount(0);
 for(const name of ['Choose image','Scan document','Ask Alpha about this'])await expect(page.getByRole('button',{name,exact:true})).toBeHidden();
 const toggle=root.locator('details[data-alpha-camera="tools"] summary');await expect(toggle).toBeInViewport();
 await openCameraTools(page);
 for(const name of ['Choose image','Scan document','Ask Alpha about this'])await expect(page.getByRole('button',{name,exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('camera-tools.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Choose image',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Choose camera image'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Take photo',exact:true})).toBeAttached();
});
