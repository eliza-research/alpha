type Snapshot={revision:string;raw:string|null};
type Documents={read(key:string):Promise<Snapshot|undefined>;readOrCreate(key:string,raw:string|null):Promise<Snapshot>;edit<T>(key:string,edit:(before:Snapshot|undefined)=>Promise<{raw:string|null;result:T}>):Promise<T>};
type Binding={ownerDigest:string;folderId:string|null};
export type PendingNoteSegment={segmentId:string;durationMs:number;text?:string;offsetMs?:number;clip?:{blob:Blob;durationMs:number}};
type Manifest={version:1;recordingId:string;binding:Binding;segments:Omit<PendingNoteSegment,'clip'>[]};
const MAX_SEGMENT_BYTES=4*1024*1024,MAX_SEGMENT_MS=30_000;
const key=(id:string)=>'alpha.browser.note-recording.v1:'+encodeURIComponent(id);
const clipKey=(id:string,segmentId:string)=>key(id)+':segment:'+encodeURIComponent(segmentId);
function manifest(raw:string,id:string,binding:Binding):Manifest{
 const value=JSON.parse(raw) as Manifest;
 if(value?.version!==1||value.recordingId!==id||value.binding?.ownerDigest!==binding.ownerDigest||value.binding?.folderId!==binding.folderId||!Array.isArray(value.segments)||!value.segments.length||value.segments.length>10000||new Set(value.segments.map(row=>row.segmentId)).size!==value.segments.length||value.segments.some(row=>typeof row.segmentId!=='string'||!row.segmentId||row.segmentId.length>160||!Number.isFinite(row.durationMs)||row.durationMs<=0||row.durationMs>MAX_SEGMENT_MS||row.text!==undefined&&(typeof row.text!=='string'||row.text.length>64000)||row.offsetMs!==undefined&&(!Number.isFinite(row.offsetMs)||row.offsetMs<0)))throw Error('Recording segment recovery needs review.');
 return value;
}
/** Pending browser capture only. The shared document store owns transactions;
 * Alpha keeps its namespace and exact standalone segments until audio is bound to a note. */
export function createNoteRecordingJournal(documents:Documents){
 return {
  async save(id:string,binding:Binding,segments:PendingNoteSegment[]){
   const value=manifest(JSON.stringify({version:1,recordingId:id,binding,segments:segments.map(({clip:_clip,...row})=>row)}),id,binding);
   for(const segment of segments){
    if(segment.offsetMs!==undefined)continue;
    if(!segment.clip||segment.clip.durationMs!==segment.durationMs||!segment.clip.blob.size||segment.clip.blob.size>MAX_SEGMENT_BYTES)throw Error('Recording segment bytes need recovery.');
    const bytes=new Uint8Array(await segment.clip.blob.arrayBuffer());let binary='';
    for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));
    const raw=JSON.stringify({version:1,recordingId:id,ownerDigest:binding.ownerDigest,segmentId:segment.segmentId,durationMs:segment.durationMs,mimeType:segment.clip.blob.type,base64:btoa(binary)});
    if((await documents.readOrCreate(clipKey(id,segment.segmentId),raw)).raw!==raw)throw Error('Recording segment changed.');
   }
   await documents.edit(key(id),async before=>{
    if(before?.raw===null)throw Error('Recording recovery was retired.');
    if(before){
     const prior=manifest(before.raw!,id,binding);
     if(prior.segments.length!==value.segments.length||prior.segments.some((row,index)=>row.segmentId!==value.segments[index].segmentId||row.durationMs!==value.segments[index].durationMs||row.offsetMs!==value.segments[index].offsetMs))throw Error('Recording segments changed.');
     value.segments=value.segments.map((row,index)=>({...row,...(prior.segments[index].text!==undefined?{text:prior.segments[index].text}:{})}));
    }
    return {raw:JSON.stringify(value),result:undefined};
   });
  },
  async read(id:string,binding:Binding):Promise<PendingNoteSegment[]|null>{
   const saved=await documents.read(key(id));if(saved?.raw==null)return null;
   const value=manifest(saved.raw,id,binding),segments:PendingNoteSegment[]=[];
   for(const segment of value.segments){
    if(segment.offsetMs!==undefined){segments.push(segment);continue;}
    const raw=(await documents.read(clipKey(id,segment.segmentId)))?.raw;if(!raw)throw Error('Recording segment bytes need recovery.');
    const clip=JSON.parse(raw);
    if(clip?.version!==1||clip.recordingId!==id||clip.ownerDigest!==binding.ownerDigest||clip.segmentId!==segment.segmentId||clip.durationMs!==segment.durationMs||typeof clip.mimeType!=='string'||typeof clip.base64!=='string'||clip.base64.length>Math.ceil(MAX_SEGMENT_BYTES/3)*4)throw Error('Recording segment changed.');
    const bytes=Uint8Array.from(atob(clip.base64),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>MAX_SEGMENT_BYTES)throw Error('Recording segment bytes need recovery.');
    segments.push({...segment,clip:{blob:new Blob([bytes],{type:clip.mimeType}),durationMs:segment.durationMs}});
   }
   return segments;
  },
  async setText(id:string,binding:Binding,segmentId:string,text:string){
   await documents.edit(key(id),async before=>{
    if(before?.raw==null)throw Error('Recording segment recovery needs review.');
    const value=manifest(before.raw,id,binding),segment=value.segments.find(row=>row.segmentId===segmentId);
    if(!segment||typeof text!=='string'||text.length>64000)throw Error('Recording segment changed.');
    segment.text=text;return {raw:JSON.stringify(value),result:undefined};
   });
  },
  async retire(id:string,binding:Binding){
   const saved=await documents.read(key(id));if(saved?.raw==null)return;
   const value=manifest(saved.raw,id,binding);
   for(const row of value.segments)if(row.offsetMs===undefined)await documents.edit(clipKey(id,row.segmentId),async()=>({raw:null,result:undefined}));
   await documents.edit(key(id),async()=>({raw:null,result:undefined}));
  },
 };
}
