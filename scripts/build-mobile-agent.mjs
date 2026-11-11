#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {coreStateBuildPlugin} from './core-state-patch.mjs';
import {mobileBuildInputs,mobileBuildReceipt,MOBILE_BUILD_RECEIPT} from './mobile-uuid-adapter.mjs';

const root=path.resolve(import.meta.dirname,'..'),source=process.argv[2];
if(!source||!path.isAbsolute(source)||process.argv.slice(3).join(' ')!=='--target=android')throw Error('Usage: build-mobile-agent.mjs <absolute prepared source> --target=android');
const inputs=mobileBuildInputs(root,source);
const core=coreStateBuildPlugin(root,source);
if(Bun.version!==inputs.policy.bun.version||Bun.revision!==inputs.policy.bun.revision)throw Error('Mobile producer requires the reviewed Bun version and revision');
const output=path.join(source,'packages/agent/dist-mobile'),receiptFile=path.join(output,MOBILE_BUILD_RECEIPT);
fs.rmSync(receiptFile,{force:true});
const original=Bun.build;
try{
 Bun.build=options=>original({...options,plugins:[core.plugin,...(options.plugins??[])]});
 await import(pathToFileURL(path.join(source,inputs.policy.builder.path)).href);
}finally{Bun.build=original;}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-mobile-build-'));
try{
 const smoke=spawnSync(process.execPath,[path.join(root,'scripts/mobile-bundle-smoke.mjs'),path.join(output,'agent-bundle.js')],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{...process.env,ELIZA_STATE_DIR:temporary,ELIZA_DISABLE_TRAJECTORY_LOGGING:'1'}});
 if(smoke.status!==0||!smoke.stdout?.includes('MOBILE_UUID_AND_TURN_SMOKE_OK'))throw Error('Mobile UUID/message-turn smoke failed: '+String(smoke.stderr??'').slice(-2000));
 const {uuidNodeExports}=JSON.parse(fs.readFileSync(path.join(output,'plugins-manifest.json'),'utf8'));
 const receipt=mobileBuildReceipt(root,source,path.join(output,'agent-bundle.js'),uuidNodeExports,core.transforms);
 fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
 console.log('[build-mobile] reviewed UUID adapter and pre-provider turn smoke passed');
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
