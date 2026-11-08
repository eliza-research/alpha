// Locates the plain JDK and the pinned org.json jar for host-JVM fixture tests. These tests compile
// Capacitor-free native classes with javac and run them on the host; they are not Android evidence.
import {existsSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {preparePatchedNative} from '../../scripts/prepare-patched-native.mjs';

export const root=resolve(import.meta.dirname,'../..');
export const nativeSource=name=>join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone',name);
export const fixture=name=>join(root,'test/fixtures',name);
export const upstreamConnection=name=>join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection',name);
export const upstreamAgentRuntime=name=>join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime',name);
// Shared speech pipeline (ai.eliza.voice) and its upstream host-JVM fixtures at the reviewed pin.
export const upstreamVoiceSource=name=>join(root,'vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice',name);
// The shared product-subclassable speech bridge (AlphaVoiceCloudPlugin's base) at the reviewed pin.
export const upstreamBridgeSource=name=>join(root,'vendor/eliza/plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice',name);
export const upstreamVoiceFixture=name=>join(root,'vendor/eliza/packages/app/scripts/paradee-voice/speech-pipeline',name);

const homebrew='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
/** JAVA_HOME first; on darwin the Homebrew JDK when installed; otherwise javac/java on PATH. */
export const javaHome=()=>process.env.JAVA_HOME||(process.platform==='darwin'&&existsSync(homebrew)?homebrew:'');
export const javaBinary=name=>{const home=javaHome();return home?join(home,'bin',name):name;};

const cache=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const cached=existsSync(cache)?readdirSync(cache).flatMap(hash=>readdirSync(join(cache,hash)).filter(name=>name==='json-20250517.jar').map(name=>join(cache,hash,name)))[0]:undefined;
export const jsonJar=process.env.ALPHA_JSON_JAR||cached;
/** One timeout for every host javac and java run. */
export const jvmTimeout=120000;

const runs=command=>{const result=spawnSync(command,['-version'],{stdio:'ignore',timeout:30000});return !result.error&&result.status===0;};
const tools={
 json:()=>jsonJar?false:'Set ALPHA_JSON_JAR or install the pinned Gradle JSON test dependency',
 javac:()=>runs(javaBinary('javac'))?false:'No javac: set JAVA_HOME or put a JDK on PATH',
 sqlite3:()=>runs('sqlite3')?false:'No sqlite3 on PATH',
};
/** Skip reason for the first missing tool ('json', 'javac', 'sqlite3'), or false. Takes names or one
 * array of names. On CI a missing tool is a failure, never a skip: the test runs and fails where the
 * tool is needed. */
export function jvmSkip(...names){
 if(process.env.CI)return false;
 for(const name of names.flat()){const reason=tools[name]();if(reason)return reason;}
 return false;
}
/** Skip reason when org.json is missing. On CI a missing jar is a failure, never a skip. */
export const jsonJarSkip=jvmSkip('json');

/** Compiles the sources (plus org.json when needed) and returns the main class's stdout for the given stdin. */
export function runJvm(sources,mainClass,{json=false,args=[],input}={}){
 const temporary=mkdtempSync(join(tmpdir(),'alpha-jvm-'));
 try{
  const classpath=json?['-cp',jsonJar]:[];
  execFileSync(javaBinary('javac'),['--release','11',...classpath,'-d',temporary,...sources],{timeout:jvmTimeout});
  return execFileSync(javaBinary('java'),['-cp',json?temporary+':'+jsonJar:temporary,mainClass,...args],{encoding:'utf8',timeout:jvmTimeout,input});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

/** Authenticated shared voice additions, compiled from the reviewed patch, never a vendor edit. */
export function sharedSpeechSource(name) {
 if(!/^[A-Za-z][A-Za-z0-9]*\.java$/.test(name))throw Error('Invalid shared speech source');
 const staged=preparePatchedNative({root});
 return join(staged.root,'plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice',name);
}
