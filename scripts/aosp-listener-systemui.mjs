import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareListenerSystemui as prepare,verifyListenerSystemui as verify} from '../vendor/eliza/packages/os/scripts/android/sense-systemui.mjs';
export function prepareListenerSystemui(source,output,bundle='ops'){return prepare(source,output,bundle);}
export function verifyListenerSystemui(source,state='before',bundle='ops'){return verify(source,state,bundle);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const args=process.argv.slice(2),source=args[args.indexOf('--source')+1];
 if(!args.includes('--source')||!source)throw Error('Use --source AOSP_ROOT [--chip | --assist] [--output NEW_OVERLAY | --after]');
 if(args.includes('--chip')&&args.includes('--assist'))throw Error('Choose one SystemUI bundle');
 const bundle=args.includes('--chip')?'chip':args.includes('--assist')?'assist':'ops',output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
 if(args.includes('--output')&&(!output||output.startsWith('--')))throw Error('--output needs a new directory');
 if(output&&args.includes('--after'))throw Error('--output requires unpatched source');
 console.log(JSON.stringify(output?prepareListenerSystemui(source,path.resolve(output),bundle):verifyListenerSystemui(source,args.includes('--after')?'after':'before',bundle),null,2));
}
