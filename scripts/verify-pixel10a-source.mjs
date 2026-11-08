import fs from 'node:fs';
import {listenerSystemuiPatch, aospBuildPatch, verifyPixel10aSource} from './pixel10a-source-contract.mjs';
const args=process.argv.slice(2), values={}, bundles=[], buildPatches=[];
for(let i=0;i<args.length;i+=2) {
  const repeatable=args[i]==='--applied-systemui-patch'||args[i]==='--applied-build-patch';
  if(!['--aosp-source','--factory-image','--out','--applied-systemui-patch','--applied-build-patch'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--') || (!repeatable && values[args[i]]) || bundles.includes(args[i+1]) || buildPatches.includes(args[i+1])) throw Error('Use --aosp-source PATH --factory-image FILE [--applied-systemui-patch chip|ops|assist ...] [--applied-build-patch soong-memory|soong-app-native ...] [--out NEW_FILE]');
  if(args[i]==='--applied-systemui-patch') bundles.push(args[i+1]); else if(args[i]==='--applied-build-patch') buildPatches.push(args[i+1]); else values[args[i]]=args[i+1];
}
const evidence=await verifyPixel10aSource({source:values['--aosp-source'],factory:values['--factory-image'],appliedPatches:[...bundles.map(listenerSystemuiPatch),...buildPatches.map(aospBuildPatch)]});
const report=JSON.stringify({...evidence,observedAt:new Date().toISOString()},null,2)+'\n';
if(values['--out']) fs.writeFileSync(values['--out'],report,{flag:'wx'});
console.log(report);
