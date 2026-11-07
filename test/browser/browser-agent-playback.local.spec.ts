import {test,expect} from '@playwright/test';

// Explicit real-host qualification; ordinary CI does not start a speech service.
async function attach(page:any){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await expect.poll(()=>page.evaluate(async()=>{
  try{const response=await fetch('/__alpha-local-agent',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({path:'/api/agents',method:'GET'})});const envelope=await response.json();const agents=JSON.parse(envelope.body||'{}').agents;return envelope.status===200&&agents?.length===1&&agents[0].status==='running';}catch{return false;}
 }),{timeout:90000}).toBe(true);
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  await connectionController.startLocal();if(!connectionController.getBrowserSpeechAgent())throw Error('Local connection did not activate');
 });
}
test('first host speech request plays without a readiness probe',async({page})=>{
 test.skip(process.env.ALPHA_REAL_LOCAL_TTS!=='1','Opt in against a freshly restarted real local host');
 test.setTimeout(150000);
 const speechRequests:string[]=[];
 page.on('request',request=>{if(request.url().endsWith('/__alpha-local-agent')){const input=request.postDataJSON();if(input?.path?.startsWith('/api/tts/'))speechRequests.push(input.path);}});
 await attach(page);
 const result=await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const voice=registerPlugin<any>('AlphaVoiceCloud');
  const started=performance.now();let completed=false;
  const listener=await voice.addListener('playbackEnded',()=>{completed=true;});
  try{
   const prepared=await voice.synthesizeLocal({text:'Local speech is ready.'});
   await voice.play({playbackId:prepared.playbackId});
   const playing=(await voice.state()).playing;
   const firstPlaybackMs=Math.round(performance.now()-started);
   const deadline=performance.now()+15000;
   while(!completed&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
   return {playing,completed,firstPlaybackMs};
  }finally{await listener.remove();await voice.releaseLocalSpeech();}
 });
 expect(speechRequests).toEqual(['/api/tts/paradee']);
 expect(result.playing).toBe(true);expect(result.completed).toBe(true);
 await test.info().attach('first-host-playback',{body:JSON.stringify(result),contentType:'application/json'});
});
