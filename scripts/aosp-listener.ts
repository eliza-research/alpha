import fs from 'node:fs';
import path from 'node:path';
import {stageSenseApk, VOICE_HOST_RECORD} from '../vendor/eliza/packages/os/scripts/android/sense-listener.mjs';
export {FORBIDDEN,INDICATOR_EXEMPT_ROLES,UNPRIVILEGED,VOICE_HOST_RECORD,LISTENER_BUNDLE_MANIFEST,apkPermissions,checkListenerDescriptor,checkListenerOverlay,checkListenerPermissions,checkListenerSpeechBundle,checkListenerSpeechNatives,listenerPackage,privappPermissions,verifyAospListener} from '../vendor/eliza/packages/os/scripts/android/sense-listener.mjs';

interface ListenerStageOptions {
 root: string;
 output: string;
 apk: string;
 launcherSigner: string;
 appId: string;
 descriptorFile: string | null;
 production: boolean;
 aapt: string;
 apksigner: string;
 env: NodeJS.ProcessEnv;
}

// The shared adapter verifies and stages a single private copy of the listener APK.
export function stageListener({root,output,apk,launcherSigner,appId,descriptorFile,production,aapt,apksigner,env}: ListenerStageOptions) {
 const product=JSON.parse(fs.readFileSync(path.join(root,'android/aosp/pixel10a-composition.json'),'utf8'));
 if(product.launcher.packageName!==appId)throw Error('Sense product differs from the admitted launcher');
 const voiceHost=JSON.parse(fs.readFileSync(path.join(root,VOICE_HOST_RECORD),'utf8'));
 const descriptor=descriptorFile ? JSON.parse(fs.readFileSync(descriptorFile,'utf8')) : undefined;
 return stageSenseApk({output,apk,launcherSigner,product,descriptor,voiceHost,production,aapt,apksigner,env});
}
