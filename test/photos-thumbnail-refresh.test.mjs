import test from 'node:test';
import assert from 'node:assert/strict';
import {readWindow} from '../.eliza/client-features/packages/ui/src/mobile-shell/photos-view.ts';
const photo=(n,image='')=>({id:'native-camera-'+n,date:n,image,revision:'r1'});
test('library refresh keeps rows beyond the previous 240-row reload cap',async()=>{
 const rows=Array.from({length:650},(_,i)=>photo(i)),calls=[];
 const result=await readWindow(async({before})=>{const start=Number(before||0);calls.push(start);return {items:rows.slice(start,start+24),next:start+24<rows.length?String(start+24):''};},{more:false,cursor:'600',loaded:601,limit:10000});
 assert.ok(result.rows.some(row=>row.id==='native-camera-600'));
 assert.equal(calls[0],0);assert.equal(result.rows.length,624);assert.equal(result.next,'624');
});
test('repeated native page cursor fails instead of hanging a library reload',async()=>{
 let calls=0;await assert.rejects(readWindow(async()=>{calls++;return {items:[],next:'same'};},{more:false,cursor:'',loaded:500,limit:10000}),/repeated a cursor/);assert.equal(calls,2);
});
