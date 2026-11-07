import fs from 'node:fs';
import path from 'node:path';
import {writePrivateRuntimeJson} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
// The product record is the one identity source: the shell reads identity.characterName for its
// header and composer, and the host receives the same name through upstream's local character
// override (vendor/eliza/packages/agent/src/runtime/sandbox-character.ts). ELIZA_AGENT_CHARACTER_JSON
// merges onto the selected default agent and ui.assistant.name in memory. Its display name must
// never replace the persisted identityName used for agent and default conversation IDs. No system prompt
// is supplied: the bundled default preset keeps its style and its "{{name}}, made by Eliza Research"
// origin line, which build-character-config renders with this name.
const {identity}=JSON.parse(fs.readFileSync(new URL('../config/alpha-product.json',import.meta.url),'utf8'));
for(const key of ['characterName','appName'])if(typeof identity?.[key]!=='string'||!identity[key].trim())throw Error(`config/alpha-product.json identity.${key} required`);
export const AGENT_CHARACTER=Object.freeze({name:identity.characterName,bio:[`The assistant built into ${identity.appName} for writing, research, decisions and practical follow-through.`]});
export const AGENT_CHARACTER_ENVIRONMENT=Object.freeze({ELIZA_AGENT_CHARACTER_JSON:JSON.stringify(AGENT_CHARACTER)});

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const name=value=>typeof value==='string'?value.trim():'';
const identityRequired=()=>Error('Existing agent identity is ambiguous. Review the saved agent and conversation identity before starting Alpha; no fresh agent was selected.');

/** Capture freshness before creating a token or configuration in the profile. */
export function freshAgentProfile(profile,configPath=path.join(profile,'eliza.json')){
 if(!fs.existsSync(profile))return true;
 const stat=fs.lstatSync(profile);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid()))throw Error('Owned agent profile directory required');
 if(fs.readdirSync(profile).length===0)return true;
 if(!fs.existsSync(configPath))throw identityRequired();
 return false;
}

/** Select only identity metadata; routing, credentials, settings and other agents stay intact. */
export function agentIdentityConfiguration(config,{freshProfile=false}={}){
 if(!object(config))throw identityRequired();
 const agents=config.agents;
 if(agents!==undefined&&!object(agents))throw identityRequired();
 const list=agents?.list;
 if(list!==undefined&&!Array.isArray(list))throw identityRequired();
 if(!list?.length){
  if(!freshProfile)throw identityRequired();
  return {...config,agents:{...agents,list:[{id:'main',default:true,identityName:AGENT_CHARACTER.name}]}};
 }
 const selected=list[0];
 if(!object(selected)||list.some((entry,index)=>index>0&&entry?.default===true)||selected.default===false)throw identityRequired();
 const explicit=name(selected.identityName);
 if(Object.hasOwn(selected,'identityName')&&!explicit)throw identityRequired();
 const legacy=name(selected.name),display=name(config.ui?.assistant?.name);
 // A display label alone is not evidence of the stored agent identity. Conflicting legacy
 // labels need an authoritative preimage rather than a guessed namespace.
 if(!explicit&&(!legacy||(display&&display!==legacy)))throw identityRequired();
 if(explicit&&selected.default===true)return config;
 // The canonical builder reads list[0]; the override loader merges the default entry. Mark
 // that same entry default when the old config omitted the flag, never choose another agent.
 return {...config,agents:{...agents,list:[{...selected,default:true,...(!explicit?{identityName:legacy}:{})},...list.slice(1)]}};
}

/** Guarded atomic update of the canonical file, so later Settings writes keep their usual target. */
export async function prepareAgentIdentityConfig(configPath,config,options){
 const selected=agentIdentityConfiguration(config,options);
 const stat=fs.lstatSync(configPath);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))throw Error('Private agent configuration required');
 if(JSON.stringify(JSON.parse(fs.readFileSync(configPath,'utf8')))!==JSON.stringify(config))throw Error('Agent configuration changed; review identity before starting');
 if(selected===config)return config;
 await writePrivateRuntimeJson(configPath,selected);
 return selected;
}
