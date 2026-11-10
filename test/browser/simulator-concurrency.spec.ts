import {test,expect,type Page} from '@playwright/test';
// Contacts is a native app in the current product. Exercise the retained development
// writer at its actual browser/Web Locks boundary, without resurrecting its demo UI.
const key='alpha.dev.app.contacts';
async function openWriter(page:Page){
 await page.route('**/__simulator-writer-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Development writer fixture</title>'}));
 await page.goto('/__simulator-writer-fixture');
 await page.evaluate(async key=>{const {SimulatorWriter}=await import('/src/browser/simulator-writer.ts');const snapshots=new Map([[key,localStorage.getItem(key)]]);(window as any).writerFixture={writer:new SimulatorWriter(snapshots),snapshots,key};},key);
}
const ready=(page:Page)=>expect.poll(()=>page.evaluate(()=>(window as any).writerFixture.writer.ready)).toBe(true);
async function save(page:Page,name:string){return page.evaluate(name=>{
 const f=(window as any).writerFixture,prior=JSON.parse(f.snapshots.get(f.key)||'{"list":[]}');
 try{f.writer.write(f.key,JSON.stringify({list:[...prior.list,{first:name}]}));return {accepted:true,error:''};}
 catch(error){return {accepted:false,error:(error as Error).message};}
},name);}
const names=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{"list":[]}').list.map((row:any)=>row.first),key);
test.beforeEach(async({page})=>{await openWriter(page);});
test('another development tab cannot replace the current writers saved contacts',async({page,context})=>{
 await ready(page);const other=await context.newPage();await openWriter(other);
 expect((await save(page,'First writer')).accepted).toBe(true);
 const refused=await save(other,'Second writer');expect(refused.accepted).toBe(false);expect(refused.error).toMatch(/Another development tab/);expect(await names(other)).toEqual(['First writer']);
 await page.close();await openWriter(other);await ready(other);expect((await save(other,'Second writer')).accepted).toBe(true);expect(await names(other)).toEqual(['First writer','Second writer']);
});
test('storage changed outside the writer lease is retained without replacement',async({page})=>{
 await ready(page);const replacement=JSON.stringify({list:[]});await page.evaluate(({key,replacement})=>localStorage.setItem(key,replacement),{key,replacement});
 const refused=await save(page,'Unsaved draft');expect(refused.accepted).toBe(false);expect(refused.error).toMatch(/Saved app data changed/);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(replacement);
});
test('unavailable Web Locks refuses persistence without writing a record',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));await openWriter(page);
 const refused=await save(page,'No lock');expect(refused.accepted).toBe(false);expect(refused.error).toMatch(/Safe development storage is unavailable/);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
});
test('page retirement revokes the old tab before a new writer can save',async({page,context})=>{
 await ready(page);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));const other=await context.newPage();await openWriter(other);await ready(other);
 expect((await save(other,'Current writer')).accepted).toBe(true);expect((await save(page,'Retired writer')).accepted).toBe(false);expect(await names(page)).toEqual(['Current writer']);
});
