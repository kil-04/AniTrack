import {table,values,write,writeBatch,emit,request,saveFile,loadFile,deleteFile} from './browser-storage';
import {downloadOwner,type DownloadClaim} from './download-ownership';
import {localFileDownloads,prepareFileDownload,titleWriter,safeFileName,type LocalWriter,type SavedFiles} from './local-files';

const titleKey=(source: string,id: string)=>`${source}:${id}`;
type Task={key:string;titleKey:string;detail:any;chapter:any;claim:DownloadClaim;file:string;localFiles:boolean};
type LocalTitle={claim:DownloadClaim;failures:number};
const tasks=new Map<string,Task>(),titles=new Map<string,LocalTitle>();
let work=Promise.resolve();
const keyFor=(row:any,id:string)=>typeof row?.[id]==='string'?row[id]:row?.[id]?.key;
const update=(row:any)=>{write('novelDownloads',titleKey(row.sourceId,row.titleId),row);emit('novel:download',row);};
const live=(task:Task)=>tasks.get(task.key)===task&&downloadOwner.matches(table('novelDownloads')[task.titleKey],task.claim);
const idsFor=(key:string,claim:DownloadClaim)=>[...tasks.values()].filter(task=>task.titleKey===key&&task.claim.webGeneration===claim.webGeneration).map(task=>task.chapter.id);

export async function recoverNovelDownloads() {
  if (!downloadOwner.supported) return;
  for (const snapshot of values('novelDownloads')) {
    const key=titleKey(snapshot.sourceId,snapshot.titleId);
    await downloadOwner.withResource('novel',key,async()=>{
      const row=table('novelDownloads')[key];
      if (!row) return;
      const saved=new Set<string>(table('novelSaved')[key]??[]);
      const pending=[...new Set<string>([...(row.queuedIds??[]),...(row.currentId?[row.currentId]:[])])].filter(id=>!saved.has(id));
      const active=!!(row.queued||row.currentId||row.current||pending.length);
      // Old tabs cannot prove ownership. Preserve their queue and progress
      // until the user explicitly removes it, regardless of timestamp age.
      if (active&&!row.webOwner) return;
      if (active&&row.webOwner&&await downloadOwner.isLive(row.webOwner)) return;
      const failed=[...new Set<string>([...(row.failedIds??[]),...pending])].filter(id=>!saved.has(id));
      if (active||row.failed!==failed.length||row.saved!==saved.size) update({...row,saved:saved.size,queued:0,queuedIds:[],current:null,currentId:null,
        failed:failed.length,failedIds:failed,updatedAt:Date.now(),error:pending.length?'The tab closed before these chapters finished. Retry to complete them.':row.error});
    });
  }
}

async function processTask(task:Task) {
  if (!live(task)) return;
  const mutate=async(change:(row:any)=>void)=>downloadOwner.withResource('novel',task.titleKey,()=>{
    if (!live(task)) return false;
    const row={...table('novelDownloads')[task.titleKey]};
    change(row);row.updatedAt=Date.now();update(row);return true;
  });
  let committed=false;
  let output:LocalWriter|undefined,receipt:SavedFiles|undefined,delivered=false;
  try {
    if (!await mutate(row=>{row.current=task.chapter.label;row.currentId=task.chapter.id;})) return;
    const text=await request('novel','chapter',task.detail.sourceId,task.detail.id,task.chapter.id);
    if (!live(task)) return;
    if(task.localFiles){
      const target=await titleWriter(task.detail.title,`${String(task.chapter.order+1).padStart(4,'0')} - ${safeFileName(task.chapter.label)}`);output=target.writer;
      await output.write(`${target.stem}.txt`,[task.detail.title,text.label??task.chapter.label,'',...(text.paragraphs??[])].join('\n\n'));
      if(!live(task))return;
      receipt=await output.finish();delivered=true;
    }else await saveFile(task.file,text);
    committed=await downloadOwner.withResource('novel',task.titleKey,()=>{
      if (!live(task)) return false;
      const map={...table('novelFiles')[task.titleKey]};
      const held=new Set<string>(table('novelSaved')[task.titleKey]??[]);
      const bytes=receipt?.bytes??new TextEncoder().encode(JSON.stringify(text)).length;
      map[task.chapter.id]=receipt?{localFiles:receipt,bytes}:{key:task.file,bytes};held.add(task.chapter.id);
      const row={...table('novelDownloads')[task.titleKey],saved:held.size,sizeBytes:(table('novelDownloads')[task.titleKey].sizeBytes??0)+bytes,updatedAt:Date.now()};
      row.failedIds=(row.failedIds??[]).filter((id:string)=>id!==task.chapter.id);row.failed=row.failedIds.length;
      if(receipt){row.webFiles=receipt;row.webSavedFiles=Object.values(map).filter((entry:any)=>entry.localFiles).length;}
      writeBatch([{name:'novelFiles',id:task.titleKey,value:map},{name:'novelSaved',id:task.titleKey,value:[...held]},{name:'novelDownloads',id:task.titleKey,value:row}]);
      emit('novel:download',row);
      const local=titles.get(task.titleKey);if(local?.claim.webGeneration===task.claim.webGeneration)local.failures=0;
      return true;
    });
  } catch(error) {
    await mutate(row=>{
      row.failedIds=[...new Set([...(row.failedIds??[]),task.chapter.id])];row.failed=row.failedIds.length;
      row.error=error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:'Chapter download failed.';
      const local=titles.get(task.titleKey);
      if (local?.claim.webGeneration===task.claim.webGeneration) local.failures++;
      if ((local?.failures??0)>=3||/(?:answered|HTTP) (?:403|429)\b|verification|human browser/i.test(row.error)) {
        row.failedIds=[...new Set([...row.failedIds,...idsFor(task.titleKey,task.claim)])];row.failed=row.failedIds.length;
        for (const [key,pending] of tasks) if(pending.titleKey===task.titleKey&&pending.claim.webGeneration===task.claim.webGeneration)tasks.delete(key);
        row.queuedIds=[];row.queued=0;row.error+=' Downloading stopped; try again later.';
      }
    });
  } finally {
    if(output&&!delivered)await output.abort();
    if (tasks.get(task.key)===task)tasks.delete(task.key);
    if (!task.localFiles&&!committed&&keyFor(table('novelFiles')[task.titleKey],task.chapter.id)!==task.file)await deleteFile(task.file);
    await downloadOwner.withResource('novel',task.titleKey,()=>{
      const row=table('novelDownloads')[task.titleKey];
      if (!downloadOwner.matches(row,task.claim))return;
      const queuedIds=idsFor(task.titleKey,task.claim);
      update({...row,queuedIds,queued:queuedIds.length,current:null,currentId:null,updatedAt:Date.now()});
      if (!queuedIds.length&&titles.get(task.titleKey)?.claim.webGeneration===task.claim.webGeneration)titles.delete(task.titleKey);
    });
  }
}

