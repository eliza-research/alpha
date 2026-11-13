// Owner-bound renderer routes from the Alpha product table. The real Android request gate is compiled from
// AlphaLocalAgentPlugin.java with OwnerRoutes.java and run on the host JVM over a broad case table next to the
// renderer interpreter (owner-route-policy.ts): both must claim and admit the same requests, and exactly what the
// hand-mirrored gates admitted before the table. Host-JVM and Node evidence only, not Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root} from './fixtures/jvm-tools.mjs';
import {build} from 'esbuild';
import {serializeOwnerRouteTable} from '../apps/app/src/product/owner-route-table.ts';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{ownerRouteGroup,ownerRouteAllowed}]=await loadBrowserModule(['apps/app/src/runtime/owner-route-policy.ts'],{testMocks:true});

// Tables that cannot load: missing, empty, malformed, an invalid pattern, an {id} route in a group without an id pattern.
const shippedTable=serializeOwnerRouteTable(),edited=edit=>{const table=JSON.parse(shippedTable);edit(table);return JSON.stringify(table);};
const brokenTables=[
 ['empty',''],['malformed','{"unsafe":'],['missing groups','{"unsafe":"#"}'],
 ['invalid unsafe pattern',edited(table=>{table.unsafe='[';})],['invalid id pattern',edited(table=>{table.groups.automations.id='(';})],
 ['{id} route without an id pattern',edited(table=>{delete table.groups.automations.id;})],
];
test('the renderer interpreter fails to load every owner route table the Android gate cannot load',async()=>{
 const load=table=>build({entryPoints:[join(root,'apps/app/src/runtime/owner-route-policy.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
  plugins:[{name:'owner-routes',setup(builder){builder.onLoad({filter:/owner-route-table\.ts$/},()=>({contents:'export const OWNER_ROUTE_TABLE = '+table,loader:'ts'}));}}]})
  .then(({outputFiles})=>import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64')));
 assert.equal(typeof (await load(shippedTable)).ownerRouteAllowed,'function');
 for(const [name,table] of brokenTables)await assert.rejects(load(table),undefined,name);
});

test('the renderer refuses unknown owner route group names',()=>{
 assert.throws(()=>ownerRouteGroup('/api/triggers','automations','nope'),/Unknown owner route group nope/);
 assert.throws(()=>ownerRouteAllowed('nope','/api/triggers','POST'),/Unknown owner route group nope/);
});
