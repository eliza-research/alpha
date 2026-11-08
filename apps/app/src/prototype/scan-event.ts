import {reviewScanAllDayEvent,reviewScanEvent,type ScanEventFields,type ScanEventProposal,type ScanEventRepeat} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-event.ts';
/** Poster/flyer suggestions (J01) are the shared plugin-files rules: explicit or disclosed inferences only, never a save. */
export {suggestScanEvent,suggestScanEventDetails,type ScanEventContext,type ScanEventFields,type ScanEventRepeat,type ScanEventSuggestion} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-event.ts';
/** `creationId` makes Calendar retain the form under review (calendar-form-draft-adapter) and binds its one Save. */
export type ScanEventDraft={id:null;creationId:string;separateCreation:false;title:string;off:number;t:number;d:number;where:string;notes:string;cal:'native:local';who:never[];repeat:ScanEventRepeat;alert:null;video:false;allDay?:true};
/** Alpha's local Calendar form for a validated proposal. Calendar's own review and Save remain the only write. */
function calendarDraft(proposal:ScanEventProposal):ScanEventDraft{
 const draft=(t:number,d:number)=>({id:null,creationId:crypto.randomUUID(),separateCreation:false as const,title:proposal.title,off:proposal.dayOffset,t,d,where:proposal.location,notes:proposal.notes,cal:'native:local' as const,who:[],repeat:proposal.repeat,alert:null,video:false as const});
 if(proposal.allDay||proposal.time===undefined||proposal.minutes===undefined)return {...draft(0,24),allDay:true as const};
 const [hour,minute]=proposal.time.split(':').map(Number);
 return draft(hour+minute/60,proposal.minutes/60);
}
/**
 * All-day Calendar draft from a reviewed date: one civil day, no time. It never saves; Calendar's
 * own Save writes it as an all-day provider event after review.
 */
export function scanAllDayEventDraft(fields:Pick<ScanEventFields,'title'|'date'|'location'>&{repeat?:ScanEventRepeat},text:string,now=new Date()):ScanEventDraft{return calendarDraft(reviewScanAllDayEvent(fields,text,now));}
/** Builds a Calendar draft from reviewed fields. It never saves: Calendar's own Save remains the only write. */
export function scanEventDraft(fields:ScanEventFields&{allDay?:boolean;repeat?:ScanEventRepeat},text:string,now=new Date()):ScanEventDraft{return calendarDraft(reviewScanEvent(fields,text,now));}