export async function queueNovelDownloads(detail:any,chapters:any[]):Promise<number> {
  if(!await prepareFileDownload())return 0;
  await downloadOwner.ensure();
  const key=titleKey(detail.sourceId,detail.id);
  return downloadOwner.withResource('novel',key,async()=>{
    const previous=table('novelDownloads')[key];
    const legacyPending=previous&&!previous.webOwner&&(previous.queued||previous.currentId||previous.current||previous.queuedIds?.length);
    if (legacyPending||(previous&&(previous.queued||previous.currentId)&&previous.webOwner!==downloadOwner.id&&await downloadOwner.isLive(previous.webOwner))) {
      const held=new Set([...(table('novelSaved')[key]??[]),...(previous.queuedIds??[]),...(previous.currentId?[previous.currentId]:[])]);
      if(chapters.some(chapter=>!held.has(chapter.id)))throw new Error(legacyPending?'This title may still be downloading in an older tab. If that tab is closed, remove its download entry and queue it again.':'This title is downloading in another tab. Add chapters there or wait for it to finish.');
      return 0;
    }
    let local=titles.get(key);
    if (!local||!downloadOwner.matches(previous,local.claim)) {local={claim:downloadOwner.claim(),failures:0};titles.set(key,local);}
    const saved=new Set<string>(table('novelSaved')[key]??[]);
    const selected=[...new Map<string,any>(chapters.map(chapter=>[chapter.id,chapter])).values()].sort((a,b)=>a.order-b.order);
    const added=selected.filter(chapter=>!saved.has(chapter.id)&&!tasks.has(`${key}:${chapter.id}`));
    if (!added.length)return 0;
    const failedIds=[...new Set<string>([...(previous?.failedIds??[]),...((previous?.webGeneration!==local.claim.webGeneration)?[...(previous?.queuedIds??[]),...(previous?.currentId?[previous.currentId]:[])]:[])])].filter(id=>!saved.has(id)&&!added.some(chapter=>chapter.id===id));
    const claim=local.claim;
    const newTasks=added.map(chapter=>({key:`${key}:${chapter.id}`,titleKey:key,detail,chapter,claim,file:`novel:${key}:${claim.webGeneration}:${chapter.id}`,localFiles:localFileDownloads()}));
    for (const task of newTasks)tasks.set(task.key,task);
    const queuedIds=idsFor(key,claim);
    try {update({...previous,sourceId:detail.sourceId,titleId:detail.id,title:detail.title,cover:detail.cover,...claim,
      saved:saved.size,queued:queuedIds.length,queuedIds,failed:failedIds.length,failedIds,current:previous?.webGeneration===claim.webGeneration?previous.current:null,
      currentId:previous?.webGeneration===claim.webGeneration?previous.currentId:null,sizeBytes:previous?.sizeBytes??0,error:null,updatedAt:Date.now()});}
    catch(error){for(const task of newTasks)if(tasks.get(task.key)===task)tasks.delete(task.key);throw error;}
    local.failures=0;
    for (const task of newTasks)work=work.then(()=>processTask(task)).catch(()=>{});
    return added.length;
  });
}

