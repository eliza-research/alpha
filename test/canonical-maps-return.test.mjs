import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalMapsEventOriginFor,mapsEventOriginOf,mapsEventReturnOffered,mapsEventStillThere} from '../apps/app/src/runtime/maps-event-return.ts';
test('canonical event origins keep exact scope and revision; legacy native matching remains separate',()=>{
 const row={id:'canonical-row',canonicalEventKey:'event-key',title:'Exact title',off:0,canonicalEvent:{id:'event',startAt:'2026-10-31T12:00:00Z'}};
 const origin=canonicalMapsEventOriginFor(row,0,'owner-session',{revision:'revision-one',sourceRevision:'a'.repeat(64)});
 assert.equal(origin.version,2);assert.equal(origin.revision,'revision-one');assert.equal(origin.binding,'owner-session');
 assert.deepEqual(mapsEventOriginOf(origin),origin);assert.deepEqual(mapsEventReturnOffered(origin,['calendar'],false),origin);
 assert.equal(mapsEventReturnOffered(origin,['notes'],false),undefined);
 assert.equal(mapsEventStillThere(origin,[{id:'event',begin:origin.begin}]),false);
 assert.equal(canonicalMapsEventOriginFor(row,0,'owner-session',undefined),undefined);
 assert.equal(mapsEventOriginOf({...origin,sourceRevision:'invalid'}),undefined);
});
