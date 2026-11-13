/** Record build input identities without capturing file contents or private state. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const roots=['apps/app/src','apps/app/public','android/app/src/main/java','android/app/src/main/res','android/app/src/androidTest','android/app/src/testMocks','android/app/src/main/AndroidManifest.xml','android/app/build.gradle','android/settings.gradle','capacitor.config.ts','vite.config.ts','package.json','bun.lock','app.config.json'];
// Record flavor manifests and build policy as well as renderer/bridge sources.
// Generated web assets and Gradle output remain outputs, not source inputs.
roots.push('android/app/src/launcher','android/app/src/standalone','android/app/src/release',
 // The Gradle host the pinned upstream generator writes from android/consumer-host.json.
 'android/consumer-host.json','android/app/product.gradle','scripts/android-host.ts',
 'android/app/cloud-deployment.generated.gradle','scripts/cloud-deployment.ts','scripts/cloud-deployment-policy.ts',
 'android/.eliza-consumer-profile.json','android/eliza-consumer-host',
 'vendor/eliza/packages/app/scripts/mobile/android/consumer-host.mjs',
 'vendor/eliza/packages/app/scripts/mobile/android/consumer-host',
 'vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs',
 'android/build.gradle','android/gradle.properties',
 // Which dependency and plugin artifacts Gradle accepts (SHA-256); absent means unverified.
 'android/gradle/verification-metadata.xml',
 'android/gradle/wrapper/gradle-wrapper.properties','android/gradle/wrapper/gradle-wrapper.jar',
 'android/gradlew','android/gradlew.bat','android/app/proguard-rules.pro',
 'android/notification-fixture/build.gradle','android/notification-fixture/src',
 'scripts/build-android.ts','scripts/update-channel.ts','scripts/android-build-preflight.ts','scripts/toolchain.ts','scripts/verify-upstream.ts',
 'scripts/pinned-upstream-source.ts','scripts/verify-apks.ts','scripts/verify-packaged-runtime.py','scripts/apk.ts','scripts/source-snapshot.ts');
// The on-device voice record and its staging/verification code are APK inputs. The staged voice
// outputs and their record are streamed into the freeze so large model files do not require large buffers.
roots.push('android/voice-host','android/embedding-host','android/paradee-voice','android/local-speech/build.gradle',
 '.eliza/native-inputs/receipt.json',
 'scripts/native-build-inputs.ts','scripts/build-embedding-host.ts',
 'scripts/embedding-native-contract.ts','scripts/embedding-build-remap.ts',
 '.eliza/paradee-voice/native',
 'scripts/stage-embedding-host.ts','scripts/prepare-embedding-host.ts',
 'scripts/android-stage-voice-models.ts','scripts/voice-host.ts','scripts/paradee-runtime.ts');
// Resident payload and generated Java are consumed directly by Gradle. Capture
// their exact bytes, provenance and reproduction inputs, excluding web assets/dependencies.
roots.push('android/app/src/main/assets/agent','android/app/src/main/jniLibs',
 'android/app/build/generated/local-agent/java',
 'android/app/build/generated/local-agent/source-manifest.json',
 'upstream.lock.json',
 'android/upstream-native-sources.json',
 'scripts/prepare-local-agent.ts','scripts/local-agent-source.ts','scripts/copy-file-clone.ts',
 'scripts/stage-local-agent-runtime.ts','scripts/stage-local-agent-sources.ts','scripts/native-view-policy.ts',
 'scripts/build-mobile-agent.ts','scripts/mobile-uuid-adapter.ts','scripts/mobile-bundle-smoke.ts','scripts/upstream-mobile-build.ts',
 'scripts/build-policy-source.ts','scripts/core-state-patch.ts','scripts/core-state-preload.ts','scripts/combined-agent-source.ts',
 'scripts/upstream-core-sources.ts',
 'scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts',
 'scripts/prepare-client-features.ts','.eliza/client-features/.source.json',
 'vendor/eliza/packages/app/src/runtime/managed-google-agent/managed-google-agent-host.ts',
 'scripts/ci/resident_native_source.py',
 'scripts/build-workflow-worker.ts','scripts/prepared-workflow-worker.ts',
 'scripts/stage-workflow-worker.ts','scripts/workflow-worker-artifact.ts',
 'vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app',
 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/ChromiumBrowserIdentity.java');
const files: string[]=[];
function walk(entry: string){if(!fs.existsSync(entry))return;const stat=fs.lstatSync(entry);if(stat.isDirectory())for(const name of fs.readdirSync(entry).sort())walk(path.join(entry,name));else if(stat.isFile())files.push(entry);}
roots.forEach(walk);
function fileHash(file: string) {
 const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(4*1024*1024);
 try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}
 finally{fs.closeSync(fd);}
 return hash.digest('hex');
}
const hashes=Object.fromEntries(files.sort().map(file=>[file,fileHash(file)]));
const digest=crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
console.log(JSON.stringify({schemaVersion:5,digest,files:hashes},null,2));
