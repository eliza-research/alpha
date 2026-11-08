import assert from 'node:assert/strict';

/** Asserts that a and b both occur in list (a string or array) and that a comes first; indexOf alone passes when a is missing. */
export function assertBefore(list,a,b,message){
 const first=list.indexOf(a),second=list.indexOf(b),label=message?message+': ':'';
 assert.ok(first>=0,`${label}missing ${JSON.stringify(a)}`);
 assert.ok(second>=0,`${label}missing ${JSON.stringify(b)}`);
 assert.ok(first<second,`${label}${JSON.stringify(a)} must come before ${JSON.stringify(b)}`);
}
