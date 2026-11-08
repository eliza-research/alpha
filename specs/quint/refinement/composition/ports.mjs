/** Synthetic Android/Cloud primitives. Product controllers retain their own policy and state. */
export async function installCompositionPorts(page) {
  await page.addInitScript(() => {
    const runtime = window;
    const base = runtime.Capacitor.nativePromise;
    const state = runtime.compositionPorts = {enabled:false, writes:0, reads:0, held:true, remote:null, localRevision:'a'.repeat(64), events:[]};
    const save = () => sessionStorage.setItem('composition-calendar', JSON.stringify({enabled:state.enabled,writes:state.writes,remote:state.remote}));
    Object.assign(state, JSON.parse(sessionStorage.getItem('composition-calendar') || 'null') || {});
    const header = runtime.Capacitor.PluginHeaders.find(row => row.name === 'AlphaCalendar');
    for (const method of ['sync','requestAccess']) {
      if(header&&!header.methods.some(row=>row.name===method))header.methods.push({name:method,rtype:'promise'});
    }
    if(!header)runtime.Capacitor.PluginHeaders.push({name:'AlphaCalendar',methods:['sync','requestAccess','addListener','removeListener'].map(name=>({name,rtype:name.endsWith('Listener')?'callback':'promise'}))});
    const event = () => ({title:'Composition event',description:'',location:'',startAt:'2026-11-08T12:00:00.000Z',endAt:'2026-11-08T13:00:00.000Z',timeZone:'UTC',isAllDay:false,attendees:[],recurrence:[]});
    runtime.Capacitor.nativePromise = async (plugin,method,input) => {
      if(plugin==='AlphaCalendar'&&method==='requestAccess')return{status:'granted'};
      if(plugin==='AlphaCalendar'&&method==='sync') {
        state.events.push(['native',input.kind]);
        if(input.kind==='pause'){state.enabled=false;save();return{status:'paused'};}
        if(input.kind==='cancel')return{};
        if(input.kind==='status')return{status:'ready',enabled:state.enabled};
        if(input.kind==='list')return{status:'ready',events:[{id:'1',revision:state.localRevision}]};
        if(input.kind==='get')return{status:'ready',snapshot:{eventId:'1',revision:state.localRevision,event:event()}};
        if(input.kind==='prepare'||input.kind==='enable') {
          if(input.kind==='enable')state.enabled=true;
          const snapshot=runtime.refinement.controller.getSnapshot(), account=snapshot.cloudAccount;
          const binding={environment:account.environment,userId:account.userId,organizationId:account.organizationId,
            connectionId:'11111111-1111-4111-8111-111111111111',providerAccountId:'provider-account',calendarId:'primary',
            agentId:snapshot.session.agentId,localSourceId:'native:1',localSourceRevision:'b'.repeat(64)};
          save();return{status:'ready',lease:'22222222-2222-4222-8222-222222222222',binding,destination:{account:'calendar@example.test',calendar:'Primary'},events:[{id:'1',revision:state.localRevision}],enabled:state.enabled};
        }
        throw Error('Unmatched native Calendar input '+input.kind);
      }
      if(plugin==='AlphaConnection'&&method==='request') {
        const url=new URL(input.url);
        if(url.pathname==='/api/v1/user'){const account=runtime.residentStub.accounts.find(row=>'Bearer '+row.token===input.headers?.Authorization);if(!account)throw Error('Unmatched synthetic account');return{status:200,data:{success:true,data:{id:account.userId,email:account.email,organization_id:'11111111-2222-4333-8444-555555555555'}}};}
        if(url.pathname.startsWith('/api/v1/eliza/google/calendar/sync-v1/')) {
          const common={version:1,calendarId:'primary',providerExactlyOnce:false};
          state.events.push(['cloud',input.method,url.pathname]);
          if(url.pathname.endsWith('/capabilities'))return{status:200,data:{...common,accountId:'provider-account',accountEmail:'calendar@example.test',calendarLabel:'Primary',read:true,write:true,conditionalWrites:true,idempotentCreate:true}};
          if(input.method==='GET'){state.reads++;return{status:200,data:{...common,event:state.remote}};}
          if(input.method==='POST') {
            state.writes++;const body=JSON.parse(input.body);save();
            if(state.held)await new Promise(resolve=>{state.release=resolve;});
            state.remote={eventId:'provider-event',etag:'revision-2',visibility:'private',remindersDisabled:true,event:body.event};save();
            return{status:200,data:{...common,event:state.remote}};
          }
          throw Error('Unmatched Cloud Calendar mutation '+input.method);
        }
      }
      return base(plugin,method,input);
    };
  });
}

