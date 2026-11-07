import {openBrowserCalendar} from './helpers/browser-calendar';
import {openLegacyNotes} from './helpers/legacy-notes';
import {test,expect} from '@playwright/test';
const cases=[['calendar','event','detail'],['calendar','new','form'],['calendar','invite','detail'],['calendar','add','detail'],['browser','tabs','tabs'],['photos','viewer','viewer'],['notes','editor','editor'],['notes','voice','voice'],['files','folder','folder'],['files','preview','preview']];
for(const theme of ['light','dark'])for(const [view,sub,layer] of cases)test(`${view} ${sub} retires covered controls ${theme}`,async({page},info)=>{
 await page.goto(`/?mode=mock&theme=${theme}&start=${view}:${sub}`);
 const active=page.locator(`[data-alpha-subview="${view}-${layer}"]`),list=page.locator(`[data-alpha-subview="${view}-list"]`);
 await expect(active).toBeVisible();await expect(list).toHaveAttribute('inert','');await expect(list).toHaveAttribute('aria-hidden','true');
 await expect(active.getByRole('button').first()).toBeFocused();await expect(list.getByRole('button')).toHaveCount(0);
 for(let i=0;i<10;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('[inert]'))).toBe(false);}
 await page.screenshot({path:info.outputPath('subview.png')});
});
for(const [app,open,close] of [['Calendar','New event','Back to calendar'],['Browser','Tabs','Back to page'],['Notes','New note','Back to notes']])test(`${app} returns focus to the opener in development`,async({page})=>{
 await page.goto('/?mode=dev');if(app==='Calendar')await openBrowserCalendar(page);else if(app==='Notes')await openLegacyNotes(page);else await page.getByRole('button',{name:app,exact:true}).click();
 const opener=page.getByRole('button',{name:open,exact:true});await opener.click();
 const back=page.getByRole('button',{name:close,exact:true});await expect(back).toBeFocused();await back.click();await expect(opener).toBeFocused();
});
test('Files returns through nested preview and folder without exposing covered controls',async({page})=>{
 await page.goto('/?mode=dev');await page.evaluate(async()=>{const{registerPlugin}=await import('/src/platform-plugins.ts');await registerPlugin<any>('AlphaFiles').importFile(new File(['Focus remains with the selected file.'],'focus.txt',{type:'text/plain'}));});
 await page.getByRole('button',{name:'Files',exact:true}).click();const folder=page.getByRole('button',{name:'Internal storage',exact:true});const folderText=(await folder.textContent())!;await folder.click();
 const file=page.getByRole('button',{name:'Open focus.txt',exact:true});await file.click();
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(file).toBeFocused();
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByRole('button',{name:'Internal storage',exact:true}).filter({hasText:folderText})).toBeFocused();
});
