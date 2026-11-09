import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

/** Controlled host storage contract. Cryptographic at-rest protection is external. */
export function encryptedBackend() {
  let raw=null,revision=0;
  const calls=[],waiters=[];
  const backend={calls, nextWrite:null, nextRead:null, releaseAll(){for(const waiter of waiters)waiter.resolve();},
    get raw(){return raw;}, get revision(){return revision;},
    replace(value){raw=value;revision++;},
    port(){return {agentId:'notes-fixture',encryptedAtRest:true,
      async read(){
        calls.push({kind:'read',revision});const mode=backend.nextRead;backend.nextRead=null;
        if(mode==='fail')throw Error('controlled encrypted read failure');
        if(mode?.promise){waiters.push(mode);await mode.promise;}
        return raw;
      },
      async compareExchange(expected,next){
        const mode=backend.nextWrite;backend.nextWrite=null;
        calls.push({kind:'write',expected,next,revision});
        if(mode==='fail-before')throw Error('controlled encrypted write refusal');
        if(mode?.promise){waiters.push(mode);await mode.promise;}
        if(raw!==expected)return false;
        raw=next;revision++;
        if(mode==='fail-after')throw Error('controlled encrypted write acknowledgement failure');
        return true;
      }};},
  };
  return backend;
}

/** Actual Notes owners, with only filesystem root, clock, event delivery and host CAS supplied. */
export async function notesFixture(loaded,{mode='file',backend=encryptedBackend(),clock=[0,1,2,3,4,5,6,7,8,9]}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'quint-notes-store-'));
  const runtime=new loaded.AgentRuntime({character:{name:'Quint Notes',id:'00000000-0000-4000-8000-000000000031'},enableAutonomy:false});
  const services=[],events=[],errors=[],broadcastWaiters=[];
  let tick=0,id=0;
  const now=()=>new Date(1700000000000+1000*(clock[tick++]??clock.at(-1)));
  const sharedPort=backend.port();
  const f={mode,backend,directory,runtime,services,events,errors,reply:null,holdBroadcast:null,failBroadcast:false,selected:null};
  runtime.reportError=(scope,error)=>errors.push({scope,code:error?.code??null,message:error?.message??String(error)});
  runtime.getService=type=>type==='notes'?f.selected:undefined;
  runtime.getServiceLoadPromise=async type=>{
    if(type!=='connector-setup')return undefined;
    const hold=f.holdBroadcast;f.holdBroadcast=null;if(hold){broadcastWaiters.push(hold);await hold.promise;}
    return {broadcastWs(value){if(f.failBroadcast)throw Error('controlled broadcast failure');events.push(value);}};
  };
  f.open=async({freshPort=false,initialize=true}={})=>{
    const store=new loaded.NotesStore(mode==='encrypted'
      ?{agentId:'notes-fixture',encryptedPort:freshPort?backend.port():sharedPort,now}
      :{agentId:'notes-fixture',stateDir:directory,now});
    const service=new loaded.NotesService(runtime,{store,now,createId:()=>`note-fixture-${++id}`});
    services.push(service);f.selected=service;if(initialize)await service.initialize();return service;
  };
  f.interact=async(capability,params,service=f.selected)=>{
    f.selected=service;
    const result=await loaded.serverInteract(capability,params,{runtime});f.reply=result;return result;
  };
  f.client=loaded.createNotesClient({async fetch(url,options){
    if(url==='/api/notes/state')return {success:true,data:f.selected.snapshot()};
    const {capability,params}=JSON.parse(options.body);
    return {requestId:'notes-fixture-request',success:true,result:await f.interact(capability,params)};
  }});
  f.raw=async()=>{
    if(mode==='encrypted')return backend.raw===null?null:JSON.parse(backend.raw);
    const current=f.selected.store.filePath;
    for(const file of [current,path.join(current+'.published','state.json')])try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    return null;
  };
  f.close=async()=>{
    f.holdBroadcast?.resolve();for(const pending of broadcastWaiters)pending.resolve();backend.releaseAll();
    for(const service of services)await service.stop();
    await runtime.stop();await fs.rm(directory,{recursive:true,force:true});
  };
  return f;
}
