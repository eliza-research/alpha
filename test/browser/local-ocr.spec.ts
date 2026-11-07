import {openLegacyNotes} from './helpers/legacy-notes';
import {returnToApps} from './app-navigation';
import {test,expect} from '@playwright/test';

test('real local OCR recognizes an image without remote model requests',async({page})=>{
  test.setTimeout(90000);
  const assets:string[]=[];const remote:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/ocr/'))assets.push(url.pathname);if(url.protocol.startsWith('http')&&url.hostname!=='127.0.0.1')remote.push(url.origin);});
  await page.addInitScript(()=>{
    // Firefox does not reliably expose classic-worker importScripts requests in
    // page request events. Observe the actual script imports inside this fixture.
    const NativeWorker=window.Worker;const imports:string[]=[];(window as any).ocrScriptImports=imports;
    window.Worker=class extends NativeWorker{
      readonly auditUrl:string;
      constructor(url:string|URL,options?:WorkerOptions){
        const absolute=new URL(String(url),location.href).href;
        const auditUrl=URL.createObjectURL(new Blob([`const originalImport=self.importScripts.bind(self);self.importScripts=(...urls)=>{self.postMessage({ocrScriptImport:urls.map(String)});return originalImport(...urls);};importScripts(${JSON.stringify(absolute)});`],{type:'text/javascript'}));
        super(auditUrl,options);this.auditUrl=auditUrl;
        this.addEventListener('message',event=>{if(Array.isArray(event.data?.ocrScriptImport))imports.push(...event.data.ocrScriptImport);});
      }
      terminate(){URL.revokeObjectURL(this.auditUrl);super.terminate();}
    };
  });
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {recognizeLocalText}=await import('/src/prototype/local-ocr.ts');
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=360;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1200,360);ctx.fillStyle='black';ctx.font='60px Arial';ctx.fillText('Alpha Phone local scan',50,100);ctx.fillText('Review text before saving.',50,210);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    return recognizeLocalText(blob,new AbortController().signal);
  });
  expect(result.text).toContain('Alpha Phone local scan');expect(result.text).toContain('Review text before saving.');
  for(const imported of await page.evaluate(()=>(window as any).ocrScriptImports as string[])){const url=new URL(imported);assets.push(url.pathname);if(url.hostname!=='127.0.0.1')remote.push(url.origin);}
  expect(assets).toContain('/ocr/worker.min.js');expect(assets).toContain('/ocr/eng.traineddata.gz');expect(assets.some(path=>path.includes('lstm.wasm.js'))).toBe(true);expect(remote).toEqual([]);
});

test('cancellation during model startup terminates the owned worker',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {recognizeLocalText}=await import('/src/prototype/local-ocr.ts');
    const Original=window.Worker;let terminated=0,created=0;
    window.Worker=class extends Original{constructor(...args:ConstructorParameters<typeof Worker>){super(...args);created++;}terminate(){terminated++;super.terminate();}};
    try{
      const cancel=new AbortController();const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));const job=recognizeLocalText(blob,cancel.signal);cancel.abort();
      let error='';try{await job;}catch(value){error=(value as Error).name;}
      return {error,created,terminated};
    }finally{window.Worker=Original;}
  });
  expect(result).toEqual({error:'AbortError',created:1,terminated:1});
});

test('Camera Scan reviews real OCR and commits only corrected text to durable Notes',async({page},info)=>{
  test.setTimeout(90000);
  await page.addInitScript(()=>{
    localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
    const mediaDevices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:mediaDevices});
    mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d')!;
      const draw=()=>{ctx.fillStyle='white';ctx.fillRect(0,0,1200,800);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText('Alpha local scan',70,180);ctx.fillText('Review before saving',70,300);};draw();
      const stream=canvas.captureStream(10);const timer=setInterval(draw,100);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
    };
  });
  await page.goto('/');await openLegacyNotes(page);await returnToApps(page);await page.getByRole('button',{name:'Camera',exact:true}).click();
  const video=page.locator('[aria-label^="Viewfinder."] video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button',{name:'Type',exact:true}).click();{const input=page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();await input.fill('Scan this');await input.press('Enter');}
  const dialog=page.getByRole('dialog',{name:'Review scanned text'});await expect(dialog).toBeVisible();
  const text=dialog.getByRole('textbox',{name:'Scanned text'});await expect(text).toHaveValue(/Alpha local scan/,{timeout:60000});
  expect(await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())||'{"records":[]}').records.filter((n:any)=>n.id.startsWith('scan-')).length)).toBe(0);
  await text.fill('Reviewed scan title\nCorrected by the user.');await dialog.getByRole('button',{name:'Save to Notes',exact:true}).click();await expect(dialog.getByRole('status',{name:'Scan status'})).toHaveText('Saved to Notes.');
  await page.screenshot({path:info.outputPath('scan-review.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Close scan',exact:true}).click();await page.reload();await openLegacyNotes(page);
  const saved=await page.evaluate(async ()=>JSON.parse((await (await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())!).records.filter((n:any)=>n.id.startsWith('scan-')));
  expect(saved).toHaveLength(1);expect(saved[0].body).toBe('Reviewed scan title\nCorrected by the user.');
});

test('an unconfirmed Notes save retains reviewed text and cannot duplicate the write',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openScanReview}=await import('/src/prototype/scan-review.ts');
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=200;const context=canvas.getContext('2d')!;context.fillStyle='white';context.fillRect(0,0,600,200);context.fillStyle='black';context.font='48px Arial';context.fillText('Retain this text',30,100);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));(window as any).scanWrites=0;
  openScanReview(blob,async()=>{(window as any).scanWrites++;return false;});
 });
 const dialog=page.getByRole('dialog',{name:'Review scanned text'});const field=dialog.getByRole('textbox',{name:'Scanned text'});await expect(field).toBeEnabled({timeout:60000});await field.fill('Keep my corrected draft');await dialog.getByRole('button',{name:'Save to Notes',exact:true}).click();
 await expect(dialog.getByRole('status',{name:'Scan status'})).toContainText('Save unconfirmed');await expect(field).toHaveValue('Keep my corrected draft');await expect(dialog.getByRole('button',{name:'Save unconfirmed',exact:true})).toBeDisabled();expect(await page.evaluate(()=>(window as any).scanWrites)).toBe(1);
});

test('closing Scan during model load terminates the worker without late reopening',async({page})=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/ocr/eng.traineddata.gz',async route=>{await held;await route.abort();});
 const modelRequest=page.waitForRequest('**/ocr/eng.traineddata.gz');
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openScanReview}=await import('/src/prototype/scan-review.ts');const Original=window.Worker;(window as any).scanTerminated=0;
  window.Worker=class extends Original{terminate(){(window as any).scanTerminated++;super.terminate();}};
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!)));
  openScanReview(blob,async()=>{throw Error('No save expected');});
 });
 await modelRequest;await page.getByRole('dialog').getByRole('button',{name:'Cancel scan',exact:true}).click();release();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).scanTerminated)).toBe(1);
});
