/** UI defaults only. Existing and explicitly authored titles are never changed. */
export function nextDefaultNoteTitle(rows:Iterable<{title?:unknown}>,base:'New note'|'Voice note'):string{
 let highest=0;
 for(const row of rows){
  if(typeof row.title!=='string')continue;
  const title=row.title.trim().toLowerCase(),prefix=base.toLowerCase();
  if(title===prefix){highest=Math.max(highest,1);continue;}
  if(!title.startsWith(prefix))continue;
  const suffix=/^\s+#?(\d+)$/.exec(title.slice(prefix.length)),number=suffix?Number(suffix[1]):0;
  if(Number.isSafeInteger(number)&&number>0)highest=Math.max(highest,number);
 }
 return highest?`${base} ${highest+1}`:base;
}
