import { table, values, write, request, emit, on } from './browser-storage';
import { AccountSyncQueue, type AccountService, type AccountSyncJob, type BrowserAccountSyncApi } from './account-sync';
import { alGql, mapMedia, MEDIA_FIELDS } from '../source/apps/desktop/renderer/lib/capacitor-anilist';
import type { ApiBridge } from '../source/apps/desktop/renderer/types';
import type { ListEntry } from '../source/packages/shared/types';
const read = (service: string) => table('accounts')[service] ?? {};
const save = (service: string, value: any) => write('accounts', service, value);
const random = () => [...crypto.getRandomValues(new Uint8Array(48))].map(n => n.toString(16).padStart(2, '0')).join('');
const customClient = (service: string) => localStorage.getItem(`anitrack.web.${service}-client`)?.trim() ?? '';
const client = (service: string) => customClient(service) || table('publicAccountConfig').clients?.[service] || '';
export async function loadBrowserAccountDefaults() {
    try {
        const response = await fetch('/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({operation: 'accounts.config', args: []}), signal: AbortSignal.timeout(5000)});
        const payload = await response.json() as any;
        if (!response.ok || payload.error || !payload.value) return;
        const value = payload.value;
        const al = typeof value.alClientId === 'string' && /^\d{1,12}$/.test(value.alClientId) ? value.alClientId : '';
        const mal = typeof value.malClientId === 'string' && /^[a-zA-Z0-9]{10,80}$/.test(value.malClientId) ? value.malClientId : '';
        write('publicAccountConfig', 'clients', {al, mal});
        emit('al:state-changed', alState()); emit('mal:state-changed', malState());
        emit('account-sync:state', accountStatus());
    } catch { /* Offline startup keeps the last public client configuration. */ }
}
export const webCallback = () => `${location.origin}/`;
const alState = () => { const account = read('al'); return { connected: !!account.token && account.expiresAt > Date.now(), username: account.username ?? null, userId: account.userId ?? null, expiresAt: account.expiresAt ?? null, hasClientId: !!client('al') }; };
const malState = () => { const account = read('mal'); return { connected: !!account.token && !account.needsReconnect, username: account.username ?? null, expiresAt: account.expiresAt ?? null, needsReconnect: !!account.needsReconnect }; };
const statuses: Record<string, string> = { watching: 'CURRENT', completed: 'COMPLETED', on_hold: 'PAUSED', dropped: 'DROPPED', plan_to_watch: 'PLANNING' };
const fromStatus: Record<string, string> = { CURRENT: 'watching', REPEATING: 'watching', COMPLETED: 'completed', PAUSED: 'on_hold', DROPPED: 'dropped', PLANNING: 'plan_to_watch' };
async function browserLock<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, work);
    return work();
}
let refreshingMal: Promise<string> | null = null;
async function malToken(): Promise<string> {
    if (refreshingMal) return refreshingMal;
    const account = read('mal');
    if (!account.token || account.needsReconnect) throw new Error('Reconnect MyAnimeList to send these changes.');
    if (account.expiresAt - Date.now() >= 60000) return account.token;
    refreshingMal = browserLock('anitrack-web-mal-refresh', async () => {
        const current = read('mal');
        if (!current.token || current.needsReconnect) throw new Error('Reconnect MyAnimeList to send these changes.');
        if (current.expiresAt - Date.now() >= 60000) return current.token;
        try {
            const tokens = await request('mal.token', {clientId: current.clientId || client('mal'), grant_type: 'refresh_token', refresh_token: current.refresh});
            if (read('mal').token !== current.token) throw new Error('The connected account changed during sign-in.');
            save('mal', {...current, token: tokens.access_token, refresh: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, needsReconnect: false});
            return tokens.access_token;
        } catch (error) {
            if (read('mal').token === current.token && /401|invalid_grant|invalid_token|unauthori[sz]ed|revoked/i.test(error instanceof Error ? error.message : '')) save('mal', {...current, needsReconnect: true});
            emit('mal:state-changed', malState());
            throw error;
        }
    }).finally(() => {refreshingMal = null;});
    return refreshingMal;
}
function mergeEntry(entry: ListEntry, anime: any) { if (anime)
    write('anime', String(entry.animeId), anime); const previous = table('list')[String(entry.animeId)]; if (!previous || previous.updatedAt < entry.updatedAt)
    write('list', String(entry.animeId), entry); }
