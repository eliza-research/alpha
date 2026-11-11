import {test,expect,type Page} from '@playwright/test';
import {openScanDraftOptions} from './scan-review-navigation';

// Actual Camera session, scanner, review and draft store. Only Android IPC is
// controlled. Chromium cannot prove that a CameraX surface is visible on a phone.
async function nativeCamera(page:Page){
 await page.addInitScript(()=>{
  const w=window as any;w.androidBridge={};localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=w.scanNative={calls:[] as any[],hold:false,release:undefined as (()=>void)|undefined,streams:0},store=new Map<string,string>();
  navigator.mediaDevices.getUserMedia=async()=>{f.streams++;throw Error('Android scan must use the bound native Camera');};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'ElizaCamera',methods:[...methods(['startPreview','stopPreview','capturePhoto','setCaptureMode','checkPermissions','checkCameraPermission']),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove'])},
   {name:'Agent',methods:methods(['getStatus','setGoogleAgentAccess'])},
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
   {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   {name:'DailyApps',methods:[...methods(['surfaceInfo']),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
  ],nativeCallback:()=> 'listener',nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='ElizaCamera'){
    f.calls.push({method,input});
    if(method==='checkPermissions'||method==='checkCameraPermission')return {camera:'granted'};
    if(method==='startPreview')return {width:1280,height:720,captureSize:{width:4000,height:3000},deviceId:'back',minZoom:1,maxZoom:1,hasFlash:false};
    if(method==='capturePhoto'){
     if(f.hold){f.hold=false;await new Promise<void>(resolve=>f.release=()=>{f.release=undefined;resolve();});}
     const canvas=document.createElement('canvas');canvas.width=input.width;canvas.height=input.height;const context=canvas.getContext('2d')!;
     context.fillStyle=['red','blue','green'][Math.min(2,f.calls.filter((call:any)=>call.method==='capturePhoto').length-1)];context.fillRect(0,0,canvas.width,canvas.height);
     return {base64:canvas.toDataURL('image/jpeg').split(',')[1],format:'jpeg',width:canvas.width,height:canvas.height};
    }
    return {};
   }
   if(plugin==='AlphaConnection'){
    if(method==='secureRead')return {value:store.get(input.slot)??null};
    if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
    if(method==='secureWrite')store.set(input.slot,input.value);return {};
   }
   if(plugin==='Agent')return {packaged:false,state:'unavailable'};
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
   if(plugin==='ElizaSystem')return {launcher:false,version:'fixture'};
   if(plugin==='DailyApps')return {launcher:false};
   throw Error('Unexpected native call '+plugin+'.'+method);
  }};
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect.poll(()=>page.locator('[data-alpha-camera="viewfinder"]').evaluate(element=>element.hasAttribute('data-alpha-camera-clear'))).toBe(true);
 await page.getByRole('button',{name:'Scan document',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Review scan document',exact:true})).toBeVisible();
}
const builder=(page:Page)=>page.getByRole('dialog',{name:'Review scan document',exact:true});
const camera=(page:Page)=>page.getByRole('dialog',{name:'Capture document page',exact:true});
async function capturePage(page:Page){
 await builder(page).getByRole('button',{name:'Capture new page',exact:true}).click();
 await expect(builder(page)).toBeHidden();await expect(camera(page)).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await camera(page).getByRole('button',{name:'Capture page',exact:true}).click();
 await expect(camera(page).getByRole('img',{name:'Review captured document page',exact:true})).toBeVisible();
 await camera(page).getByRole('button',{name:'Use captured page',exact:true}).click();
 await expect(builder(page)).toBeVisible();
}
test('native document entry captures, reviews, retakes and resumes without gallery or a second camera owner',async({page},info)=>{
 await nativeCamera(page);await capturePage(page);await capturePage(page);
 await expect(builder(page).getByRole('img')).toHaveCount(2);
 await builder(page).getByRole('button',{name:'Retake page 1',exact:true}).click();
 await camera(page).getByRole('button',{name:'Capture page',exact:true}).click();
 await expect(camera(page).getByRole('button',{name:'Use captured page',exact:true})).toBeEnabled();
 await camera(page).getByRole('button',{name:'Retake capture',exact:true}).click();
 await expect(camera(page).getByRole('button',{name:'Capture page',exact:true})).toBeEnabled();
 await camera(page).getByRole('button',{name:'Capture page',exact:true}).click();
 await camera(page).getByRole('button',{name:'Use captured page',exact:true}).click();
 await expect(builder(page).getByRole('img')).toHaveCount(2);
 const calls=await page.evaluate(()=>(window as any).scanNative.calls);
 expect(calls.filter((call:any)=>call.method==='startPreview')).toHaveLength(1);
 expect(calls.filter((call:any)=>call.method==='capturePhoto').map((call:any)=>call.input)).toEqual(Array(4).fill({format:'jpeg',quality:85,saveToGallery:false,width:2048,height:1536}));
 expect(await page.evaluate(()=>(window as any).scanNative.streams)).toBe(0);
 await page.screenshot({path:info.outputPath('native-contract-document.png')});
 await builder(page).getByRole('button',{name:'Close document',exact:true}).click();await builder(page).getByRole('button',{name:'Keep draft',exact:true}).click();
 await page.getByRole('button',{name:'Scan document',exact:true}).click();await openScanDraftOptions(page);
 await builder(page).getByRole('button',{name:'Load saved draft',exact:true}).click();
 await expect(builder(page).getByRole('img')).toHaveCount(2);
});
test('cancel and Camera leave drop delayed native pages and restore covered dialogs',async({page})=>{
 await nativeCamera(page);await page.evaluate(()=>(window as any).scanNative.hold=true);
 await builder(page).getByRole('button',{name:'Capture new page',exact:true}).click();await camera(page).getByRole('button',{name:'Capture page',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).scanNative.release)).toBe('function');
 await camera(page).getByRole('button',{name:'Cancel capture',exact:true}).click();await expect(builder(page)).toBeVisible();
 await page.evaluate(async()=>{(window as any).scanNative.release();await new Promise(resolve=>setTimeout(resolve,0));});
 await expect(builder(page).getByRole('img')).toHaveCount(0);
 await page.evaluate(()=>(window as any).scanNative.hold=true);
 await builder(page).getByRole('button',{name:'Capture new page',exact:true}).click();await camera(page).getByRole('button',{name:'Capture page',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).scanNative.release)).toBe('function');
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(()=>(window as any).scanNative.release());await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).scanNative.streams)).toBe(0);
});
