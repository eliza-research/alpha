/** The staged-host check Gradle and the build preflight run before packaging. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerArtifactDirectory,digest} from './local-agent-source.ts';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.ts';
const json=(file: string)=>JSON.parse(fs.readFileSync(file,'utf8'));
/** The staged Google host is the built artifact, and that artifact matches current sources. */
export function verifyNativeGoogleHost(root: string){
 const artifact=workerArtifactDirectory(root),host=verifyNativeGoogleHostArtifact(root,artifact);
 const staged=path.join(root,'android/app/src/main/assets/agent/workflow-worker',host.module);
 if(!fs.existsSync(staged)||digest(staged)!==json(path.join(artifact,'manifest.json')).files[host.module])throw Error('Staged native Google host differs from the built host artifact; run bun run agent:stage-android');
 return {runtimeProfile:'native',nativeGoogleHost:host.module,inputs:Object.keys(host.inputs).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(import.meta.dirname,'..');
 if(process.argv[2]!=='--verify-native'||process.argv.length!==3)throw Error('Usage: runtime-profile.ts --verify-native');
 console.log(JSON.stringify(verifyNativeGoogleHost(root)));
}
