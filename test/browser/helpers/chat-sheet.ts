import {expect,type Page} from '@playwright/test';
/**
 * The owner's first touch above the open half sheet: it collapses the chat and reaches nothing
 * underneath (f21e9a6e4), so the next touch is an ordinary one on the page behind.
 */
export async function touchOutsideChat(page:Page){
 const scrim=page.locator('[data-alpha-chat-scrim]'),screen=page.locator('[data-screen]');
 const {width}=(await scrim.boundingBox())!;
 await scrim.click({position:{x:width/2,y:8}});
 await expect(screen).not.toHaveAttribute('data-alpha-chat-half','true');
}
