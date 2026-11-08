import {execFileSync} from 'node:child_process';
const ADB=[process.env.HOME+'/Android/Sdk/platform-tools/adb','-s','emulator-5600'];
const adb=(...a)=>execFileSync(ADB[0],[...ADB.slice(1),...a],{encoding:'utf8'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,id=0;const waiting=new Map();
async function connect(){for(let i=0;i<20;i++){try{const pid=adb('shell','pidof','ai.elizaresearch.alphaphone').trim();adb('forward','tcp:9333','localabstract:webview_devtools_remote_'+pid);const list=await (await fetch('http://localhost:9333/json')).json();ws=new WebSocket(list[0].webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const m=JSON.parse(e.data);waiting.get(m.id)?.(m);};return;}catch{await sleep(1000);}}throw Error('no devtools');}
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const ev=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true})).result?.result?.value;
const at=async sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [Math.round((r.left+r.width/2)*devicePixelRatio),Math.round((r.top+r.height/2)*devicePixelRatio)];})()`);
const tap=async sel=>{const p=await at(sel);if(!p)throw Error('missing '+sel);adb('shell','input','tap',...p.map(String));await sleep(900);};
const state=()=>ev(`({view:document.documentElement.dataset.activeView,pill:!!document.querySelector('[data-alpha-layer="pill"]'),bar:!!document.querySelector('[data-alpha-layer="composer"]'),guard:getComputedStyle(document.querySelector('[data-alpha-dock-guard]')).pointerEvents,focused:!!document.activeElement?.matches?.('[data-alpha-composer]'),chatOpen:document.querySelector('[data-alpha-layer="conversation"]')?.getAttribute('aria-hidden')==='false',ime:innerHeight,grid:Math.round(document.querySelector('[data-alpha-home-apps]')?.getBoundingClientRect().top??-1)})`);
const out={};
const home=async()=>{adb('shell','input','keyevent','KEYCODE_HOME');await sleep(1500);};
await connect();

// 1. Cold start: record the grid's top from the first frame for 4 s.
adb('shell','am','force-stop','ai.elizaresearch.alphaphone');await sleep(500);
adb('shell','input','keyevent','KEYCODE_HOME');await sleep(250);
await connect();
await send('Page.enable');
const tops=[];const t0=Date.now();
while(Date.now()-t0<4000){const g=await ev(`Math.round(document.querySelector('[data-alpha-home-apps]')?.getBoundingClientRect().top??-1)`);if(g!==tops.at(-1))tops.push(g);await sleep(50);}
// a chooser dialog can open on cold start in this build; close it
await ev(`document.querySelector('.alpha-connection-scrim button[aria-label^="Close"]')?.click()`);await sleep(800);
out.coldStartGridTops=tops;

// 2. Keyboard on Home: first tap on an app only closes it.
await home();
const g0=(await state()).grid;
await tap('[data-alpha-layer="composer"] textarea[data-alpha-composer]');await sleep(1200);
out.homeFocused=await state();
const upper=await ev(`(()=>{const r=document.querySelector('[data-screen]').getBoundingClientRect();return [Math.round((r.left+r.width/2)*devicePixelRatio),Math.round((r.top+r.height*0.3)*devicePixelRatio)];})()`);
adb('shell','input','tap',...upper.map(String));await sleep(1200);
out.homeAfterFirstTap=await state();
await tap('[aria-label="Calendar"]');
out.homeAfterSecondTap=await state();
await home();
out.gridAfterKeyboard=(await state()).grid; out.gridBeforeKeyboard=g0;

// 3. Keyboard closed by Android Back: composer lets go, next tap works.
await tap('[data-alpha-layer="composer"] textarea[data-alpha-composer]');await sleep(1200);
adb('shell','input','keyevent','KEYCODE_BACK');await sleep(1500);
out.afterImeBack=await state();
await tap('[aria-label="Calendar"]');
out.afterImeBackTap=await state();
await home();

// 4. Raised bar from the pill in Notes.
await tap('[aria-label="Notes"]');await sleep(800);
out.notes=await state();
await tap('[data-alpha-layer="pill"] [aria-label="Type"]');await sleep(1200);
out.notesRaised=await state();
const s=await ev(`(()=>{const r=document.querySelector('[data-screen]').getBoundingClientRect();return [Math.round((r.left+r.width/2)*devicePixelRatio),Math.round((r.top+r.height*0.3)*devicePixelRatio)];})()`);
adb('shell','input','tap',...s.map(String));await sleep(1000);
out.notesAfterOutsideTap=await state();
await tap('[data-alpha-layer="pill"] [aria-label="Type"]');await sleep(1200);
adb('shell','input','keyevent','KEYCODE_BACK');await sleep(1000);
out.notesBack1=await state();
adb('shell','input','keyevent','KEYCODE_BACK');await sleep(1000);
out.notesBack2=await state();
await home();

// 5. Swipes on Home.
const mid=await ev(`(()=>{const r=document.querySelector('[data-screen]').getBoundingClientRect();return [Math.round((r.left+r.width/2)*devicePixelRatio),Math.round((r.top+r.height*0.45)*devicePixelRatio)];})()`);
adb('shell','input','swipe',String(mid[0]),String(mid[1]),String(mid[0]),String(mid[1]-700),'250');await sleep(1200);
out.swipeOnContent=await state();
const bar=await at('[data-alpha-input-bar]');
adb('shell','input','swipe',String(bar[0]),String(bar[1]),String(bar[0]),String(bar[1]-900),'300');await sleep(1500);
out.swipeOnBar=await state();
console.log(JSON.stringify(out,null,1));
process.exit(0);
