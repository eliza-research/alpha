import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// The rendered icon checks stay in test/browser/canonical-icons.spec.ts.
const root=new URL('../apps/app/public/icons/lucide/',import.meta.url);
const sha=data=>createHash('sha256').update(data).digest('hex');
test('published assets retain their recorded provenance',()=>{
 const source=JSON.parse(readFileSync(new URL('source.json',root),'utf8'));
 assert.equal(source.package,'lucide-react');assert.equal(source.version,'1.18.0');assert.equal(source.license,'ISC and upstream Feather MIT where listed');
 for(const [name,entry] of Object.entries(source.assets)){assert.equal(sha(readFileSync(new URL(name,root))),entry.sha256,name);assert.match(source.sourceFiles[entry.source],/^[a-f0-9]{64}$/);}
 assert.equal(sha(readFileSync(new URL('LICENSE.txt',root))),source.licenseSha256);
 const catalog=JSON.parse(readFileSync(new URL('../apps/app/src/icon-catalog.json',import.meta.url),'utf8'));
 const model=readFileSync(new URL('../apps/app/src/prototype/model.js',import.meta.url),'utf8');
 // The IC literal alone: from its declaration to its closing brace (model.js is an ES module).
 const icStart=model.indexOf('var IC = {'),icEnd=model.indexOf('\n};',icStart);assert.ok(icStart>=0);assert.ok(icEnd>icStart);
 const initial=model.slice(icStart,icEnd+3);
 const extensions=[...model.matchAll(/IC\.([A-Za-z0-9_]+)\s*=\s*IC\.\1\s*\|\|\s*"([^"\n]+)";/g)].map(match=>match[0]).join('\n');
 const box={};vm.runInNewContext(initial+'\n'+extensions+'\nglobalThis.icons=IC;',box);
 assert.deepEqual(Object.keys(catalog.ic).sort(),Object.keys(box.icons).sort());
 const paths=new Map();for(const [key,asset] of Object.entries(catalog.ic)){assert.ok(source.assets[asset+'.svg'],asset);if(paths.has(box.icons[key]))assert.equal(paths.get(box.icons[key]),asset);paths.set(box.icons[key],asset);}
 const expectedAssets=new Set([...Object.values(catalog.ic),...catalog.extra].map(name=>name+'.svg'));for(const name of catalog.filled)expectedAssets.add(name+'-filled.svg');assert.deepEqual(Object.keys(source.assets).sort(),[...expectedAssets].sort());
 for(const [name,entry] of Object.entries(source.assets)){const svg=readFileSync(new URL(name,root),'utf8');for(const part of ['viewBox="0 0 24 24"','stroke-width="2"','stroke-linecap="round"','stroke-linejoin="round"',entry.fill?'fill="currentColor"':'fill="none"'])assert.ok(svg.includes(part),name+' has '+part);}
 const template=readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8');assert.equal(template.match(/<svg[^>]*class="i"[^>]*style="[^"]*stroke-width/g),null);
});
