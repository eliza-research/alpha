import {platformSharingAvailable,shareSelectedText} from '../runtime/text-share';
import { type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export { placeShare, routeShare, type MapShare } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/share.ts';
export const mapShareLabel=()=> 'Share';
export {platformSharingAvailable as canShareMap};

/** One selected place or route, handed to the OS as a portable link. */
export async function shareMap(data:MapShare,signal:AbortSignal):Promise<'shared'|'copied'|'closed'> {
 signal.throwIfAborted();
 const point=(value:{latitude:number;longitude:number})=>`${value.latitude},${value.longitude}`;
 let link=data.url;
 if(data.directions){
  const route=data.directions;
  const query=new URLSearchParams({api:'1',origin:point(route.from),destination:point(route.to),travelmode:{drive:'driving',walk:'walking',bicycle:'bicycling',transit:'transit'}[route.mode]});
  link=`https://www.google.com/maps/dir/?${query}`;
 }else if(data.location){
  link=`https://www.google.com/maps/search/?${new URLSearchParams({api:'1',query:point(data.location)})}`;
 }
 if(!link)throw Error('This place has no share link.');
 const url=new URL(link);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('This place has no share link.');
 if(!platformSharingAvailable())throw Error('Sharing is unavailable in this preview.');
 const result=await shareSelectedText(Object.freeze({title:data.title,text:url.href}),signal);
 return result==='opened'?'shared':result;
}
