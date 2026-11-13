import {test,expect,type Page} from '@playwright/test';
import {flagOffAndroid,residentHome,fenceNetwork,button} from './flag-off-android';
// The production renderer binds Sense only on a qualified Android image. Android caller identity,
// native microphone and storage are controlled fixtures; no device or external provider is used.
type Options={assistant?:boolean;invocation?:'listener'|'power'|'assist';locked?:boolean;listener?:Record<string,unknown>|null;stopReceipt?:Record<string,unknown>;localSpeech?:boolean;image?:boolean;sense?:unknown};
async function setup(page:Page,options:Options={}){
 const foreign=await fenceNetwork(page);await flagOffAndroid(page);
 await page.addInitScript((options:Options)=>{
  const w=window as any,c=w.Capacitor,prior=c.nativePromise;
  // On-device speech is the route without a Cloud account (or with a Text key and no Cartesia key),
  // as in voice-assistant-fixture.ts: the Cloud slot is absent at the native storage boundary.
  const provider={mode:'own',revision:'synthetic-local-voice-provider-r1',persistence:'native-secure-store',keys:{text:{configured:true},voice:{configured:false}},provider:'cerebras',configured:true,selected:true,model:'qwen-3.8-27b',voiceConfigured:false};
  if(options.localSpeech){delete w.flagOff.slots['cloud:production'];w.flagOff.persist();}
  const f=w.live={captures:[] as any[],stops:[] as string[],active:null as string|null,routes:[] as any[],invocations:0,binding:null as any,bindings:[] as any[],claims:[] as any[],listenerCalls:[] as string[],power:[] as string[],listener:options.listener??null,stopReceipt:options.stopReceipt,deviceSettings:[] as string[],forbidden:[] as string[]};
  const events:Array<{event:string;callback:(value:any)=>void}>=[];
  const header=(name:string)=>c.PluginHeaders.find((p:any)=>p.name===name);
  header('AlphaVoiceCloud').methods=[...['checkPermissions','localSpeechStatus','liveCaptureStatus','startLiveCapture','stopLiveCapture','synthesizeLocal','play','stopPlayback','cancel','releaseLocalSpeech','cancelRecording'].map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}];
  c.PluginHeaders.push({name:'DeviceApps',methods:[{name:'platformCapabilities',rtype:'promise'}]});
  if(!header('AlphaDevice'))c.PluginHeaders.push({name:'AlphaDevice',methods:[]});
  header('AlphaDevice').methods.push({name:'openSettings',rtype:'promise'});
  // turnOn, resume and start are declared so that a call to any of them reaches the stub and is recorded.
  header('ElizaSense').methods=['status','pause','turnOff','openSettings','turnOn','resume','start','bindInvocationSession','takeInvocation','claimProtectedPowerLaunch','discardProtectedPowerLaunch','discardProtectedPowerInvocation'].map(name=>({name,rtype:'promise'}));
  if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{f.forbidden.push('getUserMedia');throw Error('Unexpected browser capture');}});
  const callback=c.nativeCallback;c.nativeCallback=(plugin:string,method:string,input:any,fn:any)=>{if(plugin==='AlphaVoiceCloud'&&method==='addListener'){events.push({event:input.eventName,callback:fn});return String(events.length);}return callback(plugin,method,input,fn);};
  c.nativePromise=async(plugin:string,method:string,input:any)=>{
   if(plugin==='DeviceApps'&&method==='platformCapabilities')return {aospImage:options.image===true,phone:false,contacts:false,sms:false,...(options.sense===undefined?{}:{sense:options.sense})};
   if(plugin==='AlphaDevice'&&method==='openSettings'){f.deviceSettings.push(input.page);return {status:'opened',page:input.page,specific:true};}
   if(options.localSpeech&&plugin==='Agent'&&method==='providerStatus')return provider;
   if(plugin==='DailyApps'&&method==='surfaceInfo')return {assistant:options.assistant===true};
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
    // This fixture exercises warm one-shot Power receipts through takeInvocation, not cold launch grants.
    if(method==='claimProtectedPowerLaunch'||method==='discardProtectedPowerLaunch'||method==='discardProtectedPowerInvocation'){
     if(!f.binding||input.generation!==f.binding.generation||input.bindingId!==f.binding.bindingId)throw Error('Power launch was not bound to the current owner');
     f.power.push(method);return method==='claimProtectedPowerLaunch'?{assistant:false,invocation:null,locked:true}:{};
    }
    f.listenerCalls.push(method);
    if(method==='status')return f.listener??{available:false};
    if(method==='pause'){if(f.stopReceipt)return f.stopReceipt;f.listener={...f.listener,state:'PAUSED_USER',label:'Paused',listening:false,microphoneOpen:false};return {...f.listener,saved:true};}
    if(method==='turnOff'){if(f.stopReceipt)return f.stopReceipt;f.listener={...f.listener,state:'OFF',label:'Listening off',listening:false,microphoneOpen:false};return {...f.listener,saved:true};}
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
 ['press-and-hold power',{assistant:true,invocation:'power'}],
 ['locked listener wake',{assistant:true,invocation:'listener',locked:true}],
 ['locked press-and-hold power',{assistant:true,invocation:'power',locked:true}],
 ['plain assist entry',{assistant:true,invocation:'assist'}],
 ['old image without capability',{image:true,assistant:true,invocation:'listener'}],
 ['unqualified image',{image:true,sense:false,assistant:true,invocation:'listener'}],
 ['stock Android with a contradictory capability',{image:false,sense:true,assistant:true,invocation:'listener'}],
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
 const foreign=await setup(page,{assistant:true,invocation:'power',localSpeech:true});await openSurface(page);
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
 await button(page,'Settings').click();
 for(const name of ['Listening','Always-on listening','Wake word','Wake assistant'])await expect(page.getByText(name,{exact:true})).toHaveCount(0);
 for(const name of ['Pause listening','Turn off listening','Listening settings'])await expect(button(page,name)).toHaveCount(0);
 // Startup only stops the listener; an earlier status read is the one other call allowed.
 const calls=await live(page,f=>f.listenerCalls as string[]);expect(calls[0]==='status'?calls.slice(1):calls).toEqual(['turnOff']);
 expect(await live(page,f=>f.captures)).toEqual([]);expect(foreign).toEqual([]);
});

