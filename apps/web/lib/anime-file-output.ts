import {titleWriter,relativeFile,type LocalWriter,type SavedFiles} from './local-files';

export const episodeName=(episode:number)=>`Episode ${String(episode).padStart(3,'0')}`;
export async function mediaExtension(blob:Blob,kind:'media'|'key'='media'):Promise<string>{
  if(kind==='key')return 'key';
  const type=blob.type.toLowerCase();
  if(type.includes('mpegurl'))return 'm3u8';
  if(type.includes('vtt'))return 'vtt';
  if(type.includes('mp2t'))return 'ts';
  if(type.includes('webm'))return 'webm';
  if(type.includes('mpeg')&&type.startsWith('audio/'))return 'mp3';
  if(type.includes('mp4'))return type.startsWith('audio/')?'m4a':'mp4';
  const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());
  if(bytes[0]===0x47)return 'ts';
  const marker=new TextDecoder().decode(bytes.slice(4,8));
  if(marker==='ftyp')return 'mp4';
  if(marker==='moof'||marker==='styp')return 'm4s';
  if(new TextDecoder().decode(bytes).startsWith('WEBVTT'))return 'vtt';
  return 'bin';
}
export class AnimeFileOutput {
  private names=new Map<number,string>();
  private sizes=new Map<number,number>();
  constructor(readonly writer:LocalWriter,readonly stem:string,readonly root=0){}
  async blob(index:number,blob:Blob,kind:'media'|'key'='media'){
    const extension=await mediaExtension(blob,kind);
    const path=index===this.root?`${this.stem}.${extension}`:`${this.stem}_files/${String(index).padStart(5,'0')}.${extension}`;
    this.names.set(index,path);this.sizes.set(index,blob.size);await this.writer.write(path,blob);
  }
  async playlist(index:number,text:string){
    const path=index===this.root?`${this.stem}.m3u8`:`${this.stem}_files/playlist-${String(index).padStart(5,'0')}.m3u8`;
    this.names.set(index,path);
    const local=text.replace(/anitrack-file:(\d+)/g,(_match,id:string)=>{
      const target=this.names.get(Number(id));if(!target)throw new Error('A playlist resource was not saved.');
      return relativeFile(path,target).split('/').map(part=>part==='..'?part:encodeURIComponent(part)).join('/');
    });
    if(/https?:\/\/|\/api\/media\?/.test(local))throw new Error('A saved playlist still points to online media.');
    await this.writer.write(path,local);
  }
  check(index:number,kind:'media'|'key'){
    if(!this.names.has(index)||kind==='key'&&this.sizes.get(index)!==16)throw new Error('The source returned an invalid saved media resource.');
  }
  subtitle(blob:Blob){return this.writer.write(`${this.stem}.vtt`,blob);}
  finish():Promise<SavedFiles>{return this.writer.finish();}
  abort(){return this.writer.abort();}
}
export async function animeFileOutput(title:string,episode:number){const {writer,stem}=await titleWriter(title,episodeName(episode));return new AnimeFileOutput(writer,stem);}
