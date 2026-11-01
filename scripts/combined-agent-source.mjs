import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Hash source bytes, including untracked nonignored patches and symlink identities; never dependencies/private profiles. */
export function sourceManifest(source){
 if(!path.isAbsolute(source))throw Error('Explicit absolute source path required');
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:source,maxBuffer:20*1024*1024}).toString().split('\0').filter(Boolean);
 const allowedEmptyGitlinks={'plugins/plugin-local-inference/native/llama.cpp':'d960f633ddb034d0dd828a55216cfc17d012acbd'};
 const staged=execFileSync('git',['ls-files','--stage','-z'],{cwd:source,maxBuffer:20*1024*1024}).toString().split('\0').filter(Boolean),gitlinks=new Map();
 for(const entry of staged){const match=entry.match(/^(\d+) ([a-f0-9]{40}) (\d+)\t([\s\S]+)$/);if(!match||match[3]!=='0')throw Error('Unmerged or invalid source index');if(match[1]==='160000')gitlinks.set(match[4],match[2]);}
 const entries={};
 for(const name of [...new Set(files)].sort()){
  if(path.isAbsolute(name)||name.split('/').includes('..'))throw Error('Unsafe source entry');
  const file=path.join(source,name);
  if(gitlinks.has(name)){
   const commit=gitlinks.get(name);if(allowedEmptyGitlinks[name]!==commit)throw Error('Unqualified source gitlink identity');
   const stat=fs.lstatSync(file);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Reviewed gitlink must be an existing real directory');
   if(fs.readdirSync(file).length===0){entries[name]={type:'gitlink',commit,initialized:false};continue;}
   const git=(...args)=>execFileSync('git',args,{cwd:file,encoding:'utf8',maxBuffer:20*1024*1024}).trim();
   if(fs.realpathSync(git('rev-parse','--show-toplevel'))!==fs.realpathSync(file)||git('rev-parse','HEAD')!==commit)throw Error('Initialized gitlink differs from reviewed commit');
   const indexFlags=git('ls-files','-v','-z').split('\0').filter(Boolean);
   if(indexFlags.some(entry=>entry[0]==='S'||/[a-z]/.test(entry[0])))throw Error('Reviewed gitlink cannot hide changes with index flags');
   if(git('status','--porcelain','--untracked-files=all'))throw Error('Initialized reviewed gitlink must be clean');
   const nested=sourceManifest(file);
   if(nested.revision!==commit)throw Error('Gitlink revision changed during snapshot');
   entries[name]={type:'gitlink',commit,initialized:true,contentSha256:nested.contentSha256,entries:nested.entries};continue;
  }
  let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'){entries[name]={type:'missing'};continue;}throw error;}
  if(stat.isSymbolicLink())entries[name]={type:'link',sha256:sha(fs.readlinkSync(file))};
  else if(stat.isFile())entries[name]={type:'file',sha256:sha(fs.readFileSync(file)),executable:Boolean(stat.mode&0o111)};
  else if(stat.isDirectory())throw Error('Source contains unexpanded submodule/directory; archive its dependency identity explicitly before launch');
  else throw Error('Unsupported source entry');
 }
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 return {format:1,revision,entries,contentSha256:sha(JSON.stringify(entries))};
}
