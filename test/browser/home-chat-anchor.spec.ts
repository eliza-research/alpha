import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const shell of ['standalone','launcher'])for(const size of [{width:360,height:640},{width:412,height:915}])test(`Home grid stays anchored through chat detents: ${shell} ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(shell==='launcher'?'/?shell=launcher&tools=1':'/');
 const home=page.locator('[data-alpha-layer="home"]'),screen=page.locator('[data-screen]'),tile=home.getByRole('button',{name:'Calendar',exact:true}),panel=page.locator('[data-alpha-layer="conversation"]');
 await expect(tile).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 const measure=()=>home.evaluate(el=>{const tile=el.querySelector<HTMLButtonElement>('button[aria-label="Calendar"]')!,r=tile.getBoundingClientRect(),h=el.getBoundingClientRect();return {gridTop:r.top,gridLeft:r.left,homeTop:h.top,homeHeight:h.height,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,paddingBottom:getComputedStyle(el).paddingBottom};});
 const before=await measure();
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(screen).toHaveAttribute('data-alpha-chat-half','true');await expect(page.getByRole('button',{name:'Expand chat',exact:true})).toBeVisible();
 const half=await measure();
 const handle=page.getByRole('button',{name:'Resize chat',exact:true});
 // Manual pointer coordinates must come from the settled sheet, not its opening animation.
 await handle.click({trial:true});
 const box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+18,{steps:4});
 const during=await measure();await page.mouse.up();
 if(await page.getByRole('button',{name:'Minimize chat',exact:true}).isVisible())await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
 await expect(screen).toHaveAttribute('data-alpha-chat-half','false');
 const after=await measure();
 await writeFile(info.outputPath('Home-grid-geometry.json'),JSON.stringify({before,half,during,after},null,2));
 await info.attach('Home-grid-geometry',{body:JSON.stringify({before,half,during,after},null,2),contentType:'application/json'});
 expect(Math.abs(half.gridTop-before.gridTop),'open half must preserve the Home icon anchor').toBeLessThan(1);
 expect(Math.abs(during.gridTop-before.gridTop),'continuous sheet movement must preserve the Home icon anchor').toBeLessThan(1);
 expect(Math.abs(after.gridTop-before.gridTop),'collapse must preserve the Home icon anchor').toBeLessThan(1);
 // The overlay remains nonblocking; a lower app can still scroll above it and receive focus.
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();await expect(screen).toHaveAttribute('data-alpha-chat-half','true');
 // Focus scrolling must use the settled sheet edge, as the pointer drag above does.
 await handle.click({trial:true});
 const settings=home.getByRole('button',{name:'Settings',exact:true});await settings.focus();
 await expect.poll(async()=>{const a=(await settings.boundingBox())!,p=(await panel.boundingBox())!;return a.y+a.height<=p.y;}).toBe(true);
 const scrolled=await measure();expect(scrolled.scrollTop).toBeGreaterThan(0);expect(await home.getAttribute('inert')).toBeNull();
 await writeFile(info.outputPath('Home-half-scroll-geometry.json'),JSON.stringify(scrolled,null,2));
 await info.attach('Home-half-scroll-geometry',{body:JSON.stringify(scrolled,null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('home-grid-half-scroll.png'),animations:'disabled'});
});
