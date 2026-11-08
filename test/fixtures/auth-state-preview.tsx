// Local UI review only. No native ports, credentials, accounts or network requests.
import React, {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CloudSignInPanel} from '../../apps/app/src/runtime/cloud-sign-in-ui';
import type {SignInView} from '../../apps/app/src/runtime/connection-ui';
import '../../apps/app/src/runtime/connection-ui.css';

const choose:SignInView={step:'choose',environment:'production'};
function Preview(){
  const [view,setView]=useState<SignInView>(choose),[busy,setBusy]=useState(false),[ready,setReady]=useState(true);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
  const generation=useRef(0);
  const cancel=()=>{generation.current++;setView(choose);setBusy(false);setMessage('');setError('');};
  const later=(message:string,complete:()=>void)=>{const id=++generation.current;setBusy(true);setMessage(message);setError('');setTimeout(()=>{if(id!==generation.current)return;setBusy(false);setMessage('');complete();},1800);};
  return <>
    <aside className="review-toolbar" aria-label="Local review controls">
      <strong>Local auth UI review · simulated responses</strong>
      <span>No sign-in requests are sent. Use an example email and code 123456; other codes show the retry state.</span>
      <button onClick={()=>{cancel();setReady(true);setDone(false);}}>Restart review</button>
      <button onClick={()=>{cancel();setReady(false);setDone(false);setError('Alpha sign-in is temporarily unavailable. Try again.');}}>Show readiness failure</button>
    </aside>
    <main className="alpha-auth-page"><section className="alpha-connection alpha-connection-native alpha-cloud-sign-in alpha-auth-content" aria-label="Alpha sign-in review">
      {done?<><h1>UI flow complete.</h1><p>This was a local simulation. No account was signed in.</p><button onClick={()=>{cancel();setDone(false);}}>Review again</button></>:<CloudSignInPanel
        view={view} busy={busy} ready={ready} dismissible={false} google={true} message={message} error={error}
        actions={{
          cancel,
          google:()=>{setView({step:'google',environment:'production'});later('Waiting for the Google account picker…',()=>{setView(choose);setError('Google sign-in was cancelled. You can try again or use email.');});},
          email:email=>later('Sending your code…',()=>setView({step:'code',environment:'production',email,attemptId:String(generation.current),expiresAt:Date.now()+600000,resendAt:Date.now()+30000})),
          verify:code=>later('Checking your code…',()=>{if(code!=='123456'){setError('That code didn’t work.');return;}setDone(true);}),
          resend:()=>{if(view.step==='code')later('Sending your code…',()=>setView({...view,attemptId:String(generation.current),resendAt:Date.now()+30000}));},
        }}
        extra={!ready&&!busy?<button onClick={()=>later('Checking Eliza Cloud sign-in…',()=>setReady(true))}>Retry sign-in</button>:undefined}
      />}
    </section></main>
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
