/** Core owner-reminder boundary. No client singleton, credentials, UI or platform imports. */
export const OWNER_REMINDER_LIST = '/api/notifications?category=reminder&unreadOnly=true&limit=20';
export const OWNER_REMINDER_READBACK = '/api/notifications?category=reminder&unreadOnly=false&limit=20';
export const OWNER_REMINDER_BYTES = 65536;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function reminderReadPath(id:string) { if(!uuid.test(id)) throw Error('Invalid reminder identity'); return '/api/notifications/'+id+'/read'; }
export function ownerReminderRoute(path:unknown,method:unknown,body:unknown): boolean {
 return body===undefined && typeof path==='string' && (method==='GET'&&(path===OWNER_REMINDER_LIST||path===OWNER_REMINDER_READBACK)||method==='POST'&&/^\/api\/notifications\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/read$/i.test(path));
}
export interface ReminderOwner { readonly origin:string; readonly ownerId:string; readonly agentId:string; readonly sessionId:string; readonly generation:number; }
export interface ReminderNotificationBinding {
 readonly key:string; readonly identity:ReminderOwner;
 current():boolean; passiveAllowed():boolean; actionAllowed():boolean;
 listUnread(signal:AbortSignal):Promise<unknown>;
 readback(signal:AbortSignal):Promise<unknown>;
 markRead(id:string,signal:AbortSignal):Promise<unknown>;
 openConversation(conversationId:string,messageId:string,signal:AbortSignal):Promise<{opened:true}>;
}
export interface ReminderNotificationSource { binding():ReminderNotificationBinding|null; subscribeBinding(listener:()=>void):()=>void; }
export interface CoreReminderNotice {
 id:string; revision:string; agentId:string; title:string; text:string; at:number; readAt:number|null;
 expiresAt:number|null; groupKey:string; conversationId?:string; messageId?:string;
}
function record(value:unknown):Record<string,any> { if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid reminder response');return value as Record<string,any>; }
function keys(value:Record<string,any>,allowed:readonly string[],required:readonly string[]=[]) { if(Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('Unknown reminder response field'); }
function integer(value:unknown):value is number { return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0; }
function text(value:unknown,max:number):value is string { return typeof value==='string'&&value.length<=max; }
function canonical(value:any):string { if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value); }
export async function reminderDigest(value:unknown):Promise<string> { const raw=new TextEncoder().encode(canonical(value));const hash=await crypto.subtle.digest('SHA-256',raw);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''); }
const fields=['id','nativeEpoch','nativeSequence','title','body','category','priority','source','deepLink','icon','groupKey','data','createdAt','readAt','expiresAt','agentId'];
const dataFields=['ownerType','ownerId','subjectType','scheduledFor','dueAt','conversationId','messageId','count'];
/** Unknown fields fail closed; valid other producers remain in Core and are not imported. */
export async function parseOwnerReminderList(input:unknown,owner:ReminderOwner,now=Date.now()):Promise<CoreReminderNotice[]> {
 const envelope=record(input);keys(envelope,['notifications','unreadCount','serviceStatus'],['notifications','unreadCount','serviceStatus']);
 if(envelope.serviceStatus!=='ready'||!integer(envelope.unreadCount)||!Array.isArray(envelope.notifications)||envelope.notifications.length>20||new TextEncoder().encode(JSON.stringify(envelope)).length>OWNER_REMINDER_BYTES)throw Error('Reminder inbox unavailable');
 const ids=new Set<string>(),groups=new Set<string>(),out:CoreReminderNotice[]=[];
 for(const raw of envelope.notifications) {
  const row=record(raw);keys(row,fields,['id','title','category','priority','source','createdAt','agentId']);
  if(!text(row.id,36)||!uuid.test(row.id)||ids.has(row.id)||!text(row.agentId,36)||row.agentId!==owner.agentId||!text(row.title,256)||!row.title.trim()||row.category!=='reminder'||!['low','normal','high','urgent'].includes(row.priority)||!text(row.source,64)||!integer(row.createdAt))throw Error('Invalid reminder record');ids.add(row.id);
  if(row.body!==undefined&&!text(row.body,4096)||row.icon!==undefined&&!text(row.icon,256)||row.deepLink!==undefined&&!text(row.deepLink,256)||row.groupKey!==undefined&&!text(row.groupKey,256)||row.readAt!==undefined&&row.readAt!==null&&!integer(row.readAt)||row.expiresAt!==undefined&&row.expiresAt!==null&&!integer(row.expiresAt)||row.nativeEpoch!==undefined&&(!text(row.nativeEpoch,36)||!uuid.test(row.nativeEpoch))||row.nativeSequence!==undefined&&(!integer(row.nativeSequence)||row.nativeSequence===0))throw Error('Invalid reminder coordinates');
  const data=row.data===undefined?{}:record(row.data);if(new TextEncoder().encode(JSON.stringify(data)).length>4096)throw Error('Reminder metadata too large');
  // Other canonical producers share this inbox. Their bounded metadata is not
  // an owner-reminder contract and must never be imported or marked read here.
  if(row.source!=='lifeops'||data.ownerType!=='occurrence'||data.subjectType!=='owner')continue;
  keys(data,dataFields);
  if(data.count!==undefined&&(!integer(data.count)||data.count<1))throw Error('Invalid reminder count');
  if(!text(data.ownerId,36)||!uuid.test(data.ownerId)||row.groupKey!=='reminder:occurrence:'+data.ownerId||groups.has(row.groupKey)||!text(data.scheduledFor,64)||!Number.isFinite(Date.parse(data.scheduledFor))||data.dueAt!==null&&data.dueAt!==undefined&&(!text(data.dueAt,64)||!Number.isFinite(Date.parse(data.dueAt))))throw Error('Invalid owner reminder');groups.add(row.groupKey);
  for(const key of ['conversationId','messageId'])if(data[key]!==undefined&&(!text(data[key],36)||!uuid.test(data[key])))throw Error('Invalid reminder source target');
  if(row.expiresAt!==undefined&&row.expiresAt!==null&&row.expiresAt<=now)continue;
  out.push({id:row.id,revision:await reminderDigest(row),agentId:row.agentId,title:row.title,text:row.body||'',at:row.createdAt,readAt:row.readAt??null,expiresAt:row.expiresAt??null,groupKey:row.groupKey,...(row.deepLink==='/chat'&&data.conversationId&&data.messageId?{conversationId:data.conversationId,messageId:data.messageId}:{})});
 }
 return out;
}
