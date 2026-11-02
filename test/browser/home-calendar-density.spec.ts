import {installHomeCalendar} from './helpers/home-calendar';
import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

async function openHome(page:Page,theme:string,size:{width:number;height:number},kind:'long'|'unbroken'|'all-day'|'empty'){
 await page.setViewportSize(size);
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?theme='+theme);
 const expected=await page.evaluate(kind=>{
  if(kind==='empty')return null;
  const date=new Date(Date.now()+3*86400000);date.setHours(12,0,0,0);
  const allDay=kind==='all-day',begin=allDay?Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()):date.getTime(),end=begin+(allDay?86400000:3600000);
  const title=kind==='unbroken'?'OwnedSyntheticCalendarTitle'.repeat(12):'Owned Calendar QA: a deliberately long event title with enough detail to wrap across all three lines';
  return {title,startAt:new Date(begin).toISOString(),endAt:new Date(end).toISOString(),isAllDay:allDay,day:date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}),footer:allDay?'All day':new Date(begin).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' – '+new Date(end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})};
 },kind);
 await installHomeCalendar(page,expected&&{title:expected.title,startAt:expected.startAt,endAt:expected.endAt,isAllDay:expected.isAllDay});
 const card=page.locator('[data-alpha-home-calendar]');await expect(card).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 if(expected){await expect(card).toHaveAccessibleName(`Open calendar event: ${expected.title}, ${expected.day}, ${expected.footer}`);await expect(card.locator('.home-calendar-footer')).toHaveText(expected.footer);}
 else await expect(card).toHaveAccessibleName('Open Agent Calendar');
 return {card,expected};
}

for(const [theme,size,kind] of [
 ['light',{width:320,height:640},'long'],
 ['dark',{width:320,height:640},'unbroken'],
 ['light',{width:412,height:915},'all-day'],
 ['dark',{width:412,height:915},'empty'],
 ['light',{width:960,height:1020},'long'],
] as const)test(`Home Calendar keeps complete line boxes and its time footer: ${theme} ${size.width} ${kind}`,async({page},info)=>{
 const {card,expected}=await openHome(page,theme,size,kind);
 const geometry=await card.evaluate(element=>{
  const box=element.getBoundingClientRect(),title=element.querySelector<HTMLElement>('.home-calendar-title')!,r=title.getBoundingClientRect(),style=getComputedStyle(title),scale=box.width/(element as HTMLElement).offsetWidth,footerElement=element.querySelector('.home-calendar-footer'),footer=footerElement?.getBoundingClientRect();
  return {font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight),height:r.height/scale,clamp:style.webkitLineClamp,titleTop:r.top,titleBottom:r.bottom,footerTop:footer?.top,footerBottom:footer?.bottom,footerText:footerElement?.textContent,footerOverflow:footerElement?footerElement.scrollWidth-footerElement.clientWidth:0,cardBottom:box.bottom,scale,overflow:element.scrollWidth-element.clientWidth,titleOverflow:title.scrollWidth-title.clientWidth,cardHeight:box.height/scale};
 });
 expect(geometry.cardHeight).toBeCloseTo(196,1);expect(geometry.overflow).toBe(0);expect(geometry.titleOverflow).toBe(0);expect(geometry.clamp).toBe(expected?'3':'none');
 if(expected){expect(geometry.font).toBe(26);expect(geometry.height/geometry.line).toBeCloseTo(3,1);expect(geometry.footerText).toBe(expected.footer);expect(geometry.footerOverflow).toBe(0);expect(geometry.footerTop!-geometry.titleBottom).toBeGreaterThanOrEqual(11*geometry.scale);expect(geometry.cardBottom-geometry.footerBottom!).toBeGreaterThanOrEqual(21*geometry.scale);}
 else{expect(geometry.font).toBe(36);await expect(card.locator('.home-calendar-footer')).toHaveCount(0);await expect(card).toContainText(/Nothing planned/);}
 await writeFile(info.outputPath('geometry.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:info.outputPath('home-calendar.png'),animations:'disabled'});
 if(expected){await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');}
});
