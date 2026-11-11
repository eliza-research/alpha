/** When a reviewed-copy receipt may be removed. Pure rules, proved in specs/lemma (LemmaScript). */
/** An editor session lasts 15 minutes; a receipt still 'prepared' a day later belongs to an
 * editor that was closed without saving or cancelling. */
export const PREPARED_RECEIPT_TTL=24*60*60*1000;
/** The part of a receipt the removal rules read. */
export type EditReceiptState={status:string;at?:number};
/** Whether a receipt can be removed without losing an outcome. Only a receipt that no save
 * ever claimed qualifies by age: reading it reports 'not-started', exactly as its absence does.
 * A claimed receipt is the only record of its outcome and stays until that outcome is acknowledged. */
export function editReceiptAbandoned(record:EditReceiptState,now:number){
 //@ verify
 //@ ensures \result ==> record.status === 'prepared'
 //@ ensures record.at !== undefined ==> (\result <==> (record.status === 'prepared' && now - record.at > 86400000))
 //@ ensures record.at === undefined ==> (\result <==> (record.status === 'prepared' && now - 0 > 86400000))
 //@ ensures (record.status === 'saving' || record.status === 'saved' || record.status === 'failed') ==> !\result
 //@ ensures \result ==> !editReceiptSettled(record)
 return record.status==='prepared'&&now-(record.at??0)>PREPARED_RECEIPT_TTL;
}
/** Whether an acknowledged receipt can be removed. A receipt still 'prepared' or 'saving' may yet
 * commit a copy, so it is kept. */
export function editReceiptSettled(record:EditReceiptState){
 //@ verify
 //@ ensures \result <==> (record.status === 'saved' || record.status === 'failed' || record.status === 'cancelled' || record.status === 'unchanged')
 //@ ensures (record.status === 'prepared' || record.status === 'saving') ==> !\result
 return ['saved','failed','cancelled','unchanged'].includes(record.status);
}
