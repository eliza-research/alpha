import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Existing explicit link gesture is a separate trusted UI path. A provider's
// browser-tab identity or page text is never promoted to authored permission.
const source=readFileSync('apps/app/src/prototype/note-web-source-adapter.ts','utf8');
const adapter=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[^;]+;\n/gm,'').replace(/^export /gm,'');
const agent=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const start=agent.indexOf('    api.openReviewedWebSource=');
const bridge=stripTypeScriptTypes(agent.slice(start,agent.indexOf('\n',start)),{mode:'transform'});
function fixture(){
 class Element extends EventTarget{constructor(tag){super();this.tag=tag;this.children=[];this.style={setProperty(){}};}append(...children){this.children.push(...children);}setAttribute(){}showModal(){}focus(){}remove(){this.removed=true;}}
 const document=Object.assign(new EventTarget(),{hidden:false,body:new Element('body'),createElement:tag=>new Element(tag),querySelector:()=>null,activeElement:null});
 const window=new EventTarget(),calls=[];
 const note={id:'note',webSource:{name:'Explicit saved link',url:'https://example.com/exact?q=1#part'}},state={open:'note',list:[note]};let active=true;
 const api={get:()=>state,isActive:()=>active};
 new Function('api',bridge).call({browserNavigateApproved:async(url,signal)=>{calls.push({url,signal});}},api);
 const views={notes:{render:()=>({})}};
 vm.runInNewContext(adapter+';installNoteWebSourceAdapter(views);',{views,document,window,HTMLElement:Element,AbortController,webSourceOf:value=>value});
 const render=()=>views.notes.render(state,api);
 return {calls,note,render,document,retire:()=>{active=false;}};
}
test('render and source review never navigate; one explicit source-button gesture uses the original trusted bridge once',async()=>{
 const h=fixture(),out=h.render();assert.equal(h.calls.length,0);out.openWebSource();assert.equal(h.calls.length,0);
 const dialog=h.document.body.children[0],footer=dialog.children.at(-1),open=footer.children[0];open.onclick();await Promise.resolve();await Promise.resolve();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,h.note.webSource.url);assert.ok(h.calls[0].signal instanceof AbortSignal);
 open.onclick();await Promise.resolve();assert.equal(h.calls.length,1,'closed/busy gesture cannot replay navigation');
});
test('retired selected-link custody prevents the explicit gesture from navigating',async()=>{
 const h=fixture();h.render().openWebSource();h.retire();const open=h.document.body.children[0].children.at(-1).children[0];open.onclick();await Promise.resolve();assert.equal(h.calls.length,0);
});
