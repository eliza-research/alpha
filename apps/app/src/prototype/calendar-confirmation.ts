import {BrowserReviews} from '../browser/review';
import {connectionController} from '../runtime/connection-ui';
import {alphaClient} from '../runtime/alpha-client';
type Bag=Record<string,any>;
const reviews=new BrowserReviews();
let active:AbortController|undefined;
/** A review belongs to this exact Calendar drawing and connection, even if a prior view later reappears. */
export async function confirmCalendarAction(shell:Bag,api:Bag,title:string,details:string,confirmLabel:string,current:()=>boolean):Promise<boolean>{
 if(active)return false;
 const abort=active=new AbortController(),drawing=shell.vget('calendar');
 // vget returns a merged copy. Bind the actual form reference and selection values, not that copy.
 const sameDrawing=()=>{const now=shell.vget('calendar');return ['form','open','openDay','day','month','calendarAuthority'].every(key=>now[key]===drawing[key]);};
 const binding=()=>{const value=connectionController.getSnapshot();return JSON.stringify([value.session,value.history?.conversationId,value.cloudAccount]);};
 const connection=binding(),context=JSON.stringify(alphaClient.getState().context);
 const valid=()=>{try{return !abort.signal.aborted&&shell.live&&api.isActive()&&!document.hidden&&sameDrawing()&&binding()===connection&&JSON.stringify(alphaClient.getState().context)===context&&current();}catch{return false;}};
 const retire=()=>{if(!valid())abort.abort();};
 const unsubscribe=connectionController.subscribe(retire),unobserve=alphaClient.subscribe(retire);
 try{return await reviews.confirm('calendar-action',title,details,confirmLabel,{signal:abort.signal,current:valid})&&valid();}
 finally{unsubscribe();unobserve();if(active===abort)active=undefined;abort.abort();}
}
