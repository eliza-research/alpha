import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';

// Exercise the owning registry: a route-only test cannot detect plugin collisions.
const source=stripTypeScriptTypes(readFileSync('vendor/eliza/packages/agent/src/api/view-installations.ts','utf8'),{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
const declarations=JSON.parse(readFileSync('config/native-view-declarations.json','utf8'));
for(const nativeFirst of [true,false])test(`Inbox plugin and native fallback coexist, native first=${nativeFirst}`,()=>{
 const context=vm.createContext({randomUUID,ElizaError:class extends Error{},bindViewAssets(){},getViewAssetRoot(){}});
 vm.runInContext(source+';globalThis.registry={beginViewInstallation,commitViewInstallation,runtimeViewEntries,revokeViewInstallation};',context);
 const registry=context.registry,runtime={};
 const declaration=declarations.find(row=>row.id==='inbox');
 assert.ok(declaration);
 const native={...declaration,viewType:'gui',pluginName:'alpha-native',builtin:true};
 const inbox={id:'inbox',path:'/inbox',viewType:'gui',pluginName:'@elizaos/plugin-inbox',builtin:false};
 const install=entry=>{const handle=registry.beginViewInstallation(runtime,entry.pluginName);registry.commitViewInstallation(runtime,handle,[entry]);return handle;};
 let plugin;
 if(nativeFirst){install(native);plugin=install(inbox);}else{plugin=install(inbox);install(native);}
 assert.equal(registry.runtimeViewEntries(runtime).length,1);
 assert.equal(registry.runtimeViewEntries(runtime)[0].pluginName,'@elizaos/plugin-inbox');
 registry.revokeViewInstallation(runtime,plugin);
 assert.equal(registry.runtimeViewEntries(runtime)[0].pluginName,'alpha-native');
});
