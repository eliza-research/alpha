from pathlib import Path
import json,shutil,hashlib
root=Path('/home/shaw/.codex/worktrees/production-completion/alphaphone'); out=Path('/tmp/alpha-embedding-58df');out.mkdir(exist_ok=False)
def put(n,s):
 p=out/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
put('settings.gradle',"pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\nrootProject.name='alpha-embedding-qualification'\ninclude ':app'\n")
put('build.gradle',"buildscript { repositories { google(); mavenCentral() }; dependencies { classpath 'com.android.tools.build:gradle:8.13.0' } }\nallprojects { repositories { google(); mavenCentral() } }\n")
put('gradle.properties','android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2g\n')
put('app/build.gradle',"""apply plugin: 'com.android.application'
android {
 namespace 'ai.alphacompute.alphaphone'
 compileSdk 36
 defaultConfig { applicationId 'ai.eliza.embeddingqualify'; minSdk 26; targetSdk 36; testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'; buildConfigField 'String', 'ELIZA_ASR_THREADS', '\"\"' }
 buildFeatures { buildConfig true }
 compileOptions { sourceCompatibility JavaVersion.VERSION_21; targetCompatibility JavaVersion.VERSION_21 }
 androidResources { noCompress 'gguf' }
}
dependencies { androidTestImplementation 'androidx.test:runner:1.6.2'; androidTestImplementation 'androidx.test.ext:junit:1.2.1' }
""")
put('app/src/main/AndroidManifest.xml','<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Alpha embedding qualification" /></manifest>')
java='app/src/main/java/ai/alphacompute/alphaphone/'
candidate=root/'.eliza/native-candidate-6003-standalone-arm64'
put(java+'ElizaVoiceNative.java',(candidate/'source/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaVoiceNative.java').read_text())
put(java+'ElizaAsrNativeEnv.java',(root/'vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAsrNativeEnv.java').read_text().replace('package ai.elizaos.app;','package ai.alphacompute.alphaphone;'))
rows=[]
for abi,suffix in [('arm64-v8a','arm64'),('x86_64','x86_64')]:
 receipt=json.loads((root/f'.eliza/native-candidate-6003-standalone-{suffix}/PREPARATION.json').read_text())
 for row in receipt['libraries']:
  src=Path(row['path'])
  if src.name=='libelizainference.so':src=root/f'.eliza/voice-candidate-58df/jniLibs/{abi}/libelizainference.so'
  else:assert hashlib.file_digest(src.open('rb'),'sha256').hexdigest()==row['sha256']
  dst=out/'app/src/main/jniLibs'/abi/src.name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
  rows.append({'abi':abi,'source':str(src),'sha256':hashlib.file_digest(src.open('rb'),'sha256').hexdigest(),'bytes':src.stat().st_size})
model=Path('/home/shaw/.codex/worktrees/phone-latest-build/alphaphone/artifacts/pre-merge-oct14-staging/agent/models/bge-small-en-v1.5-f16.gguf')
assert hashlib.file_digest(model.open('rb'),'sha256').hexdigest()=='f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'
dst=out/'app/src/main/assets/bge-small-en-v1.5-f16.gguf';dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(model,dst)
put('input-receipt.json',json.dumps({'nativeFork':'6003a10368d8a6d5fb1f70fe9c63a70866e8bcff','consumerPin':'58dfddf87ee5adec414746a86a23dada124fbbae','libraries':rows,'qualified':False},indent=2)+'\n')
print(out)
