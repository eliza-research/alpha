import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {returnToApps} from './app-navigation';
const root=new URL('../../apps/app/public/icons/lucide/',import.meta.url);
test('published assets retain their recorded provenance',()=>{
 const source=JSON.parse(readFileSync(new URL('source.json',root),'utf8'));
 expect(source.package).toBe('lucide-react');expect(source.version).toBe('1.18.0');expect(source.license).toBe('ISC and upstream Feather MIT where listed');
 for(const [name,entry] of Object.entries(source.assets) as [string,{source:string;sha256:string}][]){expect(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex')).toBe(entry.sha256);expect(source.sourceFiles[entry.source]).toMatch(/^[a-f0-9]{64}$/);}
 expect(createHash('sha256').update(readFileSync(new URL('LICENSE.txt',root))).digest('hex')).toBe(source.licenseSha256);
 const catalog=JSON.parse(readFileSync(new URL('../../apps/app/src/icon-catalog.json',import.meta.url),'utf8'));
 const model=readFileSync(new URL('../../apps/app/src/prototype/model.js',import.meta.url),'utf8');
 // The IC literal alone: from its declaration to its closing brace (model.js is an ES module).
 const icStart=model.indexOf('var IC = {'),icEnd=model.indexOf('\n};',icStart);expect(icStart).toBeGreaterThanOrEqual(0);expect(icEnd).toBeGreaterThan(icStart);
 const initial=model.slice(icStart,icEnd+3);
 const extensions=[...model.matchAll(/IC\.([A-Za-z0-9_]+)\s*=\s*IC\.\1\s*\|\|\s*"([^"\n]+)";/g)].map(match=>match[0]).join('\n');
 const box:any={};vm.runInNewContext(initial+'\n'+extensions+'\nglobalThis.icons=IC;',box);
 expect(Object.keys(catalog.ic).sort()).toEqual(Object.keys(box.icons).sort());expect(Object.keys(catalog.ic)).toHaveLength(148);
 const paths=new Map<string,string>();for(const [key,asset] of Object.entries(catalog.ic) as [string,string][]){expect(source.assets[asset+'.svg']).toBeTruthy();if(paths.has(box.icons[key]))expect(paths.get(box.icons[key])).toBe(asset);paths.set(box.icons[key],asset);}
 const expectedAssets=new Set([...Object.values(catalog.ic),...catalog.extra].map(name=>name+'.svg'));for(const name of catalog.filled)expectedAssets.add(name+'-filled.svg');expect(Object.keys(source.assets).sort()).toEqual([...expectedAssets].sort());
 for(const [name,entry] of Object.entries(source.assets) as [string,any][]){const svg=readFileSync(new URL(name,root),'utf8');expect(svg).toContain('viewBox="0 0 24 24"');expect(svg).toContain('stroke-width="2"');expect(svg).toContain('stroke-linecap="round"');expect(svg).toContain('stroke-linejoin="round"');expect(svg).toContain(entry.fill?'fill="currentColor"':'fill="none"');}
 const template=readFileSync(new URL('../../apps/app/src/prototype/template.html',import.meta.url),'utf8');expect(template.match(/<svg[^>]*class="i"[^>]*style="[^"]*stroke-width/g)).toBeNull();

});
for(const theme of ['light','dark'])test(`canonical launcher, dock and Files assets: ${theme}`,async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev&theme='+theme);
 const camera=page.getByRole('button',{name:'Camera',exact:true});
 // Home's app grid is the shared mobile shell's (prototype/home-shell.ts): each tile draws its
 // published asset as a single-color mask. Camera stays an ordinary named button; inspecting it
 // never starts a device capture.
 const tileGlyph=(name:string)=>page.getByRole('region',{name:'Home',exact:true}).getByRole('button',{name,exact:true}).locator('[data-mobile-shell-tile-face] > span[aria-hidden="true"]');
 for(const [name,asset] of [['Camera','camera'],['Workflows','workflow']]){
  await expect(tileGlyph(name)).toHaveCount(1);
  expect(await tileGlyph(name).evaluate(el=>getComputedStyle(el).maskImage)).toMatch(new RegExp('/icons/lucide/'+asset+'\\.svg"?\\)$'));
 }
 // Every shared Home tile names the published glyph it draws (data-mobile-shell-tile-icon); its
 // accessible name stays the label. The count covers every product tile and Apps.
 const record=JSON.parse(readFileSync(new URL('../../config/alpha-product.json',import.meta.url),'utf8'));
 const homeTiles=await page.getByRole('region',{name:'Home',exact:true}).locator('[data-mobile-shell-tile]').evaluateAll(tiles=>tiles.map(tile=>({name:tile.getAttribute('aria-label'),icon:tile.getAttribute('data-mobile-shell-tile-icon'),mask:getComputedStyle(tile.querySelector('[data-mobile-shell-tile-face] > span[aria-hidden="true"]')||tile).maskImage,image:!!tile.querySelector('img')})));
 expect(homeTiles.length,'shared Home tiles').toBeGreaterThan(1);
 const glyphs=new Set([...Object.values(record.icons.views),record.icons.allApps]);
 for(const tile of homeTiles){
  if(tile.image){expect(tile.icon,tile.name+' platform icon carries no glyph id').toBeNull();continue;}
  expect(glyphs.has(tile.icon),tile.name+' names a published glyph: '+tile.icon).toBe(true);
  expect(tile.mask,tile.name+' draws the glyph it names').toMatch(new RegExp('/icons/lucide/'+tile.icon+'\\.svg"?\\)$'));
 }
 expect(homeTiles.find(tile=>tile.name==='Apps')?.icon).toBe(record.icons.allApps);
 await expect(camera.first()).toBeVisible();
 await page.screenshot({animations:'disabled',path:info.outputPath('launcher-'+theme+'.png')});
 await page.getByRole('button',{name:'Files',exact:true}).click();
 const type=page.getByRole('button',{name:'Type',exact:true});await expect(type.locator('[data-alpha-icon]')).toHaveAttribute('data-alpha-icon','/icons/lucide/keyboard.svg');

 await expect(page.getByRole('region',{name:'Home',exact:true})).toHaveCount(0);
 await page.screenshot({animations:'disabled',path:info.outputPath('dock-folders-'+theme+'.png')});
 const storage=page.getByRole('button',{name:'Internal storage',exact:true}).locator('[data-alpha-icon]');await expect(storage).toHaveAttribute('data-alpha-icon','/icons/lucide/hard-drive.svg');
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Sort and more',exact:true}).click();await page.getByText('New folder',{exact:true}).click();await page.getByRole('textbox',{name:'Name'}).fill('Synthetic folder');await page.getByRole('button',{name:'Create',exact:true}).click();
 const row=page.getByRole('button',{name:'Open Synthetic folder',exact:true});await expect(row.locator('[data-alpha-icon="/icons/lucide/folder.svg"]')).toHaveAttribute('data-alpha-icon','/icons/lucide/folder.svg');
 await page.screenshot({animations:'disabled',path:info.outputPath('folders-'+theme+'.png')});
 const icon=row.locator('[data-alpha-icon="/icons/lucide/folder.svg"]');expect(await icon.evaluate(el=>({tag:el.tagName,mask:getComputedStyle(el).maskImage,color:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width,hidden:el.getAttribute('aria-hidden'),viewbox:el.hasAttribute('viewBox')}))).toMatchObject({tag:'SPAN',hidden:'true',viewbox:false});expect(await icon.evaluate(el=>getComputedStyle(el).maskImage)).toContain('folder.svg');
 // The folder's own Back control uses the same pack.
 await expect(page.getByRole('button',{name:'Back',exact:true}).first().locator('[data-alpha-icon]')).toHaveAttribute('data-alpha-icon','/icons/lucide/chevron-left.svg');
 await page.screenshot({animations:'disabled',path:info.outputPath('folders-'+theme+'.png')});
});

