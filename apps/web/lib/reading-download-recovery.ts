import {values} from './browser-storage';
import {downloadOwner} from './download-ownership';
import {recoverMangaDownloads} from './browser-manga-downloads';
import {recoverNovelDownloads} from './browser-novel-downloads';
import {recoverArchiveDownloads} from './browser-archive-downloads';

let started=false,running=false;
let timer:ReturnType<typeof setTimeout>|undefined;
const pending=()=>values('mangaDownloads').some(row=>row.webOwner&&row.webOwner!==downloadOwner.id&&['queued','downloading'].includes(row.status))
  ||values('novelDownloads').some(row=>row.webOwner&&row.webOwner!==downloadOwner.id&&(row.queued||row.currentId))
  ||values('cityDownloads').some(row=>row.webOwner&&row.webOwner!==downloadOwner.id&&['queued','downloading'].includes(row.status));

/** A tab can close while another reader stays focused, without a Storage event. */
export async function startReadingDownloadRecovery() {
  if (!downloadOwner.supported) return;
  const recover=async()=>{
    if (running)return;
    running=true;
    try{await Promise.all([recoverMangaDownloads(),recoverNovelDownloads(),recoverArchiveDownloads()]);}
    catch{/* A busy metadata lock is retried; online browsing remains usable. */}
    finally{
      running=false;
      if(timer!==undefined){clearTimeout(timer);timer=undefined;}
      if(pending()&&typeof document!=='undefined'){
        timer=setTimeout(()=>{timer=undefined;void recover();},30000);
        (timer as any).unref?.();
      }
    }
  };
  if(!started){started=true;if(typeof window!=='undefined')window.addEventListener('focus',()=>{void recover();});}
  await recover();
}
