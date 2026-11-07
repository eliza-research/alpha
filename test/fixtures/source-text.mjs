/** Source-text helpers for the remaining wiring pins: locate a slice or fail, and compare normalized text. */
/** The text between the first `start` and the next `end` after it; throws when either marker is missing. */
export function located(text,start,end) {
 const from=text.indexOf(start);
 if(from<0)throw new Error(`start marker not found: ${start}`);
 const to=text.indexOf(end,from+start.length);
 if(to<0)throw new Error(`end marker not found after ${start}: ${end}`);
 return text.slice(from,to);
}
/** Comments removed, whitespace runs collapsed to one space and dropped around punctuation, so
 *  `if (a) {` and `if(a){` compare equal while `static final` keeps its separating space. Comment
 *  stripping is lexical: a `/*` or a `//` not after `:` inside a string literal is treated as a comment. */
export function normalizedSource(text) {
 return text
  .replace(/\/\*[\s\S]*?\*\//g,' ')
  .replace(/(^|[^:])\/\/.*$/gm,'$1')
  .replace(/\s+/g,' ')
  .replace(/ ?([^\w\s$]) ?/g,'$1')
  .trim();
}
