import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
import {stubOcr} from './helpers/ocr-stub';

test('reviewed photo PDF downloads a real landscape page with an image and no hidden OCR text',async({page},info)=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {openScanReview}=await import('/src/prototype/scan-review.ts');const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,800);ctx.fillStyle='#111';ctx.font='64px Arial';ctx.fillText('Alpha scan export',70,170);ctx.fillText('Original page image',70,280);ctx.strokeStyle='#00f';ctx.lineWidth=6;ctx.strokeRect(50,50,1100,700);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/jpeg'));openScanReview(blob,async()=>true);
 });
 const dialog=page.getByRole('dialog',{name:'Review scanned text'});await expect(dialog.getByRole('img',{name:'Captured page for PDF export'})).toBeVisible();
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download photo PDF',exact:true}).click();const file=await download;const path=info.outputPath('scan.pdf');await file.saveAs(path);
 expect(file.suggestedFilename()).toMatch(/^Alpha scan .*\.pdf$/);await expect(dialog.getByRole('status',{name:'PDF export status'})).toHaveText('PDF download requested. Check your browser downloads.');await expect(dialog.getByRole('button',{name:'Download photo PDF',exact:true})).toBeDisabled();
 const bytes=await readFile(path);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);const p=pdf.getPage(0);expect(p.getWidth()).toBeCloseTo(841.89);expect(p.getHeight()).toBeCloseTo(595.28);const x=p.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict);expect(x.keys()).toHaveLength(1);
 await dialog.getByRole('textbox',{name:'Scanned text'}).fill('Changed OCR text');await page.screenshot({path:info.outputPath('review.png'),animations:'disabled'});
});

test('PDF conversion respects cancellation and rejects invalid input before export',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {createScanPdf}=await import('/src/prototype/scan-pdf.ts');const controller=new AbortController();controller.abort();const errors=[];
  for(const [blob,signal]of [[new Blob(['bad'],{type:'image/png'}),controller.signal],[new Blob(['bad'],{type:'text/plain'}),new AbortController().signal]] as const){try{await createScanPdf(blob,signal);errors.push('unexpected success');}catch(error){errors.push((error as Error).name);}}
  return errors;
 });expect(result).toEqual(['AbortError','Error']);
});

for(const [theme,width,height]of [['dark',360,740],['light',1440,500]] as const){
 test(`scan actions remain visible in ${theme} at ${width}x${height}`,async({page},info)=>{
  await page.setViewportSize({width,height});await stubOcr(page,'Scan preview');await page.goto('/?theme='+theme);
  await page.evaluate(async()=>{
   const {openScanReview}=await import('/src/prototype/scan-review.ts');const canvas=document.createElement('canvas');canvas.width=500;canvas.height=700;const context=canvas.getContext('2d')!;context.fillStyle='white';context.fillRect(0,0,500,700);context.fillStyle='black';context.font='40px Arial';context.fillText('Scan preview',20,80);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/jpeg'));openScanReview(blob,async()=>true);
  });
  const dialog=page.getByRole('dialog',{name:'Review scanned text'});await expect(dialog.getByRole('textbox')).toBeEnabled();
  const bounds=await dialog.boundingBox();expect(bounds).not.toBeNull();
  for(const name of ['Download photo PDF','Copy text','Save to Notes','Close scan']){const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeVisible();const box=await button.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);expect(box!.y+box!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);}
  await page.screenshot({path:info.outputPath('scan-layout.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Close scan',exact:true}).click();await expect(dialog).toHaveCount(0);
 });
}

test('portrait PDF retains portrait geometry and has no text resources',async({page})=>{
 await page.goto('/');const base64=await page.evaluate(async()=>{
  const {createScanPdf}=await import('/src/prototype/scan-pdf.ts');const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));const bytes=await createScanPdf(blob,new AbortController().signal);return btoa(String.fromCharCode(...bytes));
 });const pdf=await PDFDocument.load(Buffer.from(base64,'base64'));expect(pdf.getPageCount()).toBe(1);const pageOne=pdf.getPage(0);expect(pageOne.getWidth()).toBeCloseTo(595.28);expect(pageOne.getHeight()).toBeCloseTo(841.89);expect(pageOne.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).keys()).toHaveLength(0);
});
