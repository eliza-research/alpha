import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
// Source/DOM contract regime: the actual template, adapter closure and model method; no browser,
// model, network or app startup.
const adapter=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const template=readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8');
const model=readFileSync(new URL('../apps/app/src/prototype/model.js',import.meta.url),'utf8');
const doc=new JSDOM(template.replace(/\sstyle="[^"]*"/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')).window.document;

const start=adapter.indexOf('    const live:Shell[]=this.S().msgs||[];'),end=adapter.indexOf('    // A chat-started workflow run replies',start);
assert(start>=0&&end>start,'actual chat card projection is present');
const project=new Function('collapseSystemNotices','out',`${stripTypeScriptTypes(adapter.slice(start,end),{mode:'strip'})};return out.msgs;`);
const rendered=card=>({id:card.id,isAgent:true,text:card.text,displayText:card.text,hasCalendarText:true,cGeneric:true,c:card.card});
function cards(stored,shell={}){
 const calls=[],self={S:()=>({msgs:stored}),cardAct:message=>calls.push(['approve',message.id]),declineCard:message=>calls.push(['decline',message.id]),...shell};
 return {rows:project.call(self,list=>list,{ic:{right:'R',x:'X'},msgs:stored.map(rendered)}),calls};
}
const proposal=(id,extra={})=>({id,from:'agent',text:'Create note',card:{type:'generic',proposalId:id,title:'Create note',sub:'Create note\nTitle: Milk',expiresAt:Date.now()+60_000,...extra}});

test('a missing pending proposal disables review without inventing a zero-effect outcome',async()=>{
 const from=adapter.indexOf('  function recoverPendingActions('),to=adapter.indexOf('  /** The stopped-reply state',from);
 assert(from>=0&&to>from,'actual pending-action recovery is present');
 for(const outcome of ['applied','unknown','cancelled']){
  const context={view:'home',sensitive:false},session={sessionId:'session'},original=proposal('request-one');
  let state={typing:false,msgs:[original]};
  const snapshot={session,phoneActionsAvailable:true,history:{revision:1},actionHistory:[{id:'request-one',outcome}]};
  const recover=new Function('connectionController','alphaClient','document','retainReadReply','proposalCard',`${stripTypeScriptTypes(adapter.slice(from,to),{mode:'strip'})};return recoverPendingActions;`)(
   {getSnapshot:()=>snapshot,pendingActions:async()=>[]},{getState:()=>({context})},{hidden:false},()=>assert.fail('no read reply'),()=>assert.fail('no pending proposal'));
  const shell={live:true,S:()=>state,setState:(update,done)=>{const patch=update(state);if(patch)state={...state,...patch};done?.();}};
  recover(shell);await new Promise(resolve=>setImmediate(resolve));
  const card=state.msgs[0].card;
  assert.equal(card.reviewUnavailable,true,outcome);
  assert.equal(card.done,undefined,outcome);
  assert.equal(card.proposalId,original.card.proposalId,outcome);
  assert.doesNotMatch(card.sub,/nothing was (?:done|changed|sent|saved)|belongs to a different screen/i,outcome);
 }
});

test('a pending action has a labelled Approve and a Decline, and only the card in progress says so',()=>{
 const stored=[proposal('a'),proposal('b')];
 let {rows,calls}=cards(stored);
 assert.deepEqual(rows[0].rows.map(row=>[row.who,row.label||'']),[['Create note','Approve'],['Decline','']]);
 assert.equal(rows[0].rows[0].text,'Title: Milk');assert.equal(rows[0].actionReviewClass,'alpha-action-review');
 rows[0].rows[0].open();rows[1].rows[1].open();assert.deepEqual(calls,[['approve','a'],['decline','b']]);
 // Approving `a`: its row reports progress, `b` keeps its title, and neither accepts a second tap.
 ({rows,calls}=cards(stored,{pendingActionApproval:{},pendingActionApprovalProposalId:'a'}));
 assert.deepEqual(rows.map(row=>row.rows[0].who),['Working…','Create note']);assert.equal(rows[0].rows[0].label,'');
 rows[1].rows[0].open();rows[1].rows[1].open();assert.deepEqual(calls,[]);
 ({rows}=cards(stored,{decliningProposal:'b'}));
 assert.deepEqual(rows.map(row=>row.rows[1].who),['Decline','Declining…']);
});

test('a card that only leads to the screen where the choice is made says Open',()=>{
 const {rows}=cards([proposal('n',{reviewDestination:'notes',title:'Review note'})]);
 assert.equal(rows[0].rows[0].label,'Open');
});

test('a notice card is a status block: no button, its text once',()=>{
 const text='That screen is not on this phone.';
 const {rows}=cards([{id:'n',from:'agent',text,card:{type:'generic',icon:'info',title:text,sub:'',systemNotice:true,done:true}},
  {id:'p',from:'agent',text:'Review it there.',card:{type:'generic',icon:'info',title:'Phone action not shown here',sub:'Review it there.',systemNotice:true,done:true}}]);
 assert.deepEqual(rows.map(row=>[row.cGeneric,row.cNotice,row.hasCalendarText,row.noticeSub]),[[false,true,false,''],[false,true,false,'Review it there.']]);
 const notice=doc.querySelector('[data-alpha-chat-notice]');
 assert.equal(notice.localName,'div');assert.equal(notice.getAttribute('role'),'note');
 assert.equal(notice.parentElement.getAttribute('value'),'{{m.cNotice}}');
 assert.equal(notice.querySelectorAll('button,[onclick]').length,0);assert.equal(notice.closest('button'),null);
});

test('the template labels the approval row and marks device results apart from assistant text',()=>{
 const label=doc.querySelector('.alpha-row-label');
 assert.equal(label.textContent,'{{r.label}}');assert.equal(label.parentElement.localName,'button');
 // `.alpha-action-review button > span` is hidden: the label must not be a direct span.
 assert.notEqual(label.localName,'span');
 assert.equal(doc.querySelectorAll('[data-alpha-message-text][data-alpha-device-receipt="{{m.deviceReceipt}}"]').length,1);
});

test('device results are marked for the chat; assistant text is not',async()=>{
 const {projectActionMessages}=await loadBrowserModule('apps/app/src/runtime/action-message-presentation.ts');
 const done={id:'card',from:'agent',text:'Create note',card:{proposalId:'p',done:true,title:'Completed',sub:'Note saved.'}};
 const rows=[{id:'u',from:'user',text:'Save it'},{id:'reply',from:'agent',text:'I saved your note.'},done,{id:'device-receipt:q',from:'agent',text:'Timer set.',deviceReceipt:true}];
 const shown=projectActionMessages(rows.map(row=>({id:row.id,text:row.text})),rows);
 assert.deepEqual(shown.map(row=>[row.id,row.deviceReceipt===true]),[['u',false],['reply',false],['card',true],['device-receipt:q',true]]);
});

test('the chat header offers New chat and Chat history beside the assistant name',()=>{
 const lead=doc.querySelector('[data-alpha-chat-header] [data-alpha-chat-lead]');
 assert.deepEqual([...lead.querySelectorAll('button')].map(button=>button.getAttribute('aria-label')),['Go Home','New chat','Chat history']);
 assert.equal(lead.querySelector('[data-alpha-chat-new]').parentElement.getAttribute('value'),'{{chatTools.show}}');
 assert.equal(lead.querySelector('[data-alpha-chat-history]').parentElement.getAttribute('value'),'{{chatTools.history}}');
 const from=adapter.indexOf('    const toolsSession='),to=adapter.indexOf('\n    out.onKey=',from);assert(from>=0&&to>from);
 const tools=(session,state={})=>{
  const calls=[],toasts=[];
  const out=new Function('connectionController','alphaClient','Capacitor','testMocksEnabled','out',`${stripTypeScriptTypes(adapter.slice(from,to),{mode:'strip'})};return out;`).call(
   {S:()=>({typing:!!state.typing}),toast:text=>toasts.push(text),openView:(...args)=>calls.push(['view',...args]),pendingActionApproval:state.approving||null},
   {getSnapshot:()=>({session,busy:!!state.busy}),newConversation:async()=>{calls.push(['new']);},open:()=>calls.push(['panel'])},{getState:()=>({pending:!!state.pending})},{isNativePlatform:()=>!!state.native},false,{assistantSurface:!!state.assistant});
  return {tools:out.chatTools,calls,toasts};
 };
 assert.deepEqual([tools(null).tools.show,tools(null).tools.history],[false,false]);
 assert.deepEqual([tools({}).tools.show,tools({}).tools.history,tools({},{assistant:true}).tools.history],[true,true,false]);
 let run=tools({});run.tools.newChat();run.tools.openHistory();assert.deepEqual(run.calls,[['new'],['panel']]);
 run=tools({},{native:true});run.tools.openHistory();assert.deepEqual(run.calls,[['view','settings',{page:'agent-connection'}]]);
 // A reply or an approval in flight is never cut off by starting a new chat.
 for(const state of [{typing:true},{pending:true},{busy:true},{approving:{}}]){run=tools({},state);run.tools.newChat();assert.deepEqual(run.calls,[]);assert.equal(run.toasts.length,1);}
});