for(const theme of ['light','dark'])test(`all major app controls use the one icon pack: ${theme}`,async({page},info)=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic camera denied','NotAllowedError');};});await page.goto('/?mode=dev&theme='+theme);
 const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));
 for(const view of ['Notes','Calendar','Browser','Workflows','Settings','Photos','Maps','Camera']){
  await page.getByRole('button',{name:view,exact:true}).first().click();await expect(page.locator('html')).toHaveAttribute('data-active-view',view.toLowerCase());
  await expect(page.locator('[data-alpha-icon]').first()).toBeAttached();expect(await page.locator('svg.i').count(),view+' retained bespoke UI SVG').toBe(0);
  const icons=await page.locator('[data-alpha-icon]').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length).map(element=>({asset:element.getAttribute('data-alpha-icon'),mask:getComputedStyle(element).maskImage})));expect(icons.length,view+' published icons').toBeGreaterThan(0);for(const icon of icons){expect(icon.asset).toMatch(/^\/icons\/lucide\/[a-z0-9-]+\.svg$/);expect(icon.mask).toContain('/icons/lucide/');}
  await page.screenshot({animations:'disabled',path:info.outputPath(view.toLowerCase()+'-'+theme+'.png')});await returnToApps(page);
 }
 expect(failures).toEqual([]);
});

for(const theme of ['light','dark'])test(`selected photo and playback glyphs preserve library fill and backplates: ${theme}`,async({page},info)=>{
 await page.goto('/?mode=mock&theme='+theme+'&start=photos');const favorite=page.locator('.photo-favorite-badge').first();await expect(favorite).toBeAttached();await expect(favorite.locator('[data-alpha-icon]')).toHaveCSS('mask-image',/heart-filled\.svg/);expect(await favorite.evaluate(element=>getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');await expect(page.locator('.photo-media-badge [data-alpha-icon="/icons/lucide/play.svg"]').first()).toHaveCSS('mask-image',/play-filled\.svg/);await page.screenshot({animations:'disabled',path:info.outputPath('filled-library-'+theme+'.png')});
});
