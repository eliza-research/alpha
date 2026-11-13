import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeCacheDirectory,nativeRecipe,nativeRecipeDigest,NATIVE_BUILD_RECEIPT,validateNativeBuildReceipt,verifyNativeBuildFiles,verifyNativeBuildLibraries,fileDigest,assertNativeOutputPath} from '../native-build-inputs.ts';
const root=process.cwd(), expected='60760c2e524f5b7f59bc637f3502fdb2fe2fb68b52a2d891296ac7874d3d806f';
if(nativeRecipeDigest(nativeRecipe(root))!==expected)throw Error('Different native source recipe');
const cached=path.join(nativeCacheDirectory(root),'output'),receiptFile=path.join(cached,NATIVE_BUILD_RECEIPT);
const raw=fs.readFileSync(receiptFile),receipt=JSON.parse(raw.toString());
validateNativeBuildReceipt(root,receipt);verifyNativeBuildFiles(cached,receipt);verifyNativeBuildLibraries(cached,receipt);
if(receipt.producer.platform!=='linux'||receipt.producer.arch!=='x64'||receipt.producer.sdkCommit!=='442586ce66abf43ff382a951b8d439efd400af84')throw Error('Unexpected cached producer');
const output=path.join(root,'test-results/native-portable-inputs');
if(fs.existsSync(output))throw Error('Packet output must be fresh');
fs.mkdirSync(output,{recursive:true});
for(const row of receipt.files){assertNativeOutputPath(cached,row.path);const target=path.join(output,row.path);assertNativeOutputPath(output,row.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(cached,row.path),target,fs.constants.COPYFILE_EXCL);}
fs.mkdirSync(path.dirname(path.join(output,NATIVE_BUILD_RECEIPT)),{recursive:true});fs.writeFileSync(path.join(output,NATIVE_BUILD_RECEIPT),raw,{flag:'wx'});
verifyNativeBuildFiles(output,receipt);verifyNativeBuildLibraries(output,receipt);
if(fileDigest(path.join(output,NATIVE_BUILD_RECEIPT))!==fileDigest(receiptFile))throw Error('Producer receipt changed during export');
const index={schema:'alpha-native-portable-input-packet/v1',exportHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 recipeSha256:expected,consumerSdkCommit:receipt.consumerSdkCommit,producer:receipt.producer,originalReceiptSha256:fileDigest(receiptFile),
 cacheKey:'alpha-native-Linux-X64-'+expected,cacheAnchor:{id:10497208446,ref:'refs/heads/main',createdAt:'2026-11-13T20:47:58.646876Z',admittedByRun:43502247677},
 files:receipt.files,allNativeBytesVerified:true,librariesAbiAlignmentSymbolsAndLinkageVerified:true,producerReceiptBytesUnchanged:true,
 scope:'Read-only export of exactly the already-produced native inventory and unchanged receipt. No build, signing, private profile, credential, device or acceptance claim.'};
fs.writeFileSync(path.join(output,'packet-index.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({recipeSha256:expected,fileCount:receipt.files.length,receiptSha256:index.originalReceiptSha256,producer:index.producer,verified:true}));
