import {test,expect,type Page} from '@playwright/test';
const digests=(page:Page)=>page.evaluate(async()=>(await (await import('/src/browser/development-digest-document.ts')).readDevelopmentDigests((await import('/src/browser/development-identity.ts')).developmentIdentity('local'))));
test('a bound source shows its renewal window, pauses at expiry and renews with its schedule in one confirmed step',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
 await panel.getByText('Share a snapshot',{exact:true}).click();
 // Default and maximum reviewed lifetime is 7 days.
 const expiry=panel.getByLabel('Expires after hours',{exact:true});await expect(expiry).toHaveValue('168');await expect(expiry).toHaveAttribute('max','168');
 await panel.getByLabel('Label',{exact:true}).fill('Daily source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Reviewed snapshot content');await expiry.fill('20');
 await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});await panel.getByLabel('Time zone',{exact:true}).fill('UTC');await panel.getByLabel('Morning',{exact:true}).fill('12:30');
 await panel.getByRole('button',{name:'Review morning schedule',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 const schedules=panel.getByRole('region',{name:'Digest schedules'}),renewal=panel.getByRole('region',{name:'Source renewal'});
 await expect(schedules).toContainText('Morning at 12:30 (UTC) · Daily source · On');
 // Inside the final 24 hours the in-app notice offers renewal.
 await expect(renewal).toContainText('Daily source expires');await expect(renewal).toContainText('Renew it to keep its schedule running.');
 // At expiry the loop is paused with a clear state, and no failure brief is produced. Like the agent, the
 // schedule's next settlement is one explicit "unavailable" record (not a run), and nothing after it.
 await page.clock.setFixedTime(new Date('2026-10-04T08:30:00Z'));await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(renewal).toContainText('Daily source: Source expired. Its schedule is paused until you renew it. No failure briefs are created.');
 await expect(schedules).toContainText('Source expired — paused');
 await page.clock.setFixedTime(new Date('2026-10-04T12:30:05Z'));await page.evaluate(async()=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');await request(developmentIdentity('local'),'/api/workflow/hosted/tick',undefined);});
 const lapsed=(await digests(page)).results;expect(lapsed.map((r:any)=>[r.status,r.output,r.error])).toEqual([['unavailable',{status:'unavailable',sourceState:'expired',paused:true,text:'Source expired. This schedule is paused until you renew the source. No fresh phone data was read.'},null]]);
 await page.clock.setFixedTime(new Date('2026-10-05T12:30:05Z'));await page.evaluate(async()=>{const {developmentDigestRequest:request}=await import('/src/browser/development-digests.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts');await request(developmentIdentity('local'),'/api/workflow/hosted/tick',undefined);});
 expect((await digests(page)).results).toEqual(lapsed);await page.clock.setFixedTime(new Date('2026-10-04T12:30:05Z'));
 const before=await digests(page),loop=before.loops[0],old=before.sources[0];
 await renewal.getByRole('button',{name:'Renew Daily source',exact:true}).click();
 await expect(panel.getByLabel('Label',{exact:true})).toHaveValue('Daily source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Renewed snapshot content');
 await expect(panel.getByLabel('Expires after hours',{exact:true})).toHaveValue('20');await panel.getByLabel('Expires after hours',{exact:true}).fill('168');
 await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();
 const review=panel.getByRole('heading',{name:'Review',exact:true}).locator('..');await expect(review).toContainText('Renewal: morning at 12:30 moves to this source when you confirm.');
 await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect(schedules).toContainText('Morning at 12:30 (UTC) · Daily source · On');await expect(renewal).toHaveCount(0);
 const after=await digests(page),moved=after.loops.find((l:any)=>l.id===loop.id);
 expect(after.sources).toHaveLength(2);const renewed=after.sources.find((s:any)=>s.id!==old.id);
 expect(moved.spec).toMatchObject({template:'morning',localTime:'12:30',timeZone:'UTC',enabled:true,sourceId:renewed.id,sourceRevision:renewed.revision});expect(moved.versionId).not.toBe(loop.versionId);expect(after.loops).toHaveLength(1);
 expect(Date.parse(renewed.expiresAt)-Date.parse('2026-10-04T12:30:05Z')).toBeLessThanOrEqual(168*3600000);
});
test('morning and evening schedules can share one reviewed source',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:10Z')});
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
 await panel.getByText('Share a snapshot',{exact:true}).click();await panel.getByLabel('Label',{exact:true}).fill('Shared source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Shared content');
 await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await panel.getByRole('combobox',{name:'Reviewed source',exact:true}).selectOption({index:1});await panel.getByLabel('Time zone',{exact:true}).fill('UTC');
 for(const template of ['morning','evening']){await panel.getByRole('button',{name:`Review ${template} schedule`,exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();}
 const schedules=panel.getByRole('region',{name:'Digest schedules'});await expect(schedules).toContainText('Morning at 08:00 (UTC) · Shared source · On');await expect(schedules).toContainText('Evening at 18:00 (UTC) · Shared source · On');
 const state=await digests(page);expect(new Set(state.loops.map((l:any)=>l.spec.sourceId)).size).toBe(1);expect(state.loops.map((l:any)=>l.spec.template).sort()).toEqual(['evening','morning']);
});
test('a default 7-day snapshot expires exactly at the agent bound of observedAt plus 7 days',async({page})=>{
 // Real clock: observedAt and expiresAt must come from one reading, or a 168-hour source drifts past the agent's bound.
 await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});
 await panel.getByText('Share a snapshot',{exact:true}).click();await expect(panel.getByLabel('Expires after hours',{exact:true})).toHaveValue('168');
 await panel.getByLabel('Label',{exact:true}).fill('Week source');await panel.getByLabel('Snapshot text',{exact:true}).fill('Week content');
 await panel.getByRole('button',{name:'Review snapshot',exact:true}).click();await panel.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(async()=>(await digests(page)).sources.length).toBe(1);
 const [source]=(await digests(page)).sources;expect(Date.parse(source.expiresAt)-Date.parse(source.observedAt)).toBe(168*3600000);
});
