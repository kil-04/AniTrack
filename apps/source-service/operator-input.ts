import type {BrowserWindow} from 'electron';
import {reject,ServiceError} from './protocol';

const INPUT_DEADLINE_MS=10000;

/** Fixed human mouse routing, including ordinary cross-process iframe targets. */
export class OperatorClickRouter {
  private active=false;
  isBusy(){return this.active;}

  async click(win:BrowserWindow,x:number,y:number,signal:AbortSignal,permitted:()=>boolean):Promise<void>{
    const contents=win.webContents,[width,height]=win.getContentSize();
    if(![x,y].every(Number.isInteger)||x<0||y<0||x>=width||y>=height)return reject(400,'INVALID_OPERATOR_INPUT');
    const available=()=>{
      if(signal.aborted)return reject(499,'REQUEST_CANCELLED');
      if(win.isDestroyed()||contents.isDestroyed()||!permitted())return reject(404,'SOURCE_WINDOW_UNAVAILABLE');
      if(!win.isVisible())return reject(409,'SOURCE_WINDOW_HIDDEN');
    };
    available();
    // This process-wide pair guard precedes focus. Operator key/text input also
    // checks it, so another source cannot take focus between press and release.
    if(this.active)return reject(429,'OPERATOR_INPUT_BUSY');
    this.active=true;
    let stopped:ServiceError|undefined,owned=false,detached=false,contextChanged=false;
    const contextUrl=contents.getURL();
    let inspector:Electron.Debugger|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{},onDetach=()=>{};
    const onNavigation=(_event:Electron.Event,_url:string,inPlace:boolean,main:boolean)=>{if(main&&!inPlace)contextChanged=true;};
    let interrupt:(error:ServiceError)=>void=()=>{};
    const interrupted=new Promise<never>((_,fail)=>{
      interrupt=error=>{if(stopped)return;stopped=error;fail(error);};
      onAbort=()=>interrupt(new ServiceError(499,'REQUEST_CANCELLED'));
      signal.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(()=>interrupt(new ServiceError(504,'OPERATOR_INPUT_TIMEOUT')),INPUT_DEADLINE_MS);timer.unref?.();
    });
    const current=()=>{if(stopped)throw stopped;available();};
    const sameContext=()=>{
      if(!owned||!inspector?.isAttached())return reject(409,'OPERATOR_INPUT_UNAVAILABLE');
      if(win.isDestroyed()||contents.isDestroyed()||contextChanged||contents.getURL()!==contextUrl||!permitted())return reject(404,'SOURCE_WINDOW_UNAVAILABLE');
      if(!win.isVisible())return reject(409,'SOURCE_WINDOW_HIDDEN');
    };
    const operation=(async()=>{
      try{
        current();win.focus();contents.focus();current();
        inspector=contents.debugger;
        // Never borrow, replace, or detach another application's attachment.
        if(inspector.isAttached())return reject(409,'OPERATOR_INPUT_UNAVAILABLE');
        onDetach=()=>{owned=false;detached=true;interrupt(new ServiceError(502,'OPERATOR_INPUT_UNAVAILABLE'));};
        inspector.on('detach',onDetach);
        contents.on('did-start-navigation',onNavigation);
        inspector.attach('1.3');owned=!detached;
        current();
        sameContext();
        await inspector.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
        // A cancelled HTTP request cannot undo an admitted human press. Finish
        // its single paired release only in the same visible approved document;
        // never retry the press or route cleanup into a replacement document.
        sameContext();
        await inspector.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
        current();
      }finally{
        // Admission lasts until dispatched commands and bounded pair cleanup
        // actually settle, even when the caller has already timed out.
        if(timer)clearTimeout(timer);
        signal.removeEventListener('abort',onAbort);
        try{
          contents.removeListener('did-start-navigation',onNavigation);
          inspector?.removeListener('detach',onDetach);
          if(owned&&inspector?.isAttached())inspector.detach();
        }finally{this.active=false;}
      }
    })();
    try{await Promise.race([operation,interrupted]);}
    catch(error){if(error instanceof ServiceError)throw error;return reject(502,'OPERATOR_INPUT_FAILED');}
  }
}
