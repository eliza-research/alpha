/** Build and run the pinned independent Calendar consumer outside vendor source. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceDirectory,verifySource} from './local-agent-source.mjs';
import {generateAlphaAndroidHost} from './android-host.mjs';
const root=path.resolve(import.meta.dirname,'..');
const flags=new Set(process.argv.slice(2));
if([...flags].some(flag=>!['--build-only','--bridge','--workflow-permission'].includes(flag)))throw Error('Unknown Calendar consumer option');
const serial=process.env.ALPHA_CALENDAR_TEST_SERIAL,avd=process.env.ALPHA_CALENDAR_TEST_AVD,abi=process.env.ALPHA_CALENDAR_TEST_ABI;
if(!flags.has('--build-only')&&(!/^emulator-\d+$/.test(serial||'')||!avd||!['x86_64','arm64-v8a'].includes(abi)))throw Error('Set the owned ALPHA_CALENDAR_TEST_SERIAL, exact ALPHA_CALENDAR_TEST_AVD and ALPHA_CALENDAR_TEST_ABI');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;if(!sdk||!path.isAbsolute(sdk))throw Error('Set an absolute Android SDK path');
const run=(command,args,env=process.env)=>execFileSync(command,args,{cwd:root,env,stdio:'inherit'});
run(process.execPath,['scripts/prepare-local-agent.mjs','--source-only']);
const source=sourceDirectory(root),pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
const output=path.join(root,'artifacts',`calendar-consumer-${pin}`),init=path.join(output,'outputs.gradle');
for(let current=init;current!==root;current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlink in Calendar build output');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(init,"gradle.beforeProject { project -> project.layout.buildDirectory.set(new File(System.getenv('ALPHA_CALENDAR_BUILD_OUTPUT'), project.name)) }\n");
const fixture=path.join(source,'plugins/plugin-native-calendar/test/android-consumer');
// The generated host supplies the hash-pinned Gradle wrapper used for this separate project.
generateAlphaAndroidHost(root);
run(path.join(root,'android/gradlew'),['--no-daemon','--no-watch-fs','--project-cache-dir',path.join(output,'.gradle'),'--init-script',init,'-p',fixture,`-PcapacitorAndroidDir=${path.join(root,'node_modules/@capacitor/android/capacitor')}`,'assembleDebug','assembleDebugAndroidTest'],{...process.env,ANDROID_HOME:sdk,ALPHA_CALENDAR_BUILD_OUTPUT:output});
verifySource(source,pin);
const apk=path.join(output,'android-consumer/outputs/apk/debug/android-consumer-debug.apk'),testApk=path.join(output,'android-consumer/outputs/apk/androidTest/debug/android-consumer-debug-androidTest.apk');
if(flags.has('--build-only'))console.log(JSON.stringify({pin,apk,testApk}));
else run(process.execPath,[path.join(fixture,'run-consumer.mjs'),'--adb',path.join(sdk,'platform-tools/adb'),'--aapt',path.join(sdk,'build-tools/36.0.0/aapt'),'--serial',serial,'--avd',avd,'--abi',abi,'--case',flags.has('--workflow-permission')?'workflow-permission':flags.has('--bridge')?'bridge':'recovery','--apk',apk,'--test-apk',testApk,'--output-root',path.join(root,'test-results/native-calendar-consumer')]);
