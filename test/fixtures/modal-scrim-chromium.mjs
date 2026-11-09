import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Execute real motion and modal ownership in Chromium. Shell state/rendering is a controlled port. */
export async function observeModalScrim({onInputs} = {}) {
  const options = {stdin:{contents:`
      export {installChatOverlayMotion} from './apps/app/src/prototype/chat-overlay-motion-adapter.ts';
      export {installCalendarMonthFocus} from './apps/app/src/prototype/calendar-month-focus.ts';
      export {holdPhoneInert} from './apps/app/src/runtime/modal-inert.ts';
      export {createElement} from 'react';
      export {createRoot} from 'react-dom/client';
      export {createPortal, flushSync} from 'react-dom';
  `,resolveDir:root},bundle:true,format:'iife',globalName:'Actual',write:false,platform:'browser',metafile:true,
    define:{'process.env.NODE_ENV':JSON.stringify('production')}};
  let built = await build(options);
  const stylesheet = resolve(root, 'apps/app/src/prototype/phone.css');
  if (onInputs) {
    const dependencies = Object.keys(built.metafile.inputs).filter(path => !path.includes('node_modules/'))
      .map(path => resolve(root, path)).filter(existsSync);
    onInputs([stylesheet, fileURLToPath(import.meta.url), ...dependencies]);
    built = await build(options);
  }
  const css=readFileSync(stylesheet,'utf8');
  const browser=await chromium.launch();
  try{
    const results=[];
    const schedules = [
      'uninterrupted-delayed-click',
      'uninterrupted-mouse',
      'uninterrupted-touch',
      'uninterrupted-compatibility-click',
      'unrelated-nonmodal-timeout',
      'inline-held-no-capture',
      'inline-held-capture',
      'inline-close-before-release',
      'inline-pending-timeout',
      'inline-closed-before-timeout',
      'retired-timer-same-pointer',
      'native-pending-timeout',
      'native-only-pending-timeout',
      'inline-same-task-aba',
      'native-only-same-task-aba',
    ];
    for (const name of schedules) {
      const page=await browser.newPage({viewport:{width:412,height:915},hasTouch:name==='uninterrupted-touch'});
      await page.route('**/*',route=>route.abort());
      await page.clock.install({time:new Date('2026-11-08T12:00:00Z')});
      await page.clock.pauseAt(new Date('2026-11-08T12:00:01Z'));
      await page.setContent(`<style>${css}</style><div class="os" style="position:fixed;inset:0"><div data-screen style="position:absolute;inset:0">
          <div data-alpha-layer="app" style="position:absolute;inset:0;z-index:10">
              <button aria-label="Month view" style="position:absolute;top:64px;left:18px">Month view</button>
              <button id="underlay" style="position:absolute;left:185px;top:278px;width:80px;height:44px">Underlay</button>
          </div>
          <div data-alpha-layer="conversation" style="display:none"></div>
          <div data-alpha-layer="composer" style="position:absolute;bottom:30px;left:20px;z-index:40">
              <textarea data-alpha-composer>Retain this draft</textarea>
          </div>
      </div></div>`);
      await page.addScriptTag({content:built.outputFiles[0].text});
      await page.evaluate(()=>{
        const phone=document.querySelector('.os'),app=document.querySelector('[data-alpha-layer=app]');
        const month=app.querySelector('[aria-label="Month view"]'),composer=document.querySelector('[data-alpha-layer=composer]');
        const textbox=composer.querySelector('textarea');
        const seen=[]; let modal,releasePhone,lastPointer,scrim;
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
        const host=document.createElement('div');
        document.body.append(host);
        const react=Actual.createRoot(host);
        Actual.flushSync(()=>react.render(Actual.createPortal(Actual.createElement('div',{
          ref:element=>{scrim=element;},
          'data-alpha-chat-scrim':'',
          'data-alpha-dock-scrim':'true',
          style:{position:'absolute',inset:0,zIndex:39,touchAction:'none'},
          onPointerDown:event=>shell.out.scrimSw.down(event),
          onPointerMove:event=>shell.out.scrimSw.move(event),
          onPointerUp:event=>shell.out.scrimSw.up(event),
          onPointerCancel:event=>shell.out.scrimSw.cancel(event),
          onClick:event=>shell.out.scrimTap(event),
        }),phone.querySelector('[data-screen]'))));
        update();shell.componentDidMount();
        textbox.onfocus=()=>shell.out.inputComposerFocus();
        textbox.onblur=()=>shell.out.inputComposerBlur();
        textbox.focus();
        for(const type of ['pointerdown','pointerup','pointercancel']){
          document.addEventListener(type,e=>{
            if(type==='pointerdown'&&e.target===scrim)lastPointer=e.pointerId;
            seen.push({event:type,target:e.target===scrim?'scrim':e.target.closest('[role="dialog"],dialog')?.id||e.target.id||e.target.getAttribute('aria-label'),trusted:e.isTrusted,id:e.pointerId,pointerType:e.pointerType});
          },true);
        }
        const open=kind=>{
          const native=kind!=='inline';
          modal=document.createElement(native?'dialog':'div');
          modal.id=native?'native-modal':'calendar-modal';
          modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Choose calendar date');
          if(!native){modal.className='calendar-month-dialog';modal.style.cssText='position:absolute;inset:44px 0 0;z-index:50;background:white';}
          modal.innerHTML='<button id="modal-target" style="position:absolute;left:185px;top:234px;width:80px;height:44px">Modal action</button>';
          (native?document.body:app).append(modal);
          if(kind==='nonmodal')modal.show();
          else if(native){if(kind==='native')releasePhone=Actual.holdPhoneInert(phone);modal.showModal();}
          else views.calendar.render().monthModalRef(modal);
          shell.setState({});
        };
        month.onclick=()=>open('inline');
        let activations=0;
        document.addEventListener('click',event=>{
          if(event.target.id==='underlay'||event.target.id==='modal-target')activations++;
          if(event.target===scrim)seen.push({event:'click',target:'scrim',trusted:event.isTrusted,id:event.pointerId});
        },true);
        window.boundary={
          open,close,
          unrelated() {
            const unrelated=document.createElement('div');
            phone.append(unrelated);
            unrelated.inert=true;
            unrelated.inert=false;
          },
          oldRelease(){
            scrim.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:lastPointer,pointerType:'mouse'}));
            scrim.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
          },
          compatibilityRelease(){
            const init={bubbles:true,cancelable:true,clientX:206,clientY:300,pointerId:7,pointerType:'touch',isPrimary:true};
            scrim.dispatchEvent(new PointerEvent('pointerdown',init));
            scrim.dispatchEvent(new PointerEvent('pointerup',init));
          },
          compatibilityClick(pointerId){
            const init={bubbles:true,cancelable:true,detail:1};
            scrim.dispatchEvent(pointerId===undefined?new MouseEvent('click',init):new PointerEvent('click',{...init,pointerId}));
          },
          read:()=>({chat:shell.S().chat,press:shell.chatScrimPress?{id:shell.chatScrimPress.id,moved:shell.chatScrimPress.moved,
            released:!!shell.chatScrimPress.dock?.released}:null,
            captured:lastPointer!==undefined&&scrim.hasPointerCapture(lastPointer),modal:modal?.id??null,topLayer:modal?.matches(':modal')??false,
            scrimPointer:getComputedStyle(scrim).pointerEvents,scrimInert:scrim.inert,phoneInert:phone.inert,
            composer:getComputedStyle(composer).visibility,composerMounted:getComputedStyle(composer).display!=='none',active:document.activeElement?.id||document.activeElement?.getAttribute('aria-label'),
            inputFocused:!!shell.chatInputFocused,draft:textbox.value,seen:seen.slice(),activations}),
        };
      });
      const read=()=>page.evaluate(()=>window.boundary.read());
      const result={name,initial:await read()};
      const ordinary=name.startsWith('uninterrupted');
      const touch=name==='uninterrupted-touch';
      const samePointer=name==='retired-timer-same-pointer';
      const delayed=samePointer||name.includes('timeout')||name==='uninterrupted-delayed-click'||name==='uninterrupted-compatibility-click';
      if(delayed){
        await page.evaluate(()=>window.boundary.compatibilityRelease());
      }else if(!touch){
        await page.mouse.move(206,300);await page.mouse.down();
        if(name.includes('capture')&&!name.includes('no-capture'))await page.mouse.move(226,300);
      }
      result.held=await read();
      if(name.endsWith('-aba')){
        result.sameTask=await page.evaluate(kind=>{
          window.boundary.open(kind);
          window.boundary.close();
          window.boundary.oldRelease();
          return window.boundary.read();
        },name.startsWith('native')?'native-only':'inline');
      }else if(name.startsWith('unrelated')){
        await page.evaluate(()=>{window.boundary.unrelated();window.boundary.open('nonmodal');});
        result.opened=await read();
      }else if(!ordinary){
        if(name.startsWith('native'))await page.evaluate(kind=>window.boundary.open(kind),name.startsWith('native-only')?'native-only':'native');
        else{await page.getByRole('button',{name:'Month view',exact:true}).focus();await page.keyboard.press('Enter');}
        result.opened=await read();
      }
      if(samePointer||name==='inline-close-before-release'||name==='inline-closed-before-timeout'){
        await page.keyboard.press('Escape');
        result.closedEarly=await read();
      }
      if(touch)await page.touchscreen.tap(206,300);
      else if(!delayed)await page.mouse.up();
      result.released=await read();
      if(name==='uninterrupted-compatibility-click'){
        await page.clock.runFor(120);
        await page.evaluate(()=>window.boundary.compatibilityClick(1));
        result.wrongPointer=await read();
        await page.evaluate(()=>window.boundary.compatibilityClick());
        result.compatibility=await read();
      }
      if(samePointer){
        await page.clock.runFor(100);
        await page.evaluate(()=>window.boundary.compatibilityRelease());
        result.rearmed=await read();
      }
      await page.clock.runFor(samePointer?251:351);
      result.afterWait=await read();
      if(!ordinary)await page.evaluate(()=>window.boundary.close());
      result.afterClose=await read();
      if(name==='inline-held-capture'){
        await page.mouse.click(206,300);
        result.fresh=await read();
      }else if(samePointer){
        await page.clock.runFor(100);
        result.fresh=await read();
      }
      results.push(result);
      await page.close();
    }
    return results;
  }finally{await browser.close();}
}
