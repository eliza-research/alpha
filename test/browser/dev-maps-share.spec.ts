import {test,expect,type Page} from '@playwright/test';
async function pin(page:Page){
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Maps',exact:true}).click();
 const q=page.getByRole('textbox',{name:'Search places',exact:true});await q.fill('43.7384, 7.4246');await q.press('Enter');
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  Object.defineProperty(document,'permissionsPolicy',{configurable:true,value:{allowsFeature:()=>true}});
  Object.defineProperty(navigator,'share',{configurable:true,value:async(data:unknown)=>{(window as any).shared=data;}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).copied=text;}}});
 });
});
test('Maps sends its selected location directly to the platform chooser',async({page})=>{
 await pin(page);await page.getByRole('button',{name:'Share',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).shared?.title)).toBe('Dropped pin');
 expect(await page.evaluate(()=>(window as any).shared?.text)).toContain('43.7384');
 expect(await page.evaluate(()=>(window as any).copied)).toBeUndefined();
 await expect(page.getByRole('dialog',{name:'Share',exact:true})).toHaveCount(0);
});
test('canceling platform share keeps the selected place and never copies',async({page})=>{
 await pin(page);await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:async(data:unknown)=>{(window as any).shared=data;throw new DOMException('Cancelled','AbortError');}}));
 await page.getByRole('button',{name:'Share',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).shared?.title)).toBe('Dropped pin');
 expect(await page.evaluate(()=>(window as any).copied)).toBeUndefined();
 await expect(page.getByRole('dialog',{name:'Share',exact:true})).toHaveCount(0);
});
test('platform sharing failure is reported without another destination',async({page})=>{
 await pin(page);await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:async()=>{throw Error('Sharing is unavailable.');}}));
 await page.getByRole('button',{name:'Share',exact:true}).click();
 await expect(page.getByText('Sharing is unavailable.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).copied)).toBeUndefined();
});


test('a browser without a share sheet offers Copy link for the selected place',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
 await pin(page);await page.getByRole('button',{name:'Copy link',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).copied)).toBe('https://www.google.com/maps/search/?api=1&query=43.7384%2C7.4246');
 await expect(page.getByText('Sharing is unavailable in this browser. Use Copy text or Save text.',{exact:true})).toHaveCount(0);
});
