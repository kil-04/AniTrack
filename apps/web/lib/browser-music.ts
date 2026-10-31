import { values, write, saveFile, loadFile, deleteFile } from './browser-storage';
import { BG_MUSIC_BUNDLED_DEFAULT, sortTracks, trackFromFile } from '../source/packages/shared/bg-music';
import type { ApiBridge } from '../source/apps/desktop/renderer/types';
import {readMusicSelection} from './music-import';
const urls = new Map<string, string>();
export const musicUrl = (id: string) => id === BG_MUSIC_BUNDLED_DEFAULT ? '/music/default.mp3' : urls.get(id) ?? '';
async function list() { for (const track of values('music'))
    if (!urls.has(track.id)) {
        const blob = await loadFile<Blob>(`music:${track.id}`);
        if (blob)
            urls.set(track.id, URL.createObjectURL(blob));
    } return sortTracks([{ id: BG_MUSIC_BUNDLED_DEFAULT, title: 'Because I Will Protect You', number: null, bundled: true }, ...values('music')]); }
let importQueue: Promise<unknown> = Promise.resolve();
export async function importMusicFiles(files: File[]) {
    const work = importQueue.then(async () => {
        let added = 0, skipped = 0;
        for (const file of files) {
            const selection = await readMusicSelection(file);
            skipped += selection.skipped;
            for (const {name,blob} of selection.tracks) {
                const duplicate = values('music').some(track => track.sourceName?.toLowerCase() === name.toLowerCase() || String(track.id).toLowerCase().startsWith(name.toLowerCase()+':'));
                if (duplicate) {skipped++;continue;}
                const id = `file:${name}`;
                const track = trackFromFile(name);
                if (!track) {skipped++;continue;}
                try {
                    await saveFile(`music:${id}`,blob);
                    try {write('music',id,{...track,id,sourceName:name});}
                    catch (error) {await deleteFile(`music:${id}`);throw error;}
                    urls.set(id,URL.createObjectURL(blob));
                    added++;
                } catch {skipped++;}
            }
        }
        return {added,skipped,tracks:await list()};
    });
    importQueue = work.catch(() => undefined);
    return work;
}
export const browserMusic: NonNullable<ApiBridge['music']> = {
    list,
    import: async () => {
        const files = await new Promise<File[]>((resolve) => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = 'audio/*,.zip,application/zip,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac'; input.onchange = () => resolve([...(input.files ?? [])]); input.addEventListener('cancel', () => resolve([]), { once: true }); input.click(); });
        return importMusicFiles(files);
    },
    remove: async (id) => { if (id === BG_MUSIC_BUNDLED_DEFAULT)
        return list(); await deleteFile(`music:${id}`); write('music', id, undefined); const url = urls.get(id); if (url)
        URL.revokeObjectURL(url); urls.delete(id); return list(); },
    openFolder: async () => { throw new Error('Browser music is stored privately in this site’s offline storage. Use Import to choose files from your device.'); },
};
