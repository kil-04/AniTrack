import { entryForMal } from '../source/packages/shared/watch-progress';
import type { WatchedEntry } from '../source/packages/shared/watch-progress';

export function protectMalProgress(local:WatchedEntry,remote:{status:WatchedEntry['status'];num_episodes_watched:number}|null){
  return entryForMal(local,remote?{status:remote.status,episodesWatched:remote.num_episodes_watched}:null);
}
export function protectAniListProgress<T extends {status:string;progress:number}>(local:T,remote:{status:string;progress:number}|null):T{
  const status=local.status==='CURRENT'&&(remote?.status==='COMPLETED'||remote?.status==='REPEATING')?remote.status:local.status;
  return{...local,status,progress:Math.max(local.progress,remote?.progress??0)};
}
