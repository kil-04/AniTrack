import {table,values,write,requestWithSignal,saveFile,loadFile,deleteFile} from './browser-storage';
import {downloadOwner,type DownloadClaim} from './download-ownership';
import {assertDownloadPayload} from './media-payload';
import {localFileDownloads,prepareFileDownload,titleWriter,safeFileName,type LocalWriter,type SavedFiles} from './local-files';

const controllers=new Map<string,AbortController>();
let work=Promise.resolve();
const fileKey=(row:any)=>row.filePrefix??`city:${row.key}`;
const validText=(value:string)=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\r\n\0]/.test(value);
export async function recoverArchiveDownloads() {
  if(!downloadOwner.supported)return;
  for(const snapshot of values('cityDownloads'))await downloadOwner.withResource('archive',snapshot.key,async()=>{
    const row=table('cityDownloads')[snapshot.key];
    if(!row?.webOwner||!['queued','downloading'].includes(row.status))return;
    if(row.webOwner===downloadOwner.id ? controllers.has(row.key) : row.webOwner&&await downloadOwner.isLive(row.webOwner))return;
    write('cityDownloads',row.key,{...row,status:'error',error:'The tab closed before this file finished. Retry the download.'});
  });
}

export async function downloadArchiveFile(itemId:string,fileName:string) {
  if(!await prepareFileDownload())return {key:''};
  if(!validText(itemId)||!validText(fileName))throw new Error('Choose an Archive file.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${itemId}\n${fileName}`));
  const key=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  await downloadOwner.ensure();
  const reservation=await downloadOwner.withResource('archive',key,async()=>{
    const previous=table('cityDownloads')[key];
    if(previous?.status==='completed')return null;
    if(previous&&!previous.webOwner&&['queued','downloading'].includes(previous.status))return null;
    if(previous&&['queued','downloading'].includes(previous.status)&&
      (previous.webOwner===downloadOwner.id ? controllers.has(key)&&!controllers.get(key)!.signal.aborted : await downloadOwner.isLive(previous.webOwner)))return null;
    const claim=downloadOwner.claim();
    const row={key,itemId,fileName,title:fileName,artist:'',mediaType:'audio',status:'queued',bytes:0,totalBytes:null as number|null,error:null as string|null,
      ...claim,filePrefix:`city:${key}:${claim.webGeneration}`,updatedAt:Date.now(),webFileOutput:localFileDownloads(),webFiles:undefined as SavedFiles|undefined};
    const controller=new AbortController();
    write('cityDownloads',key,row);controllers.set(key,controller);return {claim,row,previous,controller};
  });
  if(!reservation)return {key};
  const {claim,row,previous,controller}=reservation;
  const live=()=>!controller.signal.aborted&&downloadOwner.matches(table('cityDownloads')[key],claim);
  const current=()=>{if(!live()){controller.abort();throw new Error('Download cancelled.');}};
  const publish=()=>downloadOwner.withResource('archive',key,()=>{current();row.updatedAt=Date.now();write('cityDownloads',key,{...row});});
  work=work.then(async()=>{
    let saved=false;
    let output:LocalWriter|undefined,delivered=false,stem='';
    try{
      current();
      if(previous&&!previous.webFileOutput&&!previous.webFiles)await deleteFile(fileKey(previous));
      const files=await requestWithSignal(controller.signal,'archive.item',itemId);current();
      const file=files.find((candidate:any)=>candidate.fileName===fileName);
      if(!file)throw new Error('This file is no longer available.');
      if(row.webFileOutput){const target=await titleWriter(itemId,safeFileName(file.fileName.split('/').at(-1)!.replace(/\.[^.]+$/,'')));output=target.writer;stem=target.stem;}
      if(file.size!=null&&file.size>2*1024**3)throw new Error('This file is larger than the 2GB download limit.');
      row.title=file.title;row.artist=file.artist;row.mediaType=file.mediaType;row.totalBytes=file.size;row.status='downloading';await publish();
      const headerTimer=setTimeout(()=>controller.abort(new DOMException('No media response arrived.','TimeoutError')),30000);
      let response:Response;
      try{response=await fetch(`/api/archive?item=${encodeURIComponent(itemId)}&file=${encodeURIComponent(fileName)}`,{signal:controller.signal});}
      finally{clearTimeout(headerTimer);}
      if(!response.ok)throw new Error('Internet Archive could not deliver the download.');
      const reader=response.body?.getReader();if(!reader)throw new Error('The download was empty.');
      const chunks:Uint8Array[]=[];let last=0;
      try{
        for(;;){
          let timer:ReturnType<typeof setTimeout>|undefined;
          const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{const error=new DOMException('No media bytes arrived.','TimeoutError');controller.abort(error);reject(error);},30000);});
          const part=await Promise.race([reader.read(),timeout]).finally(()=>{if(timer!==undefined)clearTimeout(timer);});
          current();if(part.done)break;
          row.bytes+=part.value.byteLength;
          if(row.bytes>2*1024**3)throw new Error('This file exceeds the 2GB download limit.');
          chunks.push(part.value);
          if(Date.now()-last>500){await publish();last=Date.now();}
        }
      }finally{await reader.cancel().catch(()=>{});}
      if(!row.bytes||(file.size!=null&&row.bytes!==file.size))throw new Error('This download is incomplete. Please retry.');
      const blob=new Blob(chunks as BlobPart[],{type:response.headers.get('content-type')||'application/octet-stream'});
      await assertDownloadPayload(blob,'media');current();
      if(output){const extension=safeFileName(file.fileName.split('.').at(-1)??'media');await output.write(`${stem}.${extension}`,blob);current();row.webFiles=await output.finish();delivered=true;}
      else await saveFile(row.filePrefix,blob);
      current();
      row.status='completed';await publish();saved=true;
    }catch(error){
      await downloadOwner.withResource('archive',key,()=>{
        if(!downloadOwner.matches(table('cityDownloads')[key],claim))return;
        row.status='error';row.error=error instanceof Error&&error.name==='TimeoutError'?'The download stopped receiving data. Retry when the connection is stable.':error instanceof Error?error.message:'Download failed.';
        write('cityDownloads',key,{...row,updatedAt:Date.now()});
      });
    }finally{
      if(output&&!delivered)await output.abort();
      if(!output&&!saved)await deleteFile(row.filePrefix);
      if(controllers.get(key)===controller)controllers.delete(key);
    }
  }).catch(()=>{});
  return {key};
}

