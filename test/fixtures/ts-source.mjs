// Node's type stripping removes types only and refuses TypeScript that needs a transform
// (parameter properties, enums, namespaces). Those sources go through esbuild, the compiler tsx
// uses (installed with tsx); everything else keeps Node's own position-preserving strip. Works on
// Node 24 and 26.
import {stripTypeScriptTypes as strip} from 'node:module';
import {transformSync} from 'esbuild';
export function stripTypeScriptTypes(source,options={}){
 try{return strip(source,{...options,mode:'strip'});}
 catch(error){
  if(error?.code!=='ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')throw error;
  return transformSync(source,{loader:'ts',target:'esnext',tsconfigRaw:{compilerOptions:{verbatimModuleSyntax:true}}}).code;
 }
}
