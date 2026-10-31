interface CacheOptions {now?:()=>number;ttlMs?:number;maxEntries?:number;maxBytes?:number;maxEntryBytes?:number}
interface Entry {expires:number;bytes:number;value:Buffer}
interface Pending {bytes:number;value:Promise<any>}
const bounded=(value:number|undefined,fallback:number)=>{const result=value??fallback;if(!Number.isSafeInteger(result)||result<1||result>fallback)throw Error('Invalid public catalogue cache bound.');return result;};
const failed=(value:any)=>value instanceof Error||!!value&&typeof value==='object'&&(Object.hasOwn(value,'error')||Object.hasOwn(value,'errors'));

/** Public metadata only. Authenticated/account operations must not use this cache. */
export class PublicCatalogueCache {
  private entries=new Map<string,Entry>();
  private pending=new Map<string,Pending>();
  private bytes=0;
  private pendingBytes=0;
  private readonly now:()=>number;
  private readonly ttl:number;
  private readonly maxEntries:number;
  private readonly maxBytes:number;
  private readonly maxEntry:number;
  constructor(options:CacheOptions={}){
    this.now=options.now??Date.now;this.ttl=bounded(options.ttlMs,120000);
    this.maxEntries=bounded(options.maxEntries,32);this.maxBytes=bounded(options.maxBytes,8*1024*1024);this.maxEntry=Math.min(bounded(options.maxEntryBytes,2*1024*1024),this.maxBytes);
  }
  private remove(key:string){const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}}
  private prune(){const now=this.now();for(const [key,value]of this.entries)if(value.expires<=now)this.remove(key);}
  private room(extra:number){while(this.entries.size&&(this.entries.size>=this.maxEntries||this.bytes+this.pendingBytes+extra>this.maxBytes))this.remove(this.entries.keys().next().value!);return this.bytes+this.pendingBytes+extra<=this.maxBytes;}
  async get(query:string,variables:unknown,load:()=>Promise<any>):Promise<any>{
    let key:string;try{key=JSON.stringify({query,variables},(_name,value)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return value;
      const sorted=Object.create(null);for(const name of Object.keys(value).sort())Object.defineProperty(sorted,name,{value:value[name],enumerable:true});return sorted;
    });}catch{return load();}
    // Count the retained key conservatively as UTF-16; values are byte buffers,
    // not retained object graphs, and callers receive independent parsed copies.
    const keyBytes=key.length*2;
    if(keyBytes>this.maxEntry)return load();
    this.prune();
    const old=this.entries.get(key);
    if(old){this.entries.delete(key);this.entries.set(key,old);return JSON.parse(old.value.toString('utf8'));}
    const waiting=this.pending.get(key);if(waiting)return this.copy(await waiting.value);
    if(this.pending.size>=this.maxEntries||!this.room(keyBytes))return load();
    this.pendingBytes+=keyBytes;
    let charged=true;
    const clearPending=()=>{if(!charged)return;charged=false;this.pendingBytes-=keyBytes;this.pending.delete(key);};
    const operation=Promise.resolve().then(load).then(value=>{
      clearPending();
      if(failed(value))return {value};
      let serialized:string|undefined;try{serialized=JSON.stringify(value);}catch{return {value};}
      if(serialized===undefined)return {value};
      const buffer=Buffer.from(serialized),size=keyBytes+buffer.byteLength;
      if(size<=this.maxEntry){
        if(this.room(size)){this.entries.set(key,{value:buffer,bytes:size,expires:this.now()+this.ttl});this.bytes+=size;}
      }
      return {value,buffer};
    }).finally(clearPending);
    this.pending.set(key,{bytes:keyBytes,value:operation});
    return this.copy(await operation);
  }
  private copy(result:{value:any;buffer?:Buffer}){return result.buffer?JSON.parse(result.buffer.toString('utf8')):result.value;}
}
const publicCache=new PublicCatalogueCache();
export function publicCatalogue(query:string,variables:unknown,load:()=>Promise<any>):Promise<any>{return publicCache.get(query,variables,load);}
