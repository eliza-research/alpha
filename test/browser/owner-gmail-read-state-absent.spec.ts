import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect,type Page} from '@playwright/test';
// Issue #668 / H-17: until the deployed inbox-v1/capabilities advertises readState, Alpha must show
// read state as unavailable. The capabilities here are what the real CloudProtocol parses from a
// synthetic wire answer that omits readState (an older or partially deployed Cloud). No real
// account, OAuth, Cloud request or mail is involved.
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});

async function setup(page:Page,wireReadState:'absent'|'false'|'true'){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async wireReadState=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const {CloudProtocol}=await import('/src/runtime/cloud-protocol.ts');
  const w=window as any,slots:Record<string,unknown>={};
  s.read=async(key:string)=>structuredClone(slots[key]??null) as any;
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{if(JSON.stringify(slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)delete slots[key];else slots[key]=structuredClone(next);return {status:'saved'};};
  const f=w.rs={prepares:[] as any[],dispatches:[] as any[],parsed:null as any,wireUrls:[] as string[]};
  const wire={version:1,from:'owner@example.test',threads:true,send:false,providerDrafts:false,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,
   ...(wireReadState==='absent'?{}:{readState:wireReadState==='true'})};
  // The real protocol adapter on a synthetic transport: only the capabilities route answers.
  const protocol=new CloudProtocol('production',async(input:any)=>{f.wireUrls.push(new URL(input.url).pathname);if(!new URL(input.url).pathname.endsWith('/inbox-v1/capabilities'))throw Error('Unexpected synthetic route');return {status:200,data:wire};},
   {read:async()=>({credentialId:'fixture',token:'synthetic-only'}),write:async()=>{},clear:async()=>{}},async()=>{});
  const mail={id:'m-1',threadId:'t-1',subject:'Synthetic subject',from:'Synthetic sender',fromEmail:'sender@example.test',to:['owner@example.test'],cc:[],replyTo:null,snippet:'Synthetic preview',receivedAt:'2026-10-06T12:00:00Z',unread:true};
  const client={
   gmailAccounts:async()=>[{connectionId:'grant-0',label:'owner@example.test',configured:true,connected:true,reason:'connected',grantedCapabilities:['google.gmail.triage','google.gmail.send','google.gmail.drafts','google.gmail.mailbox']}],
   gmailInboxCapabilities:async(grant:string,signal:AbortSignal)=>{const parsed=await protocol.gmailInboxCapabilities(grant,signal);f.parsed=parsed;return parsed;},
   gmailSearch:async()=>({messages:[structuredClone(mail)],syncedAt:'sync',nextPageToken:null}),
   gmailRead:async()=>({message:structuredClone(mail),bodyText:'Synthetic body',historyId:'h-1',attachments:[]}),
   gmailThread:async()=>({messages:[{message:structuredClone(mail),bodyText:'Synthetic body',historyId:'h-1',attachments:[]}],total:1,offset:0,historyId:'thread-h',nextOffset:null}),
   gmailPrepareOperation:async(_g:string,_r:string,proposal:any)=>{f.prepares.push(proposal);throw Error('No mailbox change in this fixture');},
   gmailDispatchOperation:async(_g:string,_r:string,_d:string,proposal:any)=>{f.dispatches.push(proposal);throw Error('No mailbox change in this fixture');},
   gmailOperation:async()=>{throw Error('No mailbox change in this fixture');},
   disconnectGmail:async()=>{},
   initiateGmail:async()=>{throw Error('No live OAuth in fixture');},
  };
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 },wireReadState);
}
const rs=(page:Page)=>page.evaluate(()=>(window as any).rs);

for(const wireReadState of ['absent','false'] as const)test(`read state is unavailable when capabilities ${wireReadState==='absent'?'omit':'deny'} readState`,async({page})=>{
 await setup(page,wireReadState);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 const row=page.getByRole('button',{name:'Unread, Synthetic sender, Synthetic subject',exact:true});
 await expect(row).toBeVisible();
 await row.click();
 await expect(page.getByText('Synthetic body',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Mark (un)?read$/})).toHaveCount(0);
 const state=await rs(page);
 expect(state.parsed?.readState).toBe(false);
 expect(state.wireUrls.every((p:string)=>p.endsWith('/inbox-v1/capabilities'))).toBe(true);
 expect(state.prepares).toEqual([]);expect(state.dispatches).toEqual([]);
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Unread, Synthetic sender, Synthetic subject',exact:true})).toBeVisible();
});

test('the same fixture offers read state once capabilities advertise it',async({page})=>{
 await setup(page,'true');
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Unread, Synthetic sender, Synthetic subject',exact:true}).click();
 await expect(page.getByText('Synthetic body',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await rs(page)).parsed?.readState).toBe(true);
 // Opening an unread message tries the read-state change; the fixture refuses any mailbox change.
 await expect.poll(async()=>(await rs(page)).prepares.map((p:any)=>p.kind)).toContain('mark-read');
 expect((await rs(page)).dispatches).toEqual([]);
});
