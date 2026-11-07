// Ordering check for event logs and source text: both steps must be present, and the first must come first.
// A bare indexOf(a)<indexOf(b) passes when a never happens, because -1 is less than any index.
import assert from 'node:assert/strict';

/** Asserts that a occurs in list (an array or a string) and that it comes before b, which must also occur. */
export function assertBefore(list,a,b,message){
 const first=list.indexOf(a),second=list.indexOf(b),label=message?`${message}: `:'';
 assert.ok(first>=0,`${label}${JSON.stringify(a)} is missing`);
 assert.ok(second>=0,`${label}${JSON.stringify(b)} is missing`);
 assert.ok(first<second,`${label}${JSON.stringify(a)} comes before ${JSON.stringify(b)}`);
}
