import fs from 'node:fs';
import path from 'node:path';
import {sourceManifest} from './combined-agent-source.ts';
const [source,output]=process.argv.slice(2);
if(!source||!output||!path.isAbsolute(source)||!path.isAbsolute(output))throw Error('Usage: node scripts/fingerprint-combined-agent.ts ABSOLUTE_SOURCE ABSOLUTE_OUTPUT');
if(path.resolve(output).startsWith(path.resolve(source)+path.sep))throw Error('Manifest must be outside source tree');
const manifest=sourceManifest(source);fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({revision:manifest.revision,contentSha256:manifest.contentSha256,entries:Object.keys(manifest.entries).length}));
