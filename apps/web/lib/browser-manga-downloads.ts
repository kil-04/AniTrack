import {table, values, write, emit, request, saveFile, loadFile, deleteFile} from './browser-storage';
import {downloadOwner, type DownloadClaim} from './download-ownership';
import {browserMangaSource} from './manga-source-info';
import type {MangaDownload} from '../source/packages/shared/manga';
import {localFileDownloads,prepareFileDownload,titleWriter,type LocalWriter,type SavedFiles} from './local-files';

type Job = MangaDownload & DownloadClaim & {filePrefix: string; updatedAt: number;webFileOutput?:boolean;webFiles?:SavedFiles};
const queued = new Map<string,DownloadClaim>();
const controllers = new Map<string, AbortController>();
let work = Promise.resolve();
const prefix = (row: any) => row.filePrefix ?? `manga:${row.key}`;
const update = (row: any) => { write('mangaDownloads',row.key,row); emit('manga:download',{item:row}); };
const imageExtension=(blob:Blob)=>({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif','image/bmp':'bmp','image/svg+xml':'svg'}[blob.type.split(';')[0]]??'img');
async function erase(row: any) {
  if(row.webFileOutput||row.webFiles)return;
  for (let page=0;page<=Math.max(0,row.done??0);page++) await deleteFile(`${prefix(row)}:${page}`);
  await deleteFile(`${prefix(row)}:index`);
}

export async function recoverMangaDownloads() {
  if (!downloadOwner.supported) return;
  for (const snapshot of values('mangaDownloads')) {
    await downloadOwner.withResource('manga',snapshot.key,async()=>{
      const row=table('mangaDownloads')[snapshot.key];
      if (!row?.webOwner||!['queued','downloading'].includes(row.status)) return;
      if (row.webOwner&&await downloadOwner.isLive(row.webOwner)) return;
      update({...row,status:'failed',error:'The tab closed before the chapter finished. Retry the download.'});
    });
  }
}

export async function downloadManga(manga: any,title: any,chapter: any): Promise<boolean> {
  if(!await prepareFileDownload())return false;
  const key=`${manga.id}:${chapter.id}`;
  const pendingClaim=queued.get(key);
  if (pendingClaim&&['queued','downloading'].includes(table('mangaDownloads')[key]?.status)&&downloadOwner.matches(table('mangaDownloads')[key],pendingClaim)) return false;
  const source=browserMangaSource(title.sourceId);
  if (source?.web.downloads===false) throw new Error(source.web.description);
  await downloadOwner.ensure();
  const reservation=await downloadOwner.withResource('manga',key,async()=>{
    const previous=table('mangaDownloads')[key];
    if (previous?.status==='done'||(queued.has(key)&&['queued','downloading'].includes(previous?.status)&&downloadOwner.matches(previous,queued.get(key)!))) return null;
    if (previous&&!previous.webOwner&&['queued','downloading'].includes(previous.status)) return null;
    if (previous&&['queued','downloading'].includes(previous.status)&&previous.webOwner!==downloadOwner.id&&await downloadOwner.isLive(previous.webOwner)) return null;
    const claim=downloadOwner.claim();
    const row: Job={key,mangaId:manga.id,mangaTitle:manga.title,cover:manga.cover,country:manga.country,
      sourceId:title.sourceId,sourceTitleId:title.id,sourceTitle:title.title,chapter,status:'queued',done:0,total:0,error:null,sizeBytes:0,
      ...claim,filePrefix:`manga:${key}:${claim.webGeneration}`,updatedAt:Date.now()};
    update(row); queued.set(key,claim);
    return {row,previous,claim};
  });
  if (!reservation) return false;
  const {row,previous,claim}=reservation;
  const live=()=>downloadOwner.matches(table('mangaDownloads')[key],claim);
  const publish=()=>downloadOwner.withResource('manga',key,()=>{
    if (!live()) return false;
    row.updatedAt=Date.now(); update({...row}); return true;
  });
  work=work.then(async()=>{
    const controller=new AbortController();
    controllers.set(key,controller);
    let output:LocalWriter|undefined,stem='',delivered=false;
    try {
      if (!live()) return;
      if(localFileDownloads()){
        const target=await titleWriter(manga.title,`Chapter ${String(chapter.number).padStart(4,'0')}`);output=target.writer;stem=target.stem;row.webFileOutput=true;
      }
      if (previous) {if(output)await erase(previous).catch(()=>{});else await erase(previous);}
      row.status='downloading';
      if (!await publish()) return;
      const pages=await request('manga','pages',title,chapter.id);
      if (!pages.length) throw new Error('This chapter has no pages to download.');
      row.total=pages.length;
      if (!await publish()) return;
      const saved: any[]=[];
      for (let index=0;index<pages.length;index++) {
        if (!live()) throw new Error('Download cancelled.');
        const response=await fetch(pages[index].url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
        if (!response.ok) {
          let message='A page could not be downloaded.';
          try {const body=await response.json() as {error?:string};if(body.error)message=body.error.slice(0,600);}catch{}
          throw new Error(message);
        }
        const blob=await response.blob();
        if (!blob.type.startsWith('image/')||blob.size>20*1024*1024||!blob.size) throw new Error('The source returned an invalid page.');
        if(output)await output.write(`${stem}_files/${String(index+1).padStart(4,'0')}.${imageExtension(blob)}`,blob);
        else await saveFile(`${row.filePrefix}:${index}`,blob);
        if (!live()) throw new Error('Download cancelled.');
        saved.push({width:pages[index].width,height:pages[index].height});
        row.done++; row.sizeBytes+=blob.size;
        if (!await publish()) throw new Error('Download cancelled.');
      }
      if(output){row.webFiles=await output.finish();delivered=true;}
      else await saveFile(`${row.filePrefix}:index`,saved);
      row.status='done';
      if (!await publish()) throw new Error('Download cancelled.');
    } catch(error) {
      row.status='failed'; row.error=error instanceof Error?error.message:'Chapter download failed.';
      await publish();
    } finally {
      if(output&&!delivered)await output.abort();
      if (controllers.get(key)===controller) controllers.delete(key);
      if (queued.get(key)===claim) queued.delete(key);
      if (!live()) await erase(row);
    }
  }).catch(()=>{if(queued.get(key)===claim)queued.delete(key);});
  return true;
}

export async function offlineMangaPages(mangaId: number|undefined,chapterId: string): Promise<any[]|null> {
  const key=`${mangaId}:${chapterId}`,row=table('mangaDownloads')[key];
  if(row?.webFileOutput||row?.webFiles)return null;
  if (row&&row.status!=='done') return null;
  const filePrefix=row?prefix(row):`manga:${key}`;
  const index=await loadFile<any[]>(`${filePrefix}:index`);
  if (!index) return null;
  const pages=[];
  for (let page=0;page<index.length;page++) {
    const blob=await loadFile<Blob>(`${filePrefix}:${page}`);
    if (!blob) {for(const loaded of pages)URL.revokeObjectURL(loaded.url);throw new Error('The saved chapter is incomplete. Download it again.');}
    pages.push({...index[page],url:URL.createObjectURL(blob)});
  }
  return pages;
}

export async function removeMangaDownload(key: string) {
  const row=await downloadOwner.withResource('manga',key,()=>{
    const previous=table('mangaDownloads')[key];
    write('mangaDownloads',key,undefined);emit('manga:download',{removed:[key]});
    return previous;
  });
  controllers.get(key)?.abort();
  if (row) await erase(row);
}

export async function exportMangaFiles(key:string):Promise<SavedFiles>{
  const row=table('mangaDownloads')[key];if(!row||row.status!=='done')throw new Error('This chapter is not completely saved.');
  if(row.webFiles)return row.webFiles;
  if(!await prepareFileDownload())throw new Error('Folder selection was cancelled.');
  const index=await loadFile<any[]>(`${prefix(row)}:index`);if(!index?.length)throw new Error('The saved chapter is incomplete.');
  const {writer,stem}=await titleWriter(row.mangaTitle,`Chapter ${String(row.chapter.number).padStart(4,'0')}`);
  try{for(let page=0;page<index.length;page++){
    const blob=await loadFile<Blob>(`${prefix(row)}:${page}`);if(!blob||!blob.size||!blob.type.startsWith('image/'))throw new Error('A saved page is missing.');
    await writer.write(`${stem}_files/${String(page+1).padStart(4,'0')}.${imageExtension(blob)}`,blob);
  }return await writer.finish();}catch(error){await writer.abort();throw error;}
}

export async function cancelMangaDownloads(mangaId: number) {
  let cancelled=0;
  for (const snapshot of values('mangaDownloads').filter(row=>row.mangaId===mangaId)) {
    await downloadOwner.withResource('manga',snapshot.key,()=>{
      const row=table('mangaDownloads')[snapshot.key];
      if (!row||!['queued','downloading'].includes(row.status)) return;
      update({...row,webGeneration:downloadOwner.claim().webGeneration,status:'failed',error:'Download cancelled.',updatedAt:Date.now()});
      cancelled++;
      controllers.get(row.key)?.abort();
    });
  }
  return cancelled;
}
