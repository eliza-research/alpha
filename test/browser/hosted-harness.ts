// Shared harness for hosted scheduled-digest specs: one in-process Vite server built with the
// local-agent flag, and a routed local-agent fixture whose "hosted service" state lives in the test.
// Used by dev-hosted-journey.spec.ts and journey-f-hosted-result.spec.ts. No hosted service,
// account or model is contacted; a pass is browser source/test evidence only.
import {expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localAgentStorage} from '../../scripts/local-agent-dev-storage';
import {openConnectionDiagnostics} from './helpers/connection-diagnostics';

export type HostedServer={origin:string;close():Promise<void>};
export async function startHostedServer():Promise<HostedServer>{
 const cache=await mkdtemp(path.join(tmpdir(),'alpha-hosted-vite-'));
 const server:ViteDevServer=await createServer({cacheDir:cache,define:{'import.meta.env.VITE_LOCAL_AGENT':JSON.stringify('1')},server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
 await server.listen();
 return {origin:`http://127.0.0.1:${(server.httpServer!.address() as any).port}`,close:async()=>{await server.close();await rm(cache,{recursive:true,force:true});}};
}
export function hostedResult(cursor:number,runId:string,output:string,now=new Date().toISOString()){
 return {cursor,runId,workflowId:'workflow',workflowVersionId:'version',templateVersion:'template',scheduledAt:now,source:{observedAt:now,expiresAt:now},status:'completed',startedAt:now,completedAt:now,output,error:null as string|null};
}
/** Connects the page to the routed local agent and waits until every offered result is saved and
 * acknowledged. `f.result` is the result currently offered; `f.more` are further results offered
 * with it. The service offers each result until its cursor is acknowledged. */
export async function hostedFixture(page:any,origin:string,options:{more?:ReturnType<typeof hostedResult>[]}={}){
 const storage=await mkdtemp(path.join(tmpdir(),'alpha-hosted-store-'));
 const f={acked:0,syncs:0,verifies:0,hold:false,release:null as null|(()=>void),result:hostedResult(1,'run-one','Retained morning briefing'),more:options.more||[]};
 await page.route('**/__alpha-local-agent',async(route:any)=>{const input=route.request().postDataJSON();let body:any;
  if(input.storage){await route.fulfill({json:localAgentStorage(storage,input.storage)});return;}
  const p=input.path;
  if(p==='/api/auth/me')body={identity:{kind:'owner',id:'fixture-owner'},access:{role:'OWNER',mode:'session'}};
  else if(p==='/api/agents')body={agents:[{id:'fixture-agent',name:'Browser fixture',status:'running'}]};
  else if(p==='/api/client-devices/register')body={installationId:input.headers['X-Eliza-Device-Id'],enrollmentId:'fixture-enrollment',capabilities:[]};
  else if(p==='/api/conversations')body={conversations:[]};
  else if(p==='/api/workflow/status'){f.verifies++;if(f.hold)await new Promise<void>(resolve=>{f.release=resolve;});body={hostedDigestProtocol:1};}
  else if(p==='/api/workflow/hosted/sources')body={sources:[]};
  else if(p==='/api/workflow/hosted/loops')body={loops:[]};
  else if(p==='/api/workflow/hosted/live-accounts')body={accounts:[],truncated:false};
  else if(p.startsWith('/api/workflow/hosted/results?')){f.syncs++;body={entries:[f.result,...f.more].filter(result=>result.cursor>f.acked).sort((a,b)=>a.cursor-b.cursor)};}
  else if(p==='/api/workflow/hosted/results/ack'){f.acked=JSON.parse(input.body).cursor;body={};}
  else {await route.fulfill({json:{status:404,body:'{}'}});return;}
  await route.fulfill({json:{status:200,body:JSON.stringify(body)}});
 });
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.goto(origin+'/?mode=dev&tools=1');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await openConnectionDiagnostics(page);
 // The stored offline choice reads as the resident, which connects at start.
 await page.getByRole('button',{name:/^(Start|Restart) local agent$/}).click();
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await expect.poll(()=>f.acked,{timeout:30000}).toBe(Math.max(f.result.cursor,...f.more.map(result=>result.cursor)));
 return {f,cleanup:async()=>{f.hold=false;f.release?.();try{if(!page.isClosed())await page.unrouteAll({behavior:'ignoreErrors'});}finally{await page.close().catch(()=>{});await rm(storage,{recursive:true,force:true});}}};
}
export const hostedDevice=async(page:any,name:string)=>{await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls',exact:true}).getByRole('button',{name,exact:true}).click();};
export const hostedPanel=(page:any)=>page.getByRole('dialog',{name:'Scheduled digests',exact:true});
