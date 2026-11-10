import '../../../apps/app/src/runtime/connection-ui.css';
import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
import {HostedLiveSourcePicker} from '../../../apps/app/src/runtime/hosted-live-source-ui';
import {HostedDigestProtocol} from '../../../apps/app/src/runtime/hosted-digests';
// One picker stays mounted across the owner switch, so only its current() guard can refuse a late
// account response. Production also remounts it per session (key={liveBinding.sessionId}).
declare global {
  interface Window {
    switchOwner(): void;
  }
}
type SourceReview = Parameters<React.ComponentProps<typeof HostedLiveSourcePicker>['review']>[0];
let owner='owner',live=true;
const client=new HostedDigestProtocol(async(path,body,signal)=>{const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-fixture-owner':owner},body:body===undefined?undefined:JSON.stringify(body),signal});const data=await res.json();if(!res.ok)throw Object.assign(new Error('Rejected'),{status:res.status,...data});return data;});
function App(){const [review,setReview]=useState<SourceReview | null>(null),[message,setMessage]=useState('');window.switchOwner=()=>{owner='other';live=false;setReview(null)};return <section className="alpha-connection"><HostedLiveSourcePicker client={client} signal={new AbortController().signal} current={()=>live} busy={false} review={setReview}/>{review&&<section><p>{review.summary}</p><button onClick={()=>setReview(null)}>Cancel review</button><button onClick={async()=>{try{await client.mutate(review.path,review.body,new AbortController().signal);setMessage('Saved reviewed source');setReview(null)}catch(error){setMessage((error as Error).message);setReview(null)}}}>Confirm source</button></section>}<p role="status">{message}</p></section>}
createRoot(document.getElementById('root')!).render(<App/>);
