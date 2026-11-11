import {shareSelectedText} from '../runtime/text-share';
import { type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export { placeShare, routeShare, type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export async function shareMap(data:MapShare,signal:AbortSignal):Promise<'shared'|'copied'|'closed'> {
 signal.throwIfAborted();
 const snapshot=Object.freeze({title:data.title,text:[data.text,data.url].filter(Boolean).join('\n')});
 const result=await shareSelectedText(snapshot,signal);
 return result==='opened'?'shared':result;
}
