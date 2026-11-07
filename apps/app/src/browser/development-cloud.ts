import {CloudPersonalProtocol} from '../runtime/cloud-personal-protocol';
import {revision} from './revision';
import {devSurfacesEnabled} from '../build-flags';
import {cloudSetupDocument,type DevelopmentSetup as Setup,type DevelopmentScenario} from './development-cloud-document';
export type {DevelopmentScenario} from './development-cloud-document';
import {developmentCloudAccount,readDevelopmentCloudAccount,type DevelopmentCloudAccount as Account} from './development-account-document';
export {developmentCloudAccount,readDevelopmentCloudAccount,developmentCloudKey,selectDevelopmentCloud,developmentAccountRecovery,type DevelopmentAccount} from './development-account-document';
export function developmentCloudSetupDocument(account:NonNullable<Account>){
 return cloudSetupDocument(account.account,async signal=>{signal?.throwIfAborted();const current=await readDevelopmentCloudAccount(signal);if(current?.account!==account.account||current.session!==account.session)throw Error('Development account changed.');});
}
export async function configureDevelopmentCloud(scenario:DevelopmentScenario,signal:AbortSignal){
 const account=developmentCloudAccount();if(!account||!['new','existing','insufficient','failed','changed'].includes(scenario))throw Error('Choose a development setup.');
 await developmentCloudSetupDocument(account).edit(state=>{Object.keys(state).forEach(key=>delete state[key as keyof typeof state]);Object.assign(state,{phase:'review',scenario,quote:revision()});},signal);
 window.dispatchEvent(new Event('alpha:development-account-changed'));
}
export function developmentPersonal(account:NonNullable<Account>){
 if(!devSurfacesEnabled)throw Error('Choose development mode.');
 const index=account.account==='first'?'1':'2',userId=`00000000-0000-4000-8000-00000000000${index}`,personal=`personal:00000000-0000-5000-8000-00000000000${index}`,target=`10000000-0000-4000-8000-00000000000${index}`,job=`20000000-0000-4000-8000-00000000000${index}`;
 const domain=developmentCloudSetupDocument(account);
 const check=async(signal:AbortSignal)=>{signal.throwIfAborted();const current=await readDevelopmentCloudAccount(signal);if(current?.account!==account.account||current.session!==account.session)throw Error('Development account changed.');};
 const status=(state:Setup)=>state.phase==='review'?'stopped':state.scenario==='failed'&&Date.now()-(state.startedAt||0)>=1000?'error':state.phase==='ready'||Date.now()-(state.startedAt||0)>=1000?'running':'provisioning';
 const ok=(data:unknown,status=200)=>({status,data:{success:true,data}});
 const base=`/api/v1/eliza/agents/${encodeURIComponent(personal)}/upgrade-tier`;
 return new CloudPersonalProtocol({environment:'development',credentialId:account.session,userId,organizationId:`development-${account.account}`},async(path,signal,body)=>{
  await check(signal);const state=await domain.read(signal);
  const amounts=(data:Setup)=>({hourlyRateUsd:data.quote==='f'.repeat(64)?0.2:0.1,dailyRateUsd:data.quote==='f'.repeat(64)?4.8:2.4,minimumActivationChargeUsd:data.quote==='f'.repeat(64)?0.2:0.1,minimumBalanceUsd:10,minimumRunwayDays:1,balanceUsd:data.scenario==='insufficient'?0:100,deficitUsd:data.scenario==='insufficient'?10:0});
  if(body===undefined){
   if(path==='/api/v1/eliza/personal')return ok({identity:{id:personal,displayName:'Development Cloud agent',runtime:state.phase==='ready'?'dedicated':'shared',...(state.phase==='ready'?{activeAgentId:target,apiBase:'https://development.invalid'}:{})}});
   if(path===base)return ok({action:'activate_dedicated',sourceAgentId:personal,quoteId:state.quote,requiresConfirmation:true,...amounts(state),canActivate:state.scenario!=='insufficient',activation:state.phase==='review'&&state.scenario!=='existing'?{state:'available'}:{state:'in_progress',dedicatedAgentId:target,status:status(state)}});
   if(path===base+'/adopt-existing')return ok({action:'adopt_existing_dedicated',quoteId:state.quote,requiresConfirmation:true,...amounts(state),canAdopt:state.scenario!=='insufficient',dedicatedAgentId:target,adoptionState:'available',status:status(state),startsCompute:true,requiresCatalogRestore:false,stateDisposition:'fresh_boot_no_verified_backup'});
   if(path===`/api/v1/jobs/${job}`)return ok({id:job,status:status(state)==='error'?'failed':status(state)==='running'?'completed':'in_progress'});
   throw Error('Unknown development setup read.');
  }
  return domain.edit(async data=>{await check(signal);const input=body as Record<string,unknown>;
   if(path===base&&data.scenario==='changed'&&data.quote!=='f'.repeat(64)){data.quote='f'.repeat(64);return {status:409,data:{code:'dedicated_quote_changed'}};}
   if(path===base+'/adopt-existing'){if(!['stopped','error'].includes(status(data))||input.action!=='adopt_existing_dedicated'||input.quoteId!==data.quote||input.minimumActivationChargeUsd!==amounts(data).minimumActivationChargeUsd)throw Error('Review the current existing instance.');data.phase='provisioning';data.scenario='new';data.startedAt=Date.now();return ok({runtime:'dedicated_pending_cutover',dedicatedAgentId:target,jobId:job},202);}
   if(path===base){if(data.scenario==='insufficient'||data.scenario==='existing'||data.phase!=='review'||input.action!=='activate_dedicated'||input.quoteId!==data.quote||input.minimumActivationChargeUsd!==amounts(data).minimumActivationChargeUsd)throw Error('Review the current development quote.');data.phase='provisioning';data.startedAt=Date.now();return ok({dedicatedAgentId:target,jobId:job},202);}
   if(path===base+'/cutover'){if(data.phase!=='provisioning'||status(data)!=='running'||input.dedicatedAgentId!==target)throw Error('Check development setup status.');data.phase='ready';return ok({personalElizaId:personal,activeAgentId:target,runtime:'dedicated',apiBase:'https://development.invalid',importedMessages:0});}
   throw Error('Unknown development setup operation.');
  },signal);
 },async(id,signal)=>{await check(signal);if(id!==target)throw Error('Development target changed.');return status(await domain.read(signal));});
}
