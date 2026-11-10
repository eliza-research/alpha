import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const {stageSenseListener} = await import(new URL("../vendor/eliza/packages/os/scripts/android/sense-listener.mjs", import.meta.url).href);
export const {FORBIDDEN, INDICATOR_EXEMPT_ROLES, UNPRIVILEGED, VOICE_HOST_RECORD, LISTENER_BUNDLE_MANIFEST, apkPermissions, checkListenerDescriptor, checkListenerOverlay, checkListenerPermissions, checkListenerSpeechBundle, checkListenerSpeechNatives, listenerPackage, privappPermissions, verifyAospListener} = await import(new URL("../vendor/eliza/packages/os/scripts/android/sense-listener.mjs", import.meta.url).href);

// The outer staging pipeline admits this product, voice record and APK descriptor first.
export function stageListener({root,output,apk,dump,signer,launcherSigner,appId}: any) {
 const product=JSON.parse(fs.readFileSync(path.join(root,'android/aosp/pixel10a-composition.json'),'utf8'));
 if(product.launcher.packageName!==appId)throw Error('Sense product differs from the admitted launcher');
 const voiceHost=JSON.parse(fs.readFileSync(path.join(root,'android/voice-host/qualified-voice-host.json'),'utf8'));
 const entries=execFileSync('unzip',['-Z1',apk],{encoding:'utf8',maxBuffer:64<<20}).split(/\r?\n/).filter(Boolean);
 const readEntry=(entry: any)=>execFileSync('unzip',['-p',apk,entry],{encoding:'utf8',maxBuffer:1<<20});
 const hashEntry=(entry: any)=>createHash('sha256').update(entry===null?fs.readFileSync(apk):execFileSync('unzip',['-p',apk,entry],{maxBuffer:256<<20})).digest('hex');
 const stage = stageSenseListener as unknown as (options:{output:string;apk:string;dump:string;signer:string;launcherSigner:string;product:unknown;voiceHost:unknown;entries:string[];readEntry:(entry:string)=>string;hashEntry:(entry:string|null)=>string})=>ReturnType<typeof stageSenseListener>;
 stage({output,apk,dump,signer,launcherSigner,product,voiceHost,entries,readEntry,hashEntry});
 return path.join(output,'listener');
}
