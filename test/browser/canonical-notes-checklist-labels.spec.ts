import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';

test('blank checklist actions have object labels while exact text and row editing are preserved',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page,{notes:[{
  id:'checklist-labels',title:'Checklist labels',body:'',color:'yellow',
  createdAt:'2026-11-10T12:00:00Z',updatedAt:'2026-11-10T12:00:00Z',
  format:{kind:'list',data:{items:[{t:'',done:false},{t:' \t ',done:true},{t:'  Milk  ',done:false}]}},
 }]});
 await openCanonicalNotes(page);await page.getByRole('button',{name:'Open Checklist labels',exact:true}).click();
 const items=page.getByRole('textbox',{name:'Item',exact:true});
 await expect(items).toHaveCount(3);
 await expect(items.nth(0)).toHaveValue('');await expect(items.nth(1)).toHaveValue(' \t ');await expect(items.nth(2)).toHaveValue('  Milk  ');
 await expect(page.getByRole('button',{name:'Remove item',exact:true})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Check item',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Uncheck item',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Remove Milk',exact:true})).toBeVisible();
 await items.nth(0).fill('  Edited row  ');
 await expect(items.nth(0)).toBeFocused();
 await expect(page.getByRole('button',{name:'Remove Edited row',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remove item',exact:true}).click();
 await expect(items).toHaveCount(2);
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes[0].format.data.items))
  .toEqual([{t:'  Edited row  ',done:false},{t:'  Milk  ',done:false}]);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
