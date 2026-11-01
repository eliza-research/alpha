import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,residentHome,fenceNetwork,button} from './flag-off-android';
// P-78 in the flag-off renderer: only the in-chat Talk control may start voice.
// Deferred listener and hardware entry cannot claim an invocation or start capture,
// and startup asks the native companion to stop. Synthetic native ports only;
// this is not image, listener, microphone or physical-device evidence.
type Options={assistant?:boolean;invocation?:'listener'|'system'|'assist';locked?:boolean;listener?:Record<string,unknown>|null};
async function setup(page:Page,options:Options={}){
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript((options:Options)=>{
  const w=window as any,c=w.Capacitor,prior=c.nativePromise;
  const f=w.live={captures:[] as any[],stops:[] as string[],active:null as string|null,routes:[] as any[],invocations:0,binding:null as any,bindings:[] as any[],claims:[] as any[],listenerCalls:[] as string[],power:[] as string[],listener:options.listener??null,forbidden:[] as string[]};
  const events:Array<{event:string;callback:(value:any)=>void}>=[];
  const header=(name:string)=>c.PluginHeaders.find((p:any)=>p.name===name);
  header('AlphaVoiceCloud').methods=[...['checkPermissions','localSpeechStatus','liveCaptureStatus','startLiveCapture','stopLiveCapture','synthesizeLocal','play','stopPlayback','cancel','releaseLocalSpeech','cancelRecording'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}];
  c.PluginHeaders.push({name:'ElizaSense',methods:['status','pause','turnOff','openSettings','bindInvocationSession','takeInvocation','claimProtectedPowerLaunch','discardProtectedPowerLaunch','discardProtectedPowerInvocation'].map(name=>({name,rtype:'promise'}))});
  const callback=c.nativeCallback;c.nativeCallback=(plugin:string,method:string,input:any,fn:any)=>{if(plugin==='AlphaVoiceCloud'&&method==='addListener'){events.push({event:input.eventName,callback:fn});return String(events.length);}return callback(plugin,method,input,fn);};
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='DailyApps'&&method==='surfaceInfo')return {developmentBuild:false,assistant:options.assistant===true};
   if(plugin==='ElizaSense'){
    if(method==='bindInvocationSession'){
     if(!Number.isInteger(input.generation)||input.generation<1||typeof input.bindingId!=='string'||!input.bindingId||input.sessionKey!==null&&!/^[a-f0-9]{64}$/.test(input.sessionKey))throw Error('Invalid invocation binding');
     f.binding=structuredClone(input);f.bindings.push(structuredClone(input));return {};
    }
    if(method==='takeInvocation'){
     if(!f.binding||!f.binding.sessionKey||input.generation!==f.binding.generation||input.bindingId!==f.binding.bindingId||input.sessionKey!==f.binding.sessionKey||Object.keys(input).sort().join(',')!=='bindingId,generation,sessionKey')throw Error('Invocation was not bound to the current owner');
     f.claims.push({request:structuredClone(input),binding:structuredClone(f.binding)});
     // One-shot like AlphaAssistActivity: the listener origin is reported once, then "assist".
     const first=f.invocations++===0;
     return options.assistant?{assistant:true,invocation:first?options.invocation??'assist':'assist',locked:options.locked===true}:{assistant:false,invocation:null,locked:false};
    }
    // The pinned ElizaSense also offers protected power launches; this stub never grants one.
    if(method==='claimProtectedPowerLaunch'||method==='discardProtectedPowerLaunch'||method==='discardProtectedPowerInvocation'){
     if(!f.binding||input.generation!==f.binding.generation||input.bindingId!==f.binding.bindingId)throw Error('Power launch was not bound to the current owner');
     f.power.push(method);return method==='claimProtectedPowerLaunch'?{assistant:false,invocation:null,locked:true}:{};
    }
    f.listenerCalls.push(method);
    if(method==='status')return f.listener??{available:false};
    if(method==='pause'){f.listener={...f.listener,state:'PAUSED_USER',label:'Paused',listening:false,microphoneOpen:false};return f.listener;}
    if(method==='turnOff'){f.listener={...f.listener,state:'OFF',label:'Listening off',listening:false,microphoneOpen:false};return f.listener;}
    if(method==='openSettings')return {opened:true};
    throw Error('Unexpected Sense method '+method);
   }
   if(plugin==='Agent'&&method==='request'&&String(input.path).startsWith('/api/asr/local-inference/live')){
    if(input.path==='/api/asr/local-inference/live/status')return {status:200,body:JSON.stringify({ready:true,streaming:true,sessions:0,maxSessions:4})};
    const body=JSON.parse(input.body);f.routes.push(body);return {status:200,body:JSON.stringify({ok:true,sessionId:body.sessionId,mode:'stream',framesReceived:0})};
   }
   if(plugin!=='AlphaVoiceCloud')return prior(plugin,method,input);
   if(method==='checkPermissions')return {microphone:'granted'};
   if(method==='localSpeechStatus')return {ready:true,execution:'device'};
   if(method==='liveCaptureStatus')return {permission:true,available:true};
   if(method==='startLiveCapture'){f.captures.push({echoCancel:input.echoCancel===true});f.active=input.captureId;return {captureId:input.captureId,sampleRate:16000,echoCancelled:input.echoCancel===true};}
   if(method==='stopLiveCapture'){f.stops.push(input.captureId);f.active=null;for(const row of events)if(row.event==='liveCaptureEnded')row.callback({captureId:input.captureId});return {captureId:input.captureId,durationMs:0};}
   if(['cancel','releaseLocalSpeech','removeListener','cancelRecording','stopPlayback'].includes(method))return {};
   f.forbidden.push(method);throw Error('Not part of this path: '+method);
  };
 },options);
 return foreign;
}
const voice=(page:Page)=>page.getByRole('region',{name:'Voice conversation',exact:true});
const live=<T,>(page:Page,read:(f:any)=>T)=>page.evaluate(`(${read.toString()})(window.live)`) as Promise<T>;
async function openSurface(page:Page){
 await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>(window as any).flagOff.calls.includes('Agent.start')),{timeout:30_000}).toBe(true);
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0,{timeout:30_000});
}

