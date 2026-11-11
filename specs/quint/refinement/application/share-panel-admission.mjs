import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, sourceContext, tick, trace} from './support.mjs';
const source='apps/app/src/runtime/share-panel.ts';
export async function checkSharePanelAdmission(extraSources=[]){
 const sources=[source,fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources),traces=[];
 for(const outcome of ['success','cancel','failure']){
  const document={hidden:false};let current=true,calls=0,finished=0,resolve,reject,pending;
  const {openSharePanel}=sourceContext([source],['openSharePanel'],{document});
  const mark=()=>({'s.busy':calls>finished,'s.calls':calls,'s.finished':finished,'s.hidden':document.hidden,'s.current':current});
  const t=trace(outcome+' and repeat protection',mark());
  const open=async()=>{
   const before=calls;
   const p=openSharePanel({current:()=>current,external:()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});}});
   if(calls>before)pending=p.then(()=>{finished++;},error=>{if(outcome!=='failure')throw error;finished++;});
   await tick();checkpoint(t,'Attempt platform share',call('open'),mark());
  };
  await open();await open();
  current=false;checkpoint(t,'Selection changes',call('selection',false),mark());
  if(outcome==='cancel')reject(new DOMException('Canceled','AbortError'));
  else if(outcome==='failure')reject(Error('Platform refused'));
  else resolve();
  await pending;checkpoint(t,'Platform settles',call('finish'),mark());
  await open();current=true;checkpoint(t,'Selection restored',call('selection',true),mark());
  document.hidden=true;checkpoint(t,'Document hidden',call('visibility',true),mark());await open();
  document.hidden=false;checkpoint(t,'Document shown',call('visibility',false),mark());await open();
  resolve();await pending;checkpoint(t,'Second platform share settles',call('finish'),mark());traces.push(t);
 }
 return checkTraces({model:'SharePanelAdmission',sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'The actual dispatch function runs with a controlled document and platform port. No real file or text leaves the device.',
  'Covers repeated taps, hidden documents, changed selections, success, cancellation and platform failure. Native share UI and delivery need device evidence.',
  'The platform owns an open chooser. Completing or canceling releases admission. No fallback destination is invoked.'
 ]});
}
