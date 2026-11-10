import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readApkEntries} from '../vendor/eliza/packages/app/scripts/mobile/artifact-inspection/apk-distribution.mjs';
import {stageSenseListener} from '../vendor/eliza/packages/os/scripts/android/sense-listener.mjs';
export {FORBIDDEN,INDICATOR_EXEMPT_ROLES,UNPRIVILEGED,VOICE_HOST_RECORD,LISTENER_BUNDLE_MANIFEST,apkPermissions,checkListenerDescriptor,checkListenerOverlay,checkListenerPermissions,checkListenerSpeechBundle,checkListenerSpeechNatives,listenerPackage,privappPermissions,verifyAospListener} from '../vendor/eliza/packages/os/scripts/android/sense-listener.mjs';

// The outer staging pipeline admits this product, voice record and APK descriptor first.
interface ListenerStage {
 root: string;
 output: string;
 apk: string;
 dump: string;
 signer: string;
 launcherSigner: string;
 appId: string;
}
export function stageListener({root,output,apk,dump,signer,launcherSigner,appId}: ListenerStage) {
 const product=JSON.parse(fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/products/pixel10a-alpha.json'),'utf8'));
 if(product.launcher.packageName!==appId)throw Error('Sense product differs from the admitted launcher');
 const voiceHost=JSON.parse(fs.readFileSync(path.join(root,'android/voice-host/qualified-voice-host.json'),'utf8'));
 const entries=readApkEntries(apk);
 const readEntry=(entry: string)=>execFileSync('unzip',['-p',apk,entry],{encoding:'utf8',maxBuffer:1<<20});
 const hashEntry=(entry: string | null)=>createHash('sha256').update(entry===null?fs.readFileSync(apk):execFileSync('unzip',['-p',apk,entry],{maxBuffer:256<<20})).digest('hex');
 stageSenseListener({output,apk,dump,signer,launcherSigner,product,descriptor: undefined,voiceHost,entries,readEntry,hashEntry});
 return path.join(output,'listener');
}
