/** Rendered UI/storage flow with a disclosed synthetic document boundary. */
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(path.join(process.env.ALPHA_BROWSER_MODULES,'__notes.cjs')),{chromium}=require('playwright');
const url=process.env.ALPHA_NOTES_TEST_URL||'http://127.0.0.1:5298';if(new URL(url).hostname!=='127.0.0.1')throw Error('Local Vite only');
const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:412,height:915}});await page.addInitScript(()=>{
  window.documentsFixture={status:'read',exports:[],imports:0};window.Capacitor={PluginHeaders:[{name:'AlphaNoteDocuments',methods:['importText','exportText'].map(name=>({name,rtype:'promise'}))}],nativePromise:async(plugin,method,input)=>{
   if(plugin!=='AlphaNoteDocuments')throw Error('Unexpected native call');
   if(method==='importText'){window.documentsFixture.imports++;return {status:window.documentsFixture.status,message:'Synthetic result',name:'Owned fixture.txt',text:'Exact 🧪 text\r\nline two\n'};}
   window.documentsFixture.exports.push(input);return {status:'exported',message:'Export saved and exact bytes verified.'};
  }};
 });
 const openOlder=async()=>{
  await page.evaluate(async()=>{const m=await import('/src/runtime/browser-notes-document.ts');if(!await m.browserNotesPort.read())await m.openBrowserNotes();});
  // Unconnected agent Notes offers the retained source as a direct "Previous notes" control
  // below Alpha's Notes list (canonical-notes-ui.ts).
  await page.getByRole('button',{name:'Notes',exact:true}).click();await page.getByRole('region',{name:'Notes',exact:true}).getByRole('button',{name:'Previous notes',exact:true}).click();await page.getByRole('heading',{name:'Older notes',exact:true}).waitFor();
 };
 await page.goto(url);await openOlder();
 const count=()=>page.evaluate(async ()=>(JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records).length);const initial=await count();
 await page.getByRole('button',{name:'Import text note',exact:true}).click();await page.getByRole('textbox',{name:'Note',exact:true}).waitFor();assert.equal(await count(),initial+1);assert.equal(await page.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Exact 🧪 text\nline two\n');
 await page.getByRole('button',{name:'Share note',exact:true}).click();await page.getByRole('button',{name:'Save locally',exact:true}).click();await page.waitForFunction(()=>window.documentsFixture.exports.length===1);assert.deepEqual(await page.evaluate(()=>window.documentsFixture.exports[0]),{title:'Owned fixture',text:'Owned fixture\n\nExact 🧪 text\r\nline two\n'});
 assert.equal(await page.getByRole('dialog',{name:'Share',exact:true}).count(),0);await page.getByRole('button',{name:'Back to notes',exact:true}).click();await page.evaluate(()=>window.documentsFixture.status='cancelled');await page.getByRole('button',{name:'Import text note',exact:true}).click();await page.waitForFunction(()=>window.documentsFixture.imports===2);assert.equal(await count(),initial+1);
 await page.reload();await openOlder();await page.getByRole('button',{name:'Open Owned fixture',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Exact 🧪 text\nline two\n');
 console.log('PASS rendered import/create-new, exact snapshot export, cancellation and reload; synthetic document boundary only.');
}finally{await browser.close();}
