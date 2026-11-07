import {flagOffAndroid,completeAccessSetup} from '../flag-off-android';
import {type Page} from '@playwright/test';
// Renderer contract only. The synthetic bridge does not qualify Android permissions or MediaStore.
export async function photosBridge(page:Page,scope='full',openPhotos=true,authenticated=false){
 if(authenticated)await flagOffAndroid(page);
 await page.addInitScript(scope=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any,previous=w.Capacitor;w.androidBridge={};const calls:any[]=[];const listeners:Record<string,()=>void>={};
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const row={id:'m:external_primary:i:91',name:'Synthetic beach.jpg',kind:'image',image,width:100,height:80,date:Date.now(),revision:'provider:1:100:2:1:2',mutationRevision:'provider:1:100:2:1:2',favorite:true,owned:false};
  const state=w.mediaFixture={scope,calls,emit:()=>listeners['AlphaPhotos:libraryChanged']?.(),row};
  const access=()=>({scope:state.scope,images:state.scope==='partial'?'full':state.scope,videos:state.scope==='partial'?'denied':state.scope});
  const plugins:Record<string,string[]>={AlphaMailAttachments:['readPhotoSelected','cancelPhotoSelected'],AlphaPhotos:['libraryAccess','requestLibraryAccess','openLibrarySettings','listPermitted','list','summary','albums','read','beginVideoEdit','saveVideoEdit','cancelVideoEdit','editResult','watchLibrary'],ElizaSystem:['getBuildInfo','getLaunchInfo','getLocaleInfo','listLauncherApps','resolveDefaultApp'],DailyApps:['surfaceInfo','listReminders','pendingReminderTap'],AlphaNotifications:['status','list'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={Plugins:{},PluginHeaders:[...(previous?.PluginHeaders||[]).filter((p:any)=>!(p.name in plugins)),...Object.entries(plugins).map(([name,methods])=>({name,methods:[...methods,'addListener','removeListener'].map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))}))],
   nativeCallback:(plugin:string,method:string,input:any,callback:()=>void)=>{if(!(plugin in plugins)&&previous?.nativeCallback)return previous.nativeCallback(plugin,method,input,callback);if(method==='addListener')listeners[plugin+':'+input.eventName]=callback;return plugin+':'+input.eventName;},
   nativePromise:async(plugin:string,method:string,input:any)=>{
    calls.push({plugin,method,input});
    if(plugin==='AlphaMailAttachments'){
     if(method==='cancelPhotoSelected')return {};
     if(state.scope==='denied'||input.revision!==row.mutationRevision)throw Error('Photo unavailable');
     const source='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=';
     const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
     return {name:'source.png',mimeType:'image/png',size:bytes.length,sha256:hash,dataBase64:source};
    }
    if(plugin==='AlphaPhotos'){
     if(method==='libraryAccess')return access();
     if(method==='requestLibraryAccess'){state.scope='full';return access();}
     if(method==='listPermitted')return {items:state.scope==='denied'||input?.query&&!row.name.toLowerCase().includes(input.query.toLowerCase())?[]:[row],next:'',access:access()};
     if(method==='list')return {items:state.scope==='denied'||input?.trashed?[]:[row],next:''};
     if(method==='summary')return {favorites:state.scope==='denied'?0:1,videos:0,trash:0,canFavorite:true};
     if(method==='albums')return {items:[]};if(method==='read')return row;
    }
    if(plugin==='ElizaSystem')return method==='getBuildInfo'?{launcher:false}:method==='getLaunchInfo'?{assistant:false}:method==='getLocaleInfo'?{locale:'en-US',hour24:false}:method==='listLauncherApps'?{apps:[]}:{available:false};
    if(plugin==='DailyApps')return method==='listReminders'?{reminders:[]}:method==='pendingReminderTap'?{}:{assistant:false,developmentBuild:true,topInset:0,bottomInset:0};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='AlphaNotifications')return method==='status'?{permissionGranted:true,appEnabled:true}:{items:[]};
    return previous?previous.nativePromise(plugin,method,input):{};
   }};
 },scope);
 await page.goto('/');if(authenticated)await completeAccessSetup(page);if(openPhotos)await page.getByRole('button',{name:'Photos',exact:true}).click();
}
