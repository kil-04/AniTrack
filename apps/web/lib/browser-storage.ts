const KEY = 'anitrack.web.data.v1';
const RECORD = `${KEY}.record:`;
const REVISION = `${KEY}.revision`;
type Tables = Record<string, Record<string, any>>;
let state: Tables = {};
let seenLegacy: string | null | undefined;
let seenRevision: string | null | undefined;
let seenLength = -1;
let observing = false;
function refresh(force = false) {
    try {
        const legacy = localStorage.getItem(KEY);
        const revision = localStorage.getItem(REVISION);
        const length = localStorage.length;
        if (!force && legacy === seenLegacy && revision === seenRevision && length === seenLength) return;
        let next: Tables = {};
        try {
            const parsed = JSON.parse(legacy || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) next = parsed;
        } catch { }
        // Each record has its own storage key. Independent tabs can update
        // different rows without replacing one another's metadata snapshot.
        // Tombstones also hide rows left in the original saved-data format.
        for (let i = 0; i < length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(RECORD)) continue;
            try {
                const address = JSON.parse(key.slice(RECORD.length));
                const entry = JSON.parse(localStorage.getItem(key) || 'null');
                if (!Array.isArray(address) || address.length !== 2 || !address.every(part => typeof part === 'string') || !entry || typeof entry !== 'object') continue;
                const [name, id] = address;
                const rows = { ...(Object.hasOwn(next, name) ? next[name] : {}) };
                if (entry.deleted === true) delete rows[id];
                else if (Object.hasOwn(entry, 'value')) Object.defineProperty(rows, id, {value: entry.value, enumerable: true, writable: true, configurable: true});
                else continue;
                Object.defineProperty(next, name, {value: rows, enumerable: true, writable: true, configurable: true});
            } catch { }
        }
        state = next;
        seenLegacy = legacy;
        seenRevision = revision;
        seenLength = length;
    } catch { /* Reading remains usable when browser storage is unavailable. */ }
}
function observeStorage() {
    if (observing || typeof window === 'undefined' || !window.addEventListener) return;
    observing = true;
    window.addEventListener('storage', event => {
        if (event.storageArea && event.storageArea !== localStorage) return;
        if (event.key !== null && event.key !== KEY && event.key !== REVISION && !event.key.startsWith(RECORD)) return;
        refresh(true);
        if (event.key === REVISION) return;
        let tables: string[] = [];
        const changes: {table: string; id: string; removed: boolean}[] = [];
        if (event.key?.startsWith(RECORD)) {
            try {
                const address = JSON.parse(event.key.slice(RECORD.length));
                if (Array.isArray(address) && address.length === 2 && address.every(part => typeof part === 'string')) {
                    tables = [address[0]];
                    // Events may describe an intermediate batch/rollback write.
                    // Read the durable effective row, including legacy fallback.
                    const rows = Object.hasOwn(state, address[0]) ? state[address[0]] : {};
                    changes.push({table: address[0], id: address[1], removed: !Object.hasOwn(rows, address[1])});
                }
            } catch { }
        }
        const detail = {tables, changes};
        emit('storage:changed', detail);
        if (typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('anitrack:storage-changed', {detail}));
    });
}
export function initializeStorage() { refresh(true); observeStorage(); }
export const table = (name: string): Record<string, any> => { refresh(); return Object.hasOwn(state, name) ? state[name] : {}; };
export const values = (name: string): any[] => Object.values(table(name));
/** Read before waiting for a metadata lock to detect a concurrent deletion. */
export const recordVersion = (name: string, id: string) => localStorage.getItem(RECORD + JSON.stringify([name, id]));
export interface MetadataWrite { name: string; id: string; value: any }
/** Compensating metadata transaction for callers holding their resource lock.
 * Exact overlay snapshots preserve legacy fallback and tombstone revisions.
 */
