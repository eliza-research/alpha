// Run by agent:test against its normally prepared, pinned SDK. No server, model or personal profile.
import {expect, test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {AGENT_CHARACTER,AGENT_CHARACTER_ENVIRONMENT,agentIdentityConfiguration,freshAgentProfile,prepareAgentIdentityConfig} from '../../scripts/agent-identity.mjs';

const source=process.env.ALPHA_IDENTITY_TEST_SOURCE;
if(!source||!path.isAbsolute(source))throw Error('agent:test must select its exact prepared SDK source');
const load=(file:string)=>import(pathToFileURL(path.join(source,file)).href);
const {AgentRuntime,stringToUuid,parseAndValidateCharacter}=await load('packages/core/src/index.ts');
const {buildCharacterFromConfig,agentIdentityName}=await load('packages/agent/src/runtime/build-character-config.ts');
const {applySandboxCharacterFromEnv}=await load('packages/agent/src/runtime/sandbox-character.ts');

function identity(config:Record<string,any>,override=false){
 const value=structuredClone(config);
 if(override)applySandboxCharacterFromEnv(value,AGENT_CHARACTER_ENVIRONMENT);
 const character=buildCharacterFromConfig(value);
 const runtime=new AgentRuntime({character,logLevel:'fatal'});
 const stable=agentIdentityName(character);
 return {character,ids:{agentId:runtime.agentId,identityName:stable,
  roomId:stringToUuid(`${stable}-chat-room`),worldId:stringToUuid(`${stable}-chat-world`),
  cliServerId:stringToUuid(`${stable}-cli-server`),webWorldId:stringToUuid(`${stable}-web-chat-world`),webServerId:stringToUuid(`${stable}-web-server`)}};
}
const legacy=():Record<string,any>=>({agents:{list:[{id:'main',default:true,name:'Eliza'}]},ui:{assistant:{name:'Eliza'}},cloud:{enabled:false},serviceRouting:{llmText:{backend:'cerebras',transport:'direct',smallModel:'saved',largeModel:'saved'}},fixtureKeep:{theme:'saved',opaque:['keep']}});

test('the canonical runtime keeps retained identity and room seeds while presenting as Alpha',()=>{
 const config=legacy();config.agents.list[0].identityName='Retained Eliza';
 const before=identity(config),selected=agentIdentityConfiguration(config),after=identity(selected,true);
 expect(selected).toBe(config);
 expect(after.character.name).toBe(AGENT_CHARACTER.name);
 expect(after.ids).toEqual(before.ids);
 const restored=parseAndValidateCharacter(JSON.stringify(after.character));
 expect(restored.success).toBe(true);
 expect(agentIdentityName(restored.data)).toBe(before.ids.identityName);
});

test('a known legacy selected agent gains only its stable identity binding',()=>{
 const config=legacy(),original=structuredClone(config),before=identity(config);
 const selected=agentIdentityConfiguration(config),after=identity(selected,true);
 const expected=structuredClone(config);expected.agents.list[0].identityName='Eliza';
 expect(selected).toEqual(expected);
 expect(config).toEqual(original);
 expect(after.ids).toEqual(before.ids);
 expect(after.character.name).toBe('Alpha');
});

test('the same canonical first agent stays selected when its old default flag was omitted',()=>{
 const config=legacy();delete config.agents.list[0].default;
 const before=identity(config),selected=agentIdentityConfiguration(config),after=identity(selected,true);
 expect(selected.agents.list[0].default).toBe(true);
 expect(after.ids).toEqual(before.ids);
 expect(selected.fixtureKeep).toEqual(config.fixtureKeep);
});

test('a fresh QA profile selects Alpha once and keeps its identity on restart',()=>{
 const config={cloud:{enabled:false},fixtureKeep:'new QA only'};
 const selected=agentIdentityConfiguration(config,{freshProfile:true});
 const first=identity(selected,true),again=identity(agentIdentityConfiguration(selected),true);
 expect(first.character.name).toBe('Alpha');
 expect(first.ids.identityName).toBe('Alpha');
 expect(again.ids).toEqual(first.ids);
 expect(selected.fixtureKeep).toBe(config.fixtureKeep);
});

test('ambiguous legacy identity refuses without selecting a fresh namespace',()=>{
 for(const config of [{serviceRouting:{}},{ui:{assistant:{name:'Only a label'}}},{agents:{list:[{id:'main',default:true,name:'Eliza'}]},ui:{assistant:{name:'Conflicting label'}}},{agents:{list:[{id:'first',name:'Eliza'},{id:'other',default:true,name:'Other'}]}}]){
  const before=structuredClone(config);
  expect(()=>agentIdentityConfiguration(config)).toThrow(/identity is ambiguous/);
  expect(config).toEqual(before);
 }
});

test('canonical config updates are atomic, retain unrelated settings and keep the same Settings target',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-identity-config-')),file=path.join(dir,'eliza.json');
 try{
  const config=legacy();fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
  expect(freshAgentProfile(dir)).toBe(false);
  const selected=await prepareAgentIdentityConfig(file,config,{freshProfile:false});
  expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(selected);
  expect(identity(selected,true).ids).toEqual(identity(config).ids);
  expect(fs.readdirSync(dir)).toEqual(['eliza.json']);
  const bytes=fs.readFileSync(file);
  await prepareAgentIdentityConfig(file,selected,{freshProfile:false});
  expect(fs.readFileSync(file)).toEqual(bytes);
  // A later Settings write uses the original canonical file, not a generated sidecar.
  const updated=JSON.parse(fs.readFileSync(file,'utf8'));updated.fixtureKeep.theme='later setting';
  fs.writeFileSync(file,JSON.stringify(updated));
  expect((await prepareAgentIdentityConfig(file,updated,{freshProfile:false})).fixtureKeep.theme).toBe('later setting');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('stale or unbound profiles do not gain a token, config or migration',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-identity-refuse-')),file=path.join(dir,'eliza.json');
 try{
  fs.writeFileSync(path.join(dir,'existing-state'),'retain');
  expect(()=>freshAgentProfile(dir)).toThrow(/identity is ambiguous/);
  expect(fs.readdirSync(dir)).toEqual(['existing-state']);
  const config=legacy(),changed={...config,fixtureKeep:{theme:'newer'}};
  fs.writeFileSync(file,JSON.stringify(changed),{mode:0o600});
  await expect(prepareAgentIdentityConfig(file,config,{freshProfile:false})).rejects.toThrow(/configuration changed/);
  expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(changed);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the tested room seeds are the canonical CLI and browser identity contracts',()=>{
 const cli=fs.readFileSync(path.join(source,'packages/agent/src/runtime/eliza.ts'),'utf8');
 const web=fs.readFileSync(path.join(source,'packages/agent/src/api/conversation-routes.ts'),'utf8');
 expect(cli).toMatch(/roomId\s*=\s*stringToUuid\(`\$\{identityName\}-chat-room`\)/);
 expect(cli).toContain('`${identityName}-chat-world`');
 expect(cli).toContain('`${identityName}-cli-server`');
 expect(web).toContain('`${identityName}-web-chat-world`');
 expect(web).toContain('`${identityName}-web-server`');
 expect(web).toContain('roomId: conv.roomId');
});
