import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {androidEnv} from './toolchain.mjs';
import {generateAlphaAndroidHost} from './android-host.mjs';
const output=path.resolve(process.argv[2]||'test-results/notification-fixture');
if(!output.startsWith(path.resolve('test-results')+path.sep)||fs.existsSync(output))throw Error('New test-results output directory required');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const env=androidEnv(),keystore=path.join(output,'synthetic-signing.p12');
execFileSync(path.join(env.JAVA_HOME,'bin/keytool'),['-genkeypair','-keystore',keystore,'-storetype','PKCS12','-storepass','synthetic-fixture','-keypass','synthetic-fixture','-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','30','-dname','CN=Synthetic notification test only'],{env,stdio:'pipe',timeout:60000});
fs.chmodSync(keystore,0o600);
// The fixture is a module of the generated Android host.
generateAlphaAndroidHost();
const log=execFileSync('./gradlew',['--no-daemon',':notification-fixture:assembleSelectedDebug',':notification-fixture:assembleExcludedDebug',':notification-fixture:lint'],{cwd:'android',env:{...env,ALPHA_NOTIFICATION_FIXTURE_KEYSTORE:keystore},encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(output,'build.log'),log);
const apksigner=path.join(env.ANDROID_HOME,'build-tools/36.0.0/apksigner'),aapt=path.join(env.ANDROID_HOME,'build-tools/36.0.0/aapt');
const result={synthetic:true,networkPermission:false,apks:{}};
for(const flavor of ['selected','excluded']){
 const apk=path.join(output,`${flavor}.apk`);fs.copyFileSync(`android/notification-fixture/build/outputs/apk/${flavor}/debug/notification-fixture-${flavor}-debug.apk`,apk);
 const badging=execFileSync(aapt,['dump','badging',apk],{env,encoding:'utf8'}),cert=execFileSync(apksigner,['verify','--print-certs',apk],{env,encoding:'utf8'});
 if(!badging.includes(`package: name='ai.elizaresearch.notificationfixture.${flavor}'`)||badging.includes("name='android.permission.INTERNET'"))throw Error('Unexpected fixture identity or network permission');
 const signer=cert.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];if(!signer)throw Error('Fixture signer missing');
 result.apks[flavor]={file:path.basename(apk),packageName:`ai.elizaresearch.notificationfixture.${flavor}`,sha256:crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),signer};
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(result,null,2));
console.log('Built separately signed, synthetic-only notification witness APKs.');
