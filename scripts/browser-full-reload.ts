import type { Plugin } from 'vite';
import path from 'node:path';
import { realpathSync,readFileSync,readdirSync } from 'node:fs';
import {sha256File} from './sha256.ts';
/** Prototype adapters patch class methods during bootstrap; replay once per content edit. */
export function browserFullReload():Plugin {
 const fingerprints=new Map<string,string>();
 const sharedRoot=path.resolve(import.meta.dirname,'../.eliza/client-features');
 const snapshot=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())snapshot(file);else if(entry.isFile())fingerprints.set(file,sha256File(file));}};
 return {name:'alpha-browser-full-reload',enforce:'pre',config(){
   // Native macOS notifications can miss edits and Git's atomic replacements.
   // Polling also lets Vite invalidate its module graph before the reload hook.
   if(process.platform==='darwin')return {server:{watch:{usePolling:true,interval:250}}};
 },configureServer(server){
   // macOS can deliver queued filesystem notifications after the new server starts.
   // Compare bytes, not event timestamps, so real edits with preserved mtimes still work.
   snapshot(path.join(realpathSync(server.config.root),'src'));
   snapshot(sharedRoot);
 },hotUpdate(context){
   if(this.environment.name!=='client'||context.type==='delete')return;
   let file:string;
   try{file=realpathSync(context.file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
   const relative=path.relative(realpathSync(context.server.config.root),file).split(path.sep).join('/');
   const shared=path.relative(sharedRoot,file);
   if(!relative.startsWith('src/')&&(shared.startsWith('..'+path.sep)||path.isAbsolute(shared)))return;
   const previous=fingerprints.get(file);
   // Let Vite handle truly new modules. A create notice for a known path is
   // an atomic replacement and must share the normal content-based deduplication.
   if(context.type==='create'&&previous===undefined)return;
   const current=sha256File(file);if(previous===current)return [];fingerprints.set(file,current);
   if(context.type==='create')this.environment.moduleGraph.onFileChange(context.file);
   if(!relative.endsWith('.css')){context.server.ws.send({type:'full-reload',path:'*'});return [];}
 }};
}