for(const [name,options] of [
 ['listener wake',{assistant:true,invocation:'listener'}],
 ['press-and-hold power',{assistant:true,invocation:'system'}],
 ['locked listener wake',{assistant:true,invocation:'listener',locked:true}],
 ['locked press-and-hold power',{assistant:true,invocation:'system',locked:true}],
 ['plain assist entry',{assistant:true,invocation:'assist'}],
] as const) test(`${name} cannot start voice or consume a deferred invocation`,async({page})=>{
 const foreign=await setup(page,options);await openSurface(page);
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('turnOff');
 // Exercise a new native event and a foreground return as well as cold startup.
 await page.evaluate(()=>{window.dispatchEvent(new Event('alpha:assist-invocation'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(500);
 await expect(voice(page)).toHaveCount(0);
 expect(await live(page,f=>({captures:f.captures,routes:f.routes,invocations:f.invocations,bindings:f.bindings,claims:f.claims,power:f.power}))).toEqual({captures:[],routes:[],invocations:0,bindings:[],claims:[],power:[]});
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});

test('in-chat Talk still starts local voice after a deferred hardware entry',async({page})=>{
 const foreign=await setup(page,{assistant:true,invocation:'system'});await openSurface(page);
 await expect(voice(page)).toHaveCount(0);expect(await live(page,f=>f.captures)).toEqual([]);
 await button(page,'Talk').click();await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 expect(await live(page,f=>f.captures)).toEqual([{echoCancel:true}]);
 await button(page,'Stop voice conversation').click();await expect(voice(page)).toHaveCount(0);
 await expect.poll(()=>live(page,f=>f.stops.length)).toBe(1);
 expect(await live(page,f=>f.invocations)).toBe(0);
 expect(await live(page,f=>f.forbidden)).toEqual([]);expect(foreign).toEqual([]);
});

test('startup stops a previously active image listener and Settings exposes no deferred entry controls',async({page})=>{
 const foreign=await setup(page,{listener:{available:true,state:'LISTENING',label:'Listening',consented:true,listening:true,microphoneOpen:true}});
 await residentHome(page);await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('turnOff');
 expect(await live(page,f=>f.listener)).toMatchObject({state:'OFF',listening:false,microphoneOpen:false});
 await button(page,'Settings').click();await button(page,'Character').click();
 for(const name of ['Always-on listening','Wake word','Wake assistant'])await expect(page.getByText(name,{exact:true})).toHaveCount(0);
 for(const name of ['Pause listening','Turn off listening','Listening settings'])await expect(button(page,name)).toHaveCount(0);
 expect(await live(page,f=>f.listenerCalls.filter((method:string)=>method!=='turnOff'))).toEqual([]);
 expect(await live(page,f=>f.captures)).toEqual([]);expect(foreign).toEqual([]);
});

test('an unavailable companion keeps the unconfirmed stop notice visible',async({page})=>{
 const foreign=await setup(page);await residentHome(page);
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('turnOff');
 await button(page,'Settings').click();await button(page,'Character').click();
 await expect(page.getByText('Could not confirm listening is off. Turn it off in Android settings.',{exact:true})).toBeVisible();
 await expect(page.getByText('Always-on listening',{exact:true})).toHaveCount(0);
 expect(await live(page,f=>f.captures)).toEqual([]);expect(foreign).toEqual([]);
});
