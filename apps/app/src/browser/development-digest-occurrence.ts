import {DIGEST_MISSED_TEXT as MISSED_TEXT,DIGEST_PAUSED_TEXT,DIGEST_RUN_WINDOW_MS as RUN_WINDOW_MS,digestOccurrenceMissed,digestSourceState as sharedSourceState} from '../../../../.eliza/client-features/plugins/plugin-workflow/src/services/hosted-digest-policy.ts';
/**
 * Occurrence admission for development digest schedules. Pure, so it is tested without a browser.
 * The run window, record texts and source state are the agent's own shared occurrence policy
 * (`plugins/plugin-workflow/src/services/hosted-digest-policy.ts`, used by `digestAdmission`); this
 * file adds only the development scheduler's civil-time bookkeeping:
 *  - a lapsed source is checked first and yields one explicit `unavailable` record that pauses the
 *    schedule until a new source is reviewed;
 *  - an occurrence more than 30 minutes late is recorded as `missed` and never run;
 *  - an occurrence is settled at most once.
 * Development schedules exist only with ELIZA_DEV_ALLOW_TEST_MOCKS.
 */
export type OccurrenceLoop={active:boolean;removed?:boolean;createdAt:number;spec:{timeZone:string;localTime:string};
 /** Newest settled civil time (`YYYY-MM-DDTHH:MM`). */
 lastOccurrence?:string;
 /** Settled civil times, ascending and bounded. Absent on documents written before it existed. */
 settledOccurrences?:string[];
 /** Civil times at or before this are treated as settled: history that is no longer listed. */
 settledFloor?:string;
 /** Set with the one `unavailable` record; a new reviewed version of the loop clears it. */
 sourcePaused?:true};
