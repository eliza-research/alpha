import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;
  const paint=()=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,320,240);ctx.fillStyle='#00ff00';ctx.fillRect(80,0,80,240);ctx.fillStyle='#0000ff';ctx.fillRect(160,0,80,240);};paint();setInterval(paint,50);
  const streams=(window as any).controlStreams=[] as MediaStream[],original=HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream=function(rate){const stream=original.call(this,rate);streams.push(stream);return stream;};
  const devices=navigator.mediaDevices;devices.getUserMedia=async()=>canvas.captureStream(20);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
 });
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Camera',exact:true}).click();await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"] video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
});
test('dev screen lighting works without torch capability and never filters saved pixels',async({page},info)=>{
 await page.getByRole('button',{name:'Screen light off',exact:true}).click();await expect(page.getByRole('button',{name:'Screen light on',exact:true})).toBeVisible();await expect(page.locator('[data-alpha-camera-light="screen"]')).toHaveCount(1);await page.screenshot({path:info.outputPath('screen-light.png')});await page.getByRole('button',{name:'Take photo',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');return (await browserPhotoLibrary.list()).items.length;})).toBe(1);
 const result=await page.evaluate(async()=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const row=(await browserPhotoLibrary.list()).items[0],image=new Image();image.src=row.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return {pixel:Array.from(ctx.getImageData(20,120,1,1).data),filter:(document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement).style.filter};});expect(result.pixel[0]).toBeGreaterThan(230);expect(result.pixel[1]).toBeLessThan(20);expect(result.filter).toBe('');await page.getByRole('button',{name:'Screen light on',exact:true}).click();await expect(page.locator('[data-alpha-camera-light]')).toHaveCount(0);
});
test('screen light is removed on Home and camera replacement',async({page})=>{
 await page.getByRole('button',{name:'Screen light off',exact:true}).click();await page.getByRole('button',{name:'Switch camera',exact:true}).click();await expect(page.locator('[data-alpha-camera-light]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Screen light off',exact:true})).toBeVisible();await page.getByRole('button',{name:'Screen light off',exact:true}).click();await returnToApps(page);await expect(page.locator('[data-alpha-camera-light]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).controlStreams.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});
for(const event of ['pagehide','ended'])test(`screen light retires on ${event}`,async({page})=>{
 await page.getByRole('button',{name:'Screen light off',exact:true}).click();await expect(page.locator('[data-alpha-camera-light]')).toHaveCount(1);await page.evaluate(event=>{if(event==='pagehide')window.dispatchEvent(new Event('pagehide'));else{const video=document.querySelector('[data-alpha-camera="viewfinder"] video') as HTMLVideoElement;(video.srcObject as MediaStream).getVideoTracks()[0].dispatchEvent(new Event('ended'));}},event);await expect(page.locator('[data-alpha-camera-light]')).toHaveCount(0);
});