export function writeBatch(changes: readonly MetadataWrite[]): void {
    const records = [...new Map(changes.map(change => {
        const key = RECORD + JSON.stringify([change.name, change.id]);
        const revision = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
        return [key, {key, before: localStorage.getItem(key), after: JSON.stringify(change.value === undefined ? {deleted: true, revision} : {value: change.value, revision})}] as const;
    })).values()];
    const changed: typeof records = [];
    try {
        for (const record of records) { localStorage.setItem(record.key, record.after); changed.push(record); }
    } catch (error) {
        const rollback: unknown[] = [];
        // Remove changed overlays first to release their quota before restoring
        // prior values. Removing a newly-created overlay reveals legacy data.
        for (const record of changed) {
            try { localStorage.removeItem(record.key); } catch (failure) { rollback.push(failure); }
        }
        for (const record of changed) if (record.before !== null) {
            try { localStorage.setItem(record.key, record.before); } catch (failure) { rollback.push(failure); }
        }
        try { localStorage.setItem(REVISION, `${Date.now()}:${Math.random().toString(36).slice(2)}`); } catch { }
        refresh(true);
        if (rollback.length) throw new AggregateError([error, ...rollback], 'Browser storage could not restore a metadata change. Keep this site data and retry when storage is available.');
        throw error;
    }
    try { localStorage.setItem(REVISION, `${Date.now()}:${Math.random().toString(36).slice(2)}`); } catch { }
    refresh(true);
}
export function write(name: string, id: string, value: any) {
    // A failed record write must throw without changing the last saved value.
    const revision = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(RECORD + JSON.stringify([name, id]), JSON.stringify(value === undefined ? {deleted: true, revision} : {value, revision}));
    try { localStorage.setItem(REVISION, `${Date.now()}:${Math.random().toString(36).slice(2)}`); } catch { /* The record itself is already durable; storage events still notify other tabs. */ }
    refresh(true);
}
const listeners = new Map<string, Set<(...args: any[]) => void>>();
export function emit(channel: string, ...args: any[]) { listeners.get(channel)?.forEach(fn => fn(...args)); }
export function on(channel: string, fn: (...args: any[]) => void) { if (!listeners.has(channel))
    listeners.set(channel, new Set()); listeners.get(channel)!.add(fn); return () => { listeners.get(channel)?.delete(fn); }; }
let database: Promise<IDBDatabase> | undefined;
function open() { return database ??= new Promise((resolve, reject) => { const request = indexedDB.open('anitrack-web-offline', 1); request.onupgradeneeded = () => request.result.createObjectStore('files'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Your browser could not open offline storage.')); }); }
export async function saveFile(key: string, value: any) { const db = await open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('Offline storage is full or unavailable.')); tx.onabort = () => reject(new Error('The offline save was interrupted.')); }); }
export async function loadFile<T = any>(key: string): Promise<T | undefined> { const db = await open(); return new Promise((resolve, reject) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); }); }
export async function deleteFile(key: string) { const db = await open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
async function rpcRequest(signal: AbortSignal | undefined, operation: string, args: any[]): Promise<any> { const timeout = AbortSignal.timeout(120000); const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, args }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); const result: any = await response.json(); if (!response.ok || result.error)
    throw new Error(result.error || 'The source could not be reached.'); return result.value; }
export function request(operation: string, ...args: any[]): Promise<any> { return rpcRequest(undefined, operation, args); }
export function requestWithSignal(signal: AbortSignal, operation: string, ...args: any[]): Promise<any> { return rpcRequest(signal, operation, args); }
export async function result<T>(promise: Promise<T>): Promise<{
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
}> { try {
    return { ok: true, value: await promise };
}
catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The source could not be reached.' };
} }
export async function readCached<T>(key: string): Promise<{
    at: number;
    value: T;
} | null> { return table('catalogueCache')[key] ?? null; }
export async function writeCached(key: string, value: any) { write('catalogueCache', key, { at: Date.now(), value }); }
