import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Execute real motion and modal ownership in Chromium. Shell state/rendering is a controlled port. */
export async function observeModalScrim() {
  const built=await build({stdin:{contents:`
      export {installChatOverlayMotion} from './apps/app/src/prototype/chat-overlay-motion-adapter.ts';
      export {installCalendarMonthFocus} from './apps/app/src/prototype/calendar-month-focus.ts';
      export {holdPhoneInert} from './apps/app/src/runtime/modal-inert.ts';
  `,resolveDir:root},bundle:true,format:'iife',globalName:'Actual',write:false,platform:'browser'});
  const css=readFileSync(new URL('../../apps/app/src/prototype/phone.css', import.meta.url),'utf8');
  const browser=await chromium.launch();
  try{
    const results=[];
    const schedules = [
      'uninterrupted-delayed-click',
      'inline-held-no-capture',
      'inline-held-capture',
      'inline-close-before-release',
      'inline-pending-timeout',
      'inline-closed-before-timeout',
      'native-pending-timeout',
      'native-only-pending-timeout',
    ];
    for (const name of schedules) {
      const page=await browser.newPage({viewport:{width:412,height:915}});
      await page.route('**/*',route=>route.abort());
      await page.clock.install({time:new Date('2026-11-08T12:00:00Z')});
      await page.clock.pauseAt(new Date('2026-11-08T12:00:01Z'));
      await page.setContent(`<style>${css}</style><div class="os" style="position:fixed;inset:0"><div data-screen style="position:absolute;inset:0">
          <div data-alpha-layer="app" style="position:absolute;inset:0;z-index:10">
              <button aria-label="Month view" style="position:absolute;top:64px;left:18px">Month view</button>
              <button id="underlay" style="position:absolute;left:185px;top:278px;width:80px;height:44px">Underlay</button>
          </div>
          <div data-alpha-chat-scrim data-alpha-dock-scrim="true" style="position:absolute;inset:0;z-index:39;touch-action:none"></div>
          <div data-alpha-layer="conversation" style="display:none"></div>
          <div data-alpha-layer="composer" style="position:absolute;bottom:30px;left:20px;z-index:40">
              <textarea data-alpha-composer>Retain this draft</textarea>
          </div>
      </div></div>`);
      await page.addScriptTag({content:built.outputFiles[0].text});
      await page.evaluate(()=>{
        const phone=document.querySelector('.os'),app=document.querySelector('[data-alpha-layer=app]'),scrim=document.querySelector('[data-alpha-chat-scrim]');
        const month=app.querySelector('[aria-label="Month view"]'),composer=document.querySelector('[data-alpha-layer=composer]');
        const seen=[]; let modal,releasePhone;
        const update=()=>{
          shell.out=shell.renderVals();
          scrim.style.pointerEvents=shell.out.scrimPE;
          scrim.dataset.alphaDockScrim=String(shell.out.dockScrim);
          composer.style.display=shell.out.showComposer?'':'none';
        };
        class Shell {
          state={view:'calendar',screen:'home',chat:'input',voice:'off',shade:false};
          live=true;
          props={};
          S(){return this.state;}
          rest(){return 'hidden';}
          swallowed(){return false;}
          renderVals(){return {showComposer:this.state.chat==='input'};}
          componentDidMount(){}
          componentDidUpdate(){}
          componentWillUnmount(){}
          setState(patch){const before=this.state;this.state={...before,...patch};
            update();this.componentDidUpdate({},before);}
        }
        const close=()=>{
          if(!modal)return;
          const old=modal;modal=undefined;
          if(old instanceof HTMLDialogElement){old.close();releasePhone?.();releasePhone=undefined;}
          else views.calendar.render().monthModalRef(null);
          old.remove();
          shell.setState({});
        };
        const views={calendar:{render:()=>({closeMonth:close})}};
        Actual.installCalendarMonthFocus(Shell,views);
        Actual.installChatOverlayMotion(Shell);
        const shell=new Shell();
        update();shell.componentDidMount();
        for(const [type,name] of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel']]){
          scrim.addEventListener(type,event=>shell.out.scrimSw[name](event));
          document.addEventListener(type,e=>{
            if(type!=='pointermove')seen.push({event:type,target:e.target===scrim?'scrim':e.target.closest('[role="dialog"],dialog')?.id||e.target.id||e.target.getAttribute('aria-label'),trusted:e.isTrusted,id:e.pointerId});
          },true);
        }
        scrim.onclick=()=>shell.out.scrimTap();
        const open=kind=>{
          const native=kind!=='inline';
          modal=document.createElement(native?'dialog':'div');
          modal.id=native?'native-modal':'calendar-modal';
          modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Choose calendar date');
          if(!native){modal.className='calendar-month-dialog';modal.style.cssText='position:absolute;inset:44px 0 0;z-index:50;background:white';}
          modal.innerHTML='<button id="modal-target" style="position:absolute;left:185px;top:234px;width:80px;height:44px">Modal action</button>';
          (native?document.body:app).append(modal);
          if(native){if(kind==='native')releasePhone=Actual.holdPhoneInert(phone);modal.showModal();}
          else views.calendar.render().monthModalRef(modal);
          shell.setState({});
        };
        month.onclick=()=>open('inline');
        let activations=0;
        document.addEventListener('click',event=>{if(event.target.id==='underlay'||event.target.id==='modal-target')activations++;},true);
        window.boundary={
          open,close,read:()=>({chat:shell.S().chat,press:shell.chatScrimPress?{id:shell.chatScrimPress.id,moved:shell.chatScrimPress.moved}:null,
            captured:shell.chatScrimPress?scrim.hasPointerCapture(shell.chatScrimPress.id):false,modal:modal?.id??null,
            scrimPointer:getComputedStyle(scrim).pointerEvents,scrimInert:scrim.inert,phoneInert:phone.inert,
            composer:getComputedStyle(composer).visibility,composerMounted:getComputedStyle(composer).display!=='none',active:document.activeElement?.id||document.activeElement?.getAttribute('aria-label'),
            draft:composer.querySelector('textarea').value,seen:seen.slice(),activations}),
        };
      });
      const read=()=>page.evaluate(()=>window.boundary.read());
      const result={name,initial:await read()};
      const delayed=name.includes('timeout')||name==='uninterrupted-delayed-click';
      if(delayed){
        await page.evaluate(()=>{
          const el=document.querySelector('[data-alpha-chat-scrim]');
          const init={bubbles:true,cancelable:true,clientX:206,clientY:300,pointerId:7,pointerType:'touch',isPrimary:true};
          el.dispatchEvent(new PointerEvent('pointerdown',init));el.dispatchEvent(new PointerEvent('pointerup',init));
        });
      }else{
        await page.mouse.move(206,300);await page.mouse.down();
        if(name.includes('capture')&&!name.includes('no-capture'))await page.mouse.move(226,300);
      }
      result.held=await read();
      if(name!=='uninterrupted-delayed-click'){
        if(name.startsWith('native'))await page.evaluate(kind=>window.boundary.open(kind),name.startsWith('native-only')?'native-only':'native');
        else{await page.getByRole('button',{name:'Month view',exact:true}).focus();await page.keyboard.press('Enter');}
        result.opened=await read();
      }
      if(name==='inline-close-before-release'||name==='inline-closed-before-timeout'){await page.keyboard.press('Escape');result.closedEarly=await read();}
      if(!delayed)await page.mouse.up();
      result.released=await read();
      await page.clock.runFor(351);
      result.afterWait=await read();
      if(name!=='uninterrupted-delayed-click')await page.evaluate(()=>window.boundary.close());
      result.afterClose=await read();
      results.push(result);
      await page.close();
    }
    return results;
  }finally{await browser.close();}
}
