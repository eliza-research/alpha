import {expect,test,type Page} from '@playwright/test';
/** Seed only the isolated test's retained legacy document before explicitly opening Older notes.
 * Production source selection never initializes or migrates a missing legacy document. */
export async function openLegacyNotes(page:Page){
 if(test.info().project.name==='production')await seedRetainedNotes(page);
 else await page.evaluate(async()=>{
  const m=await import('/src/runtime/browser-notes-document.ts');
  if(!await m.browserNotesPort.read())await m.openBrowserNotes();
 });
 await selectLegacyNotes(page);
 await expect(page.getByRole('heading',{name:'Older notes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();
 await expect(page.getByText('Previous notes need a recovery review. Nothing was moved or changed.',{exact:true})).toHaveCount(0);
}

/** Navigate only; leave raw-store setup and recovery assertions to the caller. */
export async function selectLegacyNotes(page:Page){
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 // The source choice is only counted once the Notes view is active, not on the home screen.
 await expect(page.locator('html')).toHaveAttribute('data-active-view','notes');
 const older=page.getByRole('button',{name:/^(Older|Previous) notes$/});
 if(await older.count())await older.click();
}

/** Retained attachment metadata only; no file picker, file contents, or real user store. */
export async function openLegacyAttachment(page:Page){
 if(test.info().project.name==='production')await seedRetainedNotes(page,[{id:'retained-attachment',kind:'text',title:'Retained attachment',body:'Synthetic summary.',documentSource:{version:1,name:'fixture.txt',mimeType:'text/plain',sha256:'a'.repeat(64),size:1}}]);
 else await page.evaluate(async()=>{
  const store=await(await import('/src/runtime/browser-notes-document.ts')).openBrowserNotes();
  await store.replace([{id:'retained-attachment',kind:'text',title:'Retained attachment',body:'Synthetic summary.',documentSource:{version:1,name:'fixture.txt',mimeType:'text/plain',sha256:'a'.repeat(64),size:1}}]);
 });
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'Open Retained attachment',exact:true}).click();
 await page.getByRole('button',{name:'Attachment',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Note source document',exact:true})).toBeVisible();
}

/** Seed the isolated browser context through its persisted wire format, never source imports
 * or a production-only testing hook. Existing documents are left untouched. */
async function seedRetainedNotes(page:Page,records:Record<string,unknown>[]=[]){
 await page.evaluate(async(records)=>{
  const keys=['alphaphone:prototype:notes:v1','alphaphone:notes:v2','alphaphone:daily:v1'];
  if(keys.some(key=>localStorage.getItem(key)!==null))throw Error('Retained Notes fixture requires an empty isolated legacy store');
  await new Promise<void>((resolve,reject)=>{
   const request=indexedDB.open('alpha.browser.documents.v1',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('documents');
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents');
    tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
    const read=store.get('alpha.browser.notes.v1');
    read.onsuccess=()=>{if(read.result!==undefined)return;
     const currentRaw=JSON.stringify({version:2,collectionId:crypto.randomUUID(),records,deleted:[]});
     store.put({revision:crypto.randomUUID(),raw:JSON.stringify({version:1,archive:{v1:null,v2:null,daily:null},currentRaw})},'alpha.browser.notes.v1');
    };
   };
  });
 },records);
}
