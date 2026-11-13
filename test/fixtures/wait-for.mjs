// Bounded waits for node tests. A microtask spin (`while(!x)await Promise.resolve()`) starves timers, so neither a test
// timeout nor anything else can interrupt it; waitFor yields a macrotask per check and throws after `limit` ms.
export async function waitFor(predicate,{limit=2000,label='condition'}={}){
 const end=Date.now()+limit;
 while(!predicate()){if(Date.now()>end)throw Error(`waitFor timed out: ${label}`);await new Promise(resolve=>setImmediate(resolve));}
}
export const deferred=()=>Promise.withResolvers();
