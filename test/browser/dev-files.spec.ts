import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('file mutations serialize races and invalidate old selections without partial folder imports',async({page})=>{
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');const selected=await files.importFile(new File(['original'],'race.txt',{type:'text/plain'}));const row=(await files.list({})).entries[0];const attempts=await Promise.allSettled([files.rename({id:row.id,expectedRevision:row.revision,name:'winner-a.txt'}),files.rename({id:row.id,expectedRevision:row.revision,name:'winner-b.txt'})]);let stale=false;try{await files.readSelected(selected);}catch{stale=true;}let duplicate=false;try{await files.importDirectory([{path:'same.txt',file:new File(['a'],'a')},{path:'same.txt',file:new File(['b'],'b')}],'No partial folder');}catch{duplicate=true;}const folder=await files.importDirectory([{path:'nested/one.txt',file:new File(['one'],'one.txt',{type:'text/plain'})}],'Imported');const nested=await files.list({id:folder.entries[0].id});const entry=nested.entries[0];const text=await files.readSelected(await files.select({id:entry.id}));const binary=await files.readSelected(await files.importFile(new File([new Uint8Array([0,255,1])],'binary.bin',{type:'application/octet-stream'})));return {successes:attempts.filter(r=>r.status==='fulfilled').length,stale,duplicate,names:(await files.list({})).entries.map((e:any)=>e.name),text:text.text,binary:binary.status};});
 expect(result.successes).toBe(1);expect(result.stale).toBe(true);expect(result.duplicate).toBe(true);expect(result.names).not.toContain('No partial folder');expect(result.text).toBe('one');expect(result.binary).toBe('binary');
 await page.reload();expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').list({})).entries.some((e:any)=>e.name==='Imported');})).toBe(true);
});
test('PDF selection renders actual pages and releases previews',async({page})=>{
 await page.goto('/?mode=dev');
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length 43 >>\nstream\nBT /F1 16 Tf 20 100 Td (Browser PDF) Tj ET\nendstream'];let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=pdf.length;pdf+='xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;const selected=await files.importFile(new File([pdf],'pages.pdf',{type:'application/pdf'}));const first=await files.pdfSelected({...selected,page:0});const blob=await (await fetch(first.imageUri)).blob(),bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);const ink=Array.from(context.getImageData(0,0,canvas.width,canvas.height).data).filter((value,index)=>index%4!==3&&value<128).length>100;const second=await files.pdfSelected({...selected,page:1});let released=false;try{await fetch(first.imageUri);}catch{released=true;}await files.forgetSelected(selected);let forgotten=false;try{await files.pdfSelected({...selected,page:0});}catch{forgotten=true;}return {text:first.text,status:first.status,count:first.pageCount,width:bitmap.width,height:bitmap.height,page:second.page,ink,released,forgotten};});
 expect(result).toEqual({text:'Browser PDF',status:'rendered',count:2,width:400,height:600,page:1,ink:true,released:true,forgotten:true});
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await page.getByRole('button',{name:'Open pages.pdf',exact:true}).click();await expect(page.getByRole('img',{name:'Page 1 of 2',exact:true})).toBeVisible();await page.getByRole('button',{name:'Next PDF page',exact:true}).click();await expect(page.getByRole('img',{name:'Page 2 of 2',exact:true})).toBeVisible();await page.getByRole('button',{name:'Ask Alpha',exact:true}).click();const question=page.getByRole('dialog',{name:'Ask about selected content'});await expect(question.getByRole('heading')).toHaveText('Ask Alpha');await expect(question.getByLabel('Selected source',{exact:true})).toHaveText('pages.pdf · page 2');await expect(question.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Browser PDF');await expect(question.getByRole('img',{name:'Image for question review'})).toBeVisible();await expect(question.getByRole('button',{name:'Extract text locally',exact:true})).toBeEnabled();await question.getByRole('button',{name:'Cancel',exact:true}).click();await page.screenshot({path:'test-results/dev-parity-ui/pdf.png'});
});
test('Files renderer confirms folder creation and closes its mutation dialog',async({page})=>{
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Files options',exact:true}).click();await page.getByRole('button',{name:'New folder',exact:true}).click();
 await page.getByRole('textbox',{name:'Name'}).fill('UI folder');await page.getByRole('button',{name:'Create',exact:true}).click();await expect(page.getByRole('button',{name:'Open UI folder',exact:true})).toBeVisible();
});
test('Files explains empty folders, categories and Trash in the mounted list',async({page})=>{
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  await registerPlugin<any>('AlphaFiles').storageCreateFolder({parent:'',name:'Empty folder'});
 });
 await page.getByRole('button',{name:'Files',exact:true}).click();
 const detail=page.locator('[data-alpha-subview="files-folder"]');
 const empty=detail.getByRole('status').filter({hasText:'No files here'});
 const back=detail.getByRole('button',{name:'Back',exact:true});
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Open Empty folder',exact:true}).click();
 await expect(empty).toBeVisible();
 await back.click();
 await back.click();
 for(const name of ['Documents','Trash']){
  await page.getByRole('button',{name,exact:true}).click();
  await expect(detail.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(empty).toBeVisible();
  await back.click();
 }
});
test('mail attachment bridge preserves exact bytes and validates reviewed hashes',async({page})=>{
 const attachment=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles'),mail=registerPlugin<any>('AlphaMailAttachments');const selection=await files.importFile(new File(['Café\r\nExact bytes'],'letter.txt',{type:'text/plain'}));const result=await mail.readSelected(selection);let rejected=false;try{await mail.openReviewed({...result,reviewed:true,sha256:'0'.repeat(64)});}catch{rejected=true;}await mail.openReviewed({...result,reviewed:true});return {...result,rejected};});
 expect(attachment.rejected).toBe(true);expect(Buffer.from(attachment.dataBase64,'base64').toString('utf8')).toBe('Café\r\nExact bytes');const dialog=page.getByRole('dialog',{name:'Reviewed attachment'});await expect(dialog.getByText('Café Exact bytes')).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(dialog).toHaveCount(0);
});
test('opening imported HTML cannot execute against the app origin',async({page})=>{
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');const selection=await files.importFile(new File(['<h1>Imported document</h1><script>localStorage.setItem("untrusted-file-ran","yes");parent.document.body.innerHTML="changed";</script>'],'document.html',{type:'text/html'}));await files.openSelected(selection);});
 const dialog=page.getByRole('dialog',{name:'Selected document'});await expect(dialog.locator('iframe')).toHaveAttribute('sandbox','');await expect(dialog.frameLocator('iframe').getByRole('heading',{name:'Imported document'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('untrusted-file-ran'))).toBeNull();await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(dialog).toHaveCount(0);
});
const importAndOpen=async(page:import('@playwright/test').Page,name:string,content:string)=>{
 await page.evaluate(async([name,content])=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File([content],name,{type:'text/plain'}));},[name,content]);
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await page.getByRole('button',{name:'Open '+name,exact:true}).click();
};
const recentNames=(page:import('@playwright/test').Page)=>page.evaluate(()=>(JSON.parse(localStorage.getItem('alpha.files.recent.v1')||'[]') as {name:string}[]).map(row=>row.name));
for(const [label,name,content,excerpt] of [['a UTF-8 BOM text file','bom.txt','\uFEFFByte order mark',undefined],['a long text file within the preview bound','long-preview.txt','x'.repeat(1_500_000),'The long log']] as const)
 test(`Ask Alpha links the source of ${label}`,async({page})=>{
  await observeFileQuestionEffects(page);await importAndOpen(page,name,content);await page.getByRole('button',{name:'Ask Alpha',exact:true}).click();
  const question=page.getByRole('dialog',{name:'Ask about selected content'});if(excerpt)await question.getByRole('textbox',{name:'Content excerpt'}).fill(excerpt);
  await expect(question.getByRole('checkbox')).toBeChecked();await question.getByRole('button',{name:'Use in conversation'}).click();
  await expect(question).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue(new RegExp('Source: '+name));
  const retained=await page.evaluate(()=>{
   const screen=document.querySelector('[data-screen]') as any,key=Object.keys(screen).find(key=>key.startsWith('__reactFiber$'))!;let fiber=screen[key];
   while(fiber&&!(fiber.stateNode&&typeof fiber.stateNode.api==='function'&&typeof fiber.stateNode.S==='function'))fiber=fiber.return;
   if(!fiber)throw Error('Mounted shell unavailable');return structuredClone(fiber.stateNode.reviewedSourceDraft);
  });
  expect(retained.source).toEqual({version:1,name,mimeType:'text/plain',size:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex'),reference:expect.stringMatching(/^b1:[a-f0-9-]{36}$/)});
  expect(JSON.stringify(retained.source).length).toBeLessThan(512);expect(retained.source).not.toHaveProperty('dataBase64');expect(retained.source).not.toHaveProperty('text');
  expect(retained.draft.length).toBeLessThan(512);if(excerpt)expect(retained.draft).toContain(excerpt);
  expect(await fileQuestionEffects(page)).toEqual({reads:2,retains:1,sends:0});
 });
// Observe the actual source boundary, without replacing its result or the send behavior.
async function observeFileQuestionEffects(page:import('@playwright/test').Page){
 await page.evaluate(async()=>{
  const effects={reads:0,retains:0,sends:0};(window as any).fileQuestionEffects=effects;
  const {BrowserMailAttachments}=await import('/src/browser/mail-attachments.ts');
  const read=BrowserMailAttachments.prototype.readSelected,retain=BrowserMailAttachments.prototype.retainSourceReference;
  BrowserMailAttachments.prototype.readSelected=function(input){effects.reads++;return read.call(this,input);};
  BrowserMailAttachments.prototype.retainSourceReference=function(input){effects.retains++;return retain.call(this,input);};
  const {alphaClient}=await import('/src/runtime/alpha-client.ts');const send=alphaClient.send;
  (alphaClient as any).send=function(...args:any[]){effects.sends++;return (send as any).apply(this,args);};
 });
}
const fileQuestionEffects=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).fileQuestionEffects);
for(const [name,bytes] of [['long.txt',2_500_000],['huge.txt',6*1024*1024]] as const)
 test(`selected text without a content preview offers no question or source effects: ${name}`,async({page})=>{
  await observeFileQuestionEffects(page);await importAndOpen(page,name,'x'.repeat(bytes));
  await expect(page.getByRole('status').filter({hasText:'Open or download this file to read it.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Ask Alpha',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Ask about selected content'})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveCount(0);
  expect(await fileQuestionEffects(page)).toEqual({reads:0,retains:0,sends:0});
  expect(await recentNames(page)).toEqual([]);
  expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').list({})).entries.map((row:any)=>({name:row.name,size:row.size}));})).toEqual([{name,size:bytes}]);
 });
test('Ask Alpha says a file over 5 MiB is too large to link',async({page})=>{
 // A real image remains reviewable under #927. Its actual bytes exceed the separate source-link
 // limit, so the original refusal/unlink UI path is exercised without inventing a text preview.
 await observeFileQuestionEffects(page);
 const bytes=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1536;const context=canvas.getContext('2d')!,image=context.createImageData(1536,1536);let random=0x12345678;
  for(let i=0;i<image.data.length;i+=4){random^=random<<13;random^=random>>>17;random^=random<<5;image.data[i]=random&255;image.data[i+1]=(random>>>8)&255;image.data[i+2]=(random>>>16)&255;image.data[i+3]=255;}
  context.putImageData(image,0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed')),'image/png'));
  const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File([blob],'oversized.png',{type:'image/png'}));return blob.size;
 });
 expect(bytes).toBeGreaterThan(5*1024*1024);
 await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await page.getByRole('button',{name:'Open oversized.png',exact:true}).click();
 await page.getByRole('button',{name:'Ask Alpha',exact:true}).click();
 const question=page.getByRole('dialog',{name:'Ask about selected content'}),image=question.getByRole('img',{name:'Image for question review'});
 await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth===1536&&element.naturalHeight===1536)).toBe(true);
 await question.getByRole('textbox',{name:'Content excerpt'}).fill('The large image');await question.getByRole('button',{name:'Use in conversation'}).click();
 await expect(question.getByRole('status')).toHaveText('This file is too large to link as a source. Turn off the source link to ask without one.');
 expect(await fileQuestionEffects(page)).toEqual({reads:1,retains:0,sends:0});
 await question.getByRole('checkbox').uncheck();await question.getByRole('button',{name:'Use in conversation'}).click();await expect(question).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('What does this mean?\n\nSource: oversized.png\n\nThe large image');
 expect(await fileQuestionEffects(page)).toEqual({reads:1,retains:0,sends:0});
});
test('renaming a browsed file preserves bytes and does not create an obsolete Recent grant',async({page})=>{
 await importAndOpen(page,'report.txt','Quarterly');expect(await recentNames(page)).toEqual([]);
 const selected=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaFiles').storageSelect({path:'report.txt'});});
 await page.getByRole('button',{name:'Rename',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Rename',exact:true});await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('q3.txt');await dialog.getByRole('button',{name:'Rename',exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Open q3.txt',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open report.txt',exact:true})).toHaveCount(0);
 expect(await page.evaluate(async selected=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');let stale=false;try{await files.readSelected(selected);}catch{stale=true;}return {stale,text:(await files.readSelected(await files.storageSelect({path:'q3.txt'}))).text};},selected)).toEqual({stale:true,text:'Quarterly'});
 expect(await recentNames(page)).toEqual([]);await page.reload();await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Internal storage',exact:true}).click();await expect(page.getByRole('button',{name:'Open q3.txt',exact:true})).toBeVisible();
});
test('a failed browsed-file rename preserves the file and an explicit retry saves once',async({page})=>{
 await importAndOpen(page,'report.txt','Quarterly');
 await page.evaluate(async()=>{const {BrowserFiles}=await import('/src/browser/files.ts');const rename=BrowserFiles.prototype.storageRename;(window as any).restoreStorageRename=()=>{BrowserFiles.prototype.storageRename=rename;};BrowserFiles.prototype.storageRename=async()=>{throw Error('Storage unavailable');};});
 await page.getByRole('button',{name:'Rename',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Rename',exact:true});await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('q3.txt');await dialog.getByRole('button',{name:'Rename',exact:true}).click();
 await expect(dialog.getByText('The operation could not be confirmed.',{exact:true})).toBeVisible();await expect(dialog).toBeVisible();
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const files=registerPlugin<any>('AlphaFiles');return {names:(await files.storageList({path:''})).entries.map((row:any)=>row.name),text:(await files.readSelected(await files.storageSelect({path:'report.txt'}))).text};})).toEqual({names:['report.txt'],text:'Quarterly'});
 await page.evaluate(()=>(window as any).restoreStorageRename());await dialog.getByRole('button',{name:'Rename',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Open q3.txt',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');return (await registerPlugin<any>('AlphaFiles').storageList({path:''})).entries.map((row:any)=>row.name);})).toEqual(['q3.txt']);
});
