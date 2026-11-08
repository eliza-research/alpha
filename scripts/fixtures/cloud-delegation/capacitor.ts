export const Capacitor={Plugins:{}};
let callback:any=null;const listeners=new Set<()=>void>();(window as any).emitCallback=(value:unknown)=>{callback=value;for(const l of listeners)l();};(window as any).storedCallback=()=>callback;
export function registerPlugin(){return{async addListener(_name:string,fn:()=>void){listeners.add(fn);return{remove:()=>listeners.delete(fn)};},async readDelegationCallback(){return{callback};},async clearDelegationCallback(input:{state:string}){if(callback?.state===input?.state)callback=null;}};}
