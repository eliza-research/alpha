import {test,expect} from '@playwright/test';

// Full-screen chat on the launcher is drawn under Android's status bar. A pull from the bar is
// Android's shade (docs/gesture-zones.md), so the Resize chat grabber must start below it with
// room to spare, and a drag down from it must shrink the chat without opening any shade.
for(const inset of [0,52])test(`full chat grabber clears the status bar and drags down: inset ${inset}`,async({page})=>{
 await page.setViewportSize({width:412,height:915});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?shell=launcher&tools=1');
 await page.evaluate(value=>document.documentElement.style.setProperty('--native-top-inset',`${value}px`),inset);
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(page.getByRole('button',{name:'Shrink chat',exact:true})).toBeVisible();
 const panel=page.locator('[data-alpha-layer="conversation"]'),handle=page.getByRole('button',{name:'Resize chat',exact:true});
 await panel.evaluate(element=>Promise.all(element.ownerDocument.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const box=(await handle.boundingBox())!,screen=(await page.locator('[data-screen]').boundingBox())!;
 // 44px status bar band in the browser; on a phone the measured inset, plus 16 screen pixels.
 expect(box.y-screen.y).toBeGreaterThanOrEqual(Math.max(44,inset)+16);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2+320,{steps:8});await page.mouse.up();
 await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
 await expect(page.locator('[data-alpha-layer="shade"]')).not.toBeInViewport();
});