export type Occurrence={at:number;local:string;missed:boolean};
/** Agent: an occurrence admitted more than this long after its time is missed. */
export const DIGEST_RUN_WINDOW_MS=RUN_WINDOW_MS;
export const DIGEST_MISSED_TEXT=MISSED_TEXT;
export const DIGEST_UNAVAILABLE_TEXT=DIGEST_PAUSED_TEXT;
const SETTLED_LIMIT=32;
/** Agent `digestSourceState`: revocation wins, and a source expires at its expiry instant. */
export function digestSourceState(source:{revoked:boolean;expiresAt:string},now:number):'current'|'expired'|'revoked'{
 return sharedSourceState(source,now);
}
const formats=new Map<string,Intl.DateTimeFormat>();
/** Civil minute of an instant in a zone, `YYYY-MM-DDTHH:MM`. Throws for an unknown zone. */
export function wall(at:number,zone:string){let format=formats.get(zone);if(!format){format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formats.set(zone,format);}const p=Object.fromEntries(format.formatToParts(at).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
const latest=new Map<string,{at:number;local:string}|null>();
const civil=(local:string)=>Date.parse(local+':00Z');
/** The most recent instant at or before this minute whose civil time is the reviewed local time.
 * Repeated civil times resolve to their earlier instant. A civil time the zone skips (start of
 * daylight saving) runs one gap later (02:30 -> 03:30 for a one-hour gap), as the agent's cron scan
 * (`computeNextCronRunAtMs`) does. */
function latestOccurrence(zone:string,localTime:string,minute:number){
 const key=zone+'|'+localTime+'|'+minute;if(latest.has(key))return latest.get(key)!;
 let found:{at:number;local:string}|null=null,after:string|undefined;
 for(let at=minute;at>minute-26*3600000;at-=60000){const local=wall(at,zone),next=after;after=local;
  // Stepping back from at+1min, a civil jump of more than a minute is a spring-forward gap: the civil
  // times strictly between `local` and `next` do not exist that day.
  // A gap can cross midnight (America/Santiago skips 00:00), so the skipped time may be on either day.
  if(next!==undefined&&civil(next)-civil(local)>60000){const skipped=[local,next].map(day=>civil(day.slice(0,11)+localTime)).find(time=>time>civil(local)&&time<civil(next));
   if(skipped!==undefined){const shifted=at+60000+(skipped-civil(local)-60000);
    if(shifted<=minute){found={at:shifted,local:wall(shifted,zone)};break;}}}
  if(local.slice(11)!==localTime)continue;
  let first=at;for(let delta=60000;delta<=3*3600000;delta+=60000)if(wall(at-delta,zone)===local)first=at-delta;
  found={at:first,local};break;}
 if(latest.size>200)latest.clear();latest.set(key,found);return found;
}
/**
 * One occurrence to settle now, or null. Only the most recent occurrence is considered, so a long
 * absence yields one record and no backlog.
 *
 * Ahead of every settled occurrence: it runs when at most 30 minutes late, otherwise it is recorded
 * once as missed and never run late.
 *
 * At or behind the newest settled occurrence (the clock was moved back, for example after a jump
 * forward settled a later day): an occurrence that was itself settled never settles again, so nothing
 * runs twice. One that was never settled and is not older than the remembered history follows the
 * same rule as any other: it runs when at most 30 minutes late and is otherwise recorded once as
 * missed, so a jump forward neither suppresses the real occurrences before it nor lets one pass
 * without a record. Only the most recent occurrence before `now` is ever considered, so a clock set
 * back onto an earlier day yields at most one truthful record for that day and never a backlog.
 *
 * Limits: an occurrence at or below `settledFloor` (older than the 32 remembered settlements, or
 * behind the newest record of a document written before the list existed) is treated as settled and
 * leaves no record; a civil time a zone skips (start of daylight saving) runs one gap later that day,
 * as on the agent, whose cron scan shifts a skipped time by the gap.
 */
export function scheduledOccurrence(loop:OccurrenceLoop,now:number):Occurrence|null{
 if(!loop.active||loop.removed||loop.sourcePaused)return null;
 const found=latestOccurrence(loop.spec.timeZone,loop.spec.localTime,Math.floor(now/60000)*60000);
 if(!found||loop.createdAt>found.at)return null;
 const missed=digestOccurrenceMissed(found.at,now);
 if(loop.lastOccurrence===undefined||found.local>loop.lastOccurrence)return {...found,missed};
 const settled=loop.settledOccurrences;
 // Without a settled list (an older document) everything up to the newest record counts as settled.
 if(!settled||settled.includes(found.local)||found.local===loop.lastOccurrence||(loop.settledFloor!==undefined&&found.local<=loop.settledFloor))return null;
 return {...found,missed};
}
/**
 * Settlement memory a new version of a schedule keeps from the one it replaces. Settled civil times
 * are compared as text, so they carry over only within one time zone: after a zone change the same
 * text names a different instant, and keeping it would silently suppress the first occurrence in the
 * new zone ("12:30" already settled in Auckland, then due in Los Angeles). Nothing can run twice
 * without it: a new version never settles an occurrence from before its own creation.
 */
export function carriedSettlement(old:OccurrenceLoop|undefined,timeZone:string):Pick<OccurrenceLoop,'lastOccurrence'|'settledOccurrences'|'settledFloor'>{
 if(!old||old.spec.timeZone!==timeZone)return {};
 return {...(old.lastOccurrence?{lastOccurrence:old.lastOccurrence}:{}),...(old.settledOccurrences?{settledOccurrences:[...old.settledOccurrences]}:{}),...(old.settledFloor?{settledFloor:old.settledFloor}:{})};
}
/** Records an occurrence as settled before anything else happens for it. */
export function settleOccurrence(loop:OccurrenceLoop,local:string){
 let settled=loop.settledOccurrences;
 if(!settled){settled=[];if(loop.lastOccurrence!==undefined){settled.push(loop.lastOccurrence);loop.settledFloor=loop.lastOccurrence;}}
 if(!settled.includes(local))settled.push(local);
 settled.sort();
 while(settled.length>SETTLED_LIMIT)loop.settledFloor=settled.shift();
 loop.settledOccurrences=settled;
 if(loop.lastOccurrence===undefined||local>loop.lastOccurrence)loop.lastOccurrence=local;
}
