import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// Extract the actual standalone resolver without importing MapLibre or the SDK.
const mapPlaneUrl=new URL('../apps/app/src/maps/map-plane.ts',import.meta.url);
const mapPlaneSource=readFileSync(mapPlaneUrl,'utf8');
const resolverStart=mapPlaneSource.indexOf('export function resolveMapColors(');
const resolverEnd=mapPlaneSource.indexOf('\n/** Product palette',resolverStart);
assert.equal(mapPlaneSource.split('export function resolveMapColors(').length,2);
assert.ok(resolverStart>=0&&resolverEnd>resolverStart,'standalone resolver boundaries must exist');
const resolverJavaScript=stripTypeScriptTypes(mapPlaneSource.slice(resolverStart,resolverEnd),{mode:'strip',sourceUrl:mapPlaneUrl.href});
const {resolveMapColors}=await import(`data:text/javascript;base64,${Buffer.from(resolverJavaScript).toString('base64')}`);

// Controlled CSSOM port only: no MapLibre/SDK import, browser, GPU, provider or location request.
const serializations={
 '#efefec':'rgb(239, 239, 236)', '#1e1e22':'rgb(30, 30, 34)',
 '#aabbcc':'rgb(170, 187, 204)', '#112233':'rgb(17, 34, 51)',
 'transparent':'rgba(0, 0, 0, 0)',
 'color(display-p3 1 0 0)':'color(display-p3 1 0 0)',
};
function host(tokens,options={}){
 const children=[];let raw='',lastProbe;
 const container={isConnected:options.connected!==false,children,
  appendChild(node){children.push(node);node.parentNode=container;},
  ownerDocument:{createElement(){
   const style={get color(){return raw;},set color(value){raw=Object.hasOwn(serializations,value)?value:'';},setProperty(name,value,priority){assert.equal(name,'color');assert.equal(priority,'important');this.color=value;}};
   return lastProbe={style,hidden:false,setAttribute(){},remove(){children.splice(children.indexOf(this),1);}};
  }},
 };
 container.ownerDocument.defaultView={getComputedStyle(node){
  if(node===container)return {getPropertyValue:name=>tokens[name]||''};
  assert.equal(node,lastProbe);assert.ok(children.includes(node),'probe must use connected host');
  return {color:options.computed??serializations[raw]};
 }};
 return container;
}
test('light and dark constructions resolve the supplied host token palette without caching',()=>{
 const tokens={'--land':'#efefec','--water':'#aabbcc'};
 const container=host(tokens),palette={land:'var(--land)',water:'var(--water)'};
 assert.deepEqual(resolveMapColors(container,palette),{land:'rgb(239, 239, 236)',water:'rgb(170, 187, 204)'});
 tokens['--land']='#1e1e22';tokens['--water']='#112233';
 assert.deepEqual(resolveMapColors(container,palette),{land:'rgb(30, 30, 34)',water:'rgb(17, 34, 51)'});
 assert.deepEqual(palette,{land:'var(--land)',water:'var(--water)'});
 assert.deepEqual(container.children,[]);
});
test('model light and dark token names resolve independently on the connected host',()=>{
 const container=host({'--alpha-map-light-land':'#efefec','--alpha-map-dark-land':'#1e1e22'});
 assert.equal(resolveMapColors(container,{land:'var(--alpha-map-light-land)'}).land,'rgb(239, 239, 236)');
 assert.equal(resolveMapColors(container,{land:'var(--alpha-map-dark-land)'}).land,'rgb(30, 30, 34)');
});
test('nested token values, literal colors and transparent serialize to MapLibre-compatible color strings',()=>{
 const container=host({'--land':'var(--base)','--base':'#efefec'});
 assert.deepEqual(resolveMapColors(container,{land:'var(--land)',water:'transparent',label:'#112233'}),{land:'rgb(239, 239, 236)',water:'rgba(0, 0, 0, 0)',label:'rgb(17, 34, 51)'});
});
for(const [name,tokens,color] of [
 ['missing',{},'var(--missing)'],['cycle',{'--a':'var(--b)','--b':'var(--a)'},'var(--a)'],
 ['unresolved expression',{'--a':'#efefec'},'var(--a, red)'],['invalid literal',{},'not-a-color'],
 ['unsupported computed color space',{},'color(display-p3 1 0 0)'],
])test(name+' refuses construction and removes the probe',()=>{
 const container=host(tokens);assert.throws(()=>resolveMapColors(container,{land:color}),/Map theme colors are unavailable/);assert.deepEqual(container.children,[]);
});
test('a detached map host cannot borrow document-root or another map theme values',()=>{
 const container=host({'--land':'#efefec'},{connected:false});
 assert.throws(()=>resolveMapColors(container,{land:'var(--land)'}),/unavailable/);assert.deepEqual(container.children,[]);
});
for(const computed of ['rgb(999, 0, 0)','rgba(1, 2, 3, 2)','rgb(, , )','var(--land)'])test('invalid serialized color is rejected: '+computed,()=>{
 const container=host({},{computed});assert.throws(()=>resolveMapColors(container,{land:'#efefec'}),/unavailable/);assert.deepEqual(container.children,[]);
});
test('the Alpha constructor resolves only regional colors and does not fabricate readiness',()=>{
 const source=readFileSync(new URL('../apps/app/src/maps/map-plane.ts',import.meta.url),'utf8');
 assert.match(source,/region\.kind==='global'\?colors:resolveMapColors\(container,colors\)/);
 assert.doesNotMatch(source,/mapReady\s*=|data-map-ready/);
});