test('an unavailable companion keeps the unconfirmed stop notice visible',async({page})=>{
 const foreign=await setup(page);await residentHome(page);
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('turnOff');
 await button(page,'Settings').click();
 await expect(page.getByRole('button',{name:'Microphone may be on, open Android settings',exact:true})).toContainText('Mic may be on');
 await expect(page.getByText('Always-on listening',{exact:true})).toHaveCount(0);
 expect(await live(page,f=>f.captures)).toEqual([]);expect(foreign).toEqual([]);
});

for(const origin of ['listener','power'] as const)test(`qualified image ${origin} invokes one owner-bound voice turn`,async({page})=>{
 const foreign=await setup(page,{image:true,sense:true,assistant:true,invocation:origin,localSpeech:true});
 await openSurface(page);
 await expect(voice(page)).toHaveAttribute('data-voice-state','listening');
 const claim=await live(page,f=>f.claims[0]);
 expect(claim.request).toEqual(claim.binding);
 expect(claim.request.sessionKey).toMatch(/^[a-f0-9]{64}$/);
 expect(await live(page,f=>f.captures)).toEqual([{echoCancel:true}]);
 expect(await live(page,f=>f.listenerCalls)).toEqual([]);
 await button(page,'Stop voice conversation').click();
 await expect(voice(page)).toHaveCount(0);
 const consumed=await live(page,f=>f.claims.length);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:assist-invocation')));
 await expect.poll(()=>live(page,f=>f.claims.length)).toBeGreaterThan(consumed);
 expect(await live(page,f=>f.captures)).toEqual([{echoCancel:true}]);
 expect(await live(page,f=>f.forbidden)).toEqual([]);
 expect(foreign).toEqual([]);
});

for(const [name,invocation,locked] of [['generic assist','assist',false],['locked listener','listener',true],['locked protected Power','power',true]] as const)test(`qualified image ${name} opens no voice capture`,async({page})=>{
 const foreign=await setup(page,{image:true,sense:true,assistant:true,invocation,locked,localSpeech:true});
 await openSurface(page);
 await expect.poll(()=>live(page,f=>f.claims.length)).toBeGreaterThan(0);
 await expect(voice(page)).toHaveCount(0);
 expect(await live(page,f=>f.captures)).toEqual([]);
 expect(await live(page,f=>f.listenerCalls)).toEqual([]);
 expect(foreign).toEqual([]);
});

