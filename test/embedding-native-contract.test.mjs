import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {nativeInputPaths,nativeJavaPath,nativeBinding,nativeInputs,nativeGenerated,nativeCmakeOptions,verifyNativeJava,verifyNativeSymbols} from '../scripts/embedding-native-contract.mjs';
import {verifyEmbeddingInputs} from '../scripts/stage-embedding-host.mjs';
const identity='ai.elizaresearch.alphaphone';
const cpp='env->RegisterNatives(cls, methods, count); JNI_OnLoad(vm, reserved);\n'+[
 ['nativeEmbed','(JLjava/lang/String;I)[F'],['nativeEmbedUtf8','(J[BI)[F'],['nativeEmbedWithOptionsUtf8','(J[BIZ)[F']
].map(([name,signature])=>`ELIZA_NATIVE(${name}, "${signature}"),`).join('\n');
const cmake='ELIZA_VOICE_JNI_CLASS ELIZA_VOICE_JNI_SUBSET';
const java='package ai.elizaos.app; class ElizaVoiceNative {\nstatic native float[] nativeEmbed(long handle, String input, int pooling);\nstatic native float[] nativeEmbedUtf8(long handle, byte[] input, int pooling);\nstatic native float[] nativeEmbedWithOptionsUtf8(long handle, byte[] input, int pooling, boolean parseSpecial);\n}';
test('legacy exported JNI keeps the exact existing identity transformation and symbols',()=>{
 const binding=nativeBinding('Java_ai_elizaos_app_ElizaVoiceNative_nativeEmbed; ai/elizaos/app/ElizaVoiceNative','',identity);
 assert.equal(nativeInputs(binding).length,5);assert.deepEqual(nativeCmakeOptions(binding),[]);
 assert.equal(nativeGenerated('jni.cpp','Java_ai_elizaos_app_ElizaVoiceNative_nativeEmbed; ai/elizaos/app/ElizaVoiceNative',identity,binding),'Java_ai_elizaresearch_alphaphone_ElizaVoiceNative_nativeEmbed; ai/elizaresearch/alphaphone/ElizaVoiceNative');
 assert.doesNotThrow(()=>verifyNativeSymbols(['nativeEmbed','nativeEmbedUtf8','nativeEmbedWithOptionsUtf8'].map(name=>'000 T Java_ai_elizaresearch_alphaphone_ElizaVoiceNative_'+name).join('\n'),binding));
 assert.throws(()=>verifyNativeSymbols('000 T JNI_OnLoad',binding),/missing/);
});
test('registered JNI selects the product class without rewriting shared C++ and admits only JNI_OnLoad',()=>{
 const binding=nativeBinding(cpp,cmake,identity);assert.equal(nativeInputs(binding).at(-1),nativeJavaPath);
 assert.deepEqual(nativeCmakeOptions(binding),['-DELIZA_VOICE_JNI_CLASS=ai/elizaresearch/alphaphone/ElizaVoiceNative','-DELIZA_VOICE_JNI_SUBSET=full','-DELIZA_VOICE_JNI_LIBRARY=elizavoicejni']);
 assert.equal(nativeGenerated('jni.cpp',cpp,identity,binding),cpp);assert.equal(nativeGenerated(nativeJavaPath,java,identity,binding),java.replaceAll('ai.elizaos.app',identity));
 assert.equal(verifyNativeJava(cpp,java),3);
 assert.throws(()=>verifyNativeJava(cpp,java.replace('boolean parseSpecial','int parseSpecial')),/signature changed/);
 assert.throws(()=>verifyNativeJava(cpp,java.replace('static native float[] nativeEmbedUtf8(long handle, byte[] input, int pooling);','')),/set changed/);
 const streamCpp=cpp+'\nELIZA_NATIVE(nativeParadeeSynthesizeStream, "(J[BFLjava/lang/Object;)V"),',streamJava=java.replace('\n}','\nstatic native void nativeParadeeSynthesizeStream(long ctx, byte[] utf8Text, float speed, Object sink);\n}');
 assert.equal(verifyNativeJava(streamCpp,streamJava),4);
 assert.throws(()=>verifyNativeJava(streamCpp.replace('Ljava/lang/Object;','Ljava/lang/String;'),streamJava),/signature changed/);
 assert.throws(()=>verifyNativeJava(streamCpp,streamJava.replace('Object sink','Runnable sink')),/Unsupported native Java type/);
 assert.doesNotThrow(()=>verifyNativeSymbols('000 T JNI_OnLoad\n',binding));
 for(const symbols of ['000 T nativeEmbed','000 T JNI_OnLoad\n000 T unexpected'])assert.throws(()=>verifyNativeSymbols(symbols,binding),/missing|unexpected/);
});
test('registered receipt admission binds Java, full native set and product class; old receipt fails closed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-jni-contract-')),vendor=path.join(root,'vendor/eliza');fs.mkdirSync(vendor,{recursive:true});
 const git=(...args)=>execFileSync('git',['-C',vendor,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const sha=value=>createHash('sha256').update(value).digest('hex'),binding=nativeBinding(cpp,cmake,identity),forkPin='1'.repeat(40);
 try{
  git('init');git('config','user.name','JNI fixture');git('config','user.email','fixture@example.invalid');
  const inputs=nativeInputs(binding).map(relative=>{const source=relative===nativeJavaPath?java:relative.endsWith('.cpp')?cpp:relative.endsWith('CMakeLists.txt')?cmake:'// pinned build helper';const file=path.join(vendor,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);return {path:relative,sourceSha256:sha(source),generatedSha256:sha(nativeGenerated(relative,source,identity,binding))};});
  fs.mkdirSync(path.join(vendor,'plugins/plugin-local-inference/native/llama.cpp'),{recursive:true});git('add','.');git('update-index','--add','--cacheinfo','160000,'+forkPin+',plugins/plugin-local-inference/native/llama.cpp');git('commit','-m','Registered fixture');
  const pin=git('rev-parse','HEAD'),receipt={pin,forkPin,identity,abi:'arm64-v8a',inputs,jniBinding:binding};
  fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:pin}));fs.writeFileSync(path.join(root,'app.config.json'),JSON.stringify({appId:identity}));
  assert.doesNotThrow(()=>verifyEmbeddingInputs(root,receipt));
  assert.throws(()=>verifyEmbeddingInputs(root,{...receipt,inputs:inputs.slice(0,5)}),/qualification missing/);
  for(const change of [{className:'other/product/ElizaVoiceNative'},{subset:'voice'},{mode:'exported'}])assert.throws(()=>verifyEmbeddingInputs(root,{...receipt,jniBinding:{...binding,...change}}),/identity qualification/);
  fs.appendFileSync(path.join(vendor,nativeJavaPath),'\n// changed');git('add','.');git('commit','-m','Java source changed');fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:git('rev-parse','HEAD')}));assert.throws(()=>verifyEmbeddingInputs(root,receipt),/Native build input changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('current pinned streaming JNI callback matches its exact Object descriptor',()=>{
 const source=fs.readFileSync('vendor/eliza/packages/app/platforms/android/app/src/main/elizavoice-jni/elizavoice-jni.cpp','utf8');
 const declarations=fs.readFileSync('vendor/eliza/'+nativeJavaPath,'utf8');
 assert.match(declarations,/nativeParadeeSynthesizeStream\(long ctx, byte\[\] utf8Text, float speed, Object sink\)/);
 assert.ok(verifyNativeJava(source,declarations)>3);
 assert.throws(()=>verifyNativeJava(source,declarations.replace('Object sink','String sink')),/signature changed: nativeParadeeSynthesizeStream/);
});
