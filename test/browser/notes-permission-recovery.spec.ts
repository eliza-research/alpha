import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';

test('blocked Notes microphone opens the existing access panel and keeps the retry explicit',async({page},info)=>{
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const fixture=(window as any).notePermissionFixture={state:'denied',requests:0};
  const query=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=((input:PermissionDescriptor)=>input.name===('microphone' as PermissionName)?Promise.resolve({state:fixture.state} as PermissionStatus):query(input)) as typeof query;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{fixture.requests++;throw new DOMException('Blocked test microphone','NotAllowedError');}});
 });
 await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'Record voice note',exact:true}).click();
 const access=page.getByRole('dialog',{name:'Access',exact:true});
 await expect(access).toBeVisible();
 await expect(access.locator('[aria-current=step]',{hasText:'Microphone'})).toBeVisible();
 await expect(access.getByRole('button',{name:'Check',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('microphone-access.png')});
 expect(await page.evaluate(()=>(window as any).notePermissionFixture.requests)).toBe(1);
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.state.notes.length)).toBe(0);
 // Model the browser reporting the user's changed setting; the app cannot grant it itself.
 await page.evaluate(()=>{(window as any).notePermissionFixture.state='granted';});
 await access.getByRole('button',{name:'Check',exact:true}).click();
 await expect(access.locator('[aria-current=step]').getByText('Allowed',{exact:true})).toBeVisible();
 await access.getByRole('button',{name:'Done',exact:true}).click();
 await expect(access).toHaveCount(0);
 await expect(page.locator('[data-alpha-subview="notes-recorder"]').getByRole('button',{name:'Record',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).notePermissionFixture.requests)).toBe(1);
});
