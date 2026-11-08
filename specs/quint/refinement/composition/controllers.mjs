import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {sourcePaths} from '../../../../scripts/quint-lib.mjs';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {serviceInputs} from '../services/source-inputs.mjs';
import {flagOffAndroid,fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {residentStub,setStub} from '../../../../test/browser/resident-stub.ts';
import {installCompositionPorts,compositionEntry} from './ports.mjs';

const root=resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
const accounts=[{token:'quint-owner-a',userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5',email:'a@example.invalid',balance:5},
  {token:'quint-owner-b',userId:'3c5e7a90-1b2d-4f6e-8a0c-2e4f6a8b0c1d',email:'b@example.invalid',balance:7}];
const action=(name,...args)=>({name,args});

export async function runControllerCompositionRefinement(extraSources=[]) {
  const sources=serviceInputs([...sourcePaths(),'vite.config.ts','package.json','scripts/quint-lib.mjs',
    'test/browser/flag-off-android.ts','test/browser/resident-stub.ts','specs/quint/refinement/composition/ports.mjs',fileURLToPath(import.meta.url),...extraSources]);
  const driverHashes=captureInputs(sources);
  const prior=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server,browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
    server=await createServer({configFile:resolve(root,'vite.config.ts'),logLevel:'error',cacheDir:resolve(root,'test-results/quint-refinement/controller-composition-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},
      define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[{name:'quint-current-composition',
        resolveId(id){if(id==='/quint-composition-entry.js')return '\0quint-composition-entry';},
        load(id){if(id==='\0quint-composition-entry')return compositionEntry;},
        configureServer(instance){instance.middlewares.use('/quint-composition',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await instance.transformIndexHtml('/quint-composition','<main></main><script type="module" src="/quint-composition-entry.js"></script>'));});}}]});
  } finally {if(prior===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=prior;}
  const traces=[];
  try {
    await server.listen();browser=await chromium.launch({headless:true});
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    for(const scenario of ['calendar-success','replacement-after-dispatch','stale-calendar-review','cancelled-sign-in','sign-out-after-dispatch','hidden-after-dispatch','voice-open-signin','voice-pending-replacement','voice-hidden']) {
      const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(90000);
      const foreign=await fenceNetwork(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript({content:'window.__name=function(target){return target;};'});
      await flagOffAndroid(page);await residentStub(page,{nativeSignIn:true,accounts});await installCompositionPorts(page);
      await page.goto(origin+'/quint-composition',{waitUntil:'commit'});
      try {await page.waitForFunction(()=>window.refinement?.controller.getSnapshot().cloudAccount&&window.refinement.controller.getSnapshot().kind==='resident'&&!window.refinement.controller.getSnapshot().busy);}
      catch(error){throw new Error('Composition startup failed '+JSON.stringify({scenario,errors,foreign,state:await page.evaluate(()=>window.refinement?.controller.getSnapshot()),calls:await page.evaluate(()=>window.flagOff?.calls),unexpected:await page.evaluate(()=>window.flagOff?.unexpected)}),{cause:error});}
      const observe=async()=>{const s=await page.evaluate(()=>window.refinement.snapshot());const owner=s.owner===null?0:accounts.findIndex(account=>account.userId===s.owner)+1;return{'host.owner':owner,'credentialPresent':s.credential,'host.connectionOpen':s.open,'host.providerReady':s.providerReady,'state.calendar.enabled':s.calendarEnabled,'state.calendar.writes':s.providerWrites,'state.voice.phase':s.voicePhase==='awaiting-user-input'?'awaiting-review':s.voicePhase,'state.voice.capture':s.voiceCapture,'state.voice.inputHeld':s.voiceInputHeld,'voiceSubmissions':s.voiceSends,'host.foreground':s.foreground,...s.calendarState?{'state.calendar.state':s.calendarState,'state.calendar.pending':s.pending,'state.calendar.knownProvider':s.knownProvider,'state.calendar.remote':s.remote?1:0}:{}};};
      const trace={name:scenario,init:action('readySetup'),expect:await observe(),steps:[]};
      if(scenario.startsWith('voice-')) {
        await page.evaluate(()=>window.refinement.startVoice());
        trace.steps.push({label:'actual shared voice opens under the renderer conversation binding',action:action('startVoice'),expect:await observe()});
        if(scenario==='voice-pending-replacement') {
          await page.evaluate(()=>{const f=window.refinement,now=Date.now();f.listenHandlers.onSpeechStart(now);f.listenHandlers.onSpeechEnd(now);f.listenHandlers.onSegment('A concrete request.');});
          await page.waitForFunction(()=>window.refinement.voiceRequests.length===1);
          trace.steps.push({label:'closed microphone precedes one actual voice submission',action:[action('voiceSegment'),action('voiceBeginSubmission'),action('voiceInputClosed')],expect:await observe()});
          await replace(page,trace,observe);
          await page.evaluate(()=>window.refinement.voiceReply());
          trace.steps.push({label:'old voice reply cannot restart a retired conversation',action:action('voiceReply',0,1),expect:await observe()});
        } else if(scenario==='voice-open-signin') {
          await page.evaluate(()=>window.refinement.controller.beginSignIn());await page.evaluate(()=>window.refinement.controller.signInEmail('b@example.invalid'));await page.evaluate(()=>window.refinement.recheckVoice());
          trace.steps.push({label:'opening identity controls invalidates the voice conversation predicate',action:action('beginSignIn'),expect:await observe()});
          await page.evaluate(()=>window.refinement.controller.cancelSignIn());
          trace.steps.push({label:'cancelled sign-in keeps the chooser and retired voice state',action:action('cancelSignIn'),expect:await observe()});
        } else {
          await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.refinement.recheckVoice();});
          trace.steps.push({label:'visibility invalidates the actual conversation guard',action:action('hide'),expect:await observe()});
        }
        trace.implementationEvents=await page.evaluate(()=>({controller:window.refinement.events,calendar:window.compositionPorts.events}));
        if(foreign.length||errors.length)throw Error(JSON.stringify({scenario,foreign,errors}));
        traces.push(trace);console.log('Collected composition schedule '+scenario);await context.close();continue;
      }
      await page.evaluate(()=>window.refinement.prepareCalendar());
      trace.steps.push({label:'actual Alpha host captures the current Calendar owner and review',action:[action('calendarBind'),action('calendarReview')],expect:await observe()});
      if(scenario==='stale-calendar-review') {
        await replace(page,trace,observe);
        const result=await page.evaluate(()=>window.refinement.calendar.enable(window.refinement.calendarReview).then(()=>null,error=>error.message));
        if(!result)throw Error('Stale Calendar review was accepted');
        trace.steps.push({label:'old review cannot enable a replacement account',action:{...action('calendarEnable'),reject:true},expect:await observe()});
      } else {
        await page.evaluate(()=>window.refinement.enableCalendar());await page.waitForFunction(()=>window.compositionPorts.writes===1);
        trace.steps.push({label:'real Calendar host enables and checkpoints before dispatch',action:[action('calendarEnable'),action('calendarBegin'),action('calendarAnalyze'),action('calendarStage'),action('calendarDispatch')],expect:await observe()});
        if(scenario==='replacement-after-dispatch')await replace(page,trace,observe);
        if(scenario==='cancelled-sign-in') {
          await page.evaluate(()=>window.refinement.controller.beginSignIn());await page.evaluate(()=>window.refinement.controller.signInEmail('b@example.invalid'));
          trace.steps.push({label:'replacement starts while old Calendar request is held',action:action('beginSignIn'),expect:await observe()});
          await page.evaluate(()=>window.refinement.controller.cancelSignIn());
          trace.steps.push({label:'precommit cancellation preserves the old Calendar binding',action:action('cancelSignIn'),expect:await observe()});
        }
        if(scenario==='sign-out-after-dispatch') {
          await page.evaluate(()=>window.refinement.controller.cloudSignOut());
          await page.waitForFunction(()=>!window.refinement.controller.getSnapshot().cloudAccount&&!window.refinement.controller.getSnapshot().busy);
          trace.steps.push({label:'sign-out retires captured consumers',action:action('signOut'),expect:await observe()});
        }
        if(scenario==='hidden-after-dispatch') {
          await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
          trace.steps.push({label:'visibility cancels the source host before any next effect',action:action('hide'),expect:await observe()});
        }
        await page.evaluate(()=>{window.compositionPorts.release();});
        await page.waitForFunction(()=>window.compositionPorts.remote&&!window.refinement.calendar.snapshot().running);
        trace.steps.push({label:'already dispatched provider effect settles under its captured binding',action:action('calendarReturned','succeeded',true),expect:await observe()});
      }
      trace.implementationEvents=await page.evaluate(()=>({controller:window.refinement.events,calendar:window.compositionPorts.events}));
      if(foreign.length||errors.length)throw Error(JSON.stringify({scenario,foreign,errors}));
      traces.push(trace);console.log('Collected composition schedule '+scenario);await context.close();
    }
    const receipt=await checkTraces({model:'ControllerComposition',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
      'Actual renderer ConnectionController, Alpha calendarSyncHost, shared Calendar controller/reconciler/store and native protocol wrappers execute in Chromium. Android/Cloud primitives are controlled external ports.',
      'Initial and replacement native authentication internals are explicit IdentitySession contract macros. This campaign observes renderer publication, not native key-commit or acknowledgement internals.',
      'One Calendar link belongs to a captured old account. New-account link collections, Inbox composition, full Resident/Reset coordination and the full voice-adapter UI remain separate obligations.'
    ]});
    return{receipts:[receipt],obligations:[{model:'ControllerComposition',obligation:'unobserved imported fields and broader orchestration',reason:'This campaign checks selected host/Calendar observations. Identity internals are contract macros, VoiceSession uses actual conversation predicates and explicit recheck calls, with microphone, reply and speaker ports controlled. Inbox multi-slot, Resident lifecycle and Reset are not imported into this bounded composition.',requires:['native-to-renderer intermediate publication','all imported field/action coverage','Inbox multi-owner composition','Resident and reset coordination','full voice-adapter UI wiring']}]};
  } finally {await browser?.close();await server?.close();}
}
async function replace(page,trace,observe) {
  await setStub(page,{nextToken:accounts[1].token});
  await page.evaluate(()=>window.refinement.controller.beginSignIn());await page.evaluate(()=>window.refinement.controller.signInEmail('b@example.invalid'));await page.evaluate(()=>window.refinement.recheckVoice());
  trace.steps.push({label:'replacement code stage retains existing account',action:action('beginSignIn'),expect:await observe()});
  await page.evaluate(()=>window.refinement.controller.verifySignInCode('123456'));
  await page.waitForFunction(()=>window.refinement.controller.getSnapshot().cloudAccount?.email==='b@example.invalid'&&!window.refinement.controller.getSnapshot().busy);
  trace.steps.push({label:'native authentication result publishes replacement and retires consumers',action:[action('verifyCode'),action('identityExchanged'),action('saveIdentityReceipt'),action('acceptIdentityKey'),action('acknowledgeIdentity'),action('revokePreviousIdentity'),action('releaseIdentitySession'),action('publishIdentity'),action('bindingReady')],expect:await observe()});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runControllerCompositionRefinement(),null,2));
