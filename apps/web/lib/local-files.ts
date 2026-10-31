import {Zip,ZipPassThrough} from 'fflate';
import {loadFile,saveFile} from './browser-storage';

export interface SavedFiles {kind:'folder'|'zip';name:string;files:number;bytes:number}
export interface LocalWriter {
  readonly kind?:'folder'|'zip';
  write(path:string,data:Blob|string):Promise<void>;
  finish():Promise<SavedFiles>;
  abort():Promise<void>;
}
interface Directory {
  name:string;
  getDirectoryHandle(name:string,options?:{create?:boolean}):Promise<Directory>;
  getFileHandle(name:string,options?:{create?:boolean}):Promise<{createWritable():Promise<{write(data:Blob|string):Promise<void>;close():Promise<void>;abort?():Promise<void>}>}>;
  removeEntry(name:string,options?:{recursive?:boolean}):Promise<void>;
  queryPermission?(options:{mode:'readwrite'}):Promise<string>;
}
let selected:Directory|undefined;
let enabled=false;
let choosing:Promise<boolean>|undefined;
export const localFileDownloads=()=>enabled;
export async function enableLocalFileDownloads(){enabled=true;try{const saved=await loadFile<Directory>('local-download-directory');if(saved&&await saved.queryPermission?.({mode:'readwrite'})==='granted')selected=saved;}catch{}}
const listeners=new Set<()=>void>();
export const fileDestination=()=>({folder:!!selected,name:selected?.name??'Browser downloads (ZIP)'});
export const subscribeFileDestination=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const folderSavingAvailable=()=>typeof window!=='undefined'&&typeof (window as any).showDirectoryPicker==='function';
export async function chooseDownloadFolder():Promise<boolean>{
  if(!folderSavingAvailable())throw new Error('This browser saves a ZIP instead. Extract it to keep the title folder and episodes.');
  try{selected=await (window as any).showDirectoryPicker({id:'anitrack-downloads',mode:'readwrite'});try{await saveFile('local-download-directory',selected);}catch{}listeners.forEach(listener=>listener());return true;}
  catch(error){if((error as any)?.name==='AbortError')return false;throw new Error('The folder could not be opened for downloads. Choose another folder.');}
}
/** Called immediately by a user's download action, before source resolution. */
export function prepareFileDownload():Promise<boolean>{
  if(!enabled||selected||!folderSavingAvailable())return Promise.resolve(true);
  if(choosing)return choosing;
  choosing=chooseDownloadFolder().finally(()=>{choosing=undefined;});return choosing;
}
export function safeFileName(value:string):string{
  let name=String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'').trim();
  if(name.length>140){const ext=name.match(/\.[a-z0-9]{1,10}$/i)?.[0]??'';name=name.slice(0,140-ext.length).replace(/[\uD800-\uDBFF]$/,'')+ext;}
  name=name.replace(/[. ]+$/,'');
  if(!name||/^\.+$/.test(name))name='Untitled';
  if(name.startsWith('.'))name='_'+name;
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
function shortName(name:string,original:string):string{
  if(name.length<=100)return name;
  let hash=2166136261;for(const char of original.normalize('NFC'))hash=Math.imul(hash^char.codePointAt(0)!,16777619);
  return name.slice(0,91).replace(/[\uD800-\uDBFF]$/,'')+'-'+(hash>>>0).toString(16).padStart(8,'0');
}
function parts(path:string):string[]{
  const entries=path.split('/');
  if(!entries.length||entries.some(name=>!name||name==='.'||name==='..'||safeFileName(name)!==name))throw new Error('Invalid download filename.');
  return entries;
}
async function exists(directory:Directory,name:string):Promise<boolean>{
  try{await directory.getFileHandle(name);return true;}catch(error){if((error as any)?.name!=='NotFoundError'&&(error as any)?.name!=='TypeMismatchError')throw error;}
  try{await directory.getDirectoryHandle(name);return true;}catch(error){if((error as any)?.name!=='NotFoundError')throw error;return false;}
}
export function downloadBlob(blob:Blob,name:string){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=safeFileName(name);link.hidden=true;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function folderWriter(directory:Directory,label:string):Promise<LocalWriter>{
  const written=new Map<string,{directory:Directory;name:string}>();let bytes=0,closed=false;
  return {
    kind:'folder',
    async write(path,data){
      if(closed)throw new Error('The download has already finished.');
      const names=parts(path);let parent=directory;
      for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name,{create:true});
      const name=names.at(-1)!;
      if(written.has(path))throw new Error('Duplicate download filename.');
      if(await exists(parent,name))throw new Error('A file with this name already exists. Choose another folder to keep both copies.');
      const handle=await parent.getFileHandle(name,{create:true});
      written.set(path,{directory:parent,name});
      const stream=await handle.createWritable();
      try{await stream.write(data);await stream.close();bytes+=typeof data==='string'?new TextEncoder().encode(data).length:data.size;}
      catch(error){await stream.abort?.().catch(()=>{});throw error;}
    },
    async finish(){closed=true;return {kind:'folder',name:label,files:written.size,bytes};},
    async abort(){if(closed)return;closed=true;for(const item of written.values())await item.directory.removeEntry(item.name).catch(()=>{});},
  };
}
export function zipWriter(title:string,name:string,deliver=downloadBlob):LocalWriter{
  const chunks:Uint8Array[]=[];let bytes=0,files=0,closed=false,problem:Error|undefined,complete!:()=>void;
  const done=new Promise<void>(resolve=>{complete=resolve;});
  const zip=new Zip((error,data,final)=>{if(error)problem=error;if(data?.length)chunks.push(data);if(final||error)complete();});
  const names=new Set<string>();
  return {
    kind:'zip',
    async write(path,data){
      if(closed)throw new Error('The download has already finished.');parts(path);
      if(names.has(path))throw new Error('Duplicate download filename.');names.add(path);
      const payload=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(await data.arrayBuffer());
      bytes+=payload.byteLength;
      if(bytes>1024**3)throw new Error('This ZIP is larger than the browser can safely prepare. Choose a download folder for large downloads.');
      const file=new ZipPassThrough(`${safeFileName(title)}/${path}`);zip.add(file);file.push(payload,true);files++;
      if(problem)throw problem;
    },
    async finish(){closed=true;zip.end();await done;if(problem)throw problem;deliver(new Blob(chunks as BlobPart[],{type:'application/zip'}),safeFileName(name)+'.zip');return {kind:'zip',name:safeFileName(name)+'.zip',files,bytes};},
    async abort(){closed=true;zip.terminate();chunks.length=0;complete();},
  };
}
/** One title folder; each episode has a stable root file and its own assets. */
export async function titleWriter(title:string,requestedStem:string):Promise<{writer:LocalWriter;stem:string}>{
  const reserve=()=>reserveTitleWriter(title,requestedStem);
  // Serialize name reservations across tabs before creating episode files.
  if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request('anitrack-local-file-reservation',{},reserve);
  return reserve();
}
async function reserveTitleWriter(title:string,requestedStem:string):Promise<{writer:LocalWriter;stem:string}>{
  const folder=shortName(safeFileName(title),title),base=shortName(safeFileName(requestedStem),requestedStem);
  if(!selected)return {writer:zipWriter(folder,`${folder} - ${base}`),stem:base};
  const directory=await selected.getDirectoryHandle(folder,{create:true});
  for(let index=1;index<=999;index++){
    const stem=index===1?base:`${base} (${index})`;
    const occupied=await Promise.all(['.mp4','.webm','.mkv','.m3u8','.vtt','.txt','.mp3','.m4a','.aac','.ogg','.opus','.wav','.flac','.bin','_files'].map(suffix=>exists(directory,stem+suffix)));
    if(occupied.some(Boolean))continue;
    // Reserving an episode assets directory also protects an unfinished attempt.
    await directory.getDirectoryHandle(stem+'_files',{create:true});
    const target=await folderWriter(directory,`${selected.name}/${folder}`);
    const cleanEmpty=()=>directory.removeEntry(stem+'_files').catch(()=>{});
    return {writer:{kind:'folder',write:target.write,finish:async()=>{const receipt=await target.finish();await cleanEmpty();return receipt;},abort:async()=>{await target.abort();await cleanEmpty();}},stem};
  }
  throw new Error('This title already contains too many copies of that episode.');
}
export function relativeFile(from:string,to:string):string{
  const source=parts(from).slice(0,-1),target=parts(to);let common=0;
  while(common<source.length&&source[common]===target[common])common++;
  return [...source.slice(common).map(()=>'..'),...target.slice(common)].join('/');
}
