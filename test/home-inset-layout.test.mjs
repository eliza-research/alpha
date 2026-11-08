import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';import vm from 'node:vm';
import {canvasGeometry,keyboardFreeHeight} from '../apps/app/src/runtime/canvas-geometry.ts';
const source=readFileSync('apps/app/src/main.tsx','utf8');
const slice=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x,a);return source.slice(x,y);};
const cache=stripTypeScriptTypes(slice("const INSETS_KEY=",'let shell: any;'),{mode:'transform'});
function style(){const values=new Map();return {values,setProperty:(k,v)=>values.set(k,v),getPropertyValue:k=>values.get(k)||'',removeProperty:k=>values.delete(k)};}
function cached(raw,native=true){const css=style(),saved=[];const context={isAndroid:native,Number,JSON,document:{documentElement:{style:css}},localStorage:{getItem:()=>raw,setItem:(k,v)=>saved.push(JSON.parse(v))}};vm.runInNewContext(cache+';globalThis.remember=rememberInsets;',context);return {css,saved,remember:context.remember};}
test('native insets are restored before Phone mounts and validated before persistence',()=>{
 const f=cached('{"top":24,"bottom":32}');assert.equal(f.css.values.get('--native-top-inset'),'24px');assert.equal(f.css.values.get('--native-bottom-inset'),'32px');f.remember(28,40);assert.deepEqual(f.saved,[{top:28,bottom:40}]);for(const bad of [-1,NaN,Infinity,513,'24',null])f.remember(bad,30);assert.equal(f.saved.length,1);assert.ok(source.indexOf('if(isAndroid)try{')<source.indexOf('function Phone()'));
});
test('web, malformed and out-of-range caches cannot move the native canvas',()=>{
 for(const raw of ['bad','null','{"top":-1,"bottom":30}','{"top":25,"bottom":999}','{"top":"25","bottom":30}'])assert.equal(cached(raw).css.values.size,0);
 assert.equal(cached('{"top":24,"bottom":32}',false).css.values.size,0);
});
const geometryCode=stripTypeScriptTypes(slice('      const keyboardFree=','      document.documentElement.style.setProperty(\'--phone-scale\''),{mode:'transform'});
test('Home keeps its grid height while the keyboard opens and follows rotation while editing',()=>{
 const free=keyboardFreeHeight(),css=style();css.setProperty('--native-bottom-inset','30px');
 const run=(width,layoutHeight,editing)=>{const input={width,layoutHeight,available:layoutHeight,desktop:false,fluid:true,launcher:false,screenShort:Math.min(width,layoutHeight),editing};const box={input,width,layoutHeight,desktop:false,banner:0,toolsInset:0,freeHeight:free,canvasGeometry,Math,document:{documentElement:{style:css}}};vm.runInNewContext(geometryCode+';globalThis.result={geometry,homeGeometry}',box);return box.result;};
 const start=run(412,915,false),typed=run(412,380,true);assert.equal(start.homeGeometry.height,915);assert.equal(typed.geometry.height,380);assert.equal(typed.homeGeometry.height,915);assert.equal(css.values.get('--alpha-home-bottom-inset'),'30px');
 const landscape=run(915,300,true);assert.equal(landscape.homeGeometry.landscape,true);assert.equal(landscape.homeGeometry.height,412);const back=run(412,380,true);assert.equal(back.homeGeometry.landscape,false);assert.equal(back.homeGeometry.height,915);
});
test('Home reserve depends on native bar insets, not animated dock height',()=>{
 const css=readFileSync('apps/app/src/prototype/phone.css','utf8'),rule=css.split('\n').find(line=>line.includes('[data-alpha-home-layout] {')&&line.includes('padding-bottom'));assert.match(rule,/--alpha-home-clearance/);assert.match(rule,/--alpha-home-height/);assert.doesNotMatch(rule,/--alpha-dock-reserve|--alpha-dock-clearance/);assert.match(css,/\[data-alpha-home-clearance\] \{ height:max\(0px,calc\(var\(--alpha-dock-clearance/);
});
