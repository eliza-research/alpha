import {openIncomingSimulation} from './incoming-simulation';
import {datedReceiptWallet} from './workflow-receipts';
import {installSimulatedWorkflows} from './simulated-workflows';
import {installSimulatedMessages} from './simulated-messages';
import {installSimulatedVoicemail} from './simulated-voicemail';
import {SimulatorWriter} from './simulator-writer';
import {installSimulatedInbox} from './simulated-inbox';
import {loadSimulatedState,simulatorNeedsRecovery,showSimulatorRecovery,configureSimulatorRecovery} from './simulator-recovery';
import { browserDevProfile,developmentAgentWorkflows } from './dev-profile';
import { devSurfacesEnabled } from '../build-flags';
type Bag=Record<string,any>;
const names=['phone','messages','contacts','inbox','workflows','wallet'];
/** Capture product-owned local interactions before native adapters replace effects. */
function captureDevelopmentApps(views:Bag):Bag{return Object.fromEntries(names.map(name=>[name,{...views[name],state:structuredClone(views[name].state)}]));}
// Development-server-only simulator (devSurfacesEnabled). Flag-off builds fold
// these exports to no-ops so the simulated apps never enter the bundle.
export const captureSimulatedApps:(views:Bag)=>Bag=devSurfacesEnabled?captureDevelopmentApps:()=>({});
export const installSimulatedApps:(Component:any,views:Bag,original:Bag)=>void=devSurfacesEnabled?installDevelopmentApps:()=>{};
function installDevelopmentApps(Component:any,views:Bag,original:Bag){
 if(!devSurfacesEnabled||!browserDevProfile)return;
 original.wallet.persist=[...original.wallet.persist,'workflowReceipts'];original.wallet.state.workflowReceipts={};
 original.workflows.persist=[...original.workflows.persist,'localRuns','triggerState'];original.workflows.state.localRuns={};original.workflows.state.triggerState={cursors:[],queue:[]};
 original.messages.persist=[...original.messages.persist,'localDrafts'];original.messages.state.localDrafts={};
 original.inbox.persist=[...original.inbox.persist,'localDrafts'];original.inbox.state.localDrafts=[];
 const snapshots=new Map<string,string|null>();
 for(const name of names){Object.assign(views[name],original[name]);views[name].state={...views[name].state,...loadSimulatedState(name,original[name],raw=>snapshots.set('alpha.dev.app.'+name,raw))};}
 const writer=new SimulatorWriter(snapshots);
 configureSimulatorRecovery((key,expected)=>writer.reset(key,expected));
 installSimulatedInbox(views.inbox);
 const disposeWorkflows=developmentAgentWorkflows?Object.assign(()=>{},{connect:()=>{}}):installSimulatedWorkflows(views.workflows);
 const disposeMessages=installSimulatedMessages(views.messages);
 const disposeVoicemail=installSimulatedVoicemail(views.phone);
 const walletRender=views.wallet.render,walletReply=views.wallet.reply;
 views.wallet.reply=(text:string,raw:string,api:Bag)=>walletReply(text,raw,{...api,get:(name:string)=>name==='wallet'?datedReceiptWallet(api.get(name),api.now):api.get(name)});
 views.wallet.render=(state:Bag,api:Bag)=>{
  // Dev cards are predefined tokens; the simulator never collects card credentials.
  const out=walletRender({...datedReceiptWallet(state,api.now),add:null,form:{num:'',exp:'',name:'',cvv:''}},api);
  out.startAdd=()=>{const cards=api.get('wallet').cards||[];api.set({cards:[...cards,{id:crypto.randomUUID(),name:'Development card',last4:'0000',kind:'Test',bg:'#355caa',fg:'#fff',def:cards.length===0,locked:false,tx:[]}]});};return out;
 };
 const mount=Component.prototype.componentDidMount,unmount=Component.prototype.componentWillUnmount;
 Component.prototype.componentDidMount=function(){mount?.call(this);this.devIncomingData=(event:CustomEvent)=>{if(event.detail==='message'||event.detail==='email')openIncomingSimulation(event.detail,this.api('workflows'));};window.addEventListener('alpha:dev-incoming-data',this.devIncomingData);disposeWorkflows.connect(()=>this.api('workflows'),()=>writer.ready&&!simulatorNeedsRecovery('workflows'));this.devIncomingCall=()=>{const state=this.vget('phone');if(state.incoming||state.callWho||state.call||state.num){this.openView('phone');return;}this.openView('phone',{incoming:'maya',ring:'ring',scrN:0,rs:false});};window.addEventListener('alpha:dev-incoming-call',this.devIncomingCall);};
 Component.prototype.componentWillUnmount=function(){window.removeEventListener('alpha:dev-incoming-data',this.devIncomingData);disposeWorkflows();disposeMessages();disposeVoicemail();window.removeEventListener('alpha:dev-incoming-call',this.devIncomingCall);unmount?.call(this);};
 const open=Component.prototype.openView;
 Component.prototype.openView=function(name:string,...args:any[]){if(simulatorNeedsRecovery(name)){showSimulatorRecovery();return;}return open.call(this,name,...args);};
 const set=Component.prototype.vset;
 Component.prototype.vset=function(name:string,patch:Bag,options?:Bag){
  if(simulatorNeedsRecovery(name)){showSimulatorRecovery();throw Error('Saved app data needs recovery.');}
  if(name==='inbox'&&Array.isArray(patch.mails)){const known=new Set(this.vget('inbox').mails.map((mail:Bag)=>String(mail.id)));patch={...patch,mails:patch.mails.map((mail:Bag)=>known.has(String(mail.id))?mail:{...mail,receivedAt:Number.isFinite(mail.receivedAt)?mail.receivedAt:Date.now()})};}
  const fields=views[name]?.persist||[];
  if(names.includes(name)&&fields.some((key:string)=>Object.prototype.hasOwnProperty.call(patch,key))){
    // React may not have committed the previous synchronous write yet.
    const value={...this.vget(name),...JSON.parse(snapshots.get('alpha.dev.app.'+name)||'{}'),...patch},stored:Bag={};for(const key of fields)stored[key]=value[key];
    try{writer.write('alpha.dev.app.'+name,JSON.stringify(stored));}
    catch(error){this.toast(error instanceof Error&&/development|Saved app data changed/.test(error.message)?error.message:'Could not save '+views[name].title+'. Your changes are still here. Try again after freeing app storage.');throw Error('Development app save failed.');}
  }
  const result=set.call(this,name,patch,options);if(name==='messages'&&patch.threads||name==='inbox'&&patch.mails||name==='workflows'&&patch.flows)queueMicrotask(()=>window.dispatchEvent(new Event('alpha:dev-app-change')));return result;
 };
}
