import {on, emit, values} from './browser-storage';

type ReadTable = (name: string) => any[];
type Publish = (channel: string, event: any) => void;
const groups = [
  {table: 'mangaDownloads', channel: 'manga:download', key: (row: any) => row.key},
  {table: 'novelDownloads', channel: 'novel:download', key: (row: any) => `${row.sourceId}:${row.titleId}`},
];

/** Translate durable changes from another tab into the reader's existing events. */
export function createReadingDownloadMirror(read: ReadTable, publish: Publish) {
  const known = new Map(groups.map(group => [group.table, new Map(read(group.table).map(row => [group.key(row), JSON.stringify(row)]))]));
  return {
    remember(channel: string, event: any) {
      const group = groups.find(item => item.channel === channel);
      if (!group) return;
      const rows = known.get(group.table)!;
      if (channel === 'manga:download') {
        for (const key of event.removed ?? []) rows.delete(key);
        if (event.item) rows.set(group.key(event.item), JSON.stringify(event.item));
      } else if (event.removed) rows.delete(event.removed);
      else rows.set(group.key(event), JSON.stringify(event));
    },
    flush(changed: string[]) {
      for (const group of groups) {
        if (changed.length && !changed.includes(group.table)) continue;
        const previous = known.get(group.table)!;
        const rows = read(group.table);
        const next = new Map(rows.map(row => [group.key(row), JSON.stringify(row)]));
        known.set(group.table, next);
        const removed = [...previous.keys()].filter(key => !next.has(key));
        if (group.channel === 'manga:download' && removed.length) publish(group.channel, {removed});
        else if (group.channel === 'novel:download') for (const key of removed) publish(group.channel, {removed: key});
        for (const row of rows) if (previous.get(group.key(row)) !== next.get(group.key(row))) {
          publish(group.channel, group.channel === 'manga:download' ? {item: row} : row);
        }
      }
    },
  };
}

let following = false;
export function followReadingDownloadsAcrossTabs() {
  if (following) return;
  following = true;
  const mirror = createReadingDownloadMirror(values, emit);
  on('manga:download', event => mirror.remember('manga:download', event));
  on('novel:download', event => mirror.remember('novel:download', event));
  const pending = new Set<string>();
  let all = false, scheduled = false;
  on('storage:changed', ({tables = []}: {tables?: string[]}) => {
    if (!tables.length) all = true;
    else for (const table of tables) pending.add(table);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const changed = all ? [] : [...pending];
      all = false; pending.clear();
      mirror.flush(changed);
    });
  });
}
