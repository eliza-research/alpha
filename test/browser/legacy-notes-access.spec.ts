import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';

const note={id:'current-note',title:'Current note',body:'\nCurrent collection',color:'yellow',createdAt:'2026-11-08T10:00:00.000Z',updatedAt:'2026-11-08T10:00:00.000Z'};

test('retained previous notes have a visible route and return to the current collection',async({page})=>{
 const fixture=await canonicalNotesFixture(page,{notes:[note]});
 await page.evaluate(async()=>{
  const {openBrowserNotes}=await import('/src/runtime/browser-notes-document.ts');
  const store=await openBrowserNotes();
  await store.replace([{id:'retained-note',kind:'text',title:'Retained note',body:'Previously saved text'}]);
 });
 await openCanonicalNotes(page);
 await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await page.getByRole('button',{name:'On this phone',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Previous notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open Retained note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Previously saved text');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:'Return to Notes',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Open Current note',exact:true})).toBeVisible();
 expect(fixture.foreign).toEqual([]);expect(fixture.errors).toEqual([]);
});

test('a fresh collection keeps previous notes absent without initializing legacy storage',async({page})=>{
 await canonicalNotesFixture(page,{notes:[note]});
 await page.evaluate(async()=>{
  const {browserNotesPort}=await import('/src/runtime/browser-notes-document.ts');
  const read=browserNotesPort.read;
  (window as any).previousNotesReads=0;
  browserNotesPort.read=async signal=>{const saved=await read(signal);(window as any).previousNotesReads++;return saved;};
 });
 await openCanonicalNotes(page);
 await expect.poll(()=>page.evaluate(()=>(window as any).previousNotesReads)).toBe(1);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await expect(page.getByRole('button',{name:'On this phone',exact:true})).toHaveCount(0);
 expect(await page.evaluate(async()=>(await import('/src/runtime/browser-notes-document.ts')).browserNotesPort.read())).toBeNull();
});

test('an unreadable previous collection offers recovery without initializing or clearing it',async({page})=>{
 await canonicalNotesFixture(page,{notes:[note]});
 await page.evaluate(async()=>{
  const {browserNotesPort}=await import('/src/runtime/browser-notes-document.ts');
  browserNotesPort.read=async()=>{throw Error('Closed fixture cannot read retained Notes');};
 });
 await openCanonicalNotes(page);
 await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await page.getByRole('button',{name:'On this phone',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Previous notes',exact:true})).toBeVisible();
 await expect(page.getByText('Previous notes need a recovery review. Nothing was moved or changed.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Recover browser Notes',exact:true})).toBeVisible();
});

test('a delayed old-owner storage read cannot expose a recovery entry to the next owner',async({page})=>{
 await canonicalNotesFixture(page,{notes:[note]});
 await page.evaluate(async()=>{
  const {browserNotesPort}=await import('/src/runtime/browser-notes-document.ts');
  (window as any).heldNotesReads=[];
  browserNotesPort.read=async()=>{const saved=await new Promise<any>(resolve=>(window as any).heldNotesReads.push(resolve));(window as any).finishedNotesReads=((window as any).finishedNotesReads??0)+1;return saved;};
 });
 await openCanonicalNotes(page);
 await expect.poll(()=>page.evaluate(()=>(window as any).heldNotesReads.length)).toBe(1);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const original=c.getAppRecordClient;
  c.getAppRecordClient=()=>{const port=original()!;return {...port,sessionId:'next-owner-session',identity:{...port.identity,ownerId:'next-owner',sessionId:'next-owner-session'}};};
  await c.offline();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).heldNotesReads.length)).toBe(2);
 await page.evaluate(()=>{
  (window as any).heldNotesReads[1](null);
  (window as any).heldNotesReads[0]({revision:'old-owner',raw:'retained old-owner bytes'});
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).finishedNotesReads)).toBe(2);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.getByRole('button',{name:'Notes options',exact:true}).click();
 await expect(page.getByRole('button',{name:'On this phone',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open Current note',exact:true})).toBeVisible();
});
