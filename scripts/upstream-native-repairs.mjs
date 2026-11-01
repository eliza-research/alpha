import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
/**
 * Upstream native fixes, committed on elizaOS/eliza fix branches but not yet reviewed, merged or
 * pinned. Each one is bound to the exact pinned bytes and must produce the exact bytes of its
 * upstream commit; anything else refuses the build. Remove an entry once the pin includes its commit.
 */
export const UPSTREAM_REPAIRS=Object.freeze([{
 // elizaOS/eliza fix/resident-stop-vanished-process (d4964fada0) and fix/resident-stop-exiting-argv
 // on top of it: a same-UID process that exits during the stop inventory (no /proc/<pid>/exe, or an
 // empty argv while unreaped) made every stop "identity unproven", so binding Cloud inference left
 // the agent stopped. Pixel 10a evidence: docs/evidence/subscription-device-pixel10a-2026-10-26.md.
 commit:'a757a9bf57eb4382edd98a9cdbee139b779c0d28',
 path:'packages/app/platforms/android/app/src/main/java/ai/elizaos/app/WorkflowSurvivorInventory.java',
 sourceSha256:'72568e8f859c0453606100d0f94d26c4cec4c3b7811ad62b0eaea8ea76a66820',
 repairedSha256:'4ae1f61e7ba4cf37d0dad302c905d6f809b2ea3aa5d42e76061c072414194d4f',
 edits:[{
 before:'   if(stat.st_uid!=Process.myUid())continue;int pid=Integer.parseInt(entry.getName());result.put(pid,processIdentity(pid,deadline));check(result.size()<=32,"too many same-UID processes");}\n',
 after:'   if(stat.st_uid!=Process.myUid())continue;int pid=Integer.parseInt(entry.getName());\n'
  +'   // A process that exits between listing and identity (e.g. the resident during its own stop)\n'
  +'   // is skipped only after fresh absence or terminal-state proof; a live unreadable one still refuses.\n'
  +'   Identity identity=observePresent(pid,()->processIdentity(pid,deadline));if(identity==null)continue;\n'
  +'   result.put(pid,identity);check(result.size()<=32,"too many same-UID processes");}\n',
 },{
 before:' /** Only the exact resident command is signalable; shared-runtime siblings are preserved. */\n',
 after:' /** An exited but unreaped same-UID process (a zombie) reads an empty argv: an observation failure, so it is\n'
  +'  * skipped only after fresh absence or terminal-state proof; a live process with no argv still refuses. */\n'
  +' static byte[] presentArguments(byte[] bytes)throws IOException {if(bytes.length==0)throw new FileNotFoundException("resident argv unavailable");return bytes;}\n'
  +' /** Only the exact resident command is signalable; shared-runtime siblings are preserved. */\n',
 },{
 before:'   byte[] args=observePresent(pid,()->bounded(new File(entry,"cmdline"),65536));if(args==null)continue;\n',
 after:'   byte[] args=observePresent(pid,()->presentArguments(bounded(new File(entry,"cmdline"),65536)));if(args==null)continue;\n',
 }],
}]);
export function applyUpstreamRepair(relative,input,repairs=UPSTREAM_REPAIRS){
 const repair=repairs.find(entry=>entry.path===relative);
 if(!repair)return {value:input,repair:null};
 if(digest(input)!==repair.sourceSha256)throw Error(`Upstream repair ${repair.commit.slice(0,10)} no longer matches ${relative}; drop it if the pin includes it`);
 let value=input;
 for(const edit of repair.edits){
  if(value.split(edit.before).length!==2)throw Error(`Upstream repair ${repair.commit.slice(0,10)} anchor changed in ${relative}`);
  value=value.replace(edit.before,()=>edit.after);
 }
 if(digest(value)!==repair.repairedSha256)throw Error(`Upstream repair ${repair.commit.slice(0,10)} did not reproduce the upstream file`);
 return {value,repair:{commit:repair.commit,path:relative,sourceSha256:repair.sourceSha256,repairedSha256:repair.repairedSha256}};
}
