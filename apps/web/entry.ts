import {installBrowserApi} from './lib/browser-api';

void (async()=>{
  await installBrowserApi();
  await import('./source/apps/desktop/renderer/main');
  if(import.meta.env.PROD&&'serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
})().catch(error=>{
  const root=document.getElementById('root')!;
  root.replaceChildren();
  const message=document.createElement('p');message.setAttribute('role','alert');message.style.padding='32px';
  message.textContent=error instanceof Error?error.message:'AniTrack could not start. Refresh to try again.';
  root.append(message);
});
