import { returnToApps } from './app-navigation';
import { test, expect } from '@playwright/test';

// Real renderer, pairing, connection controller, proposal parser and journal
// orchestration. Auth, transcript, durable journal and native Clock are controlled
// boundaries: no model call, physical microphone, Android Intent or real alarm.
for (const mode of ['confirm','transcribed','zone','modal','unknown','receipt-loss','unavailable','denied','failed','show','snooze','dismiss','browser','old-host','duplicate','review-cancel','review-owner','review-context','review-cancel-failure'] as const) {
  test(`agent Clock handoff: ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const w = window as any, store = new Map(JSON.parse(localStorage.getItem('fixture-secure')||'[]'));w.calendarEntry=JSON.parse(localStorage.getItem('fixture-journal')||'null');
      const agentId = '12345678-1234-4234-8234-123456789abc';
      const fixture = w.recoveryFixture = { voicePeak:0,cloudUploads:0,localProbes:0,posts: 0, lists: 0, decisions: 0, claims: 0, receipts: 0, reviews:0,cancellations:0,effects: Number(localStorage.getItem('fixture-effects')||0), journal: [] as string[], proposal: null as any };
      const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
      if(mode!=='browser')w.androidBridge={};
      w.Capacitor = {
        PluginHeaders: [
          {name:'AlphaNotifications',methods:methods(['status','addListener','removeListener'])},
          {name:'AlphaVoiceCloud',methods:methods(['checkPermissions','localSpeechStatus','transcribeLocalRecording','transcribeRecording','getRecordingMetrics','startRecording','stopRecording','releaseLocalSpeech','cancel','cancelRecording','stopPlayback','addListener','removeListener'])},
          {name:'DailyApps',methods:methods(['clockHandoff','perform','surfaceInfo','addListener','removeListener'])},
          { name: 'AlphaConnection', methods: methods(['request', 'cancel', 'secureRead', 'secureWrite','secureCompareExchange', 'secureRemove','addListener','removeListener']) },
          { name: 'AlphaActionJournal', methods: methods(['reserve', 'markApplying', 'finish', 'get', 'list','reviewClock','confirmClock','cancelClock']) },
        ],
        nativeCallback:()=> 'fixture-listener',
        nativePromise: async (plugin: string, method: string, input: any) => {
          if(method==='addListener')return {callbackId:'fixture-listener'};if(method==='removeListener')return {};
          if(plugin==='AlphaNotifications'&&method==='status')return {permissionGranted:true,appEnabled:true};
          if(plugin==='AlphaVoiceCloud'){if(method==='checkPermissions')return {microphone:'granted'};if(method==='localSpeechStatus'){fixture.localProbes++;throw Error('Local speech forbidden in Cloud fixture');}if(method==='getRecordingMetrics')return {recordingId:input.recordingId,peak:fixture.voicePeak};if(method==='transcribeRecording'){if(input.environment!=='production'||input.credentialId!=='synthetic-cloud-credential')throw Error('Wrong Cloud binding');fixture.cloudUploads++;return {text:'Set an alarm for 07:00; await my review.',local:false};}if(method==='startRecording')return {recordingId:'clock-voice-fixture',maxDurationMs:29000};if(method==='stopRecording')return {recordingId:'clock-voice-fixture',durationMs:1000};if(method==='transcribeLocalRecording')throw Error('Local transcript forbidden');return {};}
          if(plugin==='DailyApps'){if(method==='surfaceInfo')return {developmentBuild:true,assistant:false};if(method==='perform')return {status:'selected',transcript:'Set an alarm for 07:00; await my review.'};if(method==='clockHandoff'){fixture.effects++;localStorage.setItem('fixture-effects',String(fixture.effects));if(mode==='unknown')throw Error('Lost native bridge response');return {action:input.action,status:mode==='unavailable'?'unavailable':mode==='denied'?'denied':mode==='failed'?'failed':'opened',message:'Clock request sent'};}throw Error('Unexpected DailyApps method');}
          if (plugin === 'AlphaActionJournal') {
            fixture.journal.push(method);
            if(method==='reviewClock'){
              if(input.scope!==w.calendarEntry.scope||input.proposalId!==w.calendarEntry.proposalId||input.operationId!==w.calendarEntry.operationId||JSON.stringify(input.operation)!==JSON.stringify(w.calendarEntry.record.operation)||w.calendarEntry.phase!=='applying')throw Error('Wrong exact native journal');
              fixture.reviews++;
              if(mode==='review-cancel')return {result:{kind:'clock-handoff',action:input.operation.action,status:'failed'}};
              if(mode==='review-owner'||mode==='review-context'||mode==='review-cancel-failure')return new Promise(resolve=>{w.releaseReview=()=>resolve({reviewToken:'native-owner-consent'});});
              return {reviewToken:'native-owner-consent'};
            }
            if(method==='cancelClock'){fixture.cancellations++;if(mode==='review-cancel-failure'&&fixture.cancellations<=2)throw Error('Unconfirmed native cancellation');if(mode==='review-owner'||mode==='review-cancel-failure')return new Promise(resolve=>{w.releaseCancel=()=>resolve({});});return {};}
            if(method==='confirmClock'){
              if(input.reviewToken!=='native-owner-consent'||input.operationId!==w.calendarEntry.operationId)throw Error('Missing native consent');
              fixture.effects++;localStorage.setItem('fixture-effects',String(fixture.effects));if(mode==='unknown')throw Error('Lost native bridge response');
              return {result:{kind:'clock-handoff',action:w.calendarEntry.record.operation.action,status:mode==='unavailable'?'unavailable':mode==='denied'?'denied':mode==='failed'?'failed':'opened'}};
            }

            if (method === 'reserve') { if(w.calendarEntry)return {created:false,entry:structuredClone(w.calendarEntry)};w.calendarEntry={...structuredClone(input),phase:'reserved'}; localStorage.setItem('fixture-journal',JSON.stringify(w.calendarEntry));return { created: true, entry: structuredClone(w.calendarEntry) }; }
            if (method === 'markApplying') { Object.assign(w.calendarEntry,{phase:'applying',attemptId:input.attemptId});return {}; }
            if(method==='get')return {entry:structuredClone(w.calendarEntry)};
            if(method==='list')return {entries:w.calendarEntry?[structuredClone(w.calendarEntry)]:[]};
            if (method === 'finish') {
              w.calendarRetained = structuredClone(input);Object.assign(w.calendarEntry,structuredClone(input),{phase:'terminal'});localStorage.setItem('fixture-journal',JSON.stringify(w.calendarEntry));

              return {};
            }
            throw Error('Unexpected journal call');
          }
          if (plugin !== 'AlphaConnection') throw Error('Unexpected native effect');
          if (method === 'secureRead') return { value: store.get(input.slot) ?? null };
          if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);localStorage.setItem('fixture-secure',JSON.stringify([...store]));return {status:'saved'};}
          if (method === 'secureWrite') { store.set(input.slot, input.value);localStorage.setItem('fixture-secure',JSON.stringify([...store])); return {}; }
          if (method === 'secureRemove') { store.delete(input.slot); return {}; }
          if (method === 'cancel') return {};
          const pathname = new URL(input.url).pathname;
          const ok = (data: any) => ({ status: 200, data });
          if (pathname === '/api/auth/status') return ok({ required: true, authenticated: false, pairingEnabled: true, bootstrapRequired: false, instanceId: 'recovery-fixture', expiresAt: Date.now() + 60000 });
          if (pathname === '/api/auth/pair') return ok({ token: 'synthetic-session', identityId: 'fixture-owner', access: 'owner', instanceId: 'recovery-fixture' });
          if (input.headers.Authorization !== 'Bearer synthetic-session') throw Error('Unpaired request');
          if (pathname === '/api/auth/me') return ok({ identity: { id: 'fixture-owner', displayName: 'Fixture owner', kind: 'owner' }, session: { id: 'synthetic-session', kind: 'machine', expiresAt: Date.now() + 600000 }, access: { role: 'OWNER', mode: 'session' } });
          if (pathname === '/api/agents') return ok({ agents: [{ id: agentId, name: 'Recovery fixture', status: 'running' }] });
          if (pathname === '/api/client-devices/register') {
            w.calendarInstallation=input.headers['X-Eliza-Device-Id'];
            return ok({ installationId: input.headers['X-Eliza-Device-Id'], enrollmentId: 'fixture-enrollment', capabilities: mode==='old-host'?['calendar.local-event.v1']:['reminders.local-record.v1','calendar.local-event.v1','clock.handoff.v1'] });
          }
          if (pathname === '/api/workflow/status') return ok({});
          if (pathname === '/api/conversations' && input.method === 'POST') return ok({ conversation: { id: 'fixture-chat', title: 'Fixture' } });
          if (pathname === '/api/conversations/fixture-chat/messages' && input.method === 'POST') {
            if(mode==='old-host'||mode==='browser'){if(input.headers['X-Eliza-Device-Capabilities'].includes('clock.handoff.v1'))throw Error('Unsupported capability advertised');return ok({text:'Clock handoff is unavailable on this host. Open Clock from Calendar.',agentName:'Fixture'});}
            if (!input.headers['X-Eliza-Device-Capabilities']?.split(',').includes('clock.handoff.v1')) throw Error('Calendar capability was not negotiated');
            fixture.posts++;
            const sent=JSON.parse(input.body);w.calendarSent=sent;
            const operation=mode==='show'||mode==='dismiss'?{type:'clock_handoff',action:mode}:mode==='snooze'?{type:'clock_handoff',action:'snooze',snoozeMinutes:10}:{type:'clock_handoff',action:'set',hour:7,minute:0,label:'Wake up',timeZone:sent.metadata.clientDevice.context.timeZone};
            fixture.proposal={id:'fixture-proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+60000).toISOString(),subjectUserId:'fixture-owner',requestedBy:agentId,action:'device_action',payload:{action:'device_action',version:1,installationId:w.calendarInstallation,enrollmentId:'fixture-enrollment',operation}};
            return ok({ text: 'The request remains incomplete because processing stopped unexpectedly. Recorded tool outcomes are preserved; remaining work has not been completed.', agentName: 'Recovery fixture', terminalFailure: { kind: 'handler_error', code: 'PLANNER_INTERRUPTED_AFTER_ACTION', transient: false } });
          }
          if (pathname === '/api/client-devices/proposals') { fixture.lists++; return ok({proposals:fixture.proposal?[fixture.proposal]:[]}); }
          const body = input.body ? JSON.parse(input.body) : {};
          if (pathname.startsWith('/api/client-devices/proposals/fixture-proposal/')) {
            if (body.digest !== fixture.proposal.digest) throw Error('Review digest changed');
            if (pathname.endsWith('/decision')) { if (body.decision !== 'approve') throw Error('Unexpected decision'); fixture.decisions++; return ok({ proposal: { ...fixture.proposal, state: 'approved' }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/claim')) { fixture.claims++; fixture.proposal={...fixture.proposal,state:'executing',execution:{attemptId:'fixture-attempt'}}; return ok({ proposal: { ...fixture.proposal, state: 'executing', execution: { attemptId: 'fixture-attempt' } }, digest: fixture.proposal.digest }); }
            if (pathname.endsWith('/receipt')) {  fixture.receipts++;if(mode==='receipt-loss'&&!w.allowReceipt)throw Error('Lost receipt upload'); w.calendarUploaded=structuredClone(body.receipt.result); return ok({ proposal: { ...fixture.proposal, state: 'succeeded' }, digest: fixture.proposal.digest }); }
          }
          throw Error('Unexpected fixture route ' + pathname);
        },
      };
    }, mode);
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw Error('Physical capture forbidden');}}});HTMLMediaElement.prototype.play=async()=>{throw Error('Physical playback forbidden');};});
    await page.goto('/?mode=dev');
    const connect=async()=>{
      if(mode==='browser'){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();}
    await page.getByText('Local development agent', { exact: true }).click();
    const local = page.locator('.alpha-connection details').filter({ has: page.getByText('Local development agent', { exact: true }) });
    await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
    await local.getByLabel('Pairing code', { exact: true }).fill('synthetic-code');
    await local.getByRole('button', { name: 'Connect local agent', exact: true }).click();
    await page.locator('.alpha-connection-scrim').waitFor({ state: 'detached' });
    };await connect();
    if(mode==='browser')await returnToApps(page);
    const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});
    if(mode==='transcribed'){
      // Cloud identity is a closed selected-account port; real pairing, EOT,
      // VOICE_DM send, proposal parsing and human approval remain exercised.
      await page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');c.getCloudEnvironment=()=> 'production';c.getCloudClient=()=>({sessionId:'synthetic-cloud-session',credentialId:'synthetic-cloud-credential',client:{}} as any);c.close();});
      await page.getByRole('button',{name:'Talk',exact:true}).first().press('Enter');
      const voice=page.getByRole('region',{name:'Voice conversation',exact:true});await expect(voice).toHaveAttribute('data-voice-state','listening');
      await page.evaluate(()=>(window as any).recoveryFixture.voicePeak=.25);await page.waitForTimeout(950);await page.evaluate(()=>(window as any).recoveryFixture.voicePeak=0);
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.posts)).toBe(1);
      await expect(voice).toHaveAttribute('data-voice-state','error');
      expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);
      await voice.getByRole('button',{name:'Stop voice conversation',exact:true}).click();
      await expect(voice).toHaveCount(0);
      await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>({uploads:(window as any).recoveryFixture.cloudUploads,local:(window as any).recoveryFixture.localProbes,channel:(window as any).calendarSent.channelType}))).toEqual({uploads:1,local:0,channel:'VOICE_DM'});
    }
    else {await input.fill(mode==='show'?'Show my alarms':mode==='snooze'?'Snooze ringing alarms for ten minutes':mode==='dismiss'?'Dismiss the ringing alarm':'Set an alarm for 07:00; await my review.');await input.press('Enter');}
    if(mode==='old-host'||mode==='browser'){await expect(page.getByText('Clock handoff is unavailable on this host. Open Clock from Calendar.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);await expect(page.getByText('clock handoff',{exact:true})).toHaveCount(0);return;}
    if(mode!=='transcribed')await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
    await expect(page.getByText('clock handoff',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);
    if(mode==='zone')await page.evaluate(()=>{const original=Intl.DateTimeFormat.prototype.resolvedOptions;Intl.DateTimeFormat.prototype.resolvedOptions=function(){return {...original.call(this),timeZone:'Pacific/Honolulu'};};});
    if(mode==='modal'){
      await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
      await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Clock alarms',exact:true}).click();
      const context=await page.evaluate(async()=> (await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context);
      expect(context.selectedObject.kind).toBe('clock-draft');
      await page.getByLabel('Alarm label',{exact:true}).fill('Edited draft');
      const edited=await page.evaluate(async()=> (await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context);
      expect(edited.revision).toBeGreaterThan(context.revision);expect(edited.selectedObject.revision).not.toBe(context.selectedObject.revision);
      await page.getByRole('button',{name:'Close Clock',exact:true}).click();
      const closed=await page.evaluate(async()=> (await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context);expect(closed.selectedObject?.kind).not.toBe('clock-draft');
      expect(await page.evaluate(async()=>{try{await (await import('/src/runtime/alpha-client.ts')).alphaClient.approve('fixture-proposal');return false;}catch{return true;}})).toBe(true);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);return;
    }
    // Activate the actual review button through its keyboard path. The chat sheet
    // can still be settling after voice closes; nested text is not a stable click target.
    await page.getByRole('button',{name:/^clock handoff /}).press('Enter');
    if(mode==='zone'){await expect(page.getByText('This action is no longer pending for the current screen. Open its original selection and review again.',{exact:true}).first()).toBeVisible();expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);return;}

    if(mode==='review-cancel'){
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(1);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);
      expect(await page.evaluate(()=>(window as any).calendarRetained.result.clockResult.status)).toBe('failed');return;
    }
    if(mode==='review-cancel-failure'){
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.reviews)).toBe(1);
      await page.evaluate(async()=>{await (await import('/src/runtime/connection-ui.tsx')).connectionController.disconnect();});
      await page.evaluate(()=>(window as any).releaseReview());
      await expect.poll(()=>page.evaluate(()=>(window as any).calendarRetained?.status)).toBe('unknown');
      expect(await page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(1);
      expect(await page.evaluate(async()=>{try{await (await import('/src/runtime/clock-agent-review.ts')).retireClockReviews();return false;}catch{return true;}})).toBe(true);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(2);
      await page.evaluate(async()=>{(window as any).retired=false;(window as any).retirement=(await import('/src/runtime/connection-ui.tsx')).connectionController.disconnect().then(()=>{(window as any).retired=true;});});
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(3);
      expect(await page.evaluate(()=>(window as any).retired)).toBe(false);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);
      await page.evaluate(()=>(window as any).releaseCancel());await page.evaluate(()=>(window as any).retirement);
      await page.evaluate(async()=>{await (await import('/src/runtime/clock-agent-review.ts')).retireClockReviews();});
      expect(await page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(3);return;
    }
    if(mode==='review-owner'||mode==='review-context'){
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.reviews)).toBe(1);
      if(mode==='review-owner'){
        await page.evaluate(async()=>{const controller=(await import('/src/runtime/connection-ui.tsx')).connectionController;(window as any).retired=false;(window as any).retirement=controller.disconnect().then(()=>{(window as any).retired=true;});});
        await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(1);
        await page.evaluate(()=>(window as any).releaseReview());
        expect(await page.evaluate(()=>(window as any).retired)).toBe(false);
        await page.evaluate(()=>(window as any).releaseCancel());
        await page.evaluate(()=>(window as any).retirement);
      }else{
        await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
        await page.evaluate(()=>(window as any).releaseReview());
      }
      await expect.poll(()=>page.evaluate(()=>(window as any).calendarRetained?.status)).toBe('unknown');
      expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(0);
      expect(await page.evaluate(()=>(window as any).recoveryFixture.cancellations)).toBe(1);return;
    }
    await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(1);
    await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(1);
    if(mode==='receipt-loss'){
      expect(await page.evaluate(()=>(window as any).calendarRetained.result.clockResult.status)).toBe('opened');
      await page.evaluate(async()=>{(window as any).allowReceipt=true;await (await import('/src/runtime/connection-ui.tsx')).connectionController.actionHistory(true);});
      await expect.poll(()=>page.evaluate(()=>(window as any).recoveryFixture.receipts)).toBe(2);expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(1);
    }
    if(mode==='unknown')expect(await page.evaluate(()=>(window as any).calendarRetained.status)).toBe('unknown');
    else expect(await page.evaluate(()=>(window as any).calendarUploaded)).toEqual({kind:'clock-handoff',action:['show','snooze','dismiss'].includes(mode)?mode:'set',status:mode==='unavailable'?'unavailable':mode==='denied'?'denied':mode==='failed'?'failed':'opened'});
    if(mode==='duplicate'||mode==='unknown'){
      await page.evaluate(()=>{const keep=['fixture-secure','fixture-journal','fixture-effects'].map(k=>[k,localStorage.getItem(k)]);localStorage.clear();for(const [k,v] of keep)if(v)localStorage.setItem(k!,v);});
      await page.reload();await connect();
      const again=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await again.fill('Repeat this same request');await again.press('Enter');
      // Let the reply settle, then keep the review card in the expanded chat.
      // A newly opening sheet can scroll its inner text between pointer down/up.
      await expect(page.getByText(/Pending phone actions are available for separate review/)).toBeVisible();
      await page.getByRole('button',{name:'Expand chat',exact:true}).click();
      await page.getByRole('button',{name:/^clock handoff /}).click();
      await expect(page.getByText(/already has a device journal entry/).first()).toBeVisible();expect(await page.evaluate(()=>(window as any).recoveryFixture.effects)).toBe(1);
    }

  });
}

// Browser development profile: agent-adapter passes an approved Clock operation to
// BrowserDaily.clockHandoff as `{...request,reviewed:true}` (the operation without `type`).
// The browser host never negotiates clock.handoff.v1, so this replays that exact call shape and
// result mapping rather than a protocol proposal. A repeat must not become one saved alarm.
test('agent Clock handoff: browser development refuses a repeat instead of saving a one-time alarm',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/?mode=dev');
  const outcome=await page.evaluate(async()=>{
    const {validateClockOperation,validateClockResult,currentClockTimeZone}=await import('/src/runtime/clock-contract.ts');
    const {DailyApps}=await import('/src/daily.ts');
    const operation=validateClockOperation({type:'clock_handoff',action:'set',hour:7,minute:0,label:'Weekday wake',timeZone:currentClockTimeZone(),days:[6,2,3,4,5]});
    const {type,...request}=operation as any;
    const result=await DailyApps.clockHandoff({...request,reviewed:true});
    const clockResult=validateClockResult(operation,{kind:'clock-handoff',action:result.action,status:result.status});
    const alarms=(await DailyApps.listReminders()).reminders.filter((row:any)=>row.id.startsWith('alarm_'));
    return {days:request.days,status:result.status,message:result.message,clockStatus:clockResult.status,alarms:alarms.length};
  });
  expect(outcome).toEqual({days:[2,3,4,5,6],status:'failed',message:'Repeating alarms are not available in this browser. No alarm was saved.',clockStatus:'failed',alarms:0});
  expect(outcome.message).not.toContain('Alarm saved.');
  // A one-time request through the same call still saves exactly one alarm.
  expect(await page.evaluate(async()=>{const {DailyApps}=await import('/src/daily.ts');const result=await DailyApps.clockHandoff({action:'set',hour:7,minute:0,label:'Once',reviewed:true});return [result.message,(await DailyApps.listReminders()).reminders.filter((row:any)=>row.id.startsWith('alarm_')).length];})).toEqual(['Alarm saved.',1]);
  await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Clock alarms',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Clock alarms',exact:true});await expect(dialog.getByText('Once',{exact:true})).toBeVisible();await expect(dialog.getByText('Weekday wake',{exact:true})).toHaveCount(0);
});
