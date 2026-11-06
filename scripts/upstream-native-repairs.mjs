import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
/**
 * Upstream native fixes, committed on elizaOS/eliza fix branches but not yet reviewed, merged or
 * pinned. Each one is bound to the exact pinned bytes and must produce the exact bytes of its
 * upstream commit; anything else refuses the build. Remove an entry once the pin includes its commit.
 */
// The resident stop-race repair (a757a9bf57) was dropped at pin 36236fc059: upstream fa7b8ea7bb and
// its successors skip a same-UID process that vanishes or reads an empty argv during the stop inventory.
export const UPSTREAM_REPAIRS=Object.freeze([]);
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
