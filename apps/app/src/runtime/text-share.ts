import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
const device=registerPlugin<{shareText(input:{title:string;text:string}):Promise<{status:'opened'}>;copyText(input:{text:string}):Promise<void>}>('AlphaDevice');
export const nativeTextSharing=()=>Capacitor.isNativePlatform();
function visible(){
 if(document.hidden||Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(node=>node.getClientRects().length))throw new DOMException('Share view is not active','AbortError');
}
export function selectedText(input:{title:string;text:string}){
 if(typeof input.title!=='string'||input.title.length>200||typeof input.text!=='string'||!input.text.trim()||new TextEncoder().encode(input.text).length>65536||input.text.includes('\0'))throw Error(typeof input.text==='string'&&input.text.trim()?'This is too long to share.':'There’s no text to share.');
 return Object.freeze({title:input.title,text:input.text});
}
/** One explicit OS handoff. Cancellation never tries clipboard or another destination. */
export async function shareSelectedText(input:{title:string;text:string},signal?:AbortSignal):Promise<'opened'|'shared'|'closed'>{
 const selection=selectedText(input);signal?.throwIfAborted();visible();
 if(nativeTextSharing()){
  const result=await device.shareText(selection);
  signal?.throwIfAborted();
  if(result.status!=='opened')throw Error('Android sharing is unavailable.');
  return 'opened'; // Chooser opened; no delivery or destination selection is claimed.
 }
 if(!navigator.share)throw Error('Sharing is unavailable in this browser. Use Copy text or Save text.');
 try{await navigator.share(selection);signal?.throwIfAborted();return 'shared';}
 catch(error){if(error instanceof DOMException&&error.name==='AbortError')return 'closed';throw error;}
}
/** Clipboard writes happen only after the separate Copy text action. */
export async function copySelectedText(text:string){
 const selection=selectedText({title:'',text});visible();
 if(nativeTextSharing())await device.copyText({text:selection.text});else await navigator.clipboard.writeText(selection.text);
}
