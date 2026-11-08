import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {sourceDirectory} from './local-agent-source.mjs';

// Resolve the actual prepared SDK's Cloud API dependency, never an Alpha root fallback.
export function resolveCloudSignatureClassifier(root=process.cwd()) {
 const source=sourceDirectory(root);
 const module=createRequire(path.join(source,'packages/cloud/api/package.json')).resolve('file-type');
 const relative=path.relative(source,module);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Cloud signature classifier must come from the prepared SDK');
 return module;
}
export async function verifyCloudRecordingSignatures(root=process.cwd()) {
 const {fileTypeFromBuffer}=await import(pathToFileURL(resolveCloudSignatureClassifier(root)));
 // Exactly the first twelve format bytes of the silent, owner-controlled Android QA capture.
 const recordedHeader=Buffer.from('00000018667479706d703432','hex');
 const recordedType=await fileTypeFromBuffer(recordedHeader);
 assert.deepEqual(recordedType,{ext:'mp4',mime:'video/mp4'});
 // Audio-only PCM container matching the shared RecordingPcm (ai.eliza.voice) mono16k/16bit output; no recording frames.
 const wav=Buffer.alloc(76);wav.write('RIFF');wav.writeUInt32LE(68,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32,40);
 const wavType=await fileTypeFromBuffer(wav);
 assert.deepEqual(wavType,{ext:'wav',mime:'audio/wav'});
 return {recordedType,wavType};
}

// Required post-prepare gate: missing dependencies fail rather than skip.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 console.log('PASS Cloud recording signatures '+JSON.stringify(await verifyCloudRecordingSignatures()));
}