function accountConnection(service: AccountService) {
    const account = read(service);
    return {identity: !account.token ? null : service === 'al' ? (account.userId ? `al:${account.userId}` : null) : (account.username ? `mal:${account.username.toLowerCase()}` : null), connected: service === 'al' ? alState().connected : malState().connected};
}
async function sendAccountEntry(service: AccountService, entry: ListEntry, expectedAccount: string) {
    const current = table('list')[String(entry.animeId)];
    if (current?.updatedAt > entry.updatedAt) entry = current;
    if (service === 'al') {
        if (accountConnection(service).identity !== expectedAccount) throw new Error('The connected AniList account changed.');
        try { await request('al.action', read('al').token, 'save', {id: entry.animeId, status: statuses[entry.status], progress: entry.episodesWatched, score: entry.score ?? 0}); }
        catch (error) {
            if (/401|invalid.token|unauthenticated|unauthori[sz]ed/i.test(error instanceof Error ? error.message : '')) {
                save('al', {...read('al'), expiresAt: 0, authError: 'AniList signed this connection out. Reconnect to send waiting changes.'});
                emit('al:state-changed', alState());
            }
            throw error;
        }
    } else {
        const anime = table('anime')[String(entry.animeId)];
        if (!anime?.malId) throw new Error('This title has no linked MyAnimeList entry.');
        const token = await malToken();
        if (accountConnection(service).identity !== expectedAccount) throw new Error('The connected MyAnimeList account changed.');
        await request('mal.save', token, anime.malId, {status: entry.status, num_watched_episodes: entry.episodesWatched, score: Math.round(entry.score ?? 0)});
    }
}
const accountQueue = new AccountSyncQueue({
    jobs: () => values('accountSync') as AccountSyncJob[],
    save: (key, job) => write('accountSync', key, job),
    account: accountConnection,
    send: sendAccountEntry,
    exclusive: (service, work) => browserLock(`anitrack-web-account-${service}`, work),
    recordExclusive: (key, work) => browserLock(`anitrack-web-account-job-${key}`, work),
    changed: () => emit('account-sync:state', accountStatus()),
});
function accountStatus() {
    const status = accountQueue.status();
    for (const service of ['al', 'mal'] as AccountService[]) if (read(service).authError) status.errors[service] = read(service).authError;
    return status;
}
export const browserAccountSync: BrowserAccountSyncApi = {
    status: async () => accountStatus(),
    retry: async () => {await accountQueue.flush(true); return accountStatus();},
};
export async function queueListEntry(entry: ListEntry, only?: AccountService[]) {
    if (entry.animeId <= 0) return;
    const services = (only ?? ['al', 'mal']).filter(service => service !== 'mal' || !!table('anime')[String(entry.animeId)]?.malId) as AccountService[];
    await accountQueue.enqueue(entry, services);
}
let syncStarted = false;
export async function startBrowserAccountSync() {
    if (syncStarted) return;
    syncStarted = true;
    for (const id of Object.keys(table('syncErrors'))) {
        const entry = table('list')[id];
        if (entry) await queueListEntry(entry);
        write('syncErrors', id, undefined);
    }
    const resume = () => {void accountQueue.flush(true);};
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', () => {if (!document.hidden) resume();});
    on('storage:changed', (change: any) => {
        if (!change?.tables?.length || change.tables.some((name: string) => ['accounts', 'accountSync'].includes(name))) {
            emit('mal:state-changed', malState()); emit('al:state-changed', alState());
            emit('account-sync:state', accountStatus()); void accountQueue.flush();
        }
    });
    accountQueue.start();
}
export const browserAl: ApiBridge['al'] = {
    state: async () => alState(),
    setClientId: async (id) => { if (id && !/^\d{1,12}$/.test(id.trim()))
        throw new Error('AniList client IDs contain digits only.'); localStorage.setItem('anitrack.web.al-client', id.trim()); return alState(); },
    beginAuth: async () => { const id = client('al'); if (!id)
        return { ok: false, reason: `Register an AniList OAuth client with redirect URL ${webCallback()}, then enter its client ID below.` }; save('al', {...read('al'), authError: null}); const state = random(); sessionStorage.setItem('anitrack.web.oauth', JSON.stringify({ service: 'al', clientId: id, state, at: Date.now() })); location.assign(`https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(id)}&response_type=token&state=${state}`); return { ok: true }; },
    disconnect: async () => { save('al', {}); await accountQueue.cancelService('al'); emit('al:state-changed', alState()); return alState(); },
    pull: async () => { const account = read('al'); if (!alState().connected)
        throw new Error('Connect AniList first.'); const data = await request('al.action', account.token, 'list', account.userId); let imported = 0; for (const list of data.MediaListCollection?.lists ?? [])
        for (const item of list.entries ?? []) {
            if (!item.media || item.media.isAdult)
                continue;
            const anime = mapMedia(item.media);
            mergeEntry({ animeId: anime.id, status: fromStatus[item.status] as any ?? 'plan_to_watch', episodesWatched: item.progress ?? 0, score: item.score ?? 0, updatedAt: (item.updatedAt ?? Math.floor(Date.now() / 1000)) * 1000 }, anime);
            imported++;
        } return { imported }; },
};
export const browserMal: ApiBridge['mal'] = {
    state: async () => malState(), clientInfo: async () => ({ usingCustom: !!customClient('mal'), clientId: client('mal') || undefined }),
    setClientId: async (id) => { if (id && !/^[a-zA-Z0-9]{10,80}$/.test(id.trim()))
        throw new Error('Enter the public client ID from your MyAnimeList app registration.'); localStorage.setItem('anitrack.web.mal-client', id.trim()); return { ok: true, usingCustom: !!id.trim() }; },
    beginAuth: async () => { const id = client('mal'); if (!id)
        return { ok: false, reason: `Register a MyAnimeList OAuth client for ${webCallback()}, then enter its client ID in Advanced. The desktop client's callback cannot open this website.` }; save('mal', {...read('mal'), authError: null}); const state = random(), verifier = random(); sessionStorage.setItem('anitrack.web.oauth', JSON.stringify({ service: 'mal', clientId: id, state, verifier, at: Date.now() })); const params = new URLSearchParams({ client_id: id, response_type: 'code', code_challenge: verifier, code_challenge_method: 'plain', state, redirect_uri: webCallback() }); location.assign(`https://myanimelist.net/v1/oauth2/authorize?${params}`); return { ok: true }; },
    disconnect: async () => { save('mal', {}); await accountQueue.cancelService('mal'); emit('mal:state-changed', malState()); return malState(); },
    pull: async () => { const token = await malToken(); const rows = await request('mal.list', token); const byMal = new Map<number, any>(); for (let i = 0; i < rows.length; i += 50) {
        const ids = rows.slice(i, i + 50).map((r: any) => r.node.id);
        const data = await alGql<any>(`query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){${MEDIA_FIELDS}}}}`, { ids });
        for (const media of data.Page?.media ?? [])
            byMal.set(media.idMal, media);
    } let imported = 0; for (const row of rows) {
        const media = byMal.get(row.node.id);
        if (!media)
            continue;
        const anime = mapMedia(media);
        const status = row.list_status;
        mergeEntry({ animeId: anime.id, status: status.status, episodesWatched: status.num_episodes_watched, score: status.score, updatedAt: Date.parse(status.updated_at) || Date.now() }, anime);
        imported++;
    } emit('mal:pull-progress', imported); return { imported }; },
    push: async () => { await malToken(); await accountQueue.batch(async () => {for (const entry of values('list')) await queueListEntry(entry, ['mal']);}); const running = await accountQueue.flush(false, []); const result = await accountQueue.flush(true, ['mal']); return {pushed: running.sent.mal + result.sent.mal, errors: running.failed.mal + result.failed.mal}; },
};
export async function syncListEntry(entry: ListEntry) {
    await queueListEntry(entry);
    const result = await accountQueue.flush(true);
    if (result.failed.al || result.failed.mal) throw new Error('Some account changes are waiting for retry. Your local changes are saved.');
}
export async function finishBrowserAuth() {
    const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!query.has('code') && !hash.has('access_token') && !query.has('error') && !hash.has('error'))
        return;
    let flow: any;
    try {
        flow = JSON.parse(sessionStorage.getItem('anitrack.web.oauth') ?? 'null');
    }
    catch { }
    const service: AccountService = flow?.service === 'al' ? 'al' : 'mal';
    try {
      const state = query.get('state') ?? hash.get('state');
      if (!flow || !['al', 'mal'].includes(flow.service) || flow.state !== state || !Number.isFinite(flow.at) || Date.now() < flow.at || Date.now() - flow.at > 15 * 60000) throw new Error('This sign-in expired or belongs to another tab. Start sign-in again.');
      if (query.has('error') || hash.has('error')) throw new Error('Sign-in was cancelled or declined. You can connect again from Settings.');
      if (flow.service === 'al') {
        const token = hash.get('access_token');
        const viewer = await request('al.action', token, 'viewer');
        if (!viewer.Viewer?.id)
            throw new Error('AniList did not return your account.');
        save('al', { token, clientId: flow.clientId || client('al'), userId: viewer.Viewer.id, username: viewer.Viewer.name, expiresAt: Date.now() + Number(hash.get('expires_in') ?? 31536000) * 1000 });
      } else {
        const usedClient = flow.clientId || client('mal');
        const tokens = await request('mal.token', { clientId: usedClient, grant_type: 'authorization_code', code: query.get('code'), code_verifier: flow.verifier, redirect_uri: webCallback() });
        const viewer = await request('mal.viewer', tokens.access_token);
        save('mal', { token: tokens.access_token, clientId: usedClient, refresh: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, username: viewer.name });
      }
      emit(`${service}:auth-complete`, service === 'al' ? alState() : malState());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in could not finish. Try connecting again.';
      save(service, {...read(service), authError: message});
      emit(`${service}:auth-error`, message);
    } finally {
      sessionStorage.removeItem('anitrack.web.oauth');
      history.replaceState(null, '', `${location.pathname}#/settings`);
    }
}
