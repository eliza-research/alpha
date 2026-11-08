import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { ViewNavigationClient } from '../apps/app/src/runtime/view-navigation';
import { handleViewsRoutes, getCurrentViewState } from '../vendor/eliza/packages/agent/src/api/views-routes';
import { registerBuiltinViews, registerPluginViews, closeRuntimeViewRegistry } from '../vendor/eliza/packages/agent/src/api/views-registry';
import { closeViewInteractionHost } from '../vendor/eliza/packages/agent/src/api/view-interaction-host';
import type { IAgentRuntime } from '@elizaos/core';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); vi.useRealTimers(); });
async function fixture() {
  const document = new EventTarget() as EventTarget & { hidden: boolean };
  document.hidden = false;
  vi.stubGlobal('document', document); vi.stubGlobal('window', new EventTarget());
  const runtime = {agentId:'44444444-4444-4444-8444-444444444444', getSetting:()=>undefined, emitEvent:async()=>{}, reportError:vi.fn(), logger:{debug(){},info(){},warn(){},error(){}}} as unknown as IAgentRuntime;
  registerBuiltinViews(runtime);
  await registerPluginViews(runtime, {name:'fixture',description:'fixture',views:[{id:'calendar',label:'Calendar',path:'/calendar',bundleUrl:'/calendar.js'}]}, {pluginDir:process.cwd(),indexEmbeddings:false});
  const hostKey = {};
  const server = createServer((req,res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    void handleViewsRoutes({req,res,method:req.method!,pathname:url.pathname,url,hostKey,runtime,
      callerAuthorization:{ok:true,role:'OWNER',identityId:'11111111-1111-4111-8111-111111111111'},
      json:(r,b)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify(b));},
      error:(r,m,c=500)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify({error:m}));},
      broadcastWsToClientId:()=>1,broadcastWs:()=>{throw Error('No global navigation');},
    }).catch(e=>{res.writeHead(500);res.end(String(e));});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let state:any={view:'settings',revision:1,sensitive:false}, active=true;
  const calls:Array<{path:string,body:any}>=[];
  const request=async(path:string,body:any,signal:AbortSignal)=>{
    calls.push({path,body});
    const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;
  };
  const client=new ViewNavigationClient(request,()=>active,()=>state);
  cleanups.push(async()=>{client.dispose();closeViewInteractionHost(hostKey);closeRuntimeViewRegistry(runtime);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllGlobals();});
  return {client,request,calls,set:(next:any)=>{state=next;},retire:()=>{active=false;},state:()=>state,current:()=>getCurrentViewState(runtime,{hostKey,clientId:client.clientId})};
}
it('manual Settings and an acknowledged agent Calendar switch share canonical previous history',async()=>{
  const f=await fixture();expect(await f.client.observeCommittedView()).toBe(true);
  const prepared:any=await f.request('/api/views/calendar/navigate',{clientId:f.client.clientId,delivery:'completed-action',prepareOnly:true,viewType:'gui',completedActionHandoffId:'agent-calendar'},new AbortController().signal);
  const attempt=f.client.capture(f.state());
  const result=await f.client.deliver([{success:true,actionName:'VIEWS',values:{mode:'show',viewId:'calendar',viewPath:'/calendar',viewType:'gui',navigationPrepared:true,completedActionHandoffId:'agent-calendar',navigationBinding:prepared.navigationBinding}}],attempt,async(view)=>{
    f.set({view,revision:2,sensitive:false});
    expect(await f.client.observeCommittedView()).toBe(false);
    return true;
  });
  expect(result.status).toBe('delivered');
  await vi.waitFor(()=>expect(f.current()?.navigationConfirmation?.previousView?.viewId).toBe('settings'));
  expect(f.current()?.viewId).toBe('calendar');
  const count=f.calls.length;expect(await f.client.observeCommittedView()).toBe(true);expect(f.calls).toHaveLength(count);
});
it('chat overlay or selected-object revisions do not replace the underlying Settings history',async()=>{
  const f=await fixture();expect(await f.client.observeCommittedView()).toBe(true);
  const count=f.calls.length;f.set({view:'settings',revision:2,sensitive:false,selectedObject:{kind:'settings',id:'account'}});
  expect(await f.client.observeCommittedView()).toBe(true);expect(f.calls).toHaveLength(count);expect(f.current()?.viewId).toBe('settings');
});
it('failed or blocked navigation leaves its current committed destination unchanged',async()=>{
  const f=await fixture();await f.client.observeCommittedView();
  const count=f.calls.length; // A dirty form refused a requested switch; no component commit occurred.
  await f.client.observeCommittedView();expect(f.calls).toHaveLength(count);expect(f.current()?.viewId).toBe('settings');
});
it('a retired session cannot acknowledge a pending manual report',async()=>{
  const f=await fixture();let resume!:()=>void;const waiting=new Promise<void>(r=>resume=r);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  const client=new ViewNavigationClient(async(path,body,signal)=>{const result=await f.request(path,body,signal);if(path.endsWith('/navigate')){entered();await waiting;}return result;},()=>active,()=>f.state());let active=true;
  const pending=client.observeCommittedView();await started;active=false;resume();expect(await pending).toBe(false);expect(f.calls.filter(c=>c.path.endsWith('interact-result'))).toHaveLength(0);client.dispose();
});
it('a newer committed view cancels a stale report before it can enter history',async()=>{
  const f=await fixture();let resume!:()=>void;const waiting=new Promise<void>(r=>resume=r);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);let held=false;
  const client=new ViewNavigationClient(async(path,body,signal)=>{const result=await f.request(path,body,signal);if(!held&&path.includes('/settings/navigate')){held=true;entered();await waiting;}return result;},()=>true,()=>f.state());
  const old=client.observeCommittedView();await started;f.set({view:'calendar',revision:2,sensitive:false});expect(await client.observeCommittedView()).toBe(true);resume();expect(await old).toBe(false);expect(f.calls.filter(c=>c.path.endsWith('interact-result'))).toHaveLength(1);client.dispose();
});
it('one explicit fresh turn can recover a failed observation without render retries',async()=>{
  const f=await fixture();let offline=true,attempts=0;
  const client=new ViewNavigationClient(async(path,body,signal)=>{attempts++;if(offline)throw Error('offline');return f.request(path,body,signal);},()=>true,()=>f.state());
  expect(await client.observeCommittedView()).toBe(false);offline=false;
  expect(await client.observeCommittedView()).toBe(false);expect(attempts).toBe(1);
  expect(await client.observeCommittedView(true)).toBe(true);expect(attempts).toBe(4);
  expect(await client.observeCommittedView(true)).toBe(true);expect(attempts).toBe(4);client.dispose();
});
it('offline observation has a bounded deadline and is not retried by repeated renders',async()=>{
  vi.useFakeTimers();vi.stubGlobal('document',{hidden:false});vi.stubGlobal('window',new EventTarget());let calls=0;
  const client=new ViewNavigationClient((_path,_body,signal)=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('offline')),{once:true}));},()=>true,()=>({view:'settings',revision:1,sensitive:false}));
  const pending=client.observeCommittedView();await vi.advanceTimersByTimeAsync(5001);expect(await pending).toBe(false);expect(await client.observeCommittedView()).toBe(false);expect(calls).toBe(1);client.dispose();vi.unstubAllGlobals();
});
