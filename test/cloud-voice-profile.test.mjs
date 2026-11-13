import test from 'node:test';
import {resolveCloudSignatureClassifier,verifyCloudRecordingSignatures} from '../scripts/check-cloud-recording-signature.ts';

let fileTypeModule;
try{fileTypeModule=resolveCloudSignatureClassifier();}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('Cloud signature classifier rejects actual Android mp42 header and accepts PCM WAV',{skip:!fileTypeModule?'Prepared Cloud file-type dependency unavailable':false},async()=>{
 await verifyCloudRecordingSignatures();
});
