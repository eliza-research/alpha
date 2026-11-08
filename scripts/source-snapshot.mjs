/** Record build input identities without capturing file contents or private state. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const roots=['apps/app/src','apps/app/public','android/app/src/main/java','android/app/src/main/res','android/app/src/androidTest','android/app/src/testMocks','android/app/src/main/AndroidManifest.xml','android/app/build.gradle','android/settings.gradle','capacitor.config.ts','vite.config.ts','package.json','package-lock.json','app.config.json'];
// Record flavor manifests and build policy as well as renderer/bridge sources.
// Generated web assets and Gradle output remain outputs, not source inputs.
roots.push('android/app/src/launcher','android/app/src/standalone','android/app/src/release',
 // The Gradle host the pinned upstream generator writes from android/consumer-host.json.
 'android/consumer-host.json','android/app/product.gradle','scripts/android-host.mjs',
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
 'scripts/build-android.mjs','scripts/android-build-preflight.mjs','scripts/toolchain.mjs','scripts/verify-upstream.mjs',
 'scripts/pinned-upstream-source.mjs','scripts/verify-apks.mjs','scripts/verify-packaged-runtime.py','scripts/apk.mjs','scripts/source-snapshot.mjs');
// The on-device voice record and its staging/verification code are APK inputs. The staged voice
// outputs are identified by their build record (every file's SHA-256), not re-hashed (about 1 GB).
roots.push('android/voice-host','android/embedding-host','android/paradee-voice','android/local-speech/build.gradle',
 '.eliza/paradee-voice/native/build-record.json',
 'scripts/stage-embedding-host.mjs','scripts/prepare-embedding-host.mjs',
 'scripts/android-stage-voice-models.mjs','scripts/voice-host.mjs','scripts/paradee-runtime.mjs');
// Resident payload and generated Java are consumed directly by Gradle. Capture
// their exact bytes, provenance and reproduction inputs, excluding web assets/dependencies.
roots.push('android/app/src/main/assets/agent','android/app/src/main/jniLibs',
 'android/app/build/generated/local-agent/java',
 'android/app/build/generated/local-agent/source-manifest.json',
 'upstream.lock.json',
 // Authored patch manifests and patch bytes change the native source compiled into an APK.
 'patches/eliza',
 'scripts/prepare-local-agent.mjs','scripts/local-agent-source.mjs','scripts/copy-file-clone.mjs',
 'scripts/stage-local-agent-runtime.mjs','scripts/stage-local-agent-sources.mjs',
 'scripts/build-mobile-agent.mjs','scripts/mobile-uuid-adapter.mjs','scripts/mobile-bundle-smoke.mjs',
 'scripts/prepare-patched-native.mjs','scripts/upstream-native-source.mjs',
 'scripts/prepare-client-features.mjs','scripts/client-speech-patch.mjs','.eliza/client-features/.source.json',
 'scripts/ci/resident_native_source.py',
 'scripts/build-workflow-worker.ts','scripts/prepared-workflow-worker.mjs',
 'scripts/stage-workflow-worker.mjs','scripts/workflow-worker-artifact.mjs',
 'vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app',
 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/ChromiumBrowserIdentity.java');
const files=[];
function walk(entry){if(!fs.existsSync(entry))return;const stat=fs.lstatSync(entry);if(stat.isDirectory())for(const name of fs.readdirSync(entry).sort())walk(path.join(entry,name));else if(stat.isFile())files.push(entry);}
roots.forEach(walk);
const hashes=Object.fromEntries(files.sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const digest=crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
console.log(JSON.stringify({schemaVersion:5,digest,files:hashes},null,2));
