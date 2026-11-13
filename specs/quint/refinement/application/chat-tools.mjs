import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
const source=fileURLToPath(new URL('../../../../apps/app/src/prototype/chat-tools-adapter.ts',import.meta.url));
const sources=[source,fileURLToPath(import.meta.url)];
function fixture(){
 let generation=0,held=0,completePicker,completeSearch,timer;
 const connectionController={getSnapshot:()=>({session:{ownerId:generation}}),getSelectedConversationId:()=> 'chat',searchMessages:()=>{held=generation;return new Promise(resolve=>{completeSearch=resolve;});}};
 const code=stripTypeScriptTypes(readFileSync(source,'utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{mode:'strip'});
 class Component {constructor(){this.live=true;this.state={msgs:[]};}renderVals(){return {};}setState(next){Object.assign(this.state,typeof next==='function'?next(this.state):next);this.output=this.renderVals();}S(){return this.state;}}
 new Function('connectionController','createInlineModal','runFilePicker','inputFiles','intakeAttachmentFiles','CHAT_UPLOAD_ACCEPT','MAX_CHAT_IMAGES','clearTimeout','setTimeout',code+';return installChatTools;')(connectionController,()=>({ref(){}}),choose=>choose(),()=>{held=generation;return new Promise(resolve=>{completePicker=resolve;});},async files=>({attachments:files,droppedTooLarge:[],droppedOverCount:[]}), 'text/plain',4,()=>{},fn=>{timer=fn;return 1;})(Component);
 const shell=new Component();shell.setState({});
 const observe=()=>({'s.generation':generation,'s.held':held,'s.picker':!!shell.chatFileBusy,'s.search':!!shell.chatSearchOpen,'s.pending':!!shell.chatSearchBusy,'s.results':!!shell.chatSearchResults?.length,'s.attached':!!shell.fileAttachments?.length});
 const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 return {observe,async chooseFile(){shell.output.chatTools.upload();},async finishPicker(ok){completePicker(ok?[{mimeType:'text/plain',name:'qa.txt',data:'eA=='}]:[]);await settle();},async openSearch(){shell.output.chatTools.search();},async query(){shell.output.chatSearch.change({target:{value:'needle'}});timer();},async reply(){completeSearch([{messageId:'one',text:'needle',createdAt:0}]);await settle();},async closeSearch(){shell.output.chatSearch.close();},async retire(){generation++;shell.setState({});}};
}
export async function checkChatTools(){
 const driverHashes=captureInputs(sources),traces=[];
 for(const [name,steps] of [['current search',['openSearch','query','reply']],['retired search',['openSearch','query','retire','reply']],['cancelled search',['openSearch','query','closeSearch']],['retired file chooser',['chooseFile','retire','finishPicker']]]){
  const f=fixture(),trace={name,expect:f.observe(),steps:[]};
  for(const step of steps){await f[step](true);trace.steps.push({action:{name:step,args:step==='finishPicker'?[true]:[]},expect:f.observe()});}
  if(name.startsWith('retired'))assert(!f.observe()['s.results']&&!f.observe()['s.attached']);
  traces.push(trace);
 }
 return checkTraces({model:'ChatTools',sources,driverHashes,traces,scope:'bounded-component',assumptions:['The actual composer adapter runs with controlled file, search and shell ports.','One pending operation and two owner generations. Browser rendering, native chooser and provider processing have separate live checks.']});
}
