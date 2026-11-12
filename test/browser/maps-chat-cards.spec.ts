import {test,expect,type Page} from '@playwright/test';
import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
const place={name:'Ferry Building',latitude:37.7955,longitude:-122.3937,provider:'eliza-cloud',providerPlaceId:'osm:n1',formattedAddress:'1 Ferry Building, San Francisco',categories:[]};
const attribution='© OpenStreetMap contributors';
// The exact wire shapes plugin-maps emits (`card.ts` and core `interaction-serialize.ts`).
const card=(text:string,body:unknown)=>`${text}\n\n[MAPSCARD]\n${JSON.stringify(body)}\n[/MAPSCARD]`;
const route=card('Here is the walking route.',{kind:'route',origin:{...place,name:'Home',providerPlaceId:'osm:n0'},destination:place,travelMode:'walk',distanceMeters:1530,durationSeconds:1260,warnings:[],attribution});
const share='Share the location of Ferry Building?\n\n[CHOICE:maps-share id=maps-share-m1]\nYes, share the location of Ferry Building (confirmed).=Share location\nNo, do not share my location.=Don\'t share\n[/CHOICE]';
async function setup(page:Page,theme:string){
 await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));(window as any).mapsChat={sent:[]};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('No microphone');};});
 await page.goto('/?mode=dev&theme='+theme);
 await openConnectionDiagnostics(page);
 await page.getByRole('button',{name:'Connect development profile',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Development connections',exact:true})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(async()=>!!(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session)).toBe(true);
 await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {Component}=await import('/src/prototype/model.js');const render=Component.prototype.renderVals;Component.prototype.renderVals=function(){(window as any).mapsChat.shell=this;return render.call(this);};});
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!(window as any).mapsChat.shell)).toBe(true);
 await page.evaluate(([route,share])=>new Promise<void>(resolve=>{const f=(window as any).mapsChat;f.shell.send=async(text:string)=>{f.sent.push(text);};f.shell.setState({chat:'full',msgs:[{id:'u1',from:'user',text:'Walk me to the Ferry Building'},{id:'a1',from:'agent',text:route},{id:'u2',from:'user',text:'Share it'},{id:'a2',from:'agent',text:share}]},resolve);}),[route,share]);
}
for(const theme of ['light','dark'])test(`agent Maps cards render without raw markup: ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:412,height:915});await setup(page,theme);
 const transcript=page.locator('[data-alpha-transcript]');
 await expect(transcript).not.toContainText('[MAPSCARD]');await expect(transcript).not.toContainText('[CHOICE');await expect(transcript).not.toContainText('"kind"');
 const routeCard=page.locator('.maps-chat-card[data-maps-card-kind="route"]');
 await expect(routeCard).toContainText('Route to Ferry Building');await expect(routeCard).toContainText('Walking · 1.0 mi · 21 min');await expect(routeCard.locator('small')).toHaveText(attribution);
 await expect(transcript).toContainText('Share the location of Ferry Building?');
 const choice=page.getByRole('group',{name:'Share location'});await expect(choice.getByRole('button')).toHaveText(['Share location',"Don't share"]);
 for(const button of await choice.getByRole('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('maps-chat-'+theme+'.png'),animations:'disabled'});
 await choice.getByRole('button',{name:"Don't share"}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).mapsChat.sent)).toEqual(['No, do not share my location.']);
 await expect(page.getByRole('group',{name:'Share location'})).toHaveCount(0);
});
