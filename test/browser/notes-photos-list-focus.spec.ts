import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {captureInputs} from '../../specs/quint/refinement/check-traces.mjs';

const sources=['apps/app/src/prototype/keyed-list-focus.ts','apps/app/src/prototype/subview-accessibility.ts',
 'apps/app/src/prototype/dc-lite.js','apps/app/src/prototype/template.html','apps/app/src/prototype/model.js',
 'apps/app/src/prototype/agent-adapter.ts','apps/app/src/prototype/camera-adapter.ts',
 'apps/app/src/prototype/browser-camera.ts','apps/app/src/prototype/photo-library-adapter.ts',
 'apps/app/src/prototype/voice-adapter.ts','apps/app/src/runtime/browser-notes-document.ts',
 'apps/app/src/runtime/notes-store.ts','test/browser/notes-photos-list-focus.spec.ts'];
const note=(id:string,ts:number)=>({id,kind:'text',title:id,body:id+' body',ts});
async function shell(page:Page,operation:string,payload:any){
 return page.evaluate(async({operation,payload})=>{
  const screen=document.querySelector('[data-screen]') as any;
  const key=Object.keys(screen).find(name=>name.startsWith('__reactFiber$'))!;
  let fiber=screen[key];while(fiber&&!(fiber.stateNode&&typeof fiber.stateNode.vget==='function'))fiber=fiber.return;
  const app=fiber.stateNode;
  if(operation==='notes')return app.vset('notes',{list:payload});
  if(operation==='photos')return app.vset('photos',payload);
  if(operation==='refreshPhotos')return app.renderVals().photos.libraryRetry();
  return {notesOpen:app.vget('notes').open,photoOpen:app.vget('photos').open};
 },{operation,payload});
}
async function observe(page:Page,attribute:string,intended:string|null=null){
 return page.evaluate(({attribute,intended})=>{
  const elements=Array.from(document.querySelectorAll<HTMLElement>('['+attribute+']'));
  const active=document.activeElement as HTMLElement|null;
  const owner=(element:HTMLElement|undefined|null)=>element?.closest<HTMLElement>('[data-alpha-subview]')?.dataset.alphaSubview
   ||element?.closest<HTMLElement>('[data-alpha-app-scroll]')?.dataset.alphaAppScroll||null;
  const visible=(element:HTMLElement)=>!!element.getClientRects().length&&!element.closest('[inert],[hidden],[aria-hidden="true"]');
  const candidates=elements.filter(element=>element.getAttribute(attribute)===intended&&visible(element));
  return {
   rows:elements.map(row=>({id:row.getAttribute(attribute),label:row.getAttribute('aria-label'),owner:owner(row),visible:visible(row),parent:Array.from(row.parentElement?.parentElement?.children||[]).indexOf(row.parentElement!)})),
   currentRow:active?.getAttribute(attribute)||null,intendedRow:intended,
   owner:owner(candidates[0])||owner(active),activeView:document.documentElement.dataset.activeView||null,
   restorationCandidate:candidates.length===1?candidates[0].getAttribute(attribute):null,
   removed:!!intended&&!elements.some(element=>element.getAttribute(attribute)===intended),
   focusMovedToOtherControl:!!intended&&active!==document.body&&active?.getAttribute(attribute)!==intended,
   focusedControl:active?{tag:active.tagName,label:active.getAttribute('aria-label')}:null,
  };
 },{attribute,intended});
}
async function evidence(info:TestInfo,name:string,hashes:any,checkpoints:any[]){
 expect(captureInputs(sources)).toEqual(hashes);
 const path=info.outputPath(name+'.json');
 writeFileSync(path,JSON.stringify({scope:'bounded-browser-observations',sources:hashes,inputsUnchanged:true,checkpoints},null,2));
 await info.attach(name,{path,contentType:'application/json'});
}
async function openNotes(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-notes-storage-state','ready');
 await shell(page,'notes',[note('One',3),note('Two',2),note('Three',1)]);
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Two',exact:true})).toBeVisible();
}

test('a saved Notes insertion retains the focused note across columns and opens that note',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 await openNotes(page);const target=page.getByRole('button',{name:'Open Two',exact:true});await target.focus();
 const intended=(await observe(page,'data-alpha-note-id')).currentRow;
 checkpoints.push({label:'focus saved note',...await observe(page,'data-alpha-note-id',intended)});
 const before=await target.evaluate(element=>{(window as any).oldNote=element;return element.parentElement?.parentElement?.children[0]===element.parentElement;});
 expect(await shell(page,'notes',[note('Inserted',4),note('One',3),note('Two',2),note('Three',1)])).toBe(true);
 await expect(target).toBeFocused();
 expect(await target.evaluate(element=>element===(window as any).oldNote)).toBe(false);
 expect(await target.evaluate(element=>element.parentElement?.parentElement?.children[0]===element.parentElement)).toBe(!before);
 checkpoints.push({label:'commit insertion and cross-parent movement',...await observe(page,'data-alpha-note-id',intended)});
 await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Two');
 checkpoints.push({label:'activate retained note',...await observe(page,'data-alpha-note-id',intended),...await shell(page,'state',null)});
 await evidence(info,'notes-cross-parent-focus',hashes,checkpoints);
});

