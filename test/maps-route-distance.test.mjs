import assert from 'node:assert/strict';
import test from 'node:test';
// Alpha's re-export of the prepared plugin-maps module (npm run upstream:prepare-client).
import {distanceToRoute as d} from '../apps/app/src/maps/route-distance.ts';

test('route distances cover segment interiors, endpoints, repeated points and the date line', () => {
 const p=(latitude,longitude)=>({latitude,longitude});
 const actual=[d(p(0,1),[p(0,0),p(0,2)]), d(p(1,1),[p(0,0),p(0,2)]),
  d(p(0,3),[p(0,0),p(0,2)]), d(p(0,-1),[p(0,0),p(0,2)]),
  d(p(0,1),[p(0,0),p(0,0),p(0,2)]), d(p(0,180),[p(0,179),p(0,-179)]),
  d(p(0,0),[p(0,0)]), d(p(0,0),[])];
 assert.ok(actual[0]<.001, String(actual[0]));
 for(const i of [1,2,3]) assert.ok(Math.abs(actual[i]-111194.9266)<.005, `${i}: ${actual[i]}`);
 for(const i of [4,5,6]) assert.ok(actual[i]<.001, `${i}: ${actual[i]}`);
 assert.equal(actual[7], Infinity);
});
