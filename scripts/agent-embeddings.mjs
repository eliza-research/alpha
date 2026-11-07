import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Upstream's on-device embedding route (vendor/eliza/packages/app/src/runtime/native-runtime-profile.ts
// LOCAL_EMBEDDING_ROUTE). A profile whose serviceRouting names llmText but omits embeddings has
// TEXT_EMBEDDING capability-disabled; the assistant's post-turn memory job then fails on every tick
// and the host escalates "needs attention" notices into the chat.
export const LOCAL_EMBEDDING_ROUTE=Object.freeze({backend:'eliza-local-inference',transport:'direct'});
const FUSED_LIBRARY={darwin:'libelizainference.dylib',win32:'elizainference.dll'}[process.platform]??'libelizainference.so';
// The launchers move ELIZA_STATE_DIR into the private profile, so upstream's default fused-library
// staging directory (<state dir>/local-inference/lib, written by
// vendor/eliza/packages/app/scripts/stage-desktop-fused-lib.ts) and models directory must be named
// explicitly from the original shared state. Absolute library overrides and MODELS_DIR win
// independently; moving the profile never changes model selection or the shared model assets.
export function localEmbeddingEnvironment(env=process.env){
 const explicit={};
 for(const key of ['ELIZA_INFERENCE_LIBRARY','ELIZA_INFERENCE_LIB_DIR','MODELS_DIR']){
  const value=env[key];
  if(value===undefined||value==='')continue;
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error(`${key} must be an absolute path`);
  explicit[key]=value;
 }
 const originalState=path.join(os.homedir(),'.local/state/eliza');
 if(!explicit.MODELS_DIR)explicit.MODELS_DIR=path.join(originalState,'models');
 if(!explicit.ELIZA_INFERENCE_LIBRARY&&!explicit.ELIZA_INFERENCE_LIB_DIR){
  const dir=path.join(originalState,'local-inference/lib');
  if(!fs.existsSync(path.join(dir,FUSED_LIBRARY)))console.error(`No fused inference library at ${dir}; local embeddings cannot load until it is staged (vendor/eliza/packages/app/scripts/stage-desktop-fused-lib.ts) or ELIZA_INFERENCE_LIB_DIR names it.`);
  explicit.ELIZA_INFERENCE_LIB_DIR=dir;
 }
 return explicit;
}
// Existing profiles retain their reviewed routing; the launchers never rewrite them, so an omitted
// route is reported for explicit migration instead of being added silently.
export function reportMissingEmbeddingRoute(config,configPath){
 if(config?.serviceRouting&&!config.serviceRouting.embeddings)console.error(`${configPath}: serviceRouting omits embeddings, so TEXT_EMBEDDING stays disabled and the host repeats "needs attention" notices in chat. Add "embeddings": ${JSON.stringify(LOCAL_EMBEDDING_ROUTE)} to serviceRouting or start a fresh profile.`);
}
