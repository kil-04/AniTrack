import {unzip, type Unzipped} from 'fflate';
import {BG_MUSIC_MAX_BYTES, isMusicFile, safeTrackName} from '../source/packages/shared/bg-music';

const TYPES: Record<string,string> = {mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',oga:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',flac:'audio/flac'};
export type MusicImportLimits = {trackBytes:number; totalBytes:number; tracks:number};
const LIMITS: MusicImportLimits = {trackBytes:BG_MUSIC_MAX_BYTES,totalBytes:250*1024*1024,tracks:1000};
export type ImportedAudio = {name:string; blob:Blob};
function musicName(path: string): string {
  const base = path.replace(/\\/g,'/').split('/').at(-1) ?? '';
  const extension = base.slice(base.lastIndexOf('.')).toLowerCase();
  const stem = safeTrackName(base.slice(0,-extension.length));
  return stem.slice(0,180-extension.length)+extension;
}
export async function readMusicSelection(file: File, limits: MusicImportLimits = LIMITS): Promise<{tracks:ImportedAudio[];skipped:number}> {
  if (!/\.zip$/i.test(file.name)) {
    return isMusicFile(file.name) && file.size > 0 && file.size <= limits.trackBytes
      ? {tracks:[{name:musicName(file.name),blob:file}],skipped:0}
      : {tracks:[],skipped:1};
  }
  if (file.size > BG_MUSIC_MAX_BYTES) return {tracks:[],skipped:1};
  let total = 0, count = 0, skipped = 0;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const files = await new Promise<Unzipped>((resolve,reject) => unzip(bytes, {
      filter(entry) {
        const parts = entry.name.replace(/\\/g,'/').split('/');
        const base = parts.at(-1) ?? '';
        if (parts.includes('__MACOSX') || base.startsWith('._') || !isMusicFile(base)) return false;
        if (![0,8].includes(entry.compression) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > bytes.length || (entry.compression === 0 && entry.size !== entry.originalSize) || !Number.isSafeInteger(entry.originalSize) || entry.originalSize <= 0 || entry.originalSize > limits.trackBytes || total + entry.originalSize > limits.totalBytes || count >= limits.tracks) {skipped++;return false;}
        total += entry.originalSize; count++;
        return true;
      },
    },(error,result) => error ? reject(error) : resolve(result)));
    const tracks: ImportedAudio[] = [];
    let actual = 0;
    for (const [path,data] of Object.entries(files)) {
      actual += data.byteLength;
      if (data.byteLength > limits.trackBytes || actual > limits.totalBytes) throw Error('The archive exceeds the music import limit.');
      const name = musicName(path);
      const type = TYPES[name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
      tracks.push({name,blob:new Blob([new Uint8Array(data)],{type})});
    }
    return {tracks,skipped};
  } catch {
    return {tracks:[],skipped:Math.max(1,skipped)};
  }
}
