import {expect,type Page} from '@playwright/test';

type ToastObservation={active:boolean;text:string;undo:boolean;held:boolean;focusedInside:boolean;queued:Array<{text:string;undo:boolean}>};
/** Read-only synchronization with feedback the mounted source actually emitted. */
export const toastObservation=(page:Page):Promise<ToastObservation>=>page.evaluate(()=>{
 const screen=document.querySelector('[data-screen]') as any,key=Object.keys(screen).find(name=>name.startsWith('__reactFiber$'))!;let fiber=screen[key];
 while(fiber&&!(fiber.stateNode&&typeof fiber.stateNode.S==='function'&&typeof fiber.stateNode.closeToast==='function'))fiber=fiber.return;
 if(!fiber)throw Error('Mounted shell unavailable');const shell=fiber.stateNode;
 return {active:!!shell.toastActive,text:String(shell.S().toast||''),undo:!!shell.toastActive&&!!shell.undoFn,held:!!shell.toastHeld,
  queued:(shell.toastQueue||[]).map((notice:any)=>({text:notice.msg,undo:!!notice.undo})),focusedInside:!!document.activeElement?.closest('[data-alpha-toast]')};
});
export async function expectPendingToast(page:Page,text:string){
 await expect.poll(async()=>{const state=await toastObservation(page);return state.active&&state.text===text||state.queued.some(notice=>notice.text===text);}).toBe(true);
}
/** Ordinary pointer/keyboard exit releases a focused Undo offer; no source method is invoked. */
async function releaseToastInput(page:Page){
 await page.mouse.move(0,0);
 if((await toastObservation(page)).focusedInside)await page.keyboard.press('Tab');
 await expect.poll(async()=>{const state=await toastObservation(page);return state.focusedInside||state.held;}).toBe(false);
}
/** The caller installed/paused its clock before the deletion. Preserve the full real 10 s offer. */
export async function finishUndoWindow(page:Page){
 await releaseToastInput(page);
 const undo=page.locator('[data-alpha-toast]').getByRole('button',{name:'Undo',exact:true});
 await expect(undo).toBeVisible();
 await page.clock.fastForward(9999);await expect(undo).toBeVisible();
 await page.clock.fastForward(1);
}
