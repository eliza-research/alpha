// patches/eliza/photos-library.patch on the patched source (Photos review findings). The Android paths
// themselves are device-checked by the Photos instrumented tests; this pins the rules in the patched code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const ready=fs.existsSync(path.join(root,'vendor/eliza/plugins/plugin-native-media'));
let media;
async function source(name){
 if(!media){const {preparePatchedNative}=await import('../scripts/prepare-patched-native.mjs');media=path.join(preparePatchedNative({root}).root,'plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');}
 return fs.readFileSync(path.join(media,name+'.java'),'utf8');
}
const method=(text,signature)=>{const a=text.indexOf(signature);assert.ok(a>=0,signature);return text.slice(a,text.indexOf('\n  }\n',a));};
test('FixNoCap: a permitted favorite/trash/restore is one reviewed request of up to 500; permanent removal stays at 20',{skip:!ready&&'vendor/eliza not checked out'},async()=>{
 const access=await source('PhotoLibraryAccess'),plugin=await source('PhotosPlugin'),review=await source('PermittedMediaReview');
 assert.match(access,/public static final int REVIEWED = 20;/);assert.match(access,/public static final int REVIEWED_BATCH = 500;/);
 assert.match(method(plugin,'public void changeMany('),/reviewed\(items, PhotoLibraryAccess\.REVIEWED_BATCH\)/);
 assert.match(method(plugin,'public void deletePermittedTrash('),/PhotoLibraryAccess\.REVIEWED\)/);
 const request=method(review,'private void request(PluginCall call, List<String> ids');
 assert.match(request,/int max = batch && !permanent \? PhotoLibraryAccess\.REVIEWED_BATCH : PhotoLibraryAccess\.REVIEWED;/);
 assert.match(request,/ids\.size\(\) > max/);
 const js=fs.readFileSync(path.join(root,'apps/app/src/prototype/camera-adapter.ts'),'utf8');
 assert.match(js,/const PERMITTED_BATCH=500;/,'The adapter sends permitted items at the native bound');
});
