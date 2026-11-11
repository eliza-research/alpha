import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function openFiles(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
}
const filePreview=(page:Page)=>page.locator('[data-alpha-subview="files-preview"]');

test('Files renders real image, audio and video previews and retires playback on Back',async({page},info)=>{
 await openFiles(page);
 await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts'),files=registerPlugin<any>('AlphaFiles');
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
  const paint=canvas.getContext('2d')!;paint.fillStyle='#0055dd';paint.fillRect(0,0,96,64);
  const png=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
  const track=canvas.captureStream(12),recorder=new MediaRecorder(track,{mimeType:'video/webm'});
  const recording=new Promise<Blob>(resolve=>recorder.ondataavailable=event=>resolve(event.data));
  recorder.start();
  for(let index=0;index<4;index++){paint.fillStyle=index%2?'#ee0055':'#0055dd';paint.fillRect(0,0,96,64);await new Promise(resolve=>setTimeout(resolve,100));}
  recorder.stop();const video=await recording;track.getTracks().forEach(track=>track.stop());
  const bytes=new Uint8Array(44+8000),header=new DataView(bytes.buffer);
  const tag=(offset:number,text:string)=>bytes.set(new TextEncoder().encode(text),offset);
  tag(0,'RIFF');header.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');
  header.setUint32(16,16,true);header.setUint16(20,1,true);header.setUint16(22,1,true);
  header.setUint32(24,8000,true);header.setUint32(28,8000,true);header.setUint16(32,1,true);header.setUint16(34,8,true);
  tag(36,'data');header.setUint32(40,8000,true);bytes.fill(128,44);
  await files.importFile(new File([png],'fixture.png',{type:'image/png'}));
  await files.importFile(new File([bytes],'fixture.wav',{type:'audio/wav'}));
  await files.importFile(new File([video],'fixture.webm',{type:'video/webm'}));
 });
 const preview=filePreview(page);
 await page.getByRole('button',{name:'Open fixture.png',exact:true}).click();
 const image=preview.getByRole('img',{name:'fixture.png',exact:true});
 await expect.poll(()=>image.evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBe(96);
 await page.screenshot({path:info.outputPath('image-preview.png')});
 await preview.getByRole('button',{name:'Back',exact:true}).click();
 for(const [name,selector] of [['fixture.wav','audio'],['fixture.webm','video']] as const){
  await page.getByRole('button',{name:'Open '+name,exact:true}).click();
  const player=preview.locator(selector);
  await expect.poll(()=>player.evaluate((element:HTMLMediaElement)=>element.readyState)).toBeGreaterThan(0);
  expect(await player.evaluate((element:HTMLMediaElement)=>element.controls&&element.paused)).toBe(true);
  await player.evaluate(async(element:HTMLMediaElement)=>{(window as any).__previousFileMedia=element;element.muted=true;await element.play();});
  await preview.getByRole('button',{name:'Back',exact:true}).click();
  await expect(player).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__previousFileMedia.paused)).toBe(true);
 }
});

test('Files offers the exact Office file as a download when it cannot preview it',async({page})=>{
 await openFiles(page);
 await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File([new Uint8Array([80,75,3,4,0,31])],'fixture.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));});
 await page.getByRole('button',{name:'Open fixture.docx',exact:true}).click();
 const preview=filePreview(page);
 await expect(preview.getByRole('status')).toContainText(/preview|open|read/i);
 await expect(preview.getByText('Status',{exact:true})).toHaveCount(0);
 const downloading=page.waitForEvent('download');
 await preview.getByRole('button',{name:'Download file',exact:true}).click();
 const download=await downloading;
 expect(download.suggestedFilename()).toBe('fixture.docx');
 expect(Array.from(await readFile((await download.path())!))).toEqual([80,75,3,4,0,31]);
});
