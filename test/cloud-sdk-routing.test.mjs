import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {CLOUD_SDK_BASES} from '../scripts/cloud-sdk-authority.ts';
import {CLOUD_DEPLOYMENT as deployment} from '../scripts/cloud-deployment-policy.ts';
// Uses the pinned resident's actual installed provider SDK. Fetch is intercepted;
// this verifies routing only and never performs inference or uses a credential.
test('resident SDK appends chat completions to the versioned Cloud base',{skip:process.env.ALPHA_ELIZA_SOURCE?false:'Set ALPHA_ELIZA_SOURCE to a prepared SDK tree (bun run agent:prepare); verify.yml sets it'},async()=>{
 const modules=resolve(process.env.ALPHA_ELIZA_SOURCE,'plugins/plugin-elizacloud/node_modules');
 const {createOpenAI}=await import(pathToFileURL(resolve(modules,'@ai-sdk/openai/dist/index.mjs')).href);
 const {generateText}=await import(pathToFileURL(resolve(modules,'ai/dist/index.mjs')).href);
 for(const environment of ['production','staging']){
  let captured;
  const provider=createOpenAI({baseURL:CLOUD_SDK_BASES[environment],apiKey:'synthetic-routing-test',fetch:async(url,init)=>{captured={url:String(url),model:JSON.parse(init.body).model};throw Error('Routing capture only');}});
  await generateText({model:provider.chat('cerebras/qwen-3.8-27b'),prompt:'Routing test',maxRetries:0}).catch(()=>{});
  assert.deepEqual(captured,{url:`${deployment[environment].api}/api/v1/chat/completions`,model:'cerebras/qwen-3.8-27b'});
 }
});
