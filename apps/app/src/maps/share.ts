import {openSharePanel,composeSharedText,sharedTextEmailAvailable} from '../runtime/share-panel';
import {shareSelectedText,copySelectedText} from '../runtime/text-share';
import { type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export { placeShare, routeShare, type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export function shareMap(data:MapShare,signal:AbortSignal):Promise<'shared'|'copied'|'closed'> {
 signal.throwIfAborted();let copied:Promise<unknown>|undefined;const snapshot=Object.freeze({title:data.title,text:[data.text,data.url].filter(Boolean).join('\n')});
 return openSharePanel({title:snapshot.title,current:()=>!signal.aborted,external:()=>shareSelectedText(snapshot,signal),email:sharedTextEmailAvailable()?()=>composeSharedText(snapshot.title,snapshot.text):undefined,copy:()=>{copied=Promise.resolve(copySelectedText(data.url||snapshot.text));return copied;},copyLabel:data.url?'Copy link':'Copy text'}).then(async()=>copied?await copied.then(()=>'copied' as const,()=>'closed' as const):'closed');
}