test('Notes removal and navigation do not transfer focus to a different note',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 await openNotes(page);await page.getByRole('button',{name:'Open Two',exact:true}).focus();
 const intended=(await observe(page,'data-alpha-note-id')).currentRow;
 checkpoints.push({label:'focus note before removal',...await observe(page,'data-alpha-note-id',intended)});
 await shell(page,'notes',[note('One',3),note('Three',1)]);
 await expect(page.getByRole('button',{name:'Open Two',exact:true})).toHaveCount(0);
 expect((await observe(page,'data-alpha-note-id')).currentRow).toBeNull();
 checkpoints.push({label:'remove focused note',...await observe(page,'data-alpha-note-id',intended)});
 await page.getByRole('button',{name:'Search notes',exact:true}).focus();
 await shell(page,'notes',[note('Inserted',4),note('One',3),note('Three',1)]);
 await expect(page.getByRole('button',{name:'Search notes',exact:true})).toBeFocused();
 checkpoints.push({label:'retain deliberate other-control focus',...await observe(page,'data-alpha-note-id',intended)});
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();
 await shell(page,'notes',[note('Later',5),note('Inserted',4),note('One',3),note('Three',1)]);
 expect((await observe(page,'data-alpha-note-id')).currentRow).toBeNull();
 checkpoints.push({label:'update inactive Notes collection',...await observe(page,'data-alpha-note-id',intended)});
 await evidence(info,'notes-focus-cancellation',hashes,checkpoints);
});

async function importPhoto(page:Page,name:string){
 return page.evaluate(async name=>{
  const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');
  const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
  canvas.getContext('2d')!.fillRect(0,0,24,24);
  return importBrowserPhoto({original:new File([],name,{type:'image/jpeg'}),image:canvas.toDataURL('image/jpeg'),width:24,height:24},new AbortController().signal);
 },name);
}

test('a real Photos readback retains focused captured-media identity after a new import',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');await importPhoto(page,'one.jpg');await importPhoto(page,'two.jpg');
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const cards=page.locator('[data-alpha-media-key^="capture:"]');await expect(cards).toHaveCount(2);
 const key=await cards.last().getAttribute('data-alpha-media-key');
 const target=page.locator('[data-alpha-media-key="'+key+'"]');await target.focus();
 await target.evaluate(element=>(window as any).oldPhoto=element);
 checkpoints.push({label:'focus imported photo',...await observe(page,'data-alpha-media-key',key)});
 await importPhoto(page,'three.jpg');await shell(page,'refreshPhotos',null);await expect(cards).toHaveCount(3);
 await expect(target).toBeFocused();expect(await target.evaluate(element=>element===(window as any).oldPhoto)).toBe(true);
 checkpoints.push({label:'read back added browser photo',...await observe(page,'data-alpha-media-key',key)});
 await page.keyboard.press('Enter');await expect(page.locator('[data-alpha-subview="photos-viewer"]:not([inert])')).toBeVisible();
 const state=await shell(page,'state',null);expect(state.photoOpen).toBe(key!.slice('capture:'.length));
 checkpoints.push({label:'open retained captured media',...await observe(page,'data-alpha-media-key',key),...state});
 await evidence(info,'photos-readback-focus',hashes,checkpoints);
});

test('Photos keeps logical focus when a fixture item moves to another date group',async({page},info)=>{
 const hashes=captureInputs(sources),checkpoints:any[]=[];
 await page.goto('/?mode=mock');
 const photo=(id:string,ts:number)=>({id,ts,kind:'photo',scene:'landscape'});
 const now=Date.now(),day=86400000;
 await shell(page,'photos',{list:[photo('one',now),photo('two',now-day)],open:null,album:null,tab:'lib'});
 await page.getByRole('button',{name:'Photos',exact:true}).click();
 const target=page.locator('[data-alpha-media-key="fixture:two"]');await expect(target).toBeVisible();await target.focus();
 await target.evaluate(element=>(window as any).oldPhoto=element);
 const intended=(await observe(page,'data-alpha-media-key')).currentRow;
 checkpoints.push({label:'focus fixture photo in older date group',...await observe(page,'data-alpha-media-key',intended)});
 await shell(page,'photos',{list:[photo('one',now),photo('two',now)]});
 await expect(target).toBeFocused();expect(await target.evaluate(element=>element===(window as any).oldPhoto)).toBe(false);
 checkpoints.push({label:'same item moves between date-group parents',...await observe(page,'data-alpha-media-key',intended)});
 await page.keyboard.press('Enter');expect((await shell(page,'state',null)).photoOpen).toBe('two');
 checkpoints.push({label:'open moved fixture item',...await observe(page,'data-alpha-media-key',intended),...await shell(page,'state',null)});
 await evidence(info,'photos-fixture-group-focus',hashes,checkpoints);
});
