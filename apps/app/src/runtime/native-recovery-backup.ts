import {testMocksEnabled} from '../build-flags';
import {registerPlugin} from '../platform-plugins';
type Backup={name:string;mimeType:'text/plain';dataBase64:string;sha256:string;reviewed:true};
type Saver={saveReviewed(input:Backup):Promise<{status:string;message:string}>};
/** Explicit backup export through the existing Android document picker and byte readback. */
export async function saveNativeRecoveryBackup(raw:string,name:string,signal:AbortSignal,saver?:Saver){
 if(!testMocksEnabled)throw Error("App-data backup is unavailable.");
 signal.throwIfAborted();
 const bytes=new TextEncoder().encode(raw);
 if(bytes.length>5*1024*1024||raw.includes('\0')||!name.endsWith('.txt')||name.length>120||/[\\/\x00-\x1f]/.test(name))throw Error('Recovery backup cannot be exported as a text file.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 signal.throwIfAborted();
 const result=await (saver||registerPlugin<Saver>('AlphaMailAttachments')).saveReviewed({name,mimeType:'text/plain',dataBase64:btoa(binary),sha256,reviewed:true});
 return result.status==='saved'?'Backup saved.':result.status==='cancelled'?'Backup cancelled. Saved drafts are unchanged.':'Backup could not be confirmed. Inspect the chosen destination before resetting.';
}
