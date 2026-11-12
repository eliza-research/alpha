import type {Page} from '@playwright/test';

/** Verify the retained source-to-mail contract after the custom share chooser was removed. */
export async function retainedEmailSource(page: Page, view: 'notes' | 'files' | 'photos') {
  await page.evaluate(view => {
    const root = document.getElementById('root') as any;
    const container = Object.keys(root).find(key => key.startsWith('__reactContainer$'));
    if (!container) throw Error('Phone shell is unavailable');
    const pending = [root[container]];
    while (pending.length) {
      const fiber = pending.pop();
      const shell = fiber?.stateNode;
      if (typeof shell?.renderVals === 'function' && shell.S?.().view === view) {
        const output = shell.renderVals()[view];
        const share = view === 'notes' ? output?.shareMail : view === 'files' ? output?.pv?.email : output?.v?.email;
        if (typeof share !== 'function') throw Error('The source-to-mail contract is unavailable');
        share();
        return;
      }
      if (fiber?.sibling) pending.push(fiber.sibling);
      if (fiber?.child) pending.push(fiber.child);
    }
    throw Error('Open the source item first');
  }, view);
}
