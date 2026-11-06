// The native preparation and admission paths share one identity transformation.
export const nativeInputPaths = [
 'packages/app/scripts/stage-elizavoice-lib.ts',
 'packages/app/scripts/build-helpers/arm64-simd.ts',
 'packages/app/scripts/build-helpers/verify-fused-symbols.ts',
 'packages/app/scripts/build-helpers/omnivoice-merged.ts',
 'packages/app/scripts/aosp/compile-libllama.ts',
 'packages/app/scripts/aosp/compile-libllama-paths.ts',
 'packages/app/scripts/aosp/compile-shim.ts',
 'packages/app/scripts/aosp/vulkan-source-contract.ts',
 'packages/app/scripts/aosp/zig-toolchain.ts',
 'packages/app/scripts/lib/repo-root.ts',
 // resolveRepoRoot needs these monorepo markers.
 'package.json',
 'packages/app/package.json',
 'packages/agent/package.json',
 'packages/app/platforms/android/app/src/main/elizavoice-jni/CMakeLists.txt',
 'packages/app/platforms/android/app/src/main/elizavoice-jni/elizavoice-jni.cpp',
];
export const nativeJavaPath = 'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaVoiceNative.java';
export function nativeBinding(cpp, cmake, identity) {
 if(!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identity))throw Error('Invalid product identity');
 const registered=/env->RegisterNatives\s*\(/.test(cpp);
 if(registered&&(!/JNI_OnLoad\s*\(/.test(cpp)||!cmake.includes('ELIZA_VOICE_JNI_CLASS')||!cmake.includes('ELIZA_VOICE_JNI_SUBSET')))throw Error('Unsupported native registration contract');
 return {mode:registered?'registered':'exported',className:identity.replaceAll('.','/')+'/ElizaVoiceNative',subset:'full'};
}
export function nativeInputs(binding){return binding.mode==='registered'?[...nativeInputPaths,nativeJavaPath]:nativeInputPaths;}
export function nativeGenerated(relative, source, identity, binding){
 if(relative===nativeJavaPath)return source.replaceAll('ai.elizaos.app',identity);
 if(relative.endsWith('.cpp')&&binding.mode==='exported')return source.replaceAll('Java_ai_elizaos_app_','Java_'+identity.replaceAll('.','_')+'_').replaceAll('ai/elizaos/app/',identity.replaceAll('.','/')+'/');
 return source;
}
export function nativeCmakeOptions(binding){return binding.mode==='registered'?[`-DELIZA_VOICE_JNI_CLASS=${binding.className}`,'-DELIZA_VOICE_JNI_SUBSET=full','-DELIZA_VOICE_JNI_LIBRARY=elizavoicejni']:[];}
const clean=source=>source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
/** Reject a source pin whose full registration table cannot bind its staged Java class. */
export function verifyNativeJava(cpp,java){
 const types={void:'V',boolean:'Z',byte:'B',char:'C',short:'S',int:'I',long:'J',float:'F',double:'D',String:'Ljava/lang/String;',Object:'Ljava/lang/Object;'};
 const descriptor=type=>{type=type.replace(/\s/g,'');if(type.endsWith('[]'))return '['+descriptor(type.slice(0,-2));if(!types[type])throw Error('Unsupported native Java type '+type);return types[type];};
 const declarations=new Map();
 for(const match of clean(java).matchAll(/\bstatic\s+native\s+([\w\[\]]+)\s+(\w+)\s*\(([^)]*)\)\s*;/g)){
  const parameters=match[3].trim()?match[3].split(',').map(parameter=>descriptor(parameter.trim().split(/\s+/).slice(0,-1).join(''))).join(''):'';
  if(declarations.has(match[2]))throw Error('Overloaded native declaration requires review');
  declarations.set(match[2],`(${parameters})${descriptor(match[1])}`);
 }
 const methods=[...clean(cpp).matchAll(/ELIZA_NATIVE\(\s*(\w+)\s*,\s*"([^"]+)"\s*\)/g)];
 if(!methods.length||new Set(methods.map(match=>match[1])).size!==methods.length||methods.length!==declarations.size)throw Error('Native registration and Java declaration set changed');
 for(const [,name,signature] of methods)if(declarations.get(name)!==signature)throw Error('Native registration signature changed: '+name);
 for(const required of ['nativeEmbed','nativeEmbedUtf8','nativeEmbedWithOptionsUtf8'])if(!declarations.has(required))throw Error('Required native embedding declaration missing');
 return methods.length;
}
export function nativeRequiredSymbols(binding){return binding.mode==='registered'?['JNI_OnLoad']:['nativeEmbed','nativeEmbedUtf8','nativeEmbedWithOptionsUtf8'].map(name=>'Java_'+binding.className.replaceAll('/','_')+'_'+name);}
export function verifyNativeSymbols(symbols,binding){
 const exports=symbols.trim().split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/).at(-1));
 for(const required of nativeRequiredSymbols(binding))if(!exports.includes(required))throw Error('Required embedding JNI symbol missing');
 if(binding.mode==='registered'&&exports.some(symbol=>symbol!=='JNI_OnLoad'))throw Error('Registered JNI bridge exports unexpected symbols');
 if(exports.some(symbol=>symbol.startsWith('Java_ai_elizaos_app_')))throw Error('Unrelocated JNI identity');
}
