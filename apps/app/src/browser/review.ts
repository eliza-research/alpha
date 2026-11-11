import './review.css';
import {browserScreenLocked} from './screen-locked';
/** A browser equivalent of the native operation review, with cancellation ownership. */
export class BrowserReviews {
  private pending = new Map<string, () => void>();
  cancel(id: string) { this.pending.get(id)?.(); }
  cancelAll() { for (const cancel of [...this.pending.values()]) cancel(); }
  async confirm(id: string, title: string, details: string, confirmLabel = 'Confirm', options?: {signal?:AbortSignal;current?:()=>boolean}): Promise<boolean> {
    const current=()=>{try{return !options?.signal?.aborted&&options?.current?.()!==false;}catch{return false;}};
    if (this.pending.has(id) || !current() || document.hidden || document.documentElement.dataset.devBackground==='true' || browserScreenLocked()) return false;
    const previous = document.activeElement as HTMLElement | null;
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', title);
      dialog.className='alpha-operation-review';
      const shell=document.querySelector('.os');if(shell){const theme=getComputedStyle(shell);for(const token of ['bg','fg','s2','line'])dialog.style.setProperty('--review-'+token,theme.getPropertyValue('--'+token));dialog.style.colorScheme=theme.getPropertyValue('--bg').trim().toUpperCase()==='#000000'?'dark':'light';}

      const heading = document.createElement('h2'); heading.textContent = title;
      const body = document.createElement('p'); body.textContent = details; body.style.whiteSpace = 'pre-wrap';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
      const approve = document.createElement('button'); approve.textContent = confirmLabel;
      // An action that removes or overwrites something is set apart from Cancel (review.css).
      if (/^(Delete|Discard|Erase|Remove|Replace|Clear|Reset|Sign out)\b/.test(confirmLabel)) approve.dataset.destructive = '';

      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) return; settled = true;
        this.pending.delete(id); document.removeEventListener('visibilitychange', visibility);
        options?.signal?.removeEventListener('abort',cancelReview);
        window.removeEventListener('alpha-back', back, true);
        window.removeEventListener('pagehide', cancelReview);window.removeEventListener('alpha:device-state', cancelReview);
        dialog.remove(); previous?.isConnected && previous.focus(); resolve(confirmed);
      };
      const back = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); finish(false); };
      const cancelReview=()=>finish(false);
      const visibility = () => { if (document.hidden) finish(false); };
      cancel.onclick = () => finish(false); approve.onclick = () => finish(current() && !document.hidden && document.documentElement.dataset.devBackground!=='true' && !browserScreenLocked());
      dialog.oncancel = () => finish(false); dialog.onclose = () => finish(false);
      this.pending.set(id, () => finish(false));
      options?.signal?.addEventListener('abort',cancelReview,{once:true});
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('alpha-back', back, true);
      window.addEventListener('pagehide',cancelReview);window.addEventListener('alpha:device-state',cancelReview);
      const content=document.createElement('section');content.tabIndex=0;content.setAttribute('aria-label','Operation details');content.append(heading,body);const actions=document.createElement('footer');actions.append(cancel,approve);dialog.append(content,actions); document.body.append(dialog); dialog.showModal(); cancel.focus();
    });
  }
}
