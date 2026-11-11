import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
export const baseFixture='specs/quint/refinement/services/inbox-coordinator-ports.mjs';

/** Reuse the existing functional fixture unchanged except for a passive closure observer.
 * No product expression, branch, return, import or callback is replaced by the observer. */
export async function inboxPagingImplementation(temporary){
 const path=join(temporary,'functional-inbox-ports.mjs');let source=readFileSync(join(root,baseFixture),'utf8');
 const replace=(from,to)=>{assert.equal(source.split(from).length,2,from);source=source.replace(from,to);};
 replace('from "esbuild"',`from ${JSON.stringify(pathToFileURL(join(root,'node_modules/esbuild/lib/main.js')).href)}`);
 replace('import { readdirSync } from "node:fs";','import { readdirSync,readFileSync } from "node:fs";');
 replace('const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));',`const root=${JSON.stringify(root)};`);
 const observer=`globalThis.__inboxPaging={load,setFolder,selectAccount,refreshAccounts,rememberList,restoreList,invalidateList,cancelOperation,
 inspect:()=>({accounts,selected,query:currentQuery(),generation,busy:!!operation,loadingMore,messages,loadedQuery,nextPageToken,
 seenCursors:[...seenCursors],newerMail,failure:!!failure,cachedShown:cachedListShown,saved:folderLists.values()})};`;
 const interception=`builder.onLoad({filter:/inbox-cloud-adapter\\.ts$/},({path})=>{const source=readFileSync(path,'utf8'),marker='  let loadingMore = false;';if(source.split(marker).length!==2)throw Error('Paging observer anchor');return {contents:source.replace(marker,marker+'\\n'+${JSON.stringify(observer)}),loader:'ts'};});`;
 replace('plugins: [{ name: "controlled-inbox-ports", setup(builder) {','plugins: [{ name: "controlled-inbox-ports", setup(builder) {'+interception);
 source+='\nexport async function pagingArtifact(){return (await bundle()).code;}\n';writeFileSync(path,source);
 const implementation=await import(pathToFileURL(path).href);
 const sources=await implementation.inboxDriverSources(),compiled=join(temporary,'inbox-paging.iife.js');writeFileSync(compiled,await implementation.pagingArtifact());
 return {...implementation,sources:[...sources,baseFixture],generated:[path,compiled]};
}

export async function inboxPagingFixture(implementation){
 const fixture=await implementation.createInboxFixture(),requests=[];let active=false,ordinal=0;
 fixture.client.gmailSearch=(grant,query,signal,_limit,cursor)=>{
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  requests.push({ordinal:++ordinal,grant,query,cursor:cursor??null,signal,resolve,reject,settled:false});return promise;
 };
 // Account discovery is the precondition of this paging projection. The real render supplies
 // the API while inactive; refreshAccounts then selects the grant without opening a list.
 class Shell{constructor(){this.st={q:null,compose:null};}renderVals(){return {};}vset(_view,patch){Object.assign(this.st,patch);}S(){return this.st;}}
 const views={inbox:{state:{}}};fixture.modules.installInboxCloudAdapter(Shell,views);const shell=new Shell();
 const api={isActive:()=>active,get:()=>shell.st,set:patch=>Object.assign(shell.st,patch),toast:text=>fixture.toasts.push(text),swallowed:()=>false};
 views.inbox.render(shell.st,api);const source=fixture.sandbox.__inboxPaging;assert.ok(source);
 await source.refreshAccounts();await fixture.settle();assert.equal(requests.length,0);active=true;
 const baseline=source.inspect().generation;
 const flush=async()=>{for(let attempt=0;attempt<4;attempt++)await new Promise(resolve=>setImmediate(resolve));};
 const currentRequest=(cursor=null)=>{
  const state=source.inspect();return requests.find(request=>!request.settled&&!request.signal.aborted&&request.grant===state.selected&&request.query===state.query&&request.cursor===cursor);
 };
 const answer=async(request,{following=0,shifted=false,failed=false}={})=>{
  assert.ok(request&&!request.settled,'One actual outstanding provider request');request.settled=true;
  if(failed)request.reject(new TypeError('Failed to fetch'));
  else request.resolve({messages:[{id:`${request.grant}/${request.query}/${request.ordinal}`,owner:request.grant,folder:request.query,from:'Synthetic sender',to:[],subject:'Synthetic mail',snippet:'Synthetic',receivedAt:null,unread:false}],
   syncedAt:'synthetic',mailboxHistoryId:shifted?'changed':'stable',nextPageToken:following?`cursor-${following}`:null});
  await flush();
 };
 return {fixture,source,requests,baseline,flush,currentRequest,answer,
  async load(more=false){const before=source.inspect().generation;const promise=source.load(more);await flush();return {accepted:source.inspect().generation!==before,promise,request:currentRequest(more?source.inspect().nextPageToken:null)};},
  async folder(){source.setFolder(source.inspect().query==='in:inbox'?'sent':'inbox');await flush();},
  async account(){const state=source.inspect(),other=state.accounts.find(account=>account.connectionId!==state.selected);assert.ok(other);source.selectAccount(other,true);await flush();},
  close(){active=false;source.cancelOperation();source.invalidateList(false);for(const request of requests)if(!request.settled){request.settled=true;request.resolve({messages:[],syncedAt:'cleanup',nextPageToken:null});}},
 };
}