export const compositionEntry = `
  import {connectionController as controller} from '/src/runtime/connection-ui.tsx';
  import {calendarSyncHost as calendar,startCalendarSyncHost} from '/src/runtime/calendar-sync-host.ts';
  import {saveGoogleCalendarSelection} from '/src/runtime/google-calendar-selection.ts';
  import {VoiceAssistantSession} from '/src/runtime/voice-assistant.ts';
  const f=window.refinement={controller,calendar,events:[],voice:null,voiceRequests:[],ready:controller.initialize()};
  controller.subscribe(()=>{const s=controller.getSnapshot();f.events.push({owner:s.cloudAccount?.userId??null,open:s.open,busy:s.busy,step:s.signIn?.step??null});});
  f.prepareCalendar=async()=>{
    const a=controller.getSnapshot().cloudAccount;
    if(!saveGoogleCalendarSelection({environment:a.environment,userId:a.userId,organizationId:a.organizationId},{connectionId:'11111111-1111-4111-8111-111111111111',sourceId:'google:11111111-1111-4111-8111-111111111111:primary',providerCalendarId:'primary',name:'Primary',account:'calendar@example.test'}))throw Error('Calendar selection failed');
    f.stopCalendar??=startCalendarSyncHost();
    f.calendarReview=await calendar.review();return f.calendarReview;
  };
  f.enableCalendar=()=>{f.calendarRun=calendar.enable(f.calendarReview).then(value=>({value}),error=>({error:error.name,message:error.message}));};
  f.startVoice=async()=>{
    const binding=await controller.prepareVoiceConversation(new AbortController().signal);
    f.voiceBinding=binding;
    f.voice=new VoiceAssistantSession({conversationId:binding.conversationId,
      assertCurrent(){if(!controller.voiceConversationCurrent(binding))throw new DOMException('Retired voice binding','AbortError');},
      async listen(handlers){f.listenHandlers=handlers;return{fullDuplex:true,async close(){},cancel(){}};},
      send(input){f.voiceRequests.push(input);return new Promise(resolve=>{f.voiceReply=()=>resolve({requestId:input.turnId,conversationId:binding.conversationId,userMessageId:'user',assistantMessageId:'reply',complete:true,text:'First sentence. Second sentence.'});});},
      speak(input){input.onStarted();return new Promise(()=>{});},onHeard(){}
    });await f.voice.start();
  };
  f.recheckVoice=()=>f.voice?.recheck();
  f.snapshot=()=>{
    const state=controller.getSnapshot();
    const documents=Object.values(window.flagOff.slots).flatMap(raw=>{try{return[JSON.parse(raw)];}catch{return[];}});
    const record=documents.find(row=>Array.isArray(row?.links)&&row.links.length)?.links[0];
    return{owner:state.cloudAccount?.userId??null,credential:!!window.flagOff.slots['cloud:production'],open:state.open,
      providerReady:state.residentInference==='cloud',calendarEnabled:calendar.snapshot().enabled,calendarRunning:calendar.snapshot().running,
      calendarState:record?.state??null,pending:record?.pendingOperation??'none',knownProvider:!!record?.providerEventId,
      providerWrites:window.compositionPorts.writes,remote:!!window.compositionPorts.remote,
      voicePhase:f.voice?.getSnapshot().phase??'idle',voiceCapture:!!f.voice?.capture,voiceInputHeld:f.voice?.getSnapshot().inputHeld===true,voiceSends:f.voiceRequests.length,foreground:!document.hidden};
  };
`;
