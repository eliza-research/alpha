import {test,expect,Page} from '@playwright/test';
const row=(page:Page,name:string)=>page.getByRole('button',{name:new RegExp('^(Unread, )?'+name+'$')});
// The one bottom bar is the composer (AP-16): in a thread it addresses the person.
const field=(page:Page)=>page.locator('[data-alpha-bar-field="person"]');
async function send(page:Page,text:string){await field(page).fill(text);await page.locator('[data-alpha-input-bar]').getByRole('button',{name:'Send',exact:true}).click();}
async function back(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));}
// A failed delete animates the row back onscreen. Wait for actionability/stability before measuring swipe coordinates.
async function remove(page:Page,name:string){await row(page,name).click({trial:true});const box=await row(page,name).boundingBox();if(!box)throw Error('Missing thread');await page.mouse.move(box.x+box.width*.75,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.25,box.y+box.height/2,{steps:5});await page.mouse.up();await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const schedule=window.setTimeout;(window as any).replies=[];window.setTimeout=((fn:any,ms?:number,...args:any[])=>{if(ms===2600){(window as any).replies.push(fn);return schedule(()=>{},60000);}return schedule(fn,ms===5000?60000:ms,...args);}) as typeof setTimeout;});await page.goto('/?mode=dev');await page.getByRole('button',{name:'Messages',exact:true}).click();});
// AC-22 (docs/agentic-comms.md): a query of four or more words reads as a sentence for Alpha, not a
// local filter, so the list filter uses a three-word fragment of the sent text.
test('the list bar filters to sent text after reload',async({page})=>{
 await row(page,'Maya Chen').click();await send(page,'Unique searchable development text');await page.reload();await page.getByRole('button',{name:'Messages',exact:true}).click();await page.locator('[data-alpha-bar-field="filter"]').fill('searchable development text');await expect(row(page,'Maya Chen')).toBeVisible();await expect(row(page,'Jordan Park')).toHaveCount(0);await row(page,'Maya Chen').click();await expect(page.getByText('Unique searchable development text',{exact:true})).toBeVisible();
});
test('deleted thread cannot be resurrected by delayed replies and undo preserves another thread changes',async({page})=>{
 await row(page,'Maya Chen').click();await send(page,'Before deletion');await back(page);await remove(page,'Maya Chen');await page.evaluate(()=>(window as any).replies.forEach((fn:any)=>fn()));expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya)).toBeUndefined();await row(page,'Jordan Park').click();await send(page,'Keep this newer Jordan message');await page.getByRole('button',{name:'Undo',exact:true}).click();let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!));expect(saved.threads.maya.some((m:any)=>m.text==='Before deletion')).toBe(true);expect(saved.threads.jordan.some((m:any)=>m.text==='Keep this newer Jordan message')).toBe(true);await page.reload();saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!));expect(saved.threads.jordan.some((m:any)=>m.text==='Keep this newer Jordan message')).toBe(true);
});
test('failed photo send retains the attachment tray and retry stores one photo',async({page})=>{
 await row(page,'Maya Chen').click();const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya.filter((m:any)=>m.photo===0).length);await page.getByRole('button',{name:'Attach',exact:true}).click();await page.evaluate(()=>{const set=Storage.prototype.setItem;(window as any).restore=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k==='alpha.dev.app.messages')throw Error('Full');return set.call(this,k,v);};});await page.getByRole('button',{name:'Send photo 1',exact:true}).click();await expect(page.getByRole('button',{name:'Send photo 1',exact:true})).toBeVisible();await page.evaluate(()=>(window as any).restore());await page.getByRole('button',{name:'Send photo 1',exact:true}).click();await expect(page.getByRole('button',{name:'Send photo 1',exact:true})).toHaveCount(0);await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya.filter((m:any)=>m.photo===0).length)).toBe(before+1);
});
test('undo preserves a newly created conversation with the same contact',async({page})=>{
 await remove(page,'Maya Chen');await page.getByRole('button',{name:'New message',exact:true}).click();await page.getByRole('button',{name:'Text Maya Chen',exact:true}).click();await send(page,'New conversation after deletion');await page.getByRole('button',{name:'Undo',exact:true}).click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya);expect(saved).toHaveLength(1);expect(saved[0].text).toBe('New conversation after deletion');await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya)).toEqual(saved);
});

test('failed conversation Undo retains retry and restores without replacing newer messages',async({page})=>{
 await remove(page,'Maya Chen');
 await page.evaluate(()=>{const set=Storage.prototype.setItem;(window as any).restoreUndo=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k==='alpha.dev.app.messages')throw Error('Full');return set.call(this,k,v);};});
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya)).toBeUndefined();
 await page.evaluate(()=>(window as any).restoreUndo());await row(page,'Jordan Park').click();await send(page,'Preserve after failed Undo');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.reload();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!));expect(saved.threads.maya.length).toBeGreaterThan(0);expect(saved.threads.jordan.some((m:any)=>m.text==='Preserve after failed Undo')).toBe(true);
});

test('failed swipe deletion returns the stored conversation onscreen for retry',async({page})=>{
 await row(page,'Maya Chen').click();await back(page);
 const before=await page.evaluate(()=>localStorage.getItem('alpha.dev.app.messages'));
 await page.evaluate(()=>{const set=Storage.prototype.setItem;(window as any).restoreDelete=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k==='alpha.dev.app.messages')throw Error('Full');return set.call(this,k,v);};});
 const box=await row(page,'Maya Chen').boundingBox();if(!box)throw Error('Missing thread');
 await page.mouse.move(box.x+box.width*.75,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.25,box.y+box.height/2,{steps:5});await page.mouse.up();
 await expect(page.getByText('Conversation could not be deleted. Try again.',{exact:true})).toBeVisible();
 await expect(row(page,'Maya Chen')).toBeInViewport();expect(await page.evaluate(()=>localStorage.getItem('alpha.dev.app.messages'))).toBe(before);
 await page.evaluate(()=>(window as any).restoreDelete());await remove(page,'Maya Chen');await page.reload();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.dev.app.messages')!).threads.maya)).toBeUndefined();
});


test('a fresh conversation tap is not swallowed by the previous swipe guard',async({page})=>{
 // Hold the guard clock inside its suppression window; a new pointerdown must release it.
 await page.evaluate(()=>{const now=Date.now();Date.now=()=>now;});
 await remove(page,'Maya Chen');
 await expect(field(page)).toHaveCount(0);
 await row(page,'Jordan Park').click();
 await expect(field(page)).toBeVisible();
});