export async function cancelArchiveDownload(key:string) {
  await downloadOwner.withResource('archive',key,()=>{
    const row=table('cityDownloads')[key];if(!row||row.status==='completed')return;
    write('cityDownloads',key,{...row,webGeneration:downloadOwner.claim().webGeneration,status:'error',error:'Download cancelled.',updatedAt:Date.now()});
    controllers.get(key)?.abort();
  });
}
export async function removeArchiveDownload(key:string) {
  const row=await downloadOwner.withResource('archive',key,()=>{const row=table('cityDownloads')[key];write('cityDownloads',key,undefined);controllers.get(key)?.abort();return row;});
  if(row&&!row.webFileOutput&&!row.webFiles)await deleteFile(fileKey(row));
}
export async function loadSavedArchiveBlob(key:string):Promise<Blob|null> {
  const row=table('cityDownloads')[key];if(!row||row.status!=='completed')return null;
  if(row.webFileOutput||row.webFiles)return null;
  const blob=await loadFile<Blob>(fileKey(row));
  if(!blob)throw new Error('The saved file is incomplete. Download it again.');
  return blob;
}

export async function exportArchiveFile(key:string):Promise<SavedFiles>{
  if(!await prepareFileDownload())throw new Error('Folder selection was cancelled.');
  const row=table('cityDownloads')[key],blob=await loadSavedArchiveBlob(key);
  if(!row||!blob)throw new Error('This recording is already saved as a local file or could not be found.');
  const name=safeFileName(row.fileName.split('/').at(-1)!),dot=name.lastIndexOf('.');
  const target=await titleWriter(row.itemId,dot>0?name.slice(0,dot):name);
  try{await target.writer.write(target.stem+(dot>0?name.slice(dot):'.bin'),blob);return await target.writer.finish();}
  catch(error){await target.writer.abort();throw error;}
}
