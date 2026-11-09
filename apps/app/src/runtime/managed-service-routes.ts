import {productionCloud} from './cloud-deployment.generated.ts';
/** Product transport admits managed services, never agent hosts or provisioning. */
const MAPS_POST=/^\/api\/v1\/maps\/(?:geocode|reverse|places\/search|places\/details|routes)$/;
const CALENDAR_EVENTS='/api/v1/eliza/google/calendar/events';
const CALENDAR_EVENT=/^\/api\/v1\/eliza\/google\/calendar\/events\/[A-Za-z0-9_]{1,1024}$/;
/** Owner-side Google Calendar writes: POST creates (JSON body, no query), PATCH changes one event
 * (JSON body, no query), DELETE removes one (query names side, grant and calendar; no body).
 * Null when the path is not an events route; false when it is but the request shape is wrong. */
export function googleCalendarEvents(path:string,query:string,method:string,hasBody:boolean):boolean|null {
 if(path===CALENDAR_EVENTS)return method==='POST'&&!query&&hasBody;
 if(!path.startsWith(CALENDAR_EVENTS+'/'))return null;
 if(!CALENDAR_EVENT.test(path))return false;
 if(method==='PATCH')return !query&&hasBody;
 if(method==='DELETE')return !!query&&!hasBody;
 return false;
}
export function managedServiceRequest(url:string,method:string,hasBody=false):boolean {
 let parsed:URL;try{parsed=new URL(url);}catch{return false;}
 if(parsed.origin!==productionCloud.api||parsed.username||parsed.password||parsed.hash)return false;
 const path=parsed.pathname;
 if(/[\\%]/.test(path)||path.includes('//'))return false;
 if(path==='/api/v1/eliza/google/calendar/sync-v1/capabilities')return method==='GET'&&!!parsed.search&&!hasBody;
 if(path==='/api/v1/eliza/google/calendar/sync-v1/event')return (method==='GET'||method==='DELETE')?!!parsed.search&&!hasBody:(method==='POST'||method==='PATCH')&&!parsed.search&&hasBody;
 const calendarEvent=googleCalendarEvents(path,parsed.search,method,hasBody);
 if(calendarEvent!==null)return calendarEvent;
 if(method==='DELETE')return path==='/api/v1/api-keys/current'&&!parsed.search&&!hasBody;
 // Eliza Cloud Maps (#412): queries and coordinates travel only in a JSON body; capabilities is a bare read.
 if(method==='POST'&&MAPS_POST.test(path))return !parsed.search&&hasBody;
 if(path==='/api/v1/maps/capabilities')return method==='GET'&&!parsed.search&&!hasBody;
 if(method==='POST')return !parsed.search&&(path==='/api/auth/cli-session'||path==='/api/v1/subscription/redeem'&&hasBody||path==='/api/v1/eliza/google/connect/initiate'||path==='/api/v1/eliza/google/disconnect'||path==='/api/v1/eliza/google/gmail/inbox-v1/operations'||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/[A-Za-z0-9_-]{1,160}\/dispatch$/.test(path));
 if(method!=='GET'||hasBody)return false;
 return /^\/api\/auth\/cli-session\/[0-9a-fA-F-]{36}$/.test(path)||['/api/v1/user','/api/v1/billing/limits','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys','/api/v1/eliza/google/accounts','/api/v1/eliza/google/status','/api/v1/eliza/google/calendar/calendars','/api/v1/eliza/google/calendar/feed','/api/v1/eliza/google/gmail/search','/api/v1/eliza/google/gmail/read'].includes(path)||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/(capabilities|thread|attachment|drafts|draft)$/.test(path)||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/[A-Za-z0-9_-]{1,160}$/.test(path);
}
