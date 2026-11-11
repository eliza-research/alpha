/** Bounded offline snapshots. Cached data never authorizes provider mutations. */
export interface ReadCacheStore{read():Promise<unknown>;compareExchange(before:unknown,value:unknown):Promise<'saved'|'conflict'>}
type Entry={key:string;value:unknown;at:number};
type Document={version:1;owner:string;entries:Entry[]};
const MAX_BYTES=4*1024*1024,MAX_AGE=30*86400000,MAX_ENTRIES=24;
export class ServiceReadCache{
 private serial:Promise<unknown>=Promise.resolve();private epoch=0;
 private owner:string;private store:ReadCacheStore;private now:()=>number;
 constructor(owner:string,store:ReadCacheStore,now=()=>Date.now()){this.owner=owner;this.store=store;this.now=now;}
 private decode(raw:unknown):Document{
  if(!raw)return {version:1,owner:this.owner,entries:[]};
  const d=raw as Document;
  if(d.version!==1||d.owner!==this.owner||!Array.isArray(d.entries)||d.entries.length>MAX_ENTRIES||new TextEncoder().encode(JSON.stringify(raw)).length>MAX_BYTES)throw Error('Read cache is unavailable');
  return {...d,entries:d.entries.filter(e=>typeof e.key==='string'&&e.key.length<16384&&Number.isFinite(e.at)&&e.at<=this.now()&&this.now()-e.at<MAX_AGE)};
 }
 async get<T>(key:string):Promise<{value:T;at:number}|null>{
  const epoch=this.epoch;await this.serial;const raw=await this.store.read();if(epoch!==this.epoch)return null;
  const entry=this.decode(raw).entries.find(e=>e.key===key);return entry?{value:entry.value as T,at:entry.at}:null;
 }
 /** Cost: one local CAS per completed provider result, max24 entries/4MiB; no timer or network. */
 put(key:string,value:unknown,at=this.now()):Promise<void>{
  if(typeof key!=='string'||key.length>=16384||new TextEncoder().encode(JSON.stringify({key,value,at})).length>MAX_BYTES)return Promise.resolve();
  const epoch=this.epoch;return this.enqueue(async()=>{
   if(epoch!==this.epoch)return;
   for(let attempt=0;attempt<3;attempt++){
    const raw=await this.store.read();if(epoch!==this.epoch)return;
    const d=this.decode(raw),entries=d.entries.filter(e=>e.key!==key);entries.push({key,value,at});
    entries.sort((a,b)=>a.at-b.at);while(entries.length>MAX_ENTRIES)entries.shift();
    const next:Document={version:1,owner:this.owner,entries};
    // Each entry is measured once: eviction subtracts its size (and its comma) instead of encoding the document again.
    const size=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length,sizes=entries.map(size);let bytes=size({...next,entries:[]})+sizes.reduce((sum,n)=>sum+n,0)+Math.max(0,entries.length-1);
    while(entries.length&&bytes>MAX_BYTES){bytes-=sizes.shift()!+(entries.length>1?1:0);entries.shift();}
    if(epoch!==this.epoch)return;if(await this.store.compareExchange(raw,next)==='saved')return;
   }
  });
 }
 clear():Promise<void>{++this.epoch;return this.enqueue(async()=>{for(let n=0;n<3;n++){const raw=await this.store.read();if(await this.store.compareExchange(raw,null)==='saved')return;}});}
 private enqueue(work:()=>Promise<void>):Promise<void>{const task=this.serial.then(work,work);this.serial=task.catch(()=>{});return task;}
}
