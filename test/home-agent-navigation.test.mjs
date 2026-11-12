import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from './support/ts-import.mjs';
// Targets resolve through Alpha's product view registry (canonical ids, served ids, availability).
const {alphaViewPaths}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);

test('alpha view paths keep older aliases and give unknown ids none',()=>{
 assert.deepEqual(alphaViewPaths('automations'),['/automations','/apps/automations']);
 for(const path of ['/automations','/apps/automations','/workflows','/apps/workflows'])assert.ok(alphaViewPaths('workflows').includes(path),path);
 for(const path of ['/chat','/','/home','/apps/home'])assert.ok(alphaViewPaths('home').includes(path),path);
 assert.equal(alphaViewPaths('chat').includes('/home'),false);
 assert.deepEqual(alphaViewPaths('unknown-view'),[]);
});