test('qualified image Privacy uses only the native status, pause, stop and settings ports',async({page})=>{
 const foreign=await setup(page,{image:true,sense:true,listener:{available:true,state:'LISTENING',label:'Listening',consented:true,listening:true,microphoneOpen:true}});
 await residentHome(page);
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:assist-invocation')));
 await button(page,'Settings').click();
 await button(page,'Privacy').click();
 const listening=page.getByRole('switch',{name:'Listening',exact:true});
 await expect(listening).toHaveAttribute('aria-checked','true');
 expect(await live(page,f=>f.listenerCalls)).not.toContain('turnOff');
 await button(page,'Pause listening').click();
 await expect.poll(()=>live(page,f=>f.listener.state)).toBe('PAUSED_USER');
 await expect(button(page,'Pause listening')).toHaveCount(0);
 await listening.click();
 await expect(listening).toHaveAttribute('aria-checked','false');
 expect(await live(page,f=>f.listener)).toMatchObject({state:'OFF',listening:false,microphoneOpen:false});
 await button(page,'Listening settings').click();
 await expect.poll(()=>live(page,f=>f.listenerCalls)).toContain('openSettings');
 expect(await live(page,f=>f.listenerCalls.filter((method:string)=>method!=='status'))).toEqual(['pause','turnOff','openSettings']);
 expect(await live(page,f=>({claims:f.claims,captures:f.captures}))).toEqual({claims:[],captures:[]});
 expect(foreign).toEqual([]);
});

test('an inconsistent stop receipt keeps Android recovery available without opening Sense controls',async({page})=>{
 const foreign=await setup(page,{image:true,sense:false,stopReceipt:{available:true,state:'OFF',saved:true,listening:true,microphoneOpen:false}});
 await residentHome(page);
 await button(page,'Settings').click();
 await button(page,'Microphone may be on, open Android settings').click();
 await expect.poll(()=>live(page,f=>f.deviceSettings)).toEqual(['system']);
 expect(await live(page,f=>f.listenerCalls)).toEqual(['turnOff']);
 await button(page,'Privacy').click();
 await expect(page.getByRole('switch',{name:'Listening',exact:true})).toHaveCount(0);
 await expect(button(page,'Listening settings')).toHaveCount(0);
 expect(foreign).toEqual([]);
});

for(const readback of ['unavailable','off'] as const)for(const action of ['pause','turnOff'] as const)test(`qualified Privacy retains the open microphone status after unconfirmed ${action} and ${readback} status refresh`,async({page})=>{
 const listener={available:true,state:'OFF',label:'Listening off',consented:true,listening:false,microphoneOpen:true};
 const foreign=await setup(page,{image:true,sense:true,listener,stopReceipt:{available:false}});
 await residentHome(page);
 await button(page,'Settings').click();
 await button(page,'Privacy').click();
 const listening=page.getByRole('switch',{name:'Listening',exact:true});
 const stop=action==='pause'?button(page,'Pause listening'):listening;
 const recovery=button(page,'Microphone may be on, open Android settings');
 await expect(page.getByText('Microphone still open',{exact:true})).toBeVisible();
 await stop.click();
 await expect(page.getByText('Stop not confirmed · Use notification',{exact:true})).toBeVisible();
 await expect(page.getByText('Microphone still open',{exact:true})).toBeVisible();
 await expect(listening).toHaveAttribute('aria-checked','true');
 await expect(button(page,'Pause listening')).toBeVisible();
 await recovery.click();
 await expect.poll(()=>live(page,f=>f.deviceSettings)).toEqual(['system']);
 const reads=await live(page,f=>f.listenerCalls.filter((method:string)=>method==='status').length);
 await page.evaluate(({readback,listener})=>{
  (window as any).live.listener=readback==='unavailable'?{available:false}:{...listener,microphoneOpen:false};
  (window as any).flagOff.emit('DailyApps','appResumed',{});
 },{readback,listener});
 await expect.poll(()=>live(page,f=>f.listenerCalls.filter((method:string)=>method==='status').length)).toBeGreaterThan(reads);
 await expect(page.getByText('Microphone still open',{exact:true})).toBeVisible();
 await expect(listening).toHaveAttribute('aria-checked','true');
 await expect(button(page,'Pause listening')).toBeVisible();
 await page.evaluate(listener=>{delete (window as any).live.stopReceipt;(window as any).live.listener=listener;},listener);
 await stop.click();
 await expect(recovery).toHaveCount(0);
 await expect(button(page,'Pause listening')).toHaveCount(0);
 await expect(listening).toHaveAttribute('aria-checked',action==='pause'?'true':'false');
 expect(await live(page,f=>f.listenerCalls.filter((method:string)=>method!=='status'))).toEqual([action,action]);
 expect(await live(page,f=>f.captures)).toEqual([]);
 expect(foreign).toEqual([]);
});
