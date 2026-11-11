import {CALENDAR_APPROVAL_READ_PATH,calendarApprovalFromList,calendarApprovalId,calendarApprovalPending,calendarApprovalResolvePath,parseCalendarApprovalResolution,type CalendarApproval,type CalendarApprovalDecision} from './calendar-approval.ts';

export interface CalendarApprovalConnection {
 ownerId:string;
 /** Captured connection, authenticated owner, conversation and foreground admission. */
 current():void;
 request(path:string,body:unknown,signal:AbortSignal,headers?:Record<string,string>,method?:string):Promise<unknown>;
}
/** A decision consumes one exact authenticated read. Recovery only reads; it never dispatches. */
export class CalendarApprovalClient {
 private reads=new WeakMap<CalendarApproval,{connection:CalendarApprovalConnection;bytes:string;id:string;revision:string}>();
 private connect:(signal:AbortSignal)=>CalendarApprovalConnection;
 constructor(connect:(signal:AbortSignal)=>CalendarApprovalConnection){this.connect=connect;}
 async read(id:string,signal:AbortSignal):Promise<CalendarApproval|null>{
  if(!calendarApprovalId(id))throw Error('Calendar review is unavailable.');
  const connection=this.connect(signal);
  signal.throwIfAborted();connection.current();
  const raw=await connection.request(CALENDAR_APPROVAL_READ_PATH,undefined,signal);
  signal.throwIfAborted();connection.current();
  const row=calendarApprovalFromList(raw,id,connection.ownerId);
  if(row)this.reads.set(row,{connection,bytes:JSON.stringify(row),id:row.id,revision:row.revision});
  return row;
 }
 async resolve(row:CalendarApproval,decision:CalendarApprovalDecision,signal:AbortSignal){
  const read=this.reads.get(row);
  if(!read||!calendarApprovalPending(row)||!['approve','reject'].includes(decision))throw Error('Check this Calendar request again before choosing.');
  signal.throwIfAborted();read.connection.current();
  if(JSON.stringify(row)!==read.bytes)throw Error('This Calendar request changed. Check it again before choosing.');
  // Consume before the first await: a second tap, a lost reply or a cancelled read cannot resend.
  this.reads.delete(row);
  const raw=await read.connection.request(calendarApprovalResolvePath(read.id),{decision,revision:read.revision},signal,{},'POST');
  signal.throwIfAborted();read.connection.current();
  return parseCalendarApprovalResolution(raw,read.id,decision);
 }
}
