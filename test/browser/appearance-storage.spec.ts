import {test,expect,type Page} from '@playwright/test';
const key='alpha.appearance.v1';
const theme=(page:Page)=>page.locator('.os').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim());
async function choose(page:Page,name:'System'|'Light'|'Dark'){
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Display',exact:true}).click();
 await page.getByRole('button',{name:'Theme: '+name,exact:true}).click();
}
test.beforeEach(async({context})=>context.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}))));
test('tabs follow saved appearance without echoing writes',async({page,context})=>{
 await page.goto('/');const other=await context.newPage();await other.goto('/');
 await other.evaluate(()=>{const set=Storage.prototype.setItem;(window as any).themeWrites=0;Storage.prototype.setItem=function(key,value){if(key==='alpha.appearance.v1')(window as any).themeWrites++;return set.call(this,key,value);};});
 await choose(page,'Dark');await expect.poll(()=>theme(other)).toBe('#000000');
 expect(await other.evaluate(()=>(window as any).themeWrites)).toBe(0);
 await choose(other,'Light');await expect.poll(()=>theme(page)).toBe('#FFFFFF');
 expect(await other.evaluate(()=>(window as any).themeWrites)).toBe(1);
 await page.reload();await expect.poll(()=>theme(page)).toBe('#FFFFFF');
});
test('rapid external writes use the latest saved value',async({page,context})=>{
 await page.goto('/');const other=await context.newPage();await other.goto('/');
 await other.evaluate(key=>{for(let i=0;i<20;i++)localStorage.setItem(key,i%2?'light':'dark');localStorage.setItem(key,'dark');},key);
 await expect.poll(()=>theme(page)).toBe('#000000');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('dark');
});
for(const clear of [false,true])test(`removed appearance returns to light after ${clear?'clear':'remove'}`,async({page,context})=>{
 await page.goto('/');await choose(page,'Dark');const other=await context.newPage();await other.goto('/');
 await other.evaluate(({clear,key})=>{if(clear)localStorage.clear();else localStorage.removeItem(key);},{clear,key});
 await expect.poll(()=>theme(page)).toBe('#FFFFFF');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
});
test('malformed appearance falls back without replacing original bytes',async({page,context})=>{
 await page.goto('/');await choose(page,'Dark');const other=await context.newPage();await other.goto('/');
 await other.evaluate(key=>localStorage.setItem(key,'malformed original'),key);await expect.poll(()=>theme(page)).toBe('#FFFFFF');
 await page.reload();await expect.poll(()=>theme(page)).toBe('#FFFFFF');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('malformed original');
});
test('explicit theme preview stays fixed when another tab changes appearance',async({page,context})=>{
 await page.goto('/?theme=light');const other=await context.newPage();await other.goto('/');await choose(other,'Dark');
 await expect.poll(()=>theme(other)).toBe('#000000');await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),key)).toBe('dark');
 expect(await theme(page)).toBe('#FFFFFF');
});
test('failed preference write keeps the chosen session theme',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='alpha.appearance.v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,key,value);};});
 await choose(page,'Dark');await expect.poll(()=>theme(page)).toBe('#000000');await expect(page.getByText('Theme changed for this session, but could not be saved.',{exact:true})).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
});
test('System follows the color scheme until an explicit theme is chosen',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});await page.goto('/');await choose(page,'System');
 await expect.poll(()=>theme(page)).toBe('#000000');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('system');
 await expect(page.getByRole('button',{name:'Theme: System',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.emulateMedia({colorScheme:'light'});await expect.poll(()=>theme(page)).toBe('#FFFFFF');
 // Following the scheme never replaces the saved choice with the theme it drew.
 expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('system');
 await page.emulateMedia({colorScheme:'dark'});await page.reload();await expect.poll(()=>theme(page)).toBe('#000000');
 await choose(page,'Light');await expect.poll(()=>theme(page)).toBe('#FFFFFF');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('light');
 await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});
 await expect.poll(()=>theme(page)).toBe('#FFFFFF');
});
test('a saved System choice opens in the current scheme',async({page,context})=>{
 await context.addInitScript(key=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem(key,'system');}},key);
 await page.emulateMedia({colorScheme:'dark'});await page.goto('/');await expect.poll(()=>theme(page)).toBe('#000000');
 await page.emulateMedia({colorScheme:'light'});await page.reload();await expect.poll(()=>theme(page)).toBe('#FFFFFF');
});
