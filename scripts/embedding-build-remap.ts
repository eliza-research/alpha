import path from 'node:path';

function absoluteDirectory(value: any) {
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\s=\0]/.test(value)||path.normalize(value)!==value)throw Error('Build path remapping needs normalized absolute paths without whitespace');
 return value;
}

// Stable compiler paths are build configuration, independent of qualification receipts.
export function embeddingBuildRemap(_productRoot: any, {sdk, staging, fork, build}: any) {
 for(const directory of [sdk,staging,fork,build])absoluteDirectory(directory);
 const target='/alphaphone-embedding-host';
 return {CCC_OVERRIDE_OPTIONS:['#',...[
  [staging,target],
  [fork,target+'/plugins/plugin-local-inference/native/llama.cpp'],
  [build,target+'/jni-build'],
  [sdk,'/work/android-sdk'],
 ].map(([from,to]: any)=>`+-ffile-prefix-map=${from}=${to}`)].join(' ')};
}
