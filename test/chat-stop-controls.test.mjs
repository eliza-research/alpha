import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {JSDOM} from 'jsdom';
// Existing source/DOM contract regime: no browser, media, model, network or app startup.
const adapter=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const template=readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8');
const start=adapter.indexOf('    out.canStopReply='),end=adapter.indexOf('\n    if (isAndroid)',start);
assert(start>=0&&end>start,'actual render Stop/Send/Talk closure is present');
const code=stripTypeScriptTypes(adapter.slice(start,end),{mode:'transform'});
const render=new Function('alphaClient','connectionController','state','hasDraft',`const out={hasDraft,noDraft:!hasDraft};(function(){${code}}).call({S:()=>state});return out;`);
function shown(surface,button,values){
 for(let node=button;node&&node!==surface.parentElement;node=node.parentElement){
  if(node.localName!=='sc-if')continue;
  const match=node.getAttribute('value')?.match(/^\{\{([^}]+)\}\}$/);assert(match,'actual simple binding');assert(match[1]in values,'explicit control binding '+match[1]);if(!values[match[1]])return false;
 }
 return true;
}
test('actual composer, input bar and pill keep whole-turn Stop handoff without enabling Send or Talk',()=>{
 let phase='parse actual template',dom;
 try{
  // Unexpanded binding CSS is not CSS: this source/DOM test retains control markup, not pixel style.
  dom=new JSDOM(template.replace(/\sstyle="[^"]*"/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''));const doc=dom.window.document;
  phase='find actual surfaces';
  const surfaces=[doc.querySelector('div.alpha-chat-composer'),doc.querySelector('[data-alpha-input-bar]'),doc.querySelector('[data-alpha-layer="pill"]')];assert(surfaces.every(Boolean));
  phase='check header';assert.equal(doc.querySelectorAll('[data-alpha-chat-controls] [aria-label="Stop reply"]').length,0,'old header Stop does not return');
  for(const [typing,pending]of [[true,true],[true,false],[false,false]])for(const hasDraft of [false,true]){
   phase='render actual state closure';const calls=[],alphaClient={getState:()=>({pending}),cancel:()=>calls.push('cancel')},connectionController={cancelViewNavigation:()=>calls.push('navigation')},out=render(alphaClient,connectionController,{typing},hasDraft);
   const values={...out,pillVoiceInactive:true,pillVoice:false};
   for(const [index,surface]of surfaces.entries()){
    phase='query controls surface'+index;const controls=Array.from(surface.querySelectorAll('button')).filter(button=>['Stop reply','Send','Talk'].includes(button.getAttribute('aria-label'))&&shown(surface,button,values)).map(button=>button.getAttribute('aria-label'));
    assert.deepEqual(controls,typing?(pending?['Stop reply']:[]):index===2?['Talk']:hasDraft?['Send']:['Talk'],`surface${index}, typing=${typing}, pending=${pending}, draft=${hasDraft}`);
   }
   if(typing&&pending){out.stopReply();assert.deepEqual(calls,['navigation','cancel'],'Stop retains original cancellation behavior');}else assert.deepEqual(calls,[]);
  }
 }catch(error){throw new Error(phase+': '+(error?.stack??error),{cause:error});}finally{dom?.window.close();}
});
