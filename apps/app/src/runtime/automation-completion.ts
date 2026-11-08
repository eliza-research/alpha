import {normalizeEffectReceipts} from '../../../../.eliza/client-features/packages/core/src/types/effects.ts';
export const AUTOMATIONS_COMMITTED_EVENT='alpha:automations-committed';
/** Saved canonical LifeOps records invalidate the unified list; generic tool success is not proof. */
export function automationsCommitted(results:readonly unknown[]|undefined):boolean {
 if(!Array.isArray(results))return false;
 return results.some(result=>{
  if(!result||typeof result!=='object'||!('success' in result)||result.success!==true||!('effectReceipts' in result))return false;
  try{return normalizeEffectReceipts(result.effectReceipts).some(receipt=>receipt.outcome==='applied'&&receipt.commit.kind==='durable'&&['lifeops.definition','lifeops.occurrence'].includes(receipt.resource.kind));}catch{return false;}
 });
}