export async function savedNovelChapter(source:string,id:string,chapter:string) {
  const key=titleKey(source,id),map=table('novelFiles')[key];
  if(map?.[chapter]?.localFiles)return null;
  const file=keyFor(map,chapter)??`novel:${key}:${chapter}`;
  const text=await loadFile(file);
  if (!text&&(table('novelSaved')[key]??[]).includes(chapter))throw new Error('The saved chapter is incomplete. Download it again.');
  return text;
}

/** Export older browser saves without contacting the reading source. */
export async function exportNovelFiles(source:string,id:string):Promise<SavedFiles>{
  if(!await prepareFileDownload())throw new Error('Folder selection was cancelled.');
  const key=titleKey(source,id),row=table('novelDownloads')[key];
  if(!row)throw new Error('These saved chapters could not be found.');
  const chapters:any[]=await loadFile(`novel-chapters:${key}`)??[];
  const held:string[]=table('novelSaved')[key]??[];
  const ordered=held.filter(chapter=>!table('novelFiles')[key]?.[chapter]?.localFiles).map(chapter=>({id:chapter,meta:chapters.find(item=>item.id===chapter)})).sort((a,b)=>(a.meta?.order??held.indexOf(a.id))-(b.meta?.order??held.indexOf(b.id)));
  if(!ordered.length)throw new Error('These chapters are already saved as local files.');
  const target=await titleWriter(row.title,'Saved chapters');
  try{
    for(let index=0;index<ordered.length;index++){
      const item=ordered[index],text=await savedNovelChapter(source,id,item.id);
      if(!text)throw new Error('A saved chapter is incomplete. Download it again.');
      const label=item.meta?.label??text.label??`Chapter ${index+1}`;
      const number=String((item.meta?.order??index)+1).padStart(4,'0');
      await target.writer.write(`${target.stem}_files/${safeFileName(`${number} - ${label}.txt`)}`,[row.title,label,'',...(text.paragraphs??[])].join('\n\n'));
    }
    return await target.writer.finish();
  }catch(error){await target.writer.abort();throw error;}
}

function cancelLocal(key:string) {
  for(const [id,task] of tasks)if(task.titleKey===key)tasks.delete(id);
  titles.delete(key);
}
export async function cancelNovelDownloads(source:string,id:string) {
  const key=titleKey(source,id);
  await downloadOwner.withResource('novel',key,()=>{
    const row=table('novelDownloads')[key];if(!row){cancelLocal(key);return;}
    const held=new Set<string>(table('novelSaved')[key]??[]);
    const failedIds=[...new Set<string>([...(row.failedIds??[]),...(row.queuedIds??[]),...(row.currentId?[row.currentId]:[])])].filter(chapter=>!held.has(chapter));
    const next={...row,webGeneration:downloadOwner.claim().webGeneration,queued:0,queuedIds:[],current:null,currentId:null,failedIds,failed:failedIds.length,error:'Download cancelled.',updatedAt:Date.now()};
    write('novelDownloads',key,next);cancelLocal(key);emit('novel:download',next);
  });
}

export async function removeNovelDownloads(source:string,id:string,ids?:string[]) {
  const key=titleKey(source,id),legacySizes=new Map<string,number>();
  for(const chapter of ids??table('novelSaved')[key]??[]) {
    const file=keyFor(table('novelFiles')[key],chapter)??`novel:${key}:${chapter}`;
    const text=await loadFile(file);if(text)legacySizes.set(file,new TextEncoder().encode(JSON.stringify(text)).length);
  }
  const erase=await downloadOwner.withResource('novel',key,()=>{
    const held:string[]=table('novelSaved')[key]??[],remove=ids??held;
    const map={...table('novelFiles')[key]},files:string[]=[];
    let removedBytes=0;
    for(const chapter of remove){const file=keyFor(map,chapter)??`novel:${key}:${chapter}`;removedBytes+=map[chapter]?.bytes??legacySizes.get(file)??0;files.push(file);delete map[chapter];}
    const remaining=held.filter(chapter=>!remove.includes(chapter));
    const row=table('novelDownloads')[key];
    let next:any;
    if (row&&remaining.length) {const failedIds=[...new Set<string>([...(row.failedIds??[]),...(row.queuedIds??[]),...(row.currentId?[row.currentId]:[])])].filter(chapter=>!remove.includes(chapter)&&!remaining.includes(chapter));next={...row,webGeneration:downloadOwner.claim().webGeneration,saved:remaining.length,webSavedFiles:Object.values(map).filter((entry:any)=>entry.localFiles).length,webFiles:(Object.values(map).find((entry:any)=>entry.localFiles) as any)?.localFiles,queued:0,queuedIds:[],current:null,currentId:null,failedIds,failed:failedIds.length,sizeBytes:Math.max(0,(row.sizeBytes??0)-removedBytes),updatedAt:Date.now()};}
    writeBatch([{name:'novelFiles',id:key,value:map},{name:'novelSaved',id:key,value:remaining},{name:'novelDownloads',id:key,value:next}]);
    cancelLocal(key);
    return {files,next};
  });
  for(const file of erase.files)await deleteFile(file);
  if(erase.next)emit('novel:download',erase.next);else emit('novel:download',{removed:key});
}
