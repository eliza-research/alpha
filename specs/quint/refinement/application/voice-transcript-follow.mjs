import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {captureInputs,checkTraces} from '../check-traces.mjs';

const driver=fileURLToPath(import.meta.url),root=new URL('../../../../',import.meta.url);
const product='apps/app/src/prototype/model.js';

function compile(source){
 const start=source.indexOf('  componentDidMount() {',source.indexOf('class Component extends'));
 const end=source.indexOf('  componentDidUpdate(prev) {',start);
 assert.ok(start>=0&&end>start,'exact shell lifecycle/snapshot source boundaries');
 const marker='    var newTurn = voiceTurn ||';
 const methods=source.slice(start,end);
 assert.equal(methods.split(marker).length,2,'one read-only voice snapshot observation');
 return `class Shell { constructor(){this.state={chat:'hidden',typing:false,msgs:[{id:'old',from:'user',text:'Earlier',messageBinding:{conversationId:'owned'}}]};this.props={};} S(){return this.state;} preset(){} setState(patch){Object.assign(this.state,patch);}
 ${methods.replace(marker,'    this.observedVoiceTurn=!!voiceTurn; if(voiceTurn)this.observedVoiceFollows=(this.observedVoiceFollows||0)+1;\n'+marker)}
 };globalThis.Shell=Shell;`;
}

function fixture(code){
 const dom=new JSDOM('<input id="focus"><div data-alpha-transcript><span>Reading transcript</span></div>',{pretendToBeVisual:true});
 const {document}=dom.window,list=document.querySelector('[data-alpha-transcript]');
 Object.defineProperties(list,{scrollHeight:{value:1000},clientHeight:{value:100}});
 list.scrollTop=100;
 const context=vm.createContext({window:dom.window,document,Element:dom.window.Element,structuredClone,
  setInterval:()=>1,CHAT_PAGE_ROWS:100,CHAT_CLOSED_ROWS:20});
 vm.runInContext(code,context);
 const shell=new context.Shell();shell.componentDidMount();
 const focused=document.getElementById('focus');focused.focus();
 let snapshot=false;
 const observe=()=>{
  const row=shell.S().msgs.filter(message=>message.from==='user').at(-1),isNew=row.id==='new';
  return {'s.open':['sheet','full'].includes(shell.S().chat),'s.opened':!!shell.voiceScrollOpened,
   's.atBottom':list.scrollHeight-list.scrollTop-list.clientHeight<80,'s.selecting':!dom.window.getSelection().isCollapsed,
   's.pending':!!shell.voiceScrollPending,'s.baseline':shell.voiceScrollLastUserId==='new'?1:0,
   's.row':isNew?1:0,'s.delivered':isNew,
   's.sameConversation':!isNew||row.messageBinding.conversationId==='owned',
   's.sameText':!isNew||row.text.trim()==='Accepted transcript',
   's.follow':snapshot&&!!shell.observedVoiceTurn,'s.follows':shell.observedVoiceFollows||0,
   's.focus':document.activeElement===focused?0:1};
 };
 const apply=action=>{
  snapshot=false;
  if(action.startsWith('begin')){
   shell.state.chat=action==='beginMinimized'?'hidden':'sheet';
   list.scrollTop=action==='beginAtBottom'?900:100;
   shell.beginVoiceScrollFollow();shell.state.chat='sheet';
  }else if(action==='accept')shell.followVoiceTurn('owned','  Accepted transcript  ');
  else if(action.startsWith('deliver'))shell.state.msgs.push({id:'new',from:'user',
   text:action==='deliverOtherText'?'Different transcript':'Accepted transcript',
   messageBinding:{conversationId:action==='deliverOtherConversation'?'foreign':'owned'}});
  else if(action==='readHistory'||action==='selectText'){
   list.scrollTop=100;
   if(action==='selectText'){const range=document.createRange();range.selectNodeContents(list.querySelector('span'));dom.window.getSelection().removeAllRanges();dom.window.getSelection().addRange(range);}
   list.dispatchEvent(new dom.window.Event(action==='selectText'?'pointerdown':'wheel',{bubbles:true}));
  }else if(action==='changeAccount')shell.cancelVoiceScrollFollow();
  else if(action==='close'){shell.state.chat='hidden';shell.cancelVoiceScrollFollow();}
  else if(action==='render'){
   snapshot=true;shell.getSnapshotBeforeUpdate({},structuredClone(shell.state));
  }else throw Error('Unknown source fixture action '+action);
 };
 return {observe,apply,close:()=>dom.window.close()};
}

export async function checkVoiceTranscriptFollow(extraSources=[]){
 const sources=[product,'apps/app/src/prototype/voice-adapter.ts','apps/app/src/prototype/agent-adapter.ts',
  'apps/app/src/runtime/development-cartesia-conversation.ts',
  'test/quint-application-refinement.test.mjs',driver,...extraSources];
 const hashes=captureInputs(sources),temporary=mkdtempSync(join(tmpdir(),'alpha-voice-follow-'));
 const generated=join(temporary,'shell-observer.js');
 try{
  writeFileSync(generated,compile(readFileSync(new URL(product,root),'utf8')),{mode:0o600});
  const driverHashes={...hashes,...captureInputs([generated])},traces=[];
  const scenarios=[
   ['acceptance before delivery',['beginMinimized','accept','render','deliver','render','render']],
   ['delivery before acceptance',['beginMinimized','deliver','render','accept','render','render']],
   ['one shot at bottom',['beginAtBottom','accept','deliver','render','render']],
   ['wheel before acceptance',['beginMinimized','readHistory','accept','deliver','render']],
   ['selection after acceptance',['beginMinimized','accept','selectText','deliver','render']],
   ['already reading history',['beginInHistory','accept','deliver','render']],
   ['foreign conversation',['beginMinimized','accept','deliverOtherConversation','render']],
   ['different transcript',['beginMinimized','accept','deliverOtherText','render']],
   ['owner retirement cancels intent',['beginMinimized','accept','changeAccount','deliver','render']],
   ['closed chat cancels intent',['beginMinimized','accept','close','deliver','render']],
  ];
  for(const [name,actions] of scenarios){
   const f=fixture(readFileSync(generated,'utf8'));
   try{const t={name,init:{name:'init'},expect:f.observe(),steps:[]};
    for(const action of actions){f.apply(action);t.steps.push({label:'Actual source '+action,action:{name:action},expect:f.observe()});}
    traces.push(t);
   }finally{f.close();}
  }
  return await checkTraces({model:'VoiceTranscriptFollow',sources:[...sources,generated],driverHashes,generatedSources:[generated],traces,
   scope:'bounded-component',assumptions:[
    'Unchanged shell lifecycle, voice-follow and snapshot methods execute in JSDOM. A read-only observer records the actual local voiceTurn result and count; it does not reproduce the predicate.',
    'Transcript delivery, accepted-final invocation and owner retirement are explicit caller ports. The real mounted reading-input listeners, DOM selection and active element execute. Geometry is controlled; actual React commit scrolling, native input, ASR acceptance/deduplication and whole-session retirement remain separate obligations.',
    'The model projects only observable scroll intent, message identity, selection and focus. Its current/accepted/cancelled lifecycle fields are not independently established by this bounded shell fixture. No model state or expected result drives source execution.',
   ]});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
