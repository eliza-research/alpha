import {expect,type Page} from '@playwright/test';
/** Closed canonical app-record transport. Real Notes controller/client/editor/rendering run unchanged.
 * This fixture tests UI contracts, not the server store or account/provider integration.
 * Setting `canonicalNotesFixture.delay` (ms) holds every later response that long, like a slow link.
 * Setting `canonicalNotesFixture.dictation` to a list of transcripts answers the platform speech
 * recognition (DailyApps voice) with them in order, counted in `heard`; unset, the browser build's
 * own answer (no recognition) stands. */
export async function canonicalNotesFixture(page:Page,{path='/',notes=[],failReads=false}:{path?:string;notes?:unknown[];failReads?:boolean}={}){
 const foreign:string[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,async route=>{foreign.push(route.request().url());await route.abort();});
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto(path);
 await page.evaluate(async({notes,failReads})=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const f=(window as any).canonicalNotesFixture={state:{notes,trash:[],revision:notes.length?1:0},requests:[],otherRequests:[],fail:false,failReads,failAfterApplied:false};
  f.acceptedReads=[];
  // Observe the SAME canonical class used by the real UI; never replace its controller.
  const {CanonicalNotesController}=await import('/src/prototype/canonical-notes-controller.ts');
  const refresh=CanonicalNotesController.prototype.refresh;
  CanonicalNotesController.prototype.refresh=async function(this:InstanceType<typeof CanonicalNotesController>){
   const result=await refresh.call(this);
   const accepted=this.snapshot;
   if(this.current&&accepted&&accepted.revision===result.revision){
    f.acceptedReads.push({revision:accepted.revision,current:true,sameController:this instanceof CanonicalNotesController});
   }
   return result;
  };
  const {BrowserDaily}=await import('/src/browser/daily.ts'),perform=BrowserDaily.prototype.perform;
  BrowserDaily.prototype.perform=async function(input:any){if(input?.action!=='voice'||!f.dictation)return perform.call(this,input);f.heard=(f.heard??0)+1;return {status:'selected',action:'voice',transcript:f.dictation.shift()??''};};
  const identity={ownerId:'canonical-fixture-owner',agentId:'canonical-fixture-agent',sessionId:'canonical-fixture-session',origin:location.origin};
  c.getAppRecordClient=()=>({sessionId:identity.sessionId,identity,current:()=>true,request:async(path:string,method:string,body:any,signal:AbortSignal)=>{
   signal.throwIfAborted();if(f.delay)await new Promise(resolve=>setTimeout(resolve,f.delay));
   if(path.startsWith('/api/lifeops/calendar')){f.otherRequests.push({path,method});throw Error('Calendar is outside this closed Notes fixture');}
   f.requests.push({path,method,body:structuredClone(body)});
   if(path==='/api/notes/state'&&method==='GET'){if(f.failReads)throw Error('Closed canonical fixture read failure');return {success:true,data:structuredClone(f.state)};}
   if(path!=='/api/views/notes/interact'||method!=='POST')throw Error('Unexpected canonical Notes fixture request');
   if(f.fail)throw Error('Closed canonical fixture save failure');
   const {capability,params={}}=body;let note:any;const now=new Date().toISOString();
   if(params.expectedRevision!==undefined&&params.expectedRevision!==f.state.revision)throw Error('Canonical fixture revision changed');
   if(capability==='create-note'){
    const split=params.content.indexOf('\n'),title=split<0?params.content:params.content.slice(0,split),body=split<0?'':params.content.slice(split);note={id:crypto.randomUUID(),title,body,color:params.color??'yellow',createdAt:now,updatedAt:now,...(params.format?{format:params.format}:{})};f.state.notes.push(note);
   }else if(capability==='update-note'){
    note=f.state.notes.find((n:any)=>n.id===params.id);if(!note)throw Error('Fixture target missing');const split=params.content.indexOf('\n'),title=split<0?params.content:params.content.slice(0,split),body=split<0?'':params.content.slice(split);Object.assign(note,{title,body,color:params.color??note.color,updatedAt:now,...(params.format?{format:params.format}:{})});
   }else if(capability==='delete-note'){
    const index=f.state.notes.findIndex((n:any)=>n.id===params.id);if(index<0)throw Error('Fixture target missing');[note]=f.state.notes.splice(index,1);f.state.trash.push({note,deletedAt:now});
   }else if(capability==='restore-note'){
    const index=f.state.trash.findIndex((n:any)=>n.note.id===params.id);if(index<0)throw Error('Fixture trash target missing');note=f.state.trash.splice(index,1)[0].note;f.state.notes.push(note);
   }else throw Error('Unexpected canonical fixture capability');
   f.state.revision++;if(f.failAfterApplied)throw Error('Closed canonical fixture accepted write response loss');return {requestId:crypto.randomUUID(),success:true,result:{success:true,text:'Completed',state:structuredClone(f.state),data:{note:structuredClone(note)}}};
  }} as any);
  await c.offline();
 },{notes:structuredClone(notes),failReads});
 return {foreign,errors};
}
export async function openCanonicalNotes(page:Page){
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.requests.some((r:any)=>r.path==='/api/notes/state'))).toBe(true);
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();
}
