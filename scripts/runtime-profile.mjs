/** The one runtime profile's staged-host check. Every build packages local speech and embeddings;
 * the Cloud-only resident packaging and its verifier are gone (speech is routed at run time). */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerArtifactDirectory,digest} from './local-agent-source.mjs';
import {verifyNativeGoogleHostArtifact} from './native-google-host-artifact.mjs';
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
/** The staged Google host is the built artifact, and that artifact matches current sources. */
export function verifyNativeGoogleHost(root){
 const artifact=workerArtifactDirectory(root),host=verifyNativeGoogleHostArtifact(root,artifact);
 const staged=path.join(root,'android/app/src/main/assets/agent/workflow-worker',host.module);
 if(!fs.existsSync(staged)||digest(staged)!==json(path.join(artifact,'manifest.json')).files[host.module])throw Error('Staged native Google host differs from the built host artifact; run npm run agent:stage-android');
 return {runtimeProfile:'native',nativeGoogleHost:host.module,inputs:Object.keys(host.inputs).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(import.meta.dirname,'..');
 if(process.argv[2]!=='--verify-native'||process.argv.length!==3)throw Error('Usage: runtime-profile.mjs --verify-native. There is one runtime profile now; --verify-cloud is gone.');
 console.log(JSON.stringify(verifyNativeGoogleHost(root)));
}
