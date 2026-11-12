/** Rendered UI/storage flow with a disclosed synthetic document boundary. */
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import path from 'node:path';
import {preloadPageModules} from '../test/browser/helpers/page-modules.ts';
import {selectLegacyNotes} from '../test/browser/helpers/legacy-notes.ts';
const require=createRequire(path.join(process.env.ALPHA_BROWSER_MODULES,'__notes.cjs')),{chromium}=require('playwright'),{expect}=require('@playwright/test');
const url=process.env.ALPHA_NOTES_TEST_URL||'http://127.0.0.1:5298';if(new URL(url).hostname!=='127.0.0.1')throw Error('Local Vite only');
const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:412,height:915}});await page.addInitScript(()=>{
  window.documentsFixture={status:'read',shares:[],imports:0};
  Object.defineProperty(document,'permissionsPolicy',{configurable:true,value:{allowsFeature:()=>true}});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.documentsFixture.shares.push({title:data.title,text:data.text});}});window.Capacitor={PluginHeaders:[{name:'AlphaNoteDocuments',methods:['importText'].map(name=>({name,rtype:'promise'}))}],nativePromise:async(plugin,method,input)=>{
   if(plugin!=='AlphaNoteDocuments')throw Error('Unexpected native call');
   if(method==='importText'){window.documentsFixture.imports++;return {status:window.documentsFixture.status,message:'Synthetic result',name:'Owned fixture.txt',text:'Exact 🧪 text\r\nline two\n'};}
   throw Error('Unexpected document method: '+method);
  }};
 });
 const openOlder=async()=>{
  await preloadPageModules(page,['/src/runtime/browser-notes-document.ts']);
  await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');if(!await m.browserNotesPort.read())await m.openBrowserNotes();});
  // Compatibility fixtures select only the retained, available source through its guarded selector.
  await selectLegacyNotes(page);
 };
 await page.goto(url);await openOlder();
 const count=()=>page.evaluate(async ()=>(JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records).length);const initial=await count();
 await page.getByRole('button',{name:'Import text note',exact:true}).click();
 // The editor can appear before the imported note's storage transaction finishes.
 await page.waitForFunction(async expected=>{
  const {readBrowserNotesRaw}=await import('/src/runtime/browser-notes-document.ts');
  return JSON.parse(await readBrowserNotesRaw()||'{"records":[]}').records.length===expected;
 },initial+1);
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Exact 🧪 text\nline two\n');
 await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('dialog',{name:'Note actions',exact:true}).getByRole('button',{name:'Share note',exact:true}).click();await page.waitForFunction(()=>window.documentsFixture.shares.length===1);assert.deepEqual(await page.evaluate(()=>window.documentsFixture.shares[0]),{title:'Owned fixture',text:'Owned fixture\n\nExact 🧪 text\r\nline two\n'});
 assert.equal(await page.getByRole('dialog',{name:'Share',exact:true}).count(),0);await expect(page.getByRole('dialog',{name:'Note actions',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Back to notes',exact:true}).click();await page.evaluate(()=>window.documentsFixture.status='cancelled');await page.getByRole('button',{name:'Import text note',exact:true}).click();await page.waitForFunction(()=>window.documentsFixture.imports===2);assert.equal(await count(),initial+1);
 await page.reload();await openOlder();await page.getByRole('button',{name:'Open Owned fixture',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Exact 🧪 text\nline two\n');
 console.log('PASS rendered import/create-new, exact native-share payload, import cancellation and reload; synthetic document and share boundaries only.');
}finally{await browser.close();}
