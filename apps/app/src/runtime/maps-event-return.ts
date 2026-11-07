/** The calendar event whose location was handed to Maps. It lives only in the Maps view state for
 * that visit: it is not persisted, carries no location or search text, and never replays a search. */
type EventOrigin = { id: string; begin: number; rowId: string; day: number; title: string };
export type CanonicalMapsEventOrigin = EventOrigin & {version:2;binding:string;eventKey:string;revision:string;sourceRevision:string};
export type MapsEventOrigin = EventOrigin & {version:1} | CanonicalMapsEventOrigin;
type Bag = Record<string, any>;

export function mapsEventOriginOf(value: unknown): MapsEventOrigin | undefined {
  const o = value as MapsEventOrigin | undefined;
  if (!o || typeof o !== 'object' || ![1,2].includes(o.version) || typeof o.id !== 'string' || !o.id || o.id.length > 256 || !Number.isSafeInteger(o.begin)
    || typeof o.rowId !== 'string' || !o.rowId || o.rowId.length > 512 || !Number.isSafeInteger(o.day) || typeof o.title !== 'string' || o.title.length > 2048) return;
  const base={id:o.id,begin:o.begin,rowId:o.rowId,day:o.day,title:o.title};
  if(o.version===2){
    if(typeof o.binding!=='string'||!o.binding||o.binding.length>4096||typeof o.eventKey!=='string'||!o.eventKey||o.eventKey.length>4096||typeof o.revision!=='string'||!o.revision||o.revision.length>1024||typeof o.sourceRevision!=='string'||!/^[a-f0-9]{64}$/.test(o.sourceRevision))return;
    return {...base,version:2,binding:o.binding,eventKey:o.eventKey,revision:o.revision,sourceRevision:o.sourceRevision};
  }
  return {...base,version:1};
}
/** Built from the event row whose detail page is open when its location is tapped. */
export function mapsEventOriginFor(row: unknown, day: unknown): MapsEventOrigin | undefined {
  const r = row as Bag | undefined;
  if (!r || r.alphaCalendarId === undefined || r.alphaCalendarId === null || !r.nativeEvent) return;
  return mapsEventOriginOf({ version: 1, id: String(r.alphaCalendarId), begin: r.nativeEvent.begin, rowId: r.id, day: Number.isSafeInteger(day) ? day : r.off, title: String(r.title || '').slice(0, 2048) });
}
/** A canonical handoff carries only the selected record identity and its owner/session revision. */
export function canonicalMapsEventOriginFor(row:Bag,day:unknown,binding:string,selection:{revision:string;sourceRevision?:string}|undefined):CanonicalMapsEventOrigin|undefined {
  if(!row.canonicalEvent||!selection?.sourceRevision)return;
  const value=mapsEventOriginOf({version:2,id:row.canonicalEvent.id,begin:Date.parse(row.canonicalEvent.startAt),rowId:row.id,day:Number.isSafeInteger(day)?day:row.off,title:String(row.title||'').slice(0,2048),binding,eventKey:row.canonicalEventKey,revision:selection.revision,sourceRevision:selection.sourceRevision});
  return value?.version===2?value:undefined;
}
/** "Back to event" is offered only while Calendar is the view Maps was opened from. */
export function mapsEventReturnOffered(value: unknown, stack: unknown, navigating: boolean): MapsEventOrigin | undefined {
  const origin = mapsEventOriginOf(value);
  return origin && !navigating && Array.isArray(stack) && stack.length > 0 && stack[stack.length - 1] === 'calendar' ? origin : undefined;
}
/** Fails closed: exactly one current event must have the stored identity and start. */
export function mapsEventStillThere(value: unknown, events: unknown): boolean {
  const origin = mapsEventOriginOf(value);
  return origin?.version===1 && Array.isArray(events) && events.filter((e: Bag) => e && String(e.id) === origin.id && e.begin === origin.begin).length === 1;
}
